import { removeOrigin } from '../../../../../lib/projects/origins'

/** DELETE /api/admin/projects/:id/origins/:originId — portée project:credentials. 204 · 404. */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  const origin = await removeOrigin(access.project!.id, getRouterParam(event, 'originId') ?? '')
  await recordAudit(event, { action: 'origin.removed', projectId: access.project!.id, targetType: 'origin', targetId: origin.id, data: { label: origin.origin } })
  setResponseStatus(event, 204)
  return null
})
