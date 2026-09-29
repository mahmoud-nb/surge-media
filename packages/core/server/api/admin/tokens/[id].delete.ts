import { deleteToken, findPersonalToken, tokenAuditLabel } from '../../../lib/credentials/service'

/**
 * DELETE /api/admin/tokens/:id — supprime un de ses jetons expiré ou révoqué (permission
 * tokens:personal). 204 · 404 · 409 TOKEN_ACTIVE.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, 'tokens:personal')
  const token = await findPersonalToken(user, getRouterParam(event, 'id') ?? '')
  await deleteToken(token)
  await recordAudit(event, { action: 'token.deleted', targetType: 'token', targetId: token.id, data: { label: tokenAuditLabel(token) } })
  setResponseStatus(event, 204)
  return null
})
