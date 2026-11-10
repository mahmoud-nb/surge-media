import { apiTagListQuerySchema } from '#shared/schemas/api'
import { API_TAG_VIEWER } from '#shared/utils/tags'
import { defineApiHandler, parseApiQuery, requireApiProject } from '../../../../../lib/api/context'
import { apiProblem } from '../../../../../lib/api/problem'
import { etagMatches, toApiTag, weakEtag } from '../../../../../lib/api/serializers'
import { getGlobalTagsRevision, getRevision } from '../../../../../lib/cache/revisions'
import { listTagRecords } from '../../../../../lib/tags/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'listTags',
    'tags': ['tags'],
    'summary': 'Étiquettes du projet',
    'description': 'Étiquettes utilisables sur les médias du projet : les globales (communes à l\'installation, gérées dans l\'administration) puis celles du projet, triées par nom. Leurs `slug` servent au filtre `tags` de la liste des médias et aux affectations. Clé publique : seulement si le projet autorise la liste publique. `withCounts=true` ajoute le nombre de médias actifs. `ETag` → 304.',
    'x-scopes': ['media:read'],
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'x-query': 'TagListQuery',
    'x-errors': ['INVALID_REQUEST', 'LISTING_DISABLED', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': {
      200: { $ref: '#/components/responses/TagList' },
      304: { $ref: '#/components/responses/NotModified' },
    },
    'x-i18n': {
      en: {
        summary: 'Tags of the project',
        description: 'Tags usable on the media of the project: global ones (shared by the installation, managed in the administration) then those of the project, sorted by name. Their `slug` is used by the `tags` filter of the media list and by assignments. Publishable key: only when the project allows public listing. `withCounts=true` adds the number of active media items. `ETag` → 304.',
      },
    },
  },
})

/**
 * GET /api/v1/projects/:projectId/tags?withCounts= — étiquettes utilisables dans le projet (globales
 * puis du projet), jamais les confidentielles (architecture-tags.md, TG4). Portée media:read ; clé
 * publique seulement avec la liste publique (403 LISTING_DISABLED). ETag = révision du projet + révision
 * des étiquettes globales (+ comptes demandés) → 304. → { items: Tag[] }
 */
export default defineApiHandler(async (event, principal) => {
  const { project, publicOnly } = await requireApiProject(event, principal, 'media:read')
  const query = parseApiQuery(event, apiTagListQuerySchema)
  if (publicOnly && !project.publicListing) {
    throw apiProblem('LISTING_DISABLED', 'This project does not allow listing with a publishable key.')
  }
  const space = { type: 'project' as const, id: project.id }
  const etag = weakEtag(['tags', project.id, await getRevision(space), await getGlobalTagsRevision(), Boolean(query.withCounts)])
  setResponseHeader(event, 'ETag', etag)
  if (etagMatches(getRequestHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304)
    return null
  }
  const { tags, counts } = await listTagRecords({ projectId: project.id, viewer: API_TAG_VIEWER, counts: query.withCounts ? 'project' : 'none' })
  return { items: tags.map(tag => toApiTag(tag, counts ? counts.get(tag.id) ?? 0 : undefined)) }
})
