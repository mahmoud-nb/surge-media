import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { type ApiUploadConstraints, type DelegatedTokenClaims, delegatedTokenClaimsSchema } from '#shared/schemas/api'
import { DELEGATED_TOKEN_MAX_LENGTH, DELEGATED_TOKEN_PREFIX } from '#shared/utils/api'
import type { TokenScope } from '#shared/utils/permissions'
import { acceptedSigningSecrets, currentSigningSecret, keyId } from '../media/signing'

/**
 * Jetons délégués (architecture § 4.5) : `sm_dt_<charge>.<signature>`, émis par une clé secrète ou
 * un jeton personnel (POST /api/v1/projects/:id/delegated-tokens) pour un composant dans le
 * navigateur (envoi, sélection, médiathèque d'un back-office client).
 *
 *   - charge : JSON en base64url, lisible par le composant (échéance, portées, contraintes) ;
 *   - signature : HMAC-SHA256 avec une clé **dérivée** du secret de signature des médias (séparation
 *     des usages), désigné par `kid` : la rotation du secret (ancien secret accepté) vaut aussi ici ;
 *   - sans état : aucune ligne en base, vérification sans requête. L'émetteur est relu (cache 60 s) :
 *     le révoquer invalide ses jetons délégués. Pas de révocation individuelle (durée courte).
 *   - contrainte `maxFiles` : compteur `DelegatedTokenUsage` (incrément conditionnel atomique).
 *
 * Les fonctions pures (sans configuration ni base) sont testées dans tests/delegated.test.ts.
 */

export type DelegatedFailure = 'TOKEN_INVALID' | 'TOKEN_EXPIRED'
export type DelegatedDecoding = { ok: true, claims: DelegatedTokenClaims } | { ok: false, code: DelegatedFailure }

/** Jeton délégué vérifié, tel qu'utilisé par le contrôle d'accès. */
export interface DelegatedGrant {
  jti: string
  /** Identifiant (clé secrète ou jeton personnel) émetteur : ses droits actuels bornent le jeton. */
  issuerId: string
  projectId: string
  scopes: TokenScope[]
  subject: string | null
  origin: string | null
  upload: ApiUploadConstraints | null
  issuedAt: Date
  expiresAt: Date
}

// ─── Fonctions pures ─────────────────────────────────────────────────────────

/** Clé HMAC des jetons délégués, dérivée du secret de signature (jamais le secret lui-même). */
function delegatedKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('surge-media:delegated-token:v1').digest()
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', delegatedKey(secret)).update(`${DELEGATED_TOKEN_PREFIX}${payload}`).digest('base64url')
}

export function isDelegatedToken(value: string): boolean {
  return value.startsWith(DELEGATED_TOKEN_PREFIX)
}

export function encodeDelegatedToken(claims: DelegatedTokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${DELEGATED_TOKEN_PREFIX}${payload}.${sign(secret, payload)}`
}

/**
 * Vérifie un jeton présenté avec les secrets acceptés : forme, secret désigné par `kid`, signature
 * (temps constant), puis contenu et échéance. Rien n'est interprété avant la signature, hormis `kid`.
 */
export function decodeDelegatedToken(value: string, secrets: readonly string[], nowSeconds: number): DelegatedDecoding {
  const invalid = { ok: false, code: 'TOKEN_INVALID' } as const
  if (!isDelegatedToken(value) || value.length > DELEGATED_TOKEN_MAX_LENGTH) return invalid
  const [payload, signature, extra] = value.slice(DELEGATED_TOKEN_PREFIX.length).split('.')
  if (!payload || !signature || extra !== undefined) return invalid
  if (!/^[\w-]+$/.test(payload) || !/^[\w-]{43}$/.test(signature)) return invalid

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  }
  catch {
    return invalid
  }
  const kid = raw && typeof raw === 'object' ? (raw as { kid?: unknown }).kid : undefined
  const secret = typeof kid === 'string' ? secrets.find(candidate => keyId(candidate) === kid) : undefined
  if (!secret) return invalid

  const expected = Buffer.from(sign(secret, payload))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return invalid

  const parsed = delegatedTokenClaimsSchema.safeParse(raw)
  if (!parsed.success) return invalid
  if (parsed.data.exp <= nowSeconds) return { ok: false, code: 'TOKEN_EXPIRED' }
  return { ok: true, claims: parsed.data }
}

export function toDelegatedGrant(claims: DelegatedTokenClaims): DelegatedGrant {
  return {
    jti: claims.jti,
    issuerId: claims.iss,
    projectId: claims.project,
    scopes: claims.scopes,
    subject: claims.sub ?? null,
    origin: claims.origin ?? null,
    upload: claims.upload ?? null,
    issuedAt: new Date(claims.iat * 1000),
    expiresAt: new Date(claims.exp * 1000),
  }
}

// ─── Émission et vérification (configuration) ────────────────────────────────

export interface DelegatedTokenInput {
  issuerId: string
  projectId: string
  scopes: TokenScope[]
  subject?: string
  origin?: string
  upload?: ApiUploadConstraints
  /** Échéance (secondes Unix). */
  expires: number
}

/** Nouveau jeton délégué signé avec le secret courant. */
export function issueDelegatedToken(input: DelegatedTokenInput, nowSeconds = Math.floor(Date.now() / 1000)) {
  const secret = currentSigningSecret()
  const claims: DelegatedTokenClaims = {
    v: 1,
    jti: randomBytes(12).toString('base64url'),
    iss: input.issuerId,
    project: input.projectId,
    scopes: input.scopes,
    ...(input.subject ? { sub: input.subject } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
    ...(input.upload ? { upload: input.upload } : {}),
    iat: nowSeconds,
    exp: input.expires,
    kid: keyId(secret),
  }
  return { token: encodeDelegatedToken(claims, secret), claims }
}

export function verifyDelegatedToken(value: string): DelegatedDecoding {
  return decodeDelegatedToken(value, acceptedSigningSecrets(), Math.floor(Date.now() / 1000))
}

// ─── Compteur d'envois (contrainte maxFiles) ─────────────────────────────────

/**
 * Réserve un envoi pour un jeton limité en nombre de fichiers ; false si la limite est atteinte.
 * Incrément conditionnel atomique (`uploads < maxFiles`) : deux envois simultanés ne dépassent
 * jamais la limite. À libérer (`releaseDelegatedUpload`) si l'envoi échoue ensuite.
 */
export async function reserveDelegatedUpload(grant: DelegatedGrant): Promise<boolean> {
  const maxFiles = grant.upload?.maxFiles
  if (maxFiles === undefined) return true
  const prisma = await usePrisma()
  try {
    await prisma.delegatedTokenUsage.create({ data: { jti: grant.jti, expiresAt: grant.expiresAt } })
  }
  catch (error) {
    if (!isUniqueViolation(error)) throw error
  }
  const { count } = await prisma.delegatedTokenUsage.updateMany({
    where: { jti: grant.jti, uploads: { lt: maxFiles } },
    data: { uploads: { increment: 1 } },
  })
  return count === 1
}

/** Envois encore permis à un jeton limité en nombre de fichiers ; null sans limite de nombre. */
export async function remainingDelegatedUploads(grant: DelegatedGrant): Promise<number | null> {
  const maxFiles = grant.upload?.maxFiles
  if (maxFiles === undefined) return null
  const prisma = await usePrisma()
  const usage = await prisma.delegatedTokenUsage.findUnique({ where: { jti: grant.jti }, select: { uploads: true } })
  return Math.max(0, maxFiles - (usage?.uploads ?? 0))
}

export async function releaseDelegatedUpload(grant: DelegatedGrant): Promise<void> {
  if (grant.upload?.maxFiles === undefined) return
  try {
    const prisma = await usePrisma()
    await prisma.delegatedTokenUsage.updateMany({ where: { jti: grant.jti, uploads: { gt: 0 } }, data: { uploads: { decrement: 1 } } })
  }
  catch (error) {
    console.error('[surge-media] Compteur d\'envois d\'un jeton délégué non libéré :', error)
  }
}

/** Supprime les compteurs des jetons expirés (tâche périodique). */
export async function purgeDelegatedUsage(now = new Date()): Promise<number> {
  const prisma = await usePrisma()
  const { count } = await prisma.delegatedTokenUsage.deleteMany({ where: { expiresAt: { lt: now } } })
  return count
}
