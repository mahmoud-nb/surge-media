/**
 * Destination après connexion : uniquement un chemin interne de l'administration,
 * pour empêcher les redirections ouvertes (?redirect=https://site-malveillant…).
 */
export function safeAdminRedirect(value: unknown, fallback = '/admin'): string {
  return typeof value === 'string' && /^\/admin(?:[/?#]|$)/.test(value) && !value.includes('//')
    ? value
    : fallback
}
