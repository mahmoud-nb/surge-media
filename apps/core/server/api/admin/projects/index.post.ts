import { createProjectSchema } from '#shared/schemas/projects'
import { createProject } from '../../../lib/projects/service'

/**
 * POST /api/admin/projects — { name, slug?, description? } (permission projects:create).
 * Le créateur devient propriétaire. Sans `slug`, il est déduit du nom (suffixé si déjà pris).
 * 201 { project } · 400 · 403 · 409 SLUG_TAKEN.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, 'projects:create')
  const input = await readValidatedBody(event, body => createProjectSchema.parse(body))
  const project = await createProject(user, input)
  await recordAudit(event, { action: 'project.created', projectId: project.id, targetType: 'project', targetId: project.id, data: { label: project.name, slug: project.slug } })
  setResponseStatus(event, 201)
  return { project }
})
