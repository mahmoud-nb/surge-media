/**
 * Protection CSRF des routes authentifiées par cookie : une requête modifiante envoyée
 * par un navigateur doit provenir de la même origine (en-tête Origin, toujours envoyé
 * par les navigateurs sur ces méthodes). Les clients hors navigateur (SDK, curl)
 * n'envoient pas d'Origin et s'authentifient par jeton d'accès, pas par cookie.
 */
const COOKIE_AUTH_PREFIXES = ['/api/auth/', '/api/admin/', '/api/_auth/']
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function originHost(origin: string): string | undefined {
  try {
    return new URL(origin).host
  }
  catch {
    return undefined // ex. « Origin: null »
  }
}

export default defineEventHandler((event) => {
  if (SAFE_METHODS.has(event.method)) return
  if (!COOKIE_AUTH_PREFIXES.some(prefix => event.path.startsWith(prefix))) return

  const origin = getRequestHeader(event, 'origin')
  if (origin !== undefined && originHost(origin) !== getRequestHost(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request blocked' })
  }
})
