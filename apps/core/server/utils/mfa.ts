import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import type { User as SessionUser } from '#auth-utils'
import { MFA_CHALLENGE_SECONDS, MFA_SETUP_SECONDS, mfaRequiredFor, normalizeTotpCode, parseMfaPolicy, type MfaErrorCode, type MfaLoginStep, type MfaPolicy } from '#shared/utils/mfa'
import { EMAIL_LOCALES, type EmailLocale } from '#shared/utils/users'
import type { User } from '../generated/prisma/client'
import { mfaNoticeMail, type MfaNoticeKind } from '../lib/mail/mfa-notice'
import { mailEnabled, sendMail } from '../lib/mail/transport'
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from '../lib/mfa/recovery-codes'
import { MFA_KEY_MIN_LENGTH, MfaSecretError, openMfaSecret, sealMfaSecret } from '../lib/mfa/secret-box'
import { base32Decode, base32Encode, verifyTotp } from '../lib/mfa/totp'

/**
 * Double authentification (TOTP) de l'administration — architecture : .claude/architecture-mfa.md.
 *
 * Connexion en deux temps : après le mot de passe, aucune session n'est ouverte tant que le second facteur
 * n'est pas donné ; l'attente vit dans un cookie scellé (« défi », 5 min, chemin /api/auth). Un compte que
 * la politique oblige à configurer son application le fait dans ce même défi. La configuration en cours
 * (secret pas encore confirmé) vit dans un second cookie scellé, jamais en base.
 */

const CHALLENGE_COOKIE = 'surge-media-mfa'
const SETUP_COOKIE = 'surge-media-mfa-setup'
const POLICY_SETTING_KEY = 'mfaPolicy'

/** Codes refusés : 10 par compte en 15 min, 5 par défi (au-delà, retour au mot de passe). */
export const mfaCodeFailures = createRateLimiter({ max: 10, windowMs: 15 * 60_000 })
export const mfaChallengeFailures = createRateLimiter({ max: 5, windowMs: MFA_CHALLENGE_SECONDS * 1000 })

interface MfaChallenge { userId: string, kind: MfaLoginStep, challengeId: string, expiresAt: number }
interface MfaSetup { userId: string, secret: string, expiresAt: number }

/** Erreur de la double authentification : statut HTTP + code (`data.code`) traduit par l'interface. */
export function mfaError(statusCode: 403 | 409 | 410 | 422, code: MfaErrorCode) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}

// ─── Configuration et politique ──────────────────────────────────────────────

function mfaEncryptionKey(event: H3Event): string | undefined {
  return useRuntimeConfig(event).mfa?.encryptionKey || undefined
}

/** La clé de chiffrement est-elle configurée ? Sans elle, aucune activation n'est possible. */
export function mfaAvailable(event: H3Event): boolean {
  return (mfaEncryptionKey(event)?.length ?? 0) >= MFA_KEY_MIN_LENGTH
}

export async function readMfaPolicy(): Promise<MfaPolicy> {
  const prisma = await usePrisma()
  return parseMfaPolicy((await prisma.setting.findUnique({ where: { key: POLICY_SETTING_KEY } }))?.value)
}

export async function writeMfaPolicy(policy: MfaPolicy): Promise<void> {
  const prisma = await usePrisma()
  await prisma.setting.upsert({ where: { key: POLICY_SETTING_KEY }, create: { key: POLICY_SETTING_KEY, value: policy }, update: { value: policy } })
}

/** La politique exige-t-elle la double authentification de ce compte ? (Jamais sans clé : personne n'est bloqué.) */
export async function mfaRequiredForUser(event: H3Event, user: User): Promise<boolean> {
  return mfaAvailable(event) && mfaRequiredFor(user.role, await readMfaPolicy())
}

/** Émetteur affiché par l'application d'authentification : « SurgeMedia (hôte de l'installation) ». */
export function mfaIssuer(event: H3Event): string {
  const site = useRuntimeConfig(event).siteUrl || getRequestURL(event).origin
  try {
    return `SurgeMedia (${new URL(site).host})`
  }
  catch {
    return 'SurgeMedia'
  }
}

// ─── Cookies scellés : défi de connexion et configuration en cours ──────────

function sealedCookie(event: H3Event, name: string, maxAge: number) {
  const config = useRuntimeConfig(event).session
  return {
    name,
    password: config.password,
    maxAge,
    cookie: { httpOnly: true, secure: !config.cookie || config.cookie.secure !== false, sameSite: 'strict' as const, path: '/api/auth' },
  }
}

async function readSealed<T extends { expiresAt: number }>(event: H3Event, name: string, maxAge: number): Promise<T | null> {
  // Pas de cookie : ne pas appeler useSession, qui en poserait un vide.
  if (!getCookie(event, name)) return null
  const session = await useSession<Partial<T>>(event, sealedCookie(event, name, maxAge))
  const data = session.data as Partial<T>
  return data.expiresAt && data.expiresAt > Date.now() ? data as T : null
}

async function writeSealed<T extends object>(event: H3Event, name: string, maxAge: number, data: T): Promise<void> {
  const session = await useSession<T>(event, sealedCookie(event, name, maxAge))
  await session.clear()
  await session.update(data)
}

async function clearSealed(event: H3Event, name: string, maxAge: number): Promise<void> {
  if (!getCookie(event, name)) return
  const session = await useSession(event, sealedCookie(event, name, maxAge))
  await session.clear()
}

export function readMfaChallenge(event: H3Event): Promise<MfaChallenge | null> {
  return readSealed<MfaChallenge>(event, CHALLENGE_COOKIE, MFA_CHALLENGE_SECONDS)
}

async function startMfaChallenge(event: H3Event, user: User, kind: MfaLoginStep): Promise<void> {
  await clearSealed(event, SETUP_COOKIE, MFA_SETUP_SECONDS)
  await writeSealed<MfaChallenge>(event, CHALLENGE_COOKIE, MFA_CHALLENGE_SECONDS, {
    userId: user.id,
    kind,
    challengeId: randomUUID(),
    expiresAt: Date.now() + MFA_CHALLENGE_SECONDS * 1000,
  })
}

export function clearMfaChallenge(event: H3Event): Promise<void> {
  return clearSealed(event, CHALLENGE_COOKIE, MFA_CHALLENGE_SECONDS)
}

/** Compte du défi en cours (actif, et du type attendu), ou 410 MFA_CHALLENGE_EXPIRED. */
export async function requireMfaChallenge(event: H3Event, kind: MfaLoginStep): Promise<{ challenge: MfaChallenge, user: User }> {
  const challenge = await readMfaChallenge(event)
  if (challenge?.kind === kind) {
    const prisma = await usePrisma()
    const user = await prisma.user.findUnique({ where: { id: challenge.userId } })
    // Défi « code » : le compte doit toujours avoir son MFA (réinitialisé entre-temps → recommencer).
    if (user?.isActive && (kind === 'setup' || user.mfaSecret)) return { challenge, user }
  }
  await clearMfaChallenge(event)
  throw mfaError(410, 'MFA_CHALLENGE_EXPIRED')
}

/** Nouveau secret en attente de confirmation, pour ce compte. */
export async function startMfaSetup(event: H3Event, user: User, secret: Buffer): Promise<void> {
  await writeSealed<MfaSetup>(event, SETUP_COOKIE, MFA_SETUP_SECONDS, {
    userId: user.id,
    secret: base32Encode(secret),
    expiresAt: Date.now() + MFA_SETUP_SECONDS * 1000,
  })
}

/** Secret en attente de ce compte, ou 410 MFA_SETUP_EXPIRED. */
export async function requireMfaSetup(event: H3Event, user: User): Promise<Buffer> {
  const setup = await readSealed<MfaSetup>(event, SETUP_COOKIE, MFA_SETUP_SECONDS)
  const secret = setup?.userId === user.id ? base32Decode(setup.secret) : null
  if (!secret) throw mfaError(410, 'MFA_SETUP_EXPIRED')
  return secret
}

export function clearMfaSetup(event: H3Event): Promise<void> {
  return clearSealed(event, SETUP_COOKIE, MFA_SETUP_SECONDS)
}

/**
 * Compte qui configure son application : celui d'un défi « setup » de la connexion (politique), ou le
 * compte connecté en mode sudo (page « Mon compte »).
 */
export async function resolveMfaSetupAccount(event: H3Event): Promise<{ user: User, fromLogin: boolean }> {
  const challenge = await readMfaChallenge(event)
  if (challenge?.kind === 'setup') return { user: (await requireMfaChallenge(event, 'setup')).user, fromLogin: true }
  return { user: await requireRecentPassword(event), fromLogin: false }
}

// ─── Vérification ────────────────────────────────────────────────────────────

/**
 * Vérifie un code de l'application du compte et l'enregistre comme dernier pas utilisé (anti-rejeu, écriture
 * conditionnelle : deux requêtes simultanées avec le même code ne passent pas toutes les deux). 409
 * MFA_UNAVAILABLE si le secret ne se déchiffre pas (clé absente ou changée : message pour l'exploitant).
 */
export async function verifyUserTotp(event: H3Event, user: User, input: string): Promise<boolean> {
  const code = normalizeTotpCode(input)
  if (!code || !user.mfaSecret) return false
  let secret: Buffer
  try {
    secret = openMfaSecret(user.mfaSecret, user.id, mfaEncryptionKey(event))
  }
  catch (error) {
    if (!(error instanceof MfaSecretError)) throw error
    console.error(`[surge-media] Double authentification : secret de ${user.email} illisible (${error.reason}). Vérifiez NUXT_MFA_ENCRYPTION_KEY ; en dernier recours : surge-media user mfa-reset.`)
    throw mfaError(409, 'MFA_UNAVAILABLE')
  }
  const step = verifyTotp(secret, code, { nowMs: Date.now(), lastStep: user.mfaLastStep })
  if (step === null) return false
  const prisma = await usePrisma()
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
    data: { mfaLastStep: step },
  })
  return count === 1
}

/** Consomme un code de secours du compte ; renvoie les codes restants, ou null si le code est refusé. */
export async function consumeRecoveryCode(user: User, input: string): Promise<number | null> {
  if (!normalizeRecoveryCode(input)) return null
  const prisma = await usePrisma()
  const { count } = await prisma.mfaRecoveryCode.updateMany({
    where: { userId: user.id, codeHash: hashRecoveryCode(input), usedAt: null },
    data: { usedAt: new Date() },
  })
  return count === 1 ? countRecoveryCodes(user.id) : null
}

/** Second facteur d'un compte : code de l'application ou code de secours (`remaining` : codes restants). */
export async function verifyMfaProof(event: H3Event, user: User, proof: { code?: string, recoveryCode?: string }): Promise<{ ok: boolean, remaining?: number }> {
  if (proof.code) return { ok: await verifyUserTotp(event, user, proof.code) }
  const remaining = proof.recoveryCode ? await consumeRecoveryCode(user, proof.recoveryCode) : null
  return remaining === null ? { ok: false } : { ok: true, remaining }
}

/**
 * Compte les essais refusés (par compte, et par défi s'il y en a un) ; 429 + Retry-After au-delà. À appeler
 * avant de vérifier un code : `check` lève l'erreur, `fail` enregistre un échec, `succeed` remet à zéro.
 */
export function mfaAttempts(event: H3Event, userId: string, challengeId?: string) {
  const keys = [{ limiter: mfaCodeFailures, key: userId }, ...(challengeId ? [{ limiter: mfaChallengeFailures, key: challengeId }] : [])]
  return {
    check() {
      const retryAfter = Math.max(...keys.map(({ limiter, key }) => limiter.retryAfter(key)))
      if (retryAfter > 0) {
        setResponseHeader(event, 'Retry-After', retryAfter)
        throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
      }
    },
    fail() {
      for (const { limiter, key } of keys) limiter.hit(key)
    },
    succeed() {
      mfaCodeFailures.reset(userId)
    },
  }
}

// ─── Activation, codes de secours, désactivation ────────────────────────────

export async function countRecoveryCodes(userId: string): Promise<number> {
  const prisma = await usePrisma()
  return prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } })
}

/**
 * Active la double authentification avec le secret confirmé (`step` : pas du code de confirmation, déjà
 * utilisé) ; remplace les codes de secours et retire les appareils de confiance du compte (approuvés sans
 * second facteur). Renvoie les nouveaux codes, à montrer une seule fois.
 */
export async function enableUserMfa(event: H3Event, user: User, secret: Buffer, step: number): Promise<string[]> {
  const sealed = sealMfaSecret(secret, user.id, mfaEncryptionKey(event))
  const codes = generateRecoveryCodes()
  const prisma = await usePrisma()
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { mfaSecret: sealed, mfaEnabledAt: new Date(), mfaLastStep: step } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.mfaRecoveryCode.createMany({ data: codes.map(code => ({ userId: user.id, codeHash: hashRecoveryCode(code) })) }),
  ])
  // Toujours le navigateur du titulaire (connexion ou « Mon compte ») : son cookie est effacé aussi.
  await revokeTrustedDevices(user.id, event)
  return codes
}

/** Remplace les codes de secours d'un compte ; renvoie les nouveaux. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes()
  const prisma = await usePrisma()
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({ data: codes.map(code => ({ userId, codeHash: hashRecoveryCode(code) })) }),
  ])
  return codes
}

/**
 * Désactive (titulaire) ou réinitialise (administrateur) la double authentification d'un compte : secret,
 * codes de secours et appareils de confiance retirés. `event` du titulaire : son cookie de confiance est
 * aussi effacé.
 */
export async function disableUserMfa(userId: string, event?: H3Event): Promise<void> {
  const prisma = await usePrisma()
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
  ])
  await revokeTrustedDevices(userId, event)
}

/** État présenté au compte connecté (page « Mon compte »). */
export async function mfaState(event: H3Event, user: User) {
  return {
    enabled: Boolean(user.mfaSecret),
    enabledAt: user.mfaEnabledAt,
    recoveryCodesLeft: user.mfaSecret ? await countRecoveryCodes(user.id) : 0,
    required: await mfaRequiredForUser(event, user),
    available: mfaAvailable(event),
  }
}

// ─── Connexion ───────────────────────────────────────────────────────────────

/**
 * Suite de la connexion une fois le mot de passe vérifié : session ouverte (pas de MFA, ou appareil de
 * confiance approuvé après un second facteur), défi « code », ou défi « setup » si la politique l'exige.
 */
export async function continueLogin(event: H3Event, user: User): Promise<{ user: SessionUser } | { mfa: MfaLoginStep }> {
  if (user.mfaSecret) {
    const device = await findTrustedDevice(event, user)
    if (!device?.secondFactorAt) {
      await startMfaChallenge(event, user, 'code')
      return { mfa: 'code' }
    }
  }
  else if (await mfaRequiredForUser(event, user)) {
    await startMfaChallenge(event, user, 'setup')
    return { mfa: 'setup' }
  }
  await startSession(event, user)
  return { user: toSessionUser(user) }
}

// ─── Notification par e-mail ─────────────────────────────────────────────────

/**
 * Prévient le titulaire d'un changement de sa double authentification (si le SMTP est configuré). Un échec
 * d'envoi est journalisé sans faire échouer l'action déjà faite.
 */
export async function notifyMfaChange(event: H3Event, user: User, kind: MfaNoticeKind, extra: { by?: string, remaining?: number } = {}): Promise<void> {
  if (!mailEnabled(event)) return
  const site = (useRuntimeConfig(event).siteUrl || getRequestURL(event).origin).replace(/\/+$/, '')
  const locale: EmailLocale = (EMAIL_LOCALES as readonly string[]).includes(user.locale) ? user.locale as EmailLocale : 'fr'
  try {
    await sendMail(event, mfaNoticeMail({ locale, kind, to: user.email, date: new Date(), site, ...extra }))
  }
  catch (error) {
    console.error(`[surge-media] Envoi d'e-mail impossible (${user.email}, double authentification) :`, error instanceof Error ? error.message : error)
  }
}
