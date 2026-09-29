import type { H3Event } from 'h3'
import { extensionForMime, MEDIA_PRESETS, type MediaPreset } from '#shared/utils/media'
import { alignedExpiry, signMediaAccess } from './signing'

/** Dérivés nommés servis par /m/ (shared/utils/media.ts). */
export const MEDIA_VARIANTS = MEDIA_PRESETS
export type MediaVariantName = MediaPreset

/** Aperçus de l'administration : liens valables 1 h, échéance alignée sur le quart d'heure. */
const ADMIN_LINK_TTL = 3600
const ADMIN_LINK_BUCKET = 900

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

/** Lien de partage d'un fichier précis, valable exactement `ttlSeconds` secondes. */
export function signedMediaPath(media: UrlSource, ttlSeconds: number, variant?: MediaVariantName): { path: string, expiresAt: Date } {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds
  const query = signMediaAccess(media, { variant: variant ?? 'original' }, expires)
  return { path: `${mediaPath(media, variant)}?${query}`, expiresAt: new Date(expires * 1000) }
}

/**
 * Chemins affichés dans l'administration. Un média public (hors corbeille) garde son URL
 * permanente ; un média privé ou dans la corbeille reçoit un lien signé « admin » d'environ 1 h,
 * identique pendant chaque quart d'heure (le navigateur réutilise les images en cache).
 */
export function adminMediaPaths(
  media: UrlSource & { visibility: string, deletedAt: Date | null },
  withPreview: boolean,
): { url: string, previewUrl: string | null } {
  const url = mediaPath(media)
  const previewUrl = withPreview ? mediaPath(media, 'preview') : null
  if (media.visibility === 'PUBLIC' && !media.deletedAt) return { url, previewUrl }

  const expires = alignedExpiry(Math.floor(Date.now() / 1000), ADMIN_LINK_TTL, ADMIN_LINK_BUCKET)
  const query = signMediaAccess(media, { scope: 'admin' }, expires)
  return { url: `${url}?${query}`, previewUrl: previewUrl && `${previewUrl}?${query}` }
}

/**
 * Base absolue des URL de diffusion : NUXT_MEDIA_PUBLIC_URL (CDN, domaine dédié), sinon
 * NUXT_SITE_URL (domaine de l'application), sinon l'origine de la requête.
 */
export function mediaBaseUrl(event: H3Event): string {
  const { siteUrl, media } = useRuntimeConfig(event)
  const base = media.publicUrl || siteUrl || getRequestURL(event).origin
  return base.replace(/\/+$/, '')
}
