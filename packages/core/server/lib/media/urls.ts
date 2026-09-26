import { extensionForMime } from '#shared/utils/media'
import { signMediaTarget } from './signing'

/** Dérivés servis par /m/… ; les transformations (recadrage, formats…) viendront s'y ajouter. */
export const MEDIA_VARIANTS = ['preview'] as const
export type MediaVariantName = (typeof MEDIA_VARIANTS)[number]

interface UrlSource {
  id: string
  version: number
  mimeType: string
  originalName: string
  title: string | null
}

/** Nom lisible pour l'URL (ASCII, sans accents) : purement indicatif, jamais utilisé pour trouver le fichier. */
export function urlSlug(value: string): string {
  const withoutExtension = value.replace(/\.[a-z0-9]{1,5}$/i, '')
  return withoutExtension
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'media'
}

/**
 * Chemin de diffusion (jamais le chemin physique) :
 *   /m/<id>/v<version>/<nom>.<ext>             fichier original
 *   /m/<id>/v<version>/preview/<nom>.webp      aperçu
 * La version change à chaque remplacement : les URL publiques sont mises en cache sans limite.
 */
export function mediaPath(media: UrlSource, variant?: MediaVariantName): string {
  const extension = variant === 'preview' ? 'webp' : (extensionForMime(media.mimeType) ?? 'bin')
  const name = urlSlug(media.title || media.originalName)
  return `/m/${media.id}/v${media.version}/${variant ? `${variant}/` : ''}${name}.${extension}`
}

/** Chemin signé, valable `ttlSeconds` secondes, pour un média privé. */
export function signedMediaPath(media: UrlSource, ttlSeconds: number, variant?: MediaVariantName): { path: string, expiresAt: Date } {
  const { exp, sig } = signMediaTarget({ mediaId: media.id, version: media.version, variant: variant ?? 'original' }, ttlSeconds)
  return { path: `${mediaPath(media, variant)}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000) }
}
