import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Liens signés des médias (v2) : `?exp=<unix>&kid=<secret>[&scope=derived|admin]&sig=<HMAC-SHA256>`.
 *
 * La signature couvre `v2:<média>:<version>:<droit>:<échéance>`, où le droit est :
 *   - la cible exacte (sans `scope`) : `file` pour l'original, `preset:<nom>` pour un préréglage,
 *     `t:<transformation canonique>` pour des paramètres libres — jamais le format de sortie (une
 *     signature couvre les sources AVIF, WebP et JPEG d'un même <picture>) ;
 *   - ou un droit élargi (`scope`) : `derived` = tout dérivé de cette version, jamais l'original
 *     (un seul lien pour construire un srcset) ; `admin` = tout fichier de cette version, même dans
 *     la corbeille (aperçus de l'administration, qui n'utilise plus de cookie sur /m/).
 *
 * Signature **permanente** (sans `exp`, échéance signée `perm`) : cible exacte d'un dérivé, jamais
 * l'original ni un droit élargi ; la diffusion ne l'accepte que pour un média public (politique
 * « signed » des transformations, phase C).
 *
 * Vérification sans accès à la base. `kid` (empreinte courte du secret) désigne le secret utilisé :
 * pendant une rotation, NUXT_MEDIA_PREVIOUS_SIGNING_SECRET reste accepté. Invalidation : nouvelle
 * version du fichier, échéance, ou retrait du secret.
 *
 * Les fonctions pures (sans configuration) sont testées dans tests/signing.test.ts.
 */

export const SIGNATURE_SCOPES = ['derived', 'admin'] as const
export type SignatureScope = (typeof SIGNATURE_SCOPES)[number]

/**
 * Fichier demandé à /m/ : `variant` = `original`, nom d'un préréglage, ou `t:<transformation
 * canonique>` (delivery-path.ts, `deliveryVariant`).
 */
export interface SignatureTarget {
  mediaId: string
  version: number
  variant: string
}

/** Droit accordé par un lien : un fichier précis (`variant`) ou un droit élargi (`scope`). */
export type SignedAccess = { variant: string } | { scope: SignatureScope }

export interface SignatureQuery {
  exp?: unknown
  kid?: unknown
  scope?: unknown
  sig?: unknown
}

export type SignatureCheck =
  /** `expires` null : signature permanente. */
  | { status: 'valid', expires: number | null, scope: SignatureScope | null }
  | { status: 'invalid' | 'expired' }

// ─── Fonctions pures ─────────────────────────────────────────────────────────

/** Identifiant court d'un secret, publié dans les liens (ne révèle rien du secret). */
export function keyId(secret: string): string {
  return createHash('sha256').update(`surge-media:kid:${secret}`).digest('base64url').slice(0, 8)
}

/** Droit exigé pour un fichier : `file` (original), `preset:<nom>` ou `t:<transformation canonique>`. */
export function targetGrant(variant: string): string {
  if (variant === 'original') return 'file'
  return variant.startsWith('t:') ? variant : `preset:${variant}`
}

/** `expires` null : signature permanente. */
export function computeSignature(secret: string, mediaId: string, version: number, grant: string, expires: number | null): string {
  return createHmac('sha256', secret).update(`v2:${mediaId}:${version}:${grant}:${expires ?? 'perm'}`).digest('base64url')
}

/**
 * Échéance alignée sur la tranche suivante : toutes les demandes d'une même tranche produisent
 * la même URL (caches navigateur et CDN efficaces). Validité réelle entre `ttl` et `ttl + bucket`.
 */
export function alignedExpiry(nowSeconds: number, ttlSeconds: number, bucketSeconds: number): number {
  return Math.ceil((nowSeconds + ttlSeconds) / bucketSeconds) * bucketSeconds
}

/**
 * Paramètres d'un lien signé (sans « ? »), dans un ordre stable. `expires` null : signature
 * permanente (cible exacte d'un dérivé seulement).
 */
export function buildSignatureQuery(secret: string, media: { id: string, version: number }, access: SignedAccess, expires: number | null): string {
  const scope = 'scope' in access ? access.scope : null
  const grant = scope ?? targetGrant((access as { variant: string }).variant)
  if (expires === null && (scope || grant === 'file')) throw new Error('A permanent signature only covers an exact derived file.')
  const sig = computeSignature(secret, media.id, media.version, grant, expires)
  return `${expires === null ? '' : `exp=${expires}&`}kid=${keyId(secret)}${scope ? `&scope=${scope}` : ''}&sig=${sig}`
}

/** Vérifie les paramètres signés d'une demande avec les secrets acceptés (le courant en premier). */
export function checkSignature(secrets: readonly string[], target: SignatureTarget, query: SignatureQuery, nowSeconds: number): SignatureCheck {
  const permanent = query.exp === undefined
  const expires = permanent ? null : Number(query.exp)
  const { kid, sig } = query
  if (typeof sig !== 'string' || typeof kid !== 'string' || (expires !== null && !Number.isSafeInteger(expires))) return { status: 'invalid' }

  let scope: SignatureScope | null = null
  if (query.scope !== undefined) {
    if (!SIGNATURE_SCOPES.includes(query.scope as SignatureScope)) return { status: 'invalid' }
    scope = query.scope as SignatureScope
    // Le droit « derived » ne couvre jamais l'original.
    if (scope === 'derived' && target.variant === 'original') return { status: 'invalid' }
  }
  // Une signature permanente ne vaut que pour un dérivé précis.
  if (permanent && (scope || target.variant === 'original')) return { status: 'invalid' }

  const secret = secrets.find(candidate => keyId(candidate) === kid)
  if (!secret) return { status: 'invalid' }

  const expected = Buffer.from(computeSignature(secret, target.mediaId, target.version, scope ?? targetGrant(target.variant), expires))
  const received = Buffer.from(sig)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { status: 'invalid' }
  if (expires !== null && expires <= nowSeconds) return { status: 'expired' }
  return { status: 'valid', expires, scope }
}

// ─── Secrets (configuration) ─────────────────────────────────────────────────

let derivedSecret: string | undefined

/**
 * Secret courant : NUXT_MEDIA_SIGNING_SECRET, sinon dérivé du secret des sessions. Sert aussi, par
 * une clé dérivée, aux jetons délégués (server/lib/access/delegated.ts).
 */
export function currentSigningSecret(): string {
  const { media, session } = useRuntimeConfig()
  if (media.signingSecret) return media.signingSecret
  // Repli : secret dérivé de celui des sessions (le changer invaliderait aussi les liens).
  // `pnpm db:init` génère un NUXT_MEDIA_SIGNING_SECRET dédié.
  const sessionSecret = session.password || process.env.NUXT_SESSION_PASSWORD
  if (!sessionSecret) throw new Error('[surge-media] NUXT_MEDIA_SIGNING_SECRET (ou NUXT_SESSION_PASSWORD) doit être défini.')
  derivedSecret ??= createHmac('sha256', sessionSecret).update('surge-media:media-signing').digest('base64url')
  return derivedSecret
}

/** Secrets acceptés à la vérification : le courant, puis l'ancien pendant une rotation. */
export function acceptedSigningSecrets(): string[] {
  const previous = useRuntimeConfig().media.previousSigningSecret
  return previous ? [currentSigningSecret(), previous] : [currentSigningSecret()]
}

/**
 * Paramètres signés (sans « ? ») donnant `access` au média jusqu'à `expires` (secondes Unix), ou
 * sans échéance (`null` : dérivé précis d'un média public).
 */
export function signMediaAccess(media: { id: string, version: number }, access: SignedAccess, expires: number | null): string {
  return buildSignatureQuery(currentSigningSecret(), media, access, expires)
}

export function verifyMediaSignature(target: SignatureTarget, query: SignatureQuery): SignatureCheck {
  return checkSignature(acceptedSigningSecrets(), target, query, Math.floor(Date.now() / 1000))
}
