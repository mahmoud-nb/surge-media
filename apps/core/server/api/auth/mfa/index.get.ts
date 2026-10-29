/**
 * GET /api/auth/mfa — état de la double authentification du compte connecté (page « Mon compte ») :
 * 200 { enabled, enabledAt, recoveryCodesLeft, required (politique), available (clé configurée) } · 401.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  return mfaState(event, user)
})
