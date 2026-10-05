import type { H3Event } from 'h3'
import type { ApiMediaUpdate } from '#shared/schemas/api'
import type { MediaMetadataInput } from '#shared/schemas/media'
import type { MediaKind, MediaVisibility } from '#shared/utils/media'
import type { Media } from '../../generated/prisma/client'
import { releaseDelegatedUpload, reserveDelegatedUpload } from '../access/delegated'
import { uploadRules } from '../media/limits'
import type { MediaProvenance, UploadOptions } from '../media/service'
import { type ReceivedUpload, receiveUpload } from '../media/upload'
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
    const rules = uploadRules(grant?.upload?.types, grant?.upload?.maxSize)
    const upload = await receiveUpload(event, expectedKind ? { ...rules, expectedKind } : rules)
    try {
      const result = await task(upload, { acceptedTypes: grant?.upload?.types })
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

/** URL absolue d'un média dans l'API (en-tête Location). */
export function apiMediaLocation(event: H3Event, media: Pick<Media, 'id' | 'projectId'>): string | null {
  return media.projectId ? `${apiBaseUrl(event)}/projects/${media.projectId}/media/${media.id}` : null
}
