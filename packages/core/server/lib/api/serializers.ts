import { createHash } from 'node:crypto'
import type { ApiFolder, ApiMedia, ApiPreset, ApiProject, ApiTextTrack } from '#shared/schemas/api'
import { API_LINK_BUCKET, API_LINK_TTL } from '#shared/utils/api'
import { extensionForMime } from '#shared/utils/media'
import type { TokenScope } from '#shared/utils/permissions'
import type { TransformPolicy } from '#shared/utils/transforms'
import type { Media, MediaTextTrack } from '../../generated/prisma/client'
import { alignedExpiry, signMediaAccess, type SignedAccess } from '../media/signing'
import { TEXT_TRACK_ORDER } from '../media/tracks'
import { derivedPathTemplate, mediaPath, posterPath, trackPath } from '../media/urls'
import { hasDerivedFiles, mediaFocalPoint } from '../media/variants'
import type { PresetSummary } from '../transforms/service'

/**
 * Représentations publiques de l'API v1 (contrat : shared/schemas/api.ts) et ETag. Indépendantes de
 * l'administration : valeurs en minuscules, dates ISO, URL absolues (base de diffusion), jamais de
 * clé de stockage, d'e-mail ni d'empreinte.
 */

/** Média lu pour l'API : avec ses pistes de texte (vidéos). */
export type ApiMediaRecord = Media & { textTracks: MediaTextTrack[] }
/** `include` Prisma des médias de l'API. */
export const API_MEDIA_INCLUDE = { textTracks: TEXT_TRACK_ORDER } as const

/** Échéance des URL signées incluses dans les réponses : ~1 h, alignée sur le quart d'heure. */
export function apiLinkExpiry(nowMs = Date.now()): number {
  return alignedExpiry(Math.floor(nowMs / 1000), API_LINK_TTL, API_LINK_BUCKET)
}

/**
 * Média v1 : URL permanentes pour un média public ; pour un média privé, URL signées (fichier,
 * aperçu, affiche d'une vidéo, et gabarit des dérivés avec le droit « derived ») valables jusqu'à
 * `expires`, identiques pendant chaque quart d'heure.
 */
export function toApiMedia(media: ApiMediaRecord, base: string, expires: number): ApiMedia {
  const signed = media.visibility === 'PRIVATE'
  const signature = (access: SignedAccess) => (signed ? `?${signMediaAccess(media, access, expires)}` : '')
  const hasPreview = hasDerivedFiles(media)
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
    url: `${base}${mediaPath(media)}${signature({ variant: 'original' })}`,
    previewUrl: hasPreview ? `${base}${mediaPath(media, 'preview')}${signature({ variant: 'preview' })}` : null,
    urlTemplate: hasPreview ? `${base}${derivedPathTemplate(media)}${signature({ scope: 'derived' })}` : null,
    poster: media.posterKey && media.posterWidth && media.posterHeight
      ? { url: `${base}${posterPath(media)}${signature({ variant: 'full' })}`, width: media.posterWidth, height: media.posterHeight, time: media.posterTime }
      : null,
    textTracks: media.textTracks.map(track => toApiTextTrack(media, track, base, expires)),
    focalPoint: mediaFocalPoint(media),
    urlExpiresAt: signed ? new Date(expires * 1000).toISOString() : null,
    createdAt: media.createdAt.toISOString(),
    updatedAt: media.updatedAt.toISOString(),
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

/**
 * ETag du détail d'un média : identifiant, version, date de modification ; pour un média privé,
 * aussi l'échéance des URL signées (une réponse 304 ne doit pas prolonger des URL expirées).
 */
export function mediaEtag(media: Pick<Media, 'id' | 'version' | 'updatedAt' | 'visibility'>, expires: number): string {
  const bucket = media.visibility === 'PRIVATE' ? `-${expires}` : ''
  return `W/"${media.id}-${media.version}-${media.updatedAt.getTime()}${bucket}"`
}

/** `If-None-Match` (liste, `*`, comparaison faible) contient-il l'ETag ? */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  const opaque = (value: string) => value.trim().replace(/^W\//, '')
  return ifNoneMatch.split(',').some(candidate => candidate.trim() === '*' || opaque(candidate) === opaque(etag))
}
