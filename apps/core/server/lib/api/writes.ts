import type { H3Event } from 'h3'
import type { ApiMediaUpdate, ApiUploadRules } from '#shared/schemas/api'
import type { MediaMetadataInput } from '#shared/schemas/media'
import { DELEGATED_TOKEN_TTL } from '#shared/utils/api'
import { acceptedMimeTypes, type MediaKind, type MediaVisibility } from '#shared/utils/media'
import type { Media } from '../../generated/prisma/client'
import { type DelegatedGrant, releaseDelegatedUpload, remainingDelegatedUploads, reserveDelegatedUpload } from '../access/delegated'
import { uploadRules, uploadTypeRules } from '../media/limits'
import type { MediaProvenance, UploadOptions } from '../media/service'
import { type ReceivedUpload, receiveUpload } from '../media/upload'
import { videoProcessingActive } from '../video-processing/status'
import { type ApiPrincipal, requireUploadAllowance } from './context'
import { apiBaseUrl, apiProblem } from './problem'

/**
 * Écritures de l'API v1 : réception des fichiers avec les contraintes d'un jeton délégué
 * (nombre de fichiers, taille, types, visibilité imposée), provenance des médias créés et
 * conversion des champs publics (minuscules) vers le service médias.
 */

/** Provenance d'un média créé par l'API : identifiant (émetteur d'un jeton délégué), compte, sujet final. */
export function principalProvenance(principal: ApiPrincipal): MediaProvenance {
  return {
    userId: principal.credential.owner?.id ?? null,
    tokenId: principal.credential.id,
    subject: principal.delegated?.subject ?? null,
  }
}

/**
 * Champs publics (visibilité en minuscules) → saisie du service médias. `imposed` : contraintes d'un
 * jeton délégué (visibilité, dossier), prioritaires sur les champs envoyés.
 */
export function toMetadataInput(fields: ApiMediaUpdate, imposed: { visibility?: string, folderId?: string } | null = null): MediaMetadataInput {
  const visibility = imposed?.visibility ?? fields.visibility
  const folderId = imposed?.folderId ?? fields.folderId
  return {
    ...(fields.title === undefined ? {} : { title: fields.title }),
    ...(fields.altText === undefined ? {} : { altText: fields.altText }),
    ...(visibility ? { visibility: visibility.toUpperCase() as MediaVisibility } : {}),
    ...(folderId === undefined ? {} : { folderId }),
    ...(fields.focalPoint === undefined ? {} : { focalPoint: fields.focalPoint }),
  }
}

/**
 * Reçoit le fichier d'un envoi ou d'un remplacement puis exécute `task` : débit des envois,
 * réservation d'un envoi pour un jeton délégué limité (403 UPLOAD_LIMIT_REACHED, libérée si l'envoi
 * échoue), taille bornée par la limite du genre et celle du jeton, types restreints (refusés dès les
 * premiers octets, comme un autre genre que `expectedKind` pour un remplacement). Le fichier
 * temporaire est toujours supprimé.
 */
export async function withApiUpload<T>(
  event: H3Event,
  principal: ApiPrincipal,
  task: (upload: ReceivedUpload, options: UploadOptions) => Promise<T>,
  expectedKind?: MediaKind,
): Promise<T> {
  requireUploadAllowance(event, principal)
  const grant = principal.delegated
  if (grant && !(await reserveDelegatedUpload(grant))) {
    throw apiProblem('UPLOAD_LIMIT_REACHED', `This delegated token can send at most ${grant.upload?.maxFiles} files.`)
  }

  let succeeded = false
  try {
    // Types de l'installation en ce moment (formats convertis seulement si le traitement des vidéos est
    // actif), restreints à ceux du jeton délégué.
    const rules = uploadRules(grant?.upload?.types, grant?.upload?.maxSize, acceptedMimeTypes(await videoProcessingActive()))
    const upload = await receiveUpload(event, expectedKind ? { ...rules, expectedKind } : rules)
    try {
      // Types déjà restreints aux types de l'installation : l'analyse refuse (415) avec la même liste
      // que la réception, jamais un type du jeton que l'installation n'accepte pas.
      const result = await task(upload, { acceptedTypes: rules.acceptedTypes })
      succeeded = true
      return result
    }
    finally {
      await upload.cleanup()
    }
  }
  finally {
    if (grant && !succeeded) await releaseDelegatedUpload(grant)
  }
}

/**
 * Règles d'envoi effectives d'un identifiant (`GET /me`) : types que l'installation accepte en ce moment
 * (formats convertis seulement si le traitement des vidéos est actif), restreints par un jeton délégué, avec
 * la taille maximale de chacun ; envois restants et choix imposés par le jeton. null sans `media:upload`.
 */
export async function apiUploadRules(principal: ApiPrincipal): Promise<ApiUploadRules | null> {
  const grant = principal.delegated
  const scopes = grant ? grant.scopes : principal.credential.scopes
  if (!scopes.includes('media:upload')) return null
  const rules = uploadRules(grant?.upload?.types, grant?.upload?.maxSize, acceptedMimeTypes(await videoProcessingActive()))
  return {
    types: uploadTypeRules(rules),
    remaining: grant ? await remainingDelegatedUploads(grant) : null,
    visibility: grant?.upload?.visibility ?? null,
    folderId: grant?.upload?.folderId ?? null,
  }
}

/** Délai pendant lequel un jeton d'envoi peut poser l'affiche d'une vidéo envoyée : la durée maximale d'un jeton délégué. */
export const OWN_POSTER_WINDOW_MS = DELEGATED_TOKEN_TTL.max * 1000

/**
 * Affiche posée avec la seule portée `media:upload` (architecture phase E, ED31 ; pure) : vidéo envoyée
 * par le même émetteur et pour le même sujet qu'un jeton délégué, depuis moins d'une heure (un jeton
 * renouvelé entre-temps convient), et encore sans affiche. Toute autre affiche exige `media:write`.
 */
export function canSetOwnPoster(
  grant: Pick<DelegatedGrant, 'issuerId' | 'subject'> | null,
  media: Pick<Media, 'uploadedByTokenId' | 'uploadSubject' | 'createdAt' | 'posterKey'>,
  now = Date.now(),
): boolean {
  if (!grant || media.posterKey !== null) return false
  if (media.uploadedByTokenId !== grant.issuerId || (media.uploadSubject ?? null) !== grant.subject) return false
  const age = now - media.createdAt.getTime()
  return age >= 0 && age < OWN_POSTER_WINDOW_MS
}

/** URL absolue d'un média dans l'API (en-tête Location). */
export function apiMediaLocation(event: H3Event, media: Pick<Media, 'id' | 'projectId'>): string | null {
  return media.projectId ? `${apiBaseUrl(event)}/projects/${media.projectId}/media/${media.id}` : null
}
