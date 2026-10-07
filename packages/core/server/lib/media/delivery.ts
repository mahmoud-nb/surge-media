import type { H3Event } from 'h3'
import { CONVERTED_MIME_TYPES } from '#shared/utils/media'
import type { TokenScope } from '#shared/utils/permissions'
import type { TransformGrant } from '#shared/utils/transforms'
import { videoMetadata } from '#shared/utils/video'
import { deliveryHeld, type VideoProcessingMode } from '#shared/utils/video-processing'
import type { Media, MediaRendition } from '../../generated/prisma/client'
import { touchCredential } from '../access/credentials'
import { browserGuard, principalLibraryScopes, principalProjectScopes, resolvePrincipal } from '../access/principal'
import { getProjectState } from '../projects/state'
import { deliveryVariant, derivedSegment, type DeliveryTarget } from './delivery-path'
import { mediaError } from './errors'
import { findRendition } from './renditions'
import { verifyMediaSignature, type SignatureScope } from './signing'
import { derivedPath, mediaPath, renditionPath, trackPath, type UrlSource } from './urls'

/**
 * Diffusion des médias (/m/…) : contrôle d'accès et règles de la réponse (analyse des chemins :
 * delivery-path.ts ; fichiers : variants.ts, tracks.ts, renditions.ts). Le chemin physique n'est jamais
 * exposé : l'URL ne contient que l'identifiant, la version, la transformation et un nom indicatif.
 * Les décisions pures (relecture du cache, redirection, retenue, disposition) sont testées dans
 * tests/renditions-delivery.test.ts.
 */

export { parseDeliveryPath, type DeliveryTarget } from './delivery-path'

/** Mode d'accès accordé, qui détermine la mise en cache de la réponse. */
export type DeliveryAccess =
  /** `signed` : signature permanente d'un dérivé précis (média public). */
  | { mode: 'public', signed: boolean }
  /** `scope` null : cible exacte. */
  | { mode: 'signed', expires: number, scope: SignatureScope | null }
  | { mode: 'credential' }

/**
 * Diffusion sans cookie (aucune session lue) :
 *   - média public : libre ; une signature permanente (dérivé précis) y est aussi acceptée ;
 *   - média privé : lien signé valable (fichier précis, droit « derived » ou « admin »), ou
 *     identifiant d'API (`Authorization: Bearer`) ayant `media:read` dans l'espace du média
 *     (jamais une clé publique ; jamais une clé secrète ou un jeton personnel depuis un navigateur ;
 *     un jeton délégué depuis une origine autorisée du projet) ;
 *   - média dans la corbeille : 404, sauf lien signé « admin » (aperçus de l'administration).
 */
export async function authorizeDelivery(event: H3Event, media: Media, target: DeliveryTarget): Promise<DeliveryAccess> {
  const query = getQuery(event)
  if (query.sig !== undefined || query.exp !== undefined) {
    const check = verifyMediaSignature({ mediaId: media.id, version: media.version, variant: deliveryVariant(target) }, query)
    if (check.status === 'valid') {
      // Signature permanente : seulement pour un média public (un média privé exige une échéance).
      if (check.expires === null) {
        if (!media.deletedAt && media.visibility === 'PUBLIC') return { mode: 'public', signed: true }
      }
      else if (!media.deletedAt || check.scope === 'admin') {
        return { mode: 'signed', expires: check.expires, scope: check.scope }
      }
    }
    // Corbeille : on ne révèle pas que le média existe.
    if (media.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    throw mediaError(403, check.status === 'expired' ? 'SIGNATURE_EXPIRED' : 'SIGNATURE_INVALID')
  }

  if (media.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  if (media.visibility === 'PUBLIC') return { mode: 'public', signed: false }
  const authorization = getRequestHeader(event, 'authorization')
  if (authorization) {
    await authorizeCredential(event, authorization, media)
    return { mode: 'credential' }
  }
  throw mediaError(403, 'MEDIA_FORBIDDEN')
}

/** Identifiant d'API présenté pour un média privé : 401 s'il n'est pas valable, 403 sans `media:read`. */
async function authorizeCredential(event: H3Event, authorization: string, media: Media): Promise<void> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization)
  const resolution = match ? await resolvePrincipal(match[1]!) : { ok: false as const, code: 'TOKEN_INVALID' as const }
  if (!resolution.ok) {
    setResponseHeader(event, 'WWW-Authenticate', 'Bearer realm="surgeMedia", error="invalid_token"')
    throw createError({ statusCode: 401, statusMessage: resolution.code, data: { code: resolution.code } })
  }
  const { principal } = resolution
  const refused = await browserGuard(event, principal)
  if (refused) throw createError({ statusCode: 403, statusMessage: refused, data: { code: refused } })

  let scopes: TokenScope[] = []
  if (media.projectId) {
    const project = await getProjectState(media.projectId)
    // Projet archivé : ses identifiants sont refusés.
    if (project && !project.archived) scopes = await principalProjectScopes(principal, project)
  }
  else {
    scopes = principalLibraryScopes(principal)
  }
  // Une clé publique ne lit jamais un média privé ; un jeton délégué seulement avec media:read.
  if (principal.type === 'publishable' || !scopes.includes('media:read')) throw mediaError(403, 'MEDIA_FORBIDDEN')
  if (!principal.delegated) touchCredential(principal.credential, getRequestIP(event))
}

/** Droit présenté pour une transformation libre (politique de l'espace : shared/utils/transforms.ts). */
export function transformGrant(access: DeliveryAccess): TransformGrant {
  if (access.mode === 'public') return access.signed ? 'exact' : 'none'
  if (access.mode === 'signed') return access.scope ?? 'exact'
  return 'credential'
}

/**
 * Une nouvelle génération libre est-elle soumise au débit par IP ? Non si l'appelant a été
 * authentifié (identifiant d'API) ou si l'URL a été signée pour cette cible précise (par le serveur
 * de l'application ou l'administration) ; oui sans signature ou avec le droit élargi « derived ».
 */
export function generationRateLimited(access: DeliveryAccess): boolean {
  const grant = transformGrant(access)
  return grant === 'none' || grant === 'derived'
}

/**
 * Cache HTTP selon le mode d'accès. `mutableMaxAge` : fichier public dont le contenu peut changer
 * sous la même URL (préréglage global ou de projet, modifiable) → mis en cache pour cette durée,
 * puis revalidé (ETag), au lieu d'`immutable`.
 */
export function cacheControl(access: DeliveryAccess, mutableMaxAge?: number): string {
  switch (access.mode) {
    // URL versionnée : son contenu ne change jamais (sauf préréglage modifiable).
    case 'public': return mutableMaxAge ? `public, max-age=${mutableMaxAge}` : 'public, max-age=31536000, immutable'
    // Lien signé : jamais au-delà de son échéance, et pas dans les caches partagés.
    case 'signed': return `private, max-age=${Math.max(0, Math.min(access.expires - Math.floor(Date.now() / 1000), 3600))}`
    // Identifiant d'API : réponse propre à l'appelant, toujours revalidée (ETag).
    case 'credential': return 'private, no-cache'
  }
}

/** Rendus connus d'un média (ligne du cache de diffusion). */
interface KnownRenditions {
  renditions: readonly Pick<MediaRendition, 'name' | 'container'>[]
}

/**
 * Le média en cache doit-il être relu avant de répondre (cache.ts, `reloadDeliveryMedia`) ? Oui pour une
 * version plus récente que la sienne : sans relecture, l'URL serait redirigée vers l'ancienne version,
 * dont le fichier a pu être supprimé (réécriture sans perte par un processus de travail). Oui pour un
 * rendu de sa version qu'il ne connaît pas : produit depuis, ailleurs (l'invalidation du cache est locale
 * au processus qui écrit). Jamais pour une ancienne version : la redirection suffit.
 */
export function deliveryReloadNeeded(target: DeliveryTarget, media: { version: number } & KnownRenditions): boolean {
  if (target.version > media.version) return true
  return target.kind === 'rendition' && target.version === media.version && !findRendition(media, target.name)
}

/**
 * Adresse courante d'une cible demandée sous une ancienne version (redirection 302) : le même fichier à
 * la version du média. Un rendu absent de la version courante (fichier remplacé, rendu pas encore
 * refait) renvoie vers l'original, toujours présent.
 */
export function currentTargetPath(media: UrlSource & KnownRenditions, target: DeliveryTarget): string {
  switch (target.kind) {
    case 'original': return mediaPath(media)
    case 'track': return trackPath(media, target.trackId)
    case 'rendition': return findRendition(media, target.name) ? renditionPath(media, target.name) : mediaPath(media)
    default: return derivedPath(media, derivedSegment(target), target.format)
  }
}

/**
 * Diffusion retenue pour cette demande (§ 32.4, 503 PROCESSING_PENDING) ? Seulement l'original et ses
 * rendus, qui contiennent encore la piste de métadonnées de l'appareil (positions GPS…) ; l'affiche, ses
 * dérivés et les pistes de texte restent servis. Un lien « admin » passe : l'administration lit la vidéo
 * pendant le traitement. Décidée d'après la ligne en cache : un cache en retard ne fait que prolonger la
 * retenue (au plus 60 s) ; il ne la lève jamais trop tôt, car une version plus récente que la sienne est
 * toujours relue avant d'être servie (`deliveryReloadNeeded`).
 */
export function holdApplies(
  target: Pick<DeliveryTarget, 'kind'>,
  media: Parameters<typeof deliveryHeld>[0],
  access: DeliveryAccess,
  mode: VideoProcessingMode,
): boolean {
  if (target.kind !== 'original' && target.kind !== 'rendition') return false
  if (access.mode === 'signed' && access.scope === 'admin') return false
  return deliveryHeld(media, mode)
}

/** `inline` : affiché par le navigateur ; `attachment` : proposé en téléchargement. */
export type ContentDispositionType = 'inline' | 'attachment'

/**
 * Disposition de l'original. Une vidéo d'un format converti (MKV, AVI…, phase D3) n'est jamais lue par
 * `<video>` ni par le navigateur : proposée en téléchargement plutôt qu'affichée en lecteur cassé (la
 * lecture passe par son rendu H.264). Le type MIME suffit avant l'analyse par ffprobe ; `playback: none`
 * couvre toute autre vidéo déclarée illisible par ses métadonnées.
 */
export function originalDisposition(media: { kind: string, mimeType: string, metadata: unknown }): ContentDispositionType {
  if (media.kind !== 'VIDEO') return 'inline'
  return CONVERTED_MIME_TYPES.includes(media.mimeType) || videoMetadata(media.metadata)?.playback === 'none' ? 'attachment' : 'inline'
}

/** En-tête Content-Disposition (affichage dans le navigateur ou téléchargement, nom lisible si téléchargé). */
export function contentDisposition(filename: string, disposition: ContentDispositionType = 'inline'): string {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '_') || 'media'
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
