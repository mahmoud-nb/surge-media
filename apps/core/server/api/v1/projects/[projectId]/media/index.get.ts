import { apiMediaListQuerySchema } from '#shared/schemas/api'
import { API_TAG_VIEWER } from '#shared/utils/tags'
import { getGlobalTagsRevision, getRevision } from '../../../../../lib/cache/revisions'
import { defineApiHandler, parseApiQuery, requireApiProject } from '../../../../../lib/api/context'
import { apiProblem } from '../../../../../lib/api/problem'
import { listApiMedia } from '../../../../../lib/api/queries'
import { activeProcessingParts, apiLinkExpiry, etagMatches, toApiMedia, weakEtag } from '../../../../../lib/api/serializers'
import { mediaBaseUrl } from '../../../../../lib/media/urls'
import { resolveTagSlugs, tagFilterWhere } from '../../../../../lib/tags/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'listMedia',
    'tags': ['media'],
    'summary': 'Liste et recherche des médias',
    'description': 'Médias actifs du projet (hors corbeille), triés et paginés par curseur ; filtres combinables (étiquettes : `tags`, au moins une par défaut, toutes avec `tagMatch=all`). Clé publique : médias publics seulement, et liste ou recherche seulement si le projet l\'autorise (sinon `ids` uniquement). URL des médias privés signées pour environ une heure. `ETag` → 304 sans exécuter la requête ; une page qui contient une vidéo en attente ou en cours de traitement est relue à chaque revalidation (son `ETag` suit l\'avancement de `processing`).',
    'x-scopes': ['media:read'],
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'x-query': 'MediaListQuery',
    'x-errors': [
      'INVALID_REQUEST',
      'INVALID_CURSOR',
      'LISTING_DISABLED',
      'FOLDER_NOT_FOUND',
      'TAG_NOT_FOUND',
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
        description: 'Active media of the project (outside the trash), sorted and paginated with a cursor; filters can be combined (tags: `tags`, at least one by default, all of them with `tagMatch=all`). Publishable key: public media only, and listing or search only when the project allows it (otherwise `ids` only). URLs of private media are signed for about an hour. `ETag` → 304 without running the query; a page that contains a video waiting for or undergoing processing is read again on each revalidation (its `ETag` follows the progress of `processing`).',
      },
    },
  },
})

/**
 * GET /api/v1/projects/:projectId/media — ?q&kind&visibility&folder&recursive&tags&tagMatch&untagged&ids&sort&limit&cursor&withTotal
 * (portée media:read) → { items: Media[], nextCursor, total? }.
 * Clé publique : médias publics seulement, et liste/recherche seulement si le projet a activé la
 * « liste publique » (sinon `ids` uniquement : 403 LISTING_DISABLED).
 * `folder` : identifiant ou `root` (+ `recursive` : sous-dossiers compris) ; 404 FOLDER_NOT_FOUND.
 * ETag = révision de l'espace (médias et dossiers) + requête + audience + tranche des URL signées : un If-None-Match
 * identique répond 304 sans exécuter la requête. La révision suit les changements d'état du traitement des
 * vidéos, pas son avancement (écrit sur la tâche seule) : une page qui contient un traitement en attente ou en
 * cours reçoit un ETag qui inclut aussi ses tâches (`activeProcessingParts`), jamais égal à celui de la
 * révision seule — sa revalidation relit la page, puis répond 304 si rien n'a bougé. Ces pages sont rares
 * et passagères : les autres gardent le 304 sans requête.
 */
export default defineApiHandler(async (event, principal) => {
  const { project, publicOnly } = await requireApiProject(event, principal, 'media:read')
  const query = parseApiQuery(event, apiMediaListQuerySchema)
  if (publicOnly && !project.publicListing && !query.ids) {
    throw apiProblem('LISTING_DISABLED', 'This project does not allow listing with a publishable key: request media by ids, or enable public listing.')
  }

  const expires = apiLinkExpiry()
  const revision = await getRevision({ type: 'project', id: project.id })
  // Révision des étiquettes globales : renommer une globale change `tags` des médias sans toucher l'espace.
  const parts = ['media-list', project.id, revision, await getGlobalTagsRevision(), query, publicOnly ? 'public' : 'full', expires]
  const etag = weakEtag(parts)
  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  if (etagMatches(ifNoneMatch, etag)) {
    setResponseHeader(event, 'ETag', etag)
    setResponseStatus(event, 304)
    return null
  }

  const tagIds = query.tags ? await resolveTagSlugs(project.id, query.tags, API_TAG_VIEWER, true) : []
  const tagWhere = await tagFilterWhere(tagIds, { slugs: query.tags, match: query.tagMatch, untagged: query.untagged }, API_TAG_VIEWER)
  const page = await listApiMedia(project.id, query, publicOnly, tagWhere)
  // Traitement en attente ou en cours dans la page : son avancement entre dans l'ETag (voir l'en-tête).
  const active = activeProcessingParts(page.items)
  const pageEtag = active ? weakEtag([...parts, active]) : etag
  setResponseHeader(event, 'ETag', pageEtag)
  if (active && etagMatches(ifNoneMatch, pageEtag)) {
    setResponseStatus(event, 304)
    return null
  }
  const base = mediaBaseUrl(event)
  return {
    items: page.items.map(media => toApiMedia(media, base, expires)),
    nextCursor: page.nextCursor,
    ...(page.total === undefined ? {} : { total: page.total }),
  }
})
