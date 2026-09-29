import { deleteProjectSchema } from '#shared/schemas/projects'
import { deleteProject } from '../../../lib/projects/service'

/**
 * DELETE /api/admin/projects/:id — { media: 'library' | 'purge' } (portée project:settings).
 * Uniquement pour un projet archivé (409 PROJECT_NOT_ARCHIVED). Ses médias rejoignent la
 * bibliothèque (URL conservées) ou sont supprimés définitivement avec leurs fichiers.
 * 200 { media: nombre de médias traités }.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:settings')
  const { media } = await readValidatedBody(event, body => deleteProjectSchema.parse(body))
  return deleteProject(access, media)
})
