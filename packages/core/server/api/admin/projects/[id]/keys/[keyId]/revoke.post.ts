import { findProjectKey, revokeToken, tokenAuditLabel } from '../../../../../../lib/credentials/service'

/**
 * POST /api/admin/projects/:id/keys/:keyId/revoke — révocation immédiate (portée
 * project:credentials ; pas de confirmation du mot de passe : l'action retire des droits).
 * 204 · 404 · 409 TOKEN_NOT_ACTIVE.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  const key = await findProjectKey(access.project!.id, getRouterParam(event, 'keyId') ?? '')
  await revokeToken(key)
  await recordAudit(event, {
    action: 'key.revoked',
    projectId: access.project!.id,
    targetType: 'token',
    targetId: key.id,
    data: { label: tokenAuditLabel(key), type: key.type, environment: key.environment },
  })
  setResponseStatus(event, 204)
  return null
})
