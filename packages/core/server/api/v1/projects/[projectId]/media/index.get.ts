import { apiMediaListQuerySchema } from '#shared/schemas/api'
import { getRevision } from '../../../../../lib/cache/revisions'
import { defineApiHandler, parseApiQuery, requireApiProject } from '../../../../../lib/api/context'
import { apiProblem } from '../../../../../lib/api/problem'
import { listApiMedia } from '../../../../../lib/api/queries'
import { apiLinkExpiry, etagMatches, toApiMedia, weakEtag } from '../../../../../lib/api/serializers'
import { mediaBaseUrl } from '../../../../../lib/media/urls'

/**
 * GET /api/v1/projects/:projectId/media — ?q&kind&visibility&ids&sort&limit&cursor&withTotal
 * (portée media:read) → { items: Media[], nextCursor, total? }.
 * Clé publique : médias publics seulement, et liste/recherche seulement si le projet a activé la
 * « liste publique » (sinon `ids` uniquement : 403 LISTING_DISABLED).
 * ETag = révision de l'espace + requête + audience + tranche des URL signées : un If-None-Match
 * identique répond 304 sans exécuter la requête.
 */
export default defineApiHandler(async (event, principal) => {
  const { project, publicOnly } = await requireApiProject(event, principal, 'media:read')
  const query = parseApiQuery(event, apiMediaListQuerySchema)
  if (publicOnly && !project.publicListing && !query.ids) {
    throw apiProblem('LISTING_DISABLED', 'This project does not allow listing with a publishable key: request media by ids, or enable public listing.')
  }

  const expires = apiLinkExpiry()
  const revision = await getRevision({ type: 'project', id: project.id })
  const etag = weakEtag(['media-list', project.id, revision, query, publicOnly ? 'public' : 'full', expires])
  setResponseHeader(event, 'ETag', etag)
  if (etagMatches(getRequestHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304)
    return null
  }

  const page = await listApiMedia(project.id, query, publicOnly)
  const base = mediaBaseUrl(event)
  return {
    items: page.items.map(media => toApiMedia(media, base, expires)),
    nextCursor: page.nextCursor,
    ...(page.total === undefined ? {} : { total: page.total }),
  }
})
