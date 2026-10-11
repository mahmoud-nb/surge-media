import { createHash } from 'node:crypto'
import type { ApiFolder, ApiMedia, ApiMediaProcessing, ApiMediaSource, ApiPreset, ApiProject, ApiTextTrack } from '#shared/schemas/api'
import { API_LINK_BUCKET, API_LINK_TTL } from '#shared/utils/api'
import { extensionForMime } from '#shared/utils/media'
import type { TokenScope } from '#shared/utils/permissions'
import type { TransformPolicy } from '#shared/utils/transforms'
import { apiProcessingStatus, VIDEO_JOB_ERROR_CODES, type VideoJobErrorCode } from '#shared/utils/video-processing'
import type { Media, MediaJob, MediaTextTrack } from '../../generated/prisma/client'
import { alignedExpiry, signMediaAccess, type SignedAccess } from '../media/signing'
import { PROCESSING_INCLUDE, type ProcessingRelations, type SourceMedia, type SourceRendition, videoSources } from '../media/sources'
import { TEXT_TRACK_ORDER } from '../media/tracks'
import { derivedPathTemplate, mediaPath, posterPath, renditionPath, trackPath, type UrlSource } from '../media/urls'
import { hasDerivedFiles, mediaFocalPoint } from '../media/variants'
import type { PresetSummary } from '../transforms/service'

/**
 * Représentations publiques de l'API v1 (contrat : shared/schemas/api.ts) et ETag. Indépendantes de
 * l'administration : valeurs en minuscules, dates ISO, URL absolues (base de diffusion), jamais de
 * clé de stockage, d'e-mail ni d'empreinte.
 */

/**
 * Média lu pour l'API : avec ses pistes de texte (vidéos), ses rendus et sa dernière tâche de traitement
 * (phase D3 : `sources`, `processing`). Les médias renvoyés par le service (`MediaWithUploader`) ont les
 * mêmes relations.
 */
export type ApiMediaRecord = Media & { textTracks: MediaTextTrack[] } & ProcessingRelations
/** `include` Prisma des médias de l'API : toute lecture d'un média pour l'API v1 passe par lui. */
export const API_MEDIA_INCLUDE = { textTracks: TEXT_TRACK_ORDER, ...PROCESSING_INCLUDE } as const

/** Échéance des URL signées incluses dans les réponses : ~1 h, alignée sur le quart d'heure. */
export function apiLinkExpiry(nowMs = Date.now()): number {
  return alignedExpiry(Math.floor(nowMs / 1000), API_LINK_TTL, API_LINK_BUCKET)
}

/**
 * Média v1 : URL permanentes pour un média public ; pour un média privé, URL signées (fichier et
 * sources d'une vidéo, aperçu, affiche, et gabarit des dérivés avec le droit « derived ») valables
 * jusqu'à `expires`, identiques pendant chaque quart d'heure.
 */
export function toApiMedia(media: ApiMediaRecord, base: string, expires: number): ApiMedia {
  const signed = media.visibility === 'PRIVATE'
  const signature = (access: SignedAccess) => (signed ? `?${signMediaAccess(media, access, expires)}` : '')
  const hasPreview = hasDerivedFiles(media)
  // Le droit `file` couvre l'original et ses rendus : une seule signature pour `url` et `sources`.
  const fileQuery = signature({ variant: 'original' })
  return {
    id: media.id,
    projectId: media.projectId,
    kind: media.kind.toLowerCase(),
    visibility: media.visibility.toLowerCase(),
    title: media.title,
    altText: media.altText,
    filename: media.originalName,
    mimeType: media.mimeType,
    extension: extensionForMime(media.mimeType) ?? null,
    size: media.size,
    width: media.width,
    height: media.height,
    duration: media.duration,
    version: media.version,
    folderId: media.folderId,
    url: `${base}${mediaPath(media)}${fileQuery}`,
    sources: apiVideoSources(media, media.renditions, base, fileQuery),
    previewUrl: hasPreview ? `${base}${mediaPath(media, 'preview')}${signature({ variant: 'preview' })}` : null,
    urlTemplate: hasPreview ? `${base}${derivedPathTemplate(media)}${signature({ scope: 'derived' })}` : null,
    poster: media.posterKey && media.posterWidth && media.posterHeight
      ? { url: `${base}${posterPath(media)}${signature({ variant: 'full' })}`, width: media.posterWidth, height: media.posterHeight, time: media.posterTime }
      : null,
    textTracks: media.textTracks.map(track => toApiTextTrack(media, track, base, expires)),
    processing: toApiProcessing(media, media.jobs[0]),
    focalPoint: mediaFocalPoint(media),
    urlExpiresAt: signed ? new Date(expires * 1000).toISOString() : null,
    createdAt: media.createdAt.toISOString(),
    updatedAt: media.updatedAt.toISOString(),
  }
}

/**
 * Sources de lecture v1 d'une vidéo (ordre et règle : server/lib/media/sources.ts), URL absolues ;
 * `fileQuery` : suffixe de signature de l'original (`?…`, vide sans signature), repris tel quel par
 * chaque entrée. `[]` pour une image.
 */
export function apiVideoSources(
  media: SourceMedia & UrlSource,
  renditions: readonly SourceRendition[],
  base: string,
  fileQuery: string,
): ApiMediaSource[] {
  return videoSources(media, renditions, name => `${base}${name ? renditionPath(media, name) : mediaPath(media)}${fileQuery}`)
}

function isVideoJobErrorCode(code: string | null | undefined): code is VideoJobErrorCode {
  return (VIDEO_JOB_ERROR_CODES as readonly (string | null | undefined)[]).includes(code)
}

/**
 * Traitement v1 d'une vidéo d'après son état résumé et sa dernière tâche ; null pour un média jamais
 * traité (image, traitement désactivé). Avancement seulement pendant que la tâche tourne, code d'échec
 * seulement à l'état FAILED, jamais le détail technique (`errorDetail` : messages de ffmpeg).
 */
export function toApiProcessing(
  media: Pick<Media, 'processingState' | 'updatedAt'>,
  job: Pick<MediaJob, 'status' | 'progress' | 'errorCode' | 'updatedAt'> | undefined,
): ApiMediaProcessing | null {
  if (!media.processingState) return null
  const code = job?.errorCode
  return {
    status: apiProcessingStatus(media.processingState),
    progress: job?.status === 'RUNNING' ? job.progress : null,
    error: media.processingState === 'FAILED' && isVideoJobErrorCode(code) ? code : null,
    updatedAt: (job?.updatedAt ?? media.updatedAt).toISOString(),
  }
}

/** Piste de texte v1 : URL signée (droit `track:<piste>`) pour un média privé. */
export function toApiTextTrack(media: Media, track: MediaTextTrack, base: string, expires: number): ApiTextTrack {
  const query = media.visibility === 'PRIVATE' ? `?${signMediaAccess(media, { variant: `track:${track.id}` }, expires)}` : ''
  return {
    id: track.id,
    kind: track.kind.toLowerCase() as ApiTextTrack['kind'],
    language: track.language,
    label: track.label,
    default: track.isDefault,
    url: `${base}${trackPath(media, track.id)}${query}`,
    size: track.size,
    cueCount: track.cueCount,
    createdAt: track.createdAt.toISOString(),
  }
}

export interface ApiProjectSource {
  id: string
  name: string
  slug: string
  description: string | null
  publicListing: boolean
  transformPolicy: TransformPolicy
  createdAt: Date
  updatedAt: Date
}

export function toApiProject(project: ApiProjectSource, scopes: readonly TokenScope[]): ApiProject {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    publicListing: project.publicListing,
    transformPolicy: project.transformPolicy.toLowerCase() as ApiProject['transformPolicy'],
    scopes: [...scopes],
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

export function toApiPreset(preset: PresetSummary): ApiPreset {
  return { name: preset.name, transformation: preset.transformation, description: preset.description, level: preset.level }
}

export function toApiFolder(folder: { id: string, parentId: string | null, name: string, createdAt: Date, updatedAt: Date }): ApiFolder {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  }
}

// ─── ETag ────────────────────────────────────────────────────────────────────

/** ETag faible d'une réponse calculée à partir de ses ingrédients (fonction pure). */
export function weakEtag(parts: readonly unknown[]): string {
  return `W/"${createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 27)}"`
}

/** Champs d'un média lus pour son ETag : identité, version, date, visibilité, traitement (état, dernière tâche). */
export type EtagMedia = Pick<Media, 'id' | 'version' | 'updatedAt' | 'visibility' | 'processingState'>
  & { jobs: readonly Pick<MediaJob, 'id' | 'updatedAt'>[] }

/**
 * Part « traitement » d'un ETag (phase D3) : vide pour un média jamais traité, sinon l'état et la dernière
 * tâche (identifiant, date de sa dernière écriture). L'avancement n'est écrit que sur la tâche — ni
 * `Media.updatedAt` ni révision de l'espace — mais chaque écriture de la tâche (avancement, étape, essais,
 * bail) change son `updatedAt`, repris par `processing.updatedAt` : l'ETag change avec la réponse.
 */
function processingTag(media: EtagMedia): string {
  if (!media.processingState) return ''
  const job = media.jobs[0]
  return `-${media.processingState.toLowerCase()}${job ? `.${job.id}.${job.updatedAt.getTime()}` : ''}`
}

/**
 * ETag du détail d'un média : identifiant, version, date de modification, traitement ; pour un média
 * privé, aussi l'échéance des URL signées (une réponse 304 ne doit pas prolonger des URL expirées).
 */
export function mediaEtag(media: EtagMedia, expires: number): string {
  const bucket = media.visibility === 'PRIVATE' ? `-${expires}` : ''
  return `W/"${media.id}-${media.version}-${media.updatedAt.getTime()}${processingTag(media)}${bucket}"`
}

/**
 * Ingrédients d'ETag d'une page de médias dont le traitement est en attente ou en cours, ou null s'il n'y
 * en a aucun. L'ETag d'une liste vient de la révision de l'espace (304 sans requête), qui suit les
 * changements d'état du traitement mais pas son avancement : une page qui contient une tâche active reçoit
 * un ETag qui inclut aussi ces ingrédients, jamais égal à celui de la révision seule — sa revalidation
 * relit alors la page (voir server/api/v1/projects/[projectId]/media/index.get.ts).
 */
export function activeProcessingParts(items: readonly EtagMedia[]): string[] | null {
  const parts = items
    .filter(media => media.processingState === 'PENDING' || media.processingState === 'PROCESSING')
    .map(media => `${media.id}${processingTag(media)}`)
  return parts.length > 0 ? parts : null
}

/** `If-None-Match` (liste, `*`, comparaison faible) contient-il l'ETag ? */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  const opaque = (value: string) => value.trim().replace(/^W\//, '')
  return ifNoneMatch.split(',').some(candidate => candidate.trim() === '*' || opaque(candidate) === opaque(etag))
}
