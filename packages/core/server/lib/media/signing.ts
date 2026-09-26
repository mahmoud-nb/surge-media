import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * URL signées des médias privés : `?exp=<horodatage unix>&sig=<HMAC-SHA256>`.
 * La signature couvre l'identifiant, la version du fichier, le dérivé et l'échéance :
 * un lien ne donne accès qu'à ce fichier-là, jusqu'à cette date. Vérification sans
 * accès à la base. Invalidation : remplacement du fichier (nouvelle version) ou
 * changement du secret NUXT_MEDIA_SIGNING_SECRET (tous les liens).
 */

export interface SignedTarget {
  mediaId: string
  version: number
  /** Dérivé demandé (`original`, `preview`…). */
  variant: string
}

let derivedSecret: string | undefined

function signingSecret(): string {
  const { media, session } = useRuntimeConfig()
  if (media.signingSecret) return media.signingSecret
  // Repli : secret dérivé de celui des sessions (le changer invaliderait aussi les liens).
  // `pnpm db:init` génère un NUXT_MEDIA_SIGNING_SECRET dédié.
  const sessionSecret = session.password || process.env.NUXT_SESSION_PASSWORD
  if (!sessionSecret) throw new Error('[surge-media] NUXT_MEDIA_SIGNING_SECRET (ou NUXT_SESSION_PASSWORD) doit être défini.')
  derivedSecret ??= createHmac('sha256', sessionSecret).update('surge-media:media-signing').digest('base64url')
  return derivedSecret
}

function signature(target: SignedTarget, expires: number): string {
  return createHmac('sha256', signingSecret())
    .update(`${target.mediaId}:${target.version}:${target.variant}:${expires}`)
    .digest('base64url')
}

/** Paramètres de requête d'un lien valable `ttlSeconds` secondes. */
export function signMediaTarget(target: SignedTarget, ttlSeconds: number): { exp: number, sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return { exp, sig: signature(target, exp) }
}

export type SignatureCheck = { status: 'valid', expires: number } | { status: 'invalid' | 'expired' }

export function verifyMediaSignature(target: SignedTarget, exp: unknown, sig: unknown): SignatureCheck {
  const expires = Number(exp)
  if (typeof sig !== 'string' || !Number.isInteger(expires)) return { status: 'invalid' }
  const expected = Buffer.from(signature(target, expires))
  const received = Buffer.from(sig)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { status: 'invalid' }
  if (expires <= Math.floor(Date.now() / 1000)) return { status: 'expired' }
  return { status: 'valid', expires }
}
