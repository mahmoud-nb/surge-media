import { apiMediaUpdateSchema } from '#shared/schemas/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { apiLinkExpiry, mediaEtag, toApiMedia } from '../../../../../../lib/api/serializers'
import { toMetadataInput } from '../../../../../../lib/api/writes'
import { updateMediaMetadata } from '../../../../../../lib/media/service'
import { mediaBaseUrl } from '../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'updateMedia',
    'tags': ['media'],
    'summary': 'Modifier un média',
    'description': 'Champs absents inchangés ; `null` ou texte vide efface le titre ou le texte alternatif ; `folderId: null` sort le média de son dossier. Passer un média en privé vaut pour les nouvelles requêtes (les copies déjà en cache restent valables jusqu\'à leur expiration).',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'INVALID_REQUEST',
      'MEDIA_NOT_FOUND',
      'FOLDER_NOT_FOUND',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/MediaUpdate' },
    'responses': { 200: { $ref: '#/components/responses/Media' } },
    'x-i18n': {
      en: {
        summary: 'Update a media item',
        description: 'Absent fields stay unchanged; `null` or an empty string clears the title or alternative text; `folderId: null` takes the media item out of its folder. Making a media item private applies to new requests (copies already cached stay valid until they expire).',
      },
    },
  },
})

/**
 * PATCH /api/v1/projects/:projectId/media/:mediaId — { title?, altText?, visibility?, folderId? }
 * (portée media:write). Champs absents inchangés ; `null` ou texte vide efface le titre / le texte
 * alternatif ; `folderId` : dossier du projet, `null` = hors dossier. Passer un média en privé vaut
 * pour les nouvelles requêtes (les copies déjà en cache restent valables jusqu'à leur expiration).
 * Changement de visibilité inscrit au journal d'audit.
 * → Media · 400 INVALID_REQUEST · 404 MEDIA_NOT_FOUND / FOLDER_NOT_FOUND.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  const body = await readApiBody(event, apiMediaUpdateSchema)

  const updated = await updateMediaMetadata(media, toMetadataInput(body))
  if (updated.visibility !== media.visibility) {
    await recordAudit(event, {
      action: 'media.visibility_changed',
      projectId: media.projectId,
      targetType: 'media',
      targetId: media.id,
      data: { label: updated.title || updated.originalName, from: media.visibility, to: updated.visibility },
    })
  }

  const expires = apiLinkExpiry()
  setResponseHeader(event, 'ETag', mediaEtag(updated, expires))
  return toApiMedia(updated, mediaBaseUrl(event), expires)
})
