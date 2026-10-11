/**
 * Protection des pages /admin/* : connexion obligatoire (sinon /login?redirect=…) et
 * permission éventuelle déclarée par la page : definePageMeta({ permission: 'users:manage' }).
 * Un utilisateur déjà connecté qui ouvre /login est renvoyé vers l'administration.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, can } = useAuth()
  const isAdminRoute = to.path === '/admin' || to.path.startsWith('/admin/')

  if (isAdminRoute) {
    if (!loggedIn.value) {
      return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
    }
    const permission = to.meta.permission
    if (permission && !can(permission)) {
      // `fatal` : affiche aussi la page d'erreur lors d'une navigation côté client.
      return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden', fatal: true }))
    }
  }
  else if (to.path === '/login' && loggedIn.value) {
    return navigateTo(safeAdminRedirect(to.query.redirect))
  }
})
