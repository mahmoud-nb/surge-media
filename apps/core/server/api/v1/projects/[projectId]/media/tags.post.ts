import { apiMediaTagsBulkSchema } from '#shared/schemas/api'
import { API_TAG_VIEWER } from '#shared/utils/tags'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../lib/api/context'
import { bulkTagMedia, resolveTagSlugs } from '../../../../../lib/tags/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'tagMedia',
    'tags': ['tags'],
    'summary': 'Étiqueter des médias en lot',
    'description': 'Ajoute et/ou retire des étiquettes (slugs) sur 100 médias du projet au plus. Les médias de la corbeille ou d\'un autre projet sont ignorés ; un média qui dépasserait 50 étiquettes est laissé tel quel (`skipped`).',
    'x-scopes': ['media:write'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': ['INVALID_REQUEST', 'TAG_NOT_FOUND', 'PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'requestBody': { $ref: '#/components/requestBodies/MediaTagsBulk' },
    'responses': { 200: { $ref: '#/components/responses/MediaTagsBulkResult' } },
    'x-i18n': {
      en: {
        summary: 'Tag media in bulk',
        description: 'Adds and/or removes tags (slugs) on at most 100 media items of the project. Media items in the trash or in another project are ignored; a media item that would exceed 50 tags is left unchanged (`skipped`).',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/media/tags — { ids, add?, remove? } (slugs ; portée media:write).
 * → { updated, skipped } · 400 INVALID_REQUEST · 404 TAG_NOT_FOUND (`tags` = slugs inconnus).
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:write')
  const body = await readApiBody(event, apiMediaTagsBulkSchema)
  const add = await resolveTagSlugs(project.id, body.add, API_TAG_VIEWER, true)
  const remove = await resolveTagSlugs(project.id, body.remove, API_TAG_VIEWER, true)
  return bulkTagMedia({ type: 'project', id: project.id }, body.ids, add, remove, API_TAG_VIEWER)
})
