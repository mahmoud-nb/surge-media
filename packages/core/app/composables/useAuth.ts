import type { LoginInput } from '#shared/schemas/auth'

/**
 * Authentification de l'interface d'administration, au-dessus de useUserSession()
 * (nuxt-auth-utils) : utilisateur courant, rôle, permissions, connexion, déconnexion.
 *
 * Les contrôles de permission côté interface servent l'ergonomie (masquer ce qui est
 * interdit) : la sécurité est assurée par l'API (`requireAuth` côté serveur).
 */
export function useAuth() {
  const { loggedIn, user, session, fetch: refreshSession } = useUserSession()

  const role = computed(() => user.value?.role ?? null)
  const permissions = computed(() => (role.value ? ROLE_PERMISSIONS[role.value] : []))
  const loggedInAt = computed(() => session.value?.loggedInAt ?? null)

  function can(permission: Permission): boolean {
    return hasPermission(role.value, permission)
  }

  /** Lève l'erreur HTTP de l'API (401 identifiants refusés, 429 trop de tentatives…). */
  async function login(credentials: LoginInput): Promise<void> {
    await $fetch('/api/auth/login', { method: 'POST', body: credentials })
    await refreshSession()
  }

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    await refreshSession()
    await navigateTo('/login')
  }

  return { loggedIn, user, role, permissions, loggedInAt, can, login, logout, refresh: refreshSession }
}
