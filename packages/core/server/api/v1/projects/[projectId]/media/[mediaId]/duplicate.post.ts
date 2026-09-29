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

/**
 * POST /api/v1/projects/:projectId/media/:mediaId/duplicate — { target?: { projectId } | { library: true } }
 * Copie indépendante (nouvel identifiant, version 1, fichier copié dans le stockage, provenance
 * conservée) dans un projet (par défaut celui du média) ou dans la bibliothèque de l'organisation.
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
  const { target } = await readApiBody(event, apiDuplicateBodySchema)

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
  const copy = await duplicateMedia(media, space, principalProvenance(principal))
  const expires = apiLinkExpiry()
  const location = apiMediaLocation(event, copy)
  setResponseStatus(event, 201)
  setResponseHeader(event, 'ETag', mediaEtag(copy, expires))
  if (location) setResponseHeader(event, 'Location', location)
  return toApiMedia(copy, mediaBaseUrl(event), expires)
})
