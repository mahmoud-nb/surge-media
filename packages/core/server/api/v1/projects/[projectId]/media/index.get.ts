import { apiMediaListQuerySchema } from '#shared/schemas/api'
import { getRevision } from '../../../../../lib/cache/revisions'
import { defineApiHandler, parseApiQuery, requireApiProject } from '../../../../../lib/api/context'
import { apiProblem } from '../../../../../lib/api/problem'
import { listApiMedia } from '../../../../../lib/api/queries'
import { apiLinkExpiry, etagMatches, toApiMedia, weakEtag } from '../../../../../lib/api/serializers'
import { mediaBaseUrl } from '../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'listMedia',
    'tags': ['media'],
    'summary': 'Liste et recherche des médias',
    'description': 'Médias actifs du projet (hors corbeille), triés et paginés par curseur ; filtres combinables. Clé publique : médias publics seulement, et liste ou recherche seulement si le projet l\'autorise (sinon `ids` uniquement). URL des médias privés signées pour environ une heure. `ETag` → 304 sans exécuter la requête.',
    'x-scopes': ['media:read'],
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'x-query': 'MediaListQuery',
    'x-errors': [
      'INVALID_REQUEST',
      'INVALID_CURSOR',
      'LISTING_DISABLED',
      'FOLDER_NOT_FOUND',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'responses': {
      200: { $ref: '#/components/responses/MediaList' },
      304: { $ref: '#/components/responses/NotModified' },
    },
    'x-i18n': {
      en: {
        summary: 'List and search media',
        description: 'Active media of the project (outside the trash), sorted and paginated with a cursor; filters can be combined. Publishable key: public media only, and listing or search only when the project allows it (otherwise `ids` only). URLs of private media are signed for about an hour. `ETag` → 304 without running the query.',
      },
    },
  },
})

/**
 * GET /api/v1/projects/:projectId/media — ?q&kind&visibility&folder&recursive&ids&sort&limit&cursor&withTotal
 * (portée media:read) → { items: Media[], nextCursor, total? }.
 * Clé publique : médias publics seulement, et liste/recherche seulement si le projet a activé la
 * « liste publique » (sinon `ids` uniquement : 403 LISTING_DISABLED).
 * `folder` : identifiant ou `root` (+ `recursive` : sous-dossiers compris) ; 404 FOLDER_NOT_FOUND.
 * ETag = révision de l'espace (médias et dossiers) + requête + audience + tranche des URL signées : un If-None-Match
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
