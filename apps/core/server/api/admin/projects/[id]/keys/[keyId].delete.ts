import { deleteToken, findProjectKey, tokenAuditLabel } from '../../../../../lib/credentials/service'

/**
 * DELETE /api/admin/projects/:id/keys/:keyId — supprime une clé expirée ou révoquée (portée
 * project:credentials). 204 · 404 · 409 TOKEN_ACTIVE (la révoquer d'abord).
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  const key = await findProjectKey(access.project!.id, getRouterParam(event, 'keyId') ?? '')
  await deleteToken(key)
  await recordAudit(event, {
    action: 'key.deleted',
    projectId: access.project!.id,
    targetType: 'token',
    targetId: key.id,
    data: { label: tokenAuditLabel(key), type: key.type, environment: key.environment },
  })
  setResponseStatus(event, 204)
  return null
})
