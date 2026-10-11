import { findPersonalToken, revokeToken, tokenAuditLabel } from '../../../../lib/credentials/service'

/**
 * POST /api/admin/tokens/:id/revoke — révocation immédiate d'un de ses jetons (permission
 * tokens:personal). 204 · 404 · 409 TOKEN_NOT_ACTIVE.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, 'tokens:personal')
  const token = await findPersonalToken(user, getRouterParam(event, 'id') ?? '')
  await revokeToken(token)
  await recordAudit(event, { action: 'token.revoked', targetType: 'token', targetId: token.id, data: { label: tokenAuditLabel(token) } })
  setResponseStatus(event, 204)
  return null
})
