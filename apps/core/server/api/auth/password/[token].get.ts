/**
 * GET /api/auth/password/:token — informations d'un lien de mot de passe (page publique).
 * 404 TOKEN_INVALID si le lien est inconnu, expiré, déjà utilisé ou si le compte est désactivé.
 */
export default defineEventHandler(async (event) => {
  const record = await findValidPasswordToken(getRouterParam(event, 'token') ?? '')
  if (!record) throw userError(404, 'TOKEN_INVALID')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { email: record.user.email, purpose: record.purpose, expiresAt: record.expiresAt }
})
