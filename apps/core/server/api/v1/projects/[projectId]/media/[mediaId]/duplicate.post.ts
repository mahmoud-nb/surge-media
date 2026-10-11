import { apiDuplicateBodySchema } from '#shared/schemas/api'
import { principalLibraryScopes } from '../../../../../../lib/access/principal'
import { defineApiHandler, readApiBody, requireApiProject, requireUploadAllowance } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { apiLinkExpiry, mediaEtag, toApiMedia } from '../../../../../../lib/api/serializers'
import { apiMediaLocation, principalProvenance } from '../../../../../../lib/api/writes'
import { duplicateMedia } from '../../../../../../lib/media/service'
import { mediaBaseUrl } from '../../../../../../lib/media/urls'
import type { Space } from '../../../../../../utils/access'

defineRouteMeta({
  openAPI: {
    'operationId': 'duplicateMedia',
    'tags': ['media'],
    'summary': 'Dupliquer un média',
    'description': 'Copie indépendante (nouvel identifiant, version 1, fichier copié) dans un projet — par défaut celui du média — ou dans la bibliothèque de l\'organisation, éventuellement dans un dossier. `media:read` ici, `media:upload` dans la cible. Clé secrète : son projet seulement ; jeton personnel : tout projet accessible, ou la bibliothèque s\'il l\'inclut.',
    'x-scopes': ['media:read', 'media:upload'],
    'x-credentials': ['secret', 'personal'],
    'x-errors': [
      'INVALID_REQUEST',
      'CREDENTIAL_NOT_ALLOWED',
      'MEDIA_NOT_FOUND',
      'NOT_FOUND',
      'FOLDER_NOT_FOUND',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/MediaDuplicate' },
    'responses': { 201: { $ref: '#/components/responses/MediaCopy' } },
    'x-i18n': {
      en: {
        summary: 'Duplicate a media item',
        description: 'Independent copy (new id, version 1, copied file) in a project — by default the one of the media item — or in the organization library, optionally in a folder. `media:read` here, `media:upload` in the target. Secret key: its own project only; personal token: any accessible project, or the library when it includes it.',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/media/:mediaId/duplicate — { target?: { projectId } | { library: true }, folderId? }
 * Copie indépendante (nouvel identifiant, version 1, fichier copié dans le stockage, provenance
 * conservée) dans un projet (par défaut celui du média) ou dans la bibliothèque de l'organisation,
 * dans l'un de ses dossiers (`folderId`, hors dossier par défaut ; 404 FOLDER_NOT_FOUND sinon).
 * Portées : media:read ici, media:upload dans la cible. Clé secrète (son projet seulement) ou jeton
 * personnel (seul identifiant multi-espaces) ; jamais une clé publique ni un jeton délégué.
 * → 201 Media (+ Location si la copie est dans un projet) · 403 CREDENTIAL_NOT_ALLOWED /
 * INSUFFICIENT_SCOPE / PROJECT_ARCHIVED · 404 MEDIA_NOT_FOUND / PROJECT_NOT_FOUND / NOT_FOUND (bibliothèque).
 */
export default defineApiHandler(async (event, principal) => {
  if (principal.type !== 'secret' && principal.type !== 'personal') {
    throw apiProblem('CREDENTIAL_NOT_ALLOWED', 'Duplication requires a secret key or a personal token.')
  }
  const { project } = await requireApiProject(event, principal, 'media:read')
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')
  const { target, folderId } = await readApiBody(event, apiDuplicateBodySchema)

  let space: Space
  if (target && 'library' in target) {
    const scopes = principalLibraryScopes(principal)
    if (scopes.length === 0) throw apiProblem('NOT_FOUND', 'The organization library is not accessible with this credential.')
    if (!scopes.includes('media:upload')) throw apiProblem('INSUFFICIENT_SCOPE', 'This credential lacks the media:upload scope in the library.')
    space = LIBRARY
  }
  else {
    const targetId = target?.projectId ?? project.id
    await requireApiProject(event, principal, 'media:upload', targetId)
    space = { type: 'project', id: targetId }
  }

  requireUploadAllowance(event, principal)
  const copy = await duplicateMedia(media, space, principalProvenance(principal), folderId ?? null)
  const expires = apiLinkExpiry()
  const location = apiMediaLocation(event, copy)
  setResponseStatus(event, 201)
  setResponseHeader(event, 'ETag', mediaEtag(copy, expires))
  if (location) setResponseHeader(event, 'Location', location)
  return toApiMedia(copy, mediaBaseUrl(event), expires)
})
