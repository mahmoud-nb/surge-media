/**
 * Sessions « gérées côté serveur » : le cookie scellé de nuxt-auth-utils ne suffit
 * pas, chaque session doit aussi exister en base (révocation, désactivation de compte).
 */
export default defineNitroPlugin(() => {
  // GET /api/_auth/session (useUserSession().fetch) : revalidation en base et
  // rafraîchissement des données affichées (rôle, nom…).
  sessionHooks.hook('fetch', async (session, event) => {
    if (!session.user) return
    const user = await resolveSession(session)
    if (!user) {
      await clearUserSession(event)
      throw createError({ statusCode: 401, statusMessage: 'Session expired' })
    }
    session.user = toSessionUser(user)
  })

  // Déconnexion : suppression de la session en base.
  sessionHooks.hook('clear', session => revokeSession(session))
})
