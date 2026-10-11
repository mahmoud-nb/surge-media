import { addOriginSchema } from '#shared/schemas/credentials'
import { addOrigin } from '../../../../../lib/projects/origins'

/**
 * POST /api/admin/projects/:id/origins — { origin } (portée project:credentials), normalisée
 * (`https://app.example.com`, `http://localhost:3000`, `https://*.example.com`).
 * 201 { origin } · 400 · 409 ORIGIN_EXISTS / ORIGIN_LIMIT_REACHED.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  const input = await readValidatedBody(event, body => addOriginSchema.parse(body))
  const origin = await addOrigin(access.project!.id, input.origin)
  await recordAudit(event, { action: 'origin.added', projectId: access.project!.id, targetType: 'origin', targetId: origin.id, data: { label: origin.origin } })
  setResponseStatus(event, 201)
  return { origin }
})
