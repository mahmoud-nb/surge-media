import type { H3Event } from 'h3'
import { extensionForMime } from '#shared/utils/media'
import type { TransformFormat } from '#shared/utils/transforms'
import { RENDITION_FORMATS, type RenditionName } from '#shared/utils/video-processing'
import { alignedExpiry, signMediaAccess } from './signing'

/** Dérivé désigné par son seul nom : l'aperçu (préréglage intégré), servi en WebP. */
export type MediaVariantName = 'preview'

/** Aperçus de l'administration : liens valables 1 h, échéance alignée sur le quart d'heure. */
const ADMIN_LINK_TTL = 3600
const ADMIN_LINK_BUCKET = 900
/**
 * Vidéos de l'administration : 6 h, échéance alignée sur l'heure. Le lecteur redemande des plages avec
 * la même URL pendant toute la lecture : un lien d'une heure couperait une longue vidéo privée.
 */
const ADMIN_VIDEO_LINK_TTL = 6 * 3600
const ADMIN_VIDEO_LINK_BUCKET = 3600

export interface UrlSource {
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
  if (variant) return derivedPath(media, variant, 'webp')
  const name = urlSlug(media.title || media.originalName)
  return `/m/${media.id}/v${media.version}/${name}.${extensionForMime(media.mimeType) ?? 'bin'}`
}

/**
 * Chemin d'un dérivé : `segment` = nom de préréglage ou transformation canonique
 * (shared/utils/transforms.ts, `transformationSegment`), format donné par l'extension.
 */
export function derivedPath(media: UrlSource, segment: string, format: TransformFormat): string {
  return `/m/${media.id}/v${media.version}/${segment}/${urlSlug(media.title || media.originalName)}.${format}`
}

/** Piste de texte d'une vidéo (élément `<track>`) : fichier WebVTT, identifié par la piste. */
export function trackPath(media: Pick<UrlSource, 'id' | 'version'>, trackId: string): string {
  return `/m/${media.id}/v${media.version}/tracks/${trackId}.vtt`
}

/**
 * Rendu d'une vidéo produit par ffmpeg (phase D3, élément `<source>`) : nom de fichier fixe
 * (`h264.mp4`, `av1.webm`), servi sous la version courante du média comme l'original.
 */
export function renditionPath(media: Pick<UrlSource, 'id' | 'version'>, name: RenditionName): string {
  return `/m/${media.id}/v${media.version}/renditions/${name}.${RENDITION_FORMATS[name].container}`
}

/** Affiche d'une vidéo (attribut `poster` de `<video>`, balises `og:image`) : préréglage `full`, en JPEG. */
export function posterPath(media: UrlSource): string {
  return derivedPath(media, 'full', 'jpg')
}

/**
 * Gabarit des chemins de dérivés (API, `urlTemplate`) : `{transform}` = préréglage ou paramètres,
 * `{format}` = format de sortie, à remplacer par l'application.
 */
export function derivedPathTemplate(media: UrlSource): string {
  return `/m/${media.id}/v${media.version}/{transform}/${urlSlug(media.title || media.originalName)}.{format}`
}

/** Lien de partage d'un fichier précis, valable exactement `ttlSeconds` secondes. */
export function signedMediaPath(media: UrlSource, ttlSeconds: number, variant?: MediaVariantName): { path: string, expiresAt: Date } {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds
  const query = signMediaAccess(media, { variant: variant ?? 'original' }, expires)
  return { path: `${mediaPath(media, variant)}?${query}`, expiresAt: new Date(expires * 1000) }
}

/** Chemins d'un média dans l'administration (`adminMediaPaths`). */
export interface AdminMediaPaths {
  url: string
  previewUrl: string | null
  posterUrl: string | null
  trackUrls: string[]
  /** Rendus demandés d'une vidéo (phase D3), par nom. */
  renditions: Partial<Record<RenditionName, string>>
}

/**
 * Chemins affichés dans l'administration. Un média public (hors corbeille) garde son URL
 * permanente ; un média privé ou dans la corbeille reçoit un lien signé « admin » d'environ 1 h,
 * identique pendant chaque quart d'heure (le navigateur réutilise les images en cache) — 6 h, par
 * tranche d'une heure, pour une vidéo. Le même lien couvre l'original, ses dérivés, ses pistes et ses
 * rendus (`renditionNames` : rendus existants, à la version courante) ; « admin » passe aussi la
 * retenue de la diffusion pendant le retrait d'une piste de métadonnées (503 pour les autres liens).
 */
export function adminMediaPaths(
  media: UrlSource & { kind: string, visibility: string, deletedAt: Date | null, posterKey?: string | null },
  withPreview: boolean,
  trackIds: readonly string[] = [],
  renditionNames: readonly RenditionName[] = [],
): AdminMediaPaths {
  const url = mediaPath(media)
  const previewUrl = withPreview ? mediaPath(media, 'preview') : null
  // Affiche d'une vidéo (attribut `poster`) : image entière réencodée, en JPEG.
  const posterUrl = media.posterKey ? posterPath(media) : null
  const trackUrls = trackIds.map(id => trackPath(media, id))
  const renditions = (suffix: string) => Object.fromEntries(
    renditionNames.map(name => [name, `${renditionPath(media, name)}${suffix}`]),
  ) as AdminMediaPaths['renditions']
  if (media.visibility === 'PUBLIC' && !media.deletedAt) return { url, previewUrl, posterUrl, trackUrls, renditions: renditions('') }

  const video = media.kind === 'VIDEO'
  const expires = alignedExpiry(
    Math.floor(Date.now() / 1000),
    video ? ADMIN_VIDEO_LINK_TTL : ADMIN_LINK_TTL,
    video ? ADMIN_VIDEO_LINK_BUCKET : ADMIN_LINK_BUCKET,
  )
  const query = signMediaAccess(media, { scope: 'admin' }, expires)
  return {
    url: `${url}?${query}`,
    previewUrl: previewUrl && `${previewUrl}?${query}`,
    posterUrl: posterUrl && `${posterUrl}?${query}`,
    trackUrls: trackUrls.map(path => `${path}?${query}`),
    renditions: renditions(`?${query}`),
  }
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
