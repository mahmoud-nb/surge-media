import { apiTextTrackFieldsSchema } from '#shared/schemas/api'
import { defineApiHandler, requireApiProject, requireUploadAllowance } from '../../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../../lib/api/queries'
import { apiLinkExpiry, toApiTextTrack } from '../../../../../../../lib/api/serializers'
import { toTrackInput } from '../../../../../../../lib/api/tracks'
import { TEXT_TRACK_MAX_SIZE } from '../../../../../../../lib/media/text-track'
import { addTextTrack } from '../../../../../../../lib/media/tracks'
import { receiveSmallUpload } from '../../../../../../../lib/media/upload'
import { mediaBaseUrl } from '../../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'createTextTrack',
    'tags': ['media'],
    'summary': 'Ajouter une piste de texte à une vidéo',
    'description': 'Fichier WebVTT ou SubRip (SRT, converti), 1 Mio au plus, en UTF-8, UTF-16 avec BOM ou Windows-1252 : vérifié puis réécrit en WebVTT normalisé (commentaires `NOTE` retirés). Un fichier refusé l\'est avec le numéro de la ligne en cause (`INVALID_TEXT_TRACK`). 20 pistes au plus par vidéo. Avec un jeton délégué : ne compte pas dans `maxFiles` et n\'est pas soumise à `types`.',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'MULTIPART_REQUIRED',
      'NO_FILE',
      'INVALID_REQUEST',
      'MEDIA_NOT_FOUND',
      'TRACK_LIMIT_REACHED',
      'FILE_TOO_LARGE',
      'INVALID_TEXT_TRACK',
      'KIND_MISMATCH',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/TrackUpload' },
    'responses': { 201: { $ref: '#/components/responses/TextTrackCreated' } },
    'x-i18n': {
      en: {
        summary: 'Add a text track to a video',
        description: 'WebVTT or SubRip (SRT, converted) file, 1 MiB at most, in UTF-8, UTF-16 with BOM or Windows-1252: checked then rewritten as normalised WebVTT (`NOTE` comments removed). A rejected file is reported with the offending line number (`INVALID_TEXT_TRACK`). 20 tracks at most per video. With a delegated token: not counted in `maxFiles` and not subject to `types`.',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/media/:mediaId/tracks — multipart `file` et champs `kind`, `language`,
 * `label`, `default` : nouvelle piste de texte (portée media:write ; débit des envois). → 201 TextTrack.
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  if (media.kind !== 'VIDEO') throw apiProblem('KIND_MISMATCH', 'Only videos have text tracks.')
  requireUploadAllowance(event, principal)

  const file = await receiveSmallUpload(event, TEXT_TRACK_MAX_SIZE)
  const fields = apiTextTrackFieldsSchema.safeParse(file.fields)
  if (!fields.success) {
    throw apiProblem('INVALID_REQUEST', fields.error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  const track = await addTextTrack(media, file, toTrackInput(fields.data))
  setResponseStatus(event, 201)
  return toApiTextTrack(media, track, mediaBaseUrl(event), apiLinkExpiry())
})
