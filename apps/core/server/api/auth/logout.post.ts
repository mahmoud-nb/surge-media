/**
 * POST /api/auth/logout — ferme la session : cookie effacé et session supprimée en base
 * (hook « clear » de server/plugins/auth-session.ts).
 */
export default defineEventHandler(async (event) => {
  await clearUserSession(event)
  return { loggedOut: true }
})
