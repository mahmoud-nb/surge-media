import type { LoginInput } from '#shared/schemas/auth'
import type { MfaLoginStep } from '#shared/utils/mfa'

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

  /**
   * Lève l'erreur HTTP de l'API (401 identifiants refusés, 429 trop de tentatives…). `mfa` : la session
   * n'est pas encore ouverte, le second facteur est attendu (`code`) ou doit être configuré (`setup`).
   */
  async function login(credentials: LoginInput): Promise<{ mfa?: MfaLoginStep }> {
    const result = await $fetch<{ mfa?: MfaLoginStep }>('/api/auth/login', { method: 'POST', body: credentials })
    if (!result.mfa) await refreshSession()
    return { mfa: result.mfa }
  }

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    await refreshSession()
    await navigateTo('/login')
  }

  return { loggedIn, user, role, permissions, loggedInAt, can, login, logout, refresh: refreshSession }
}
