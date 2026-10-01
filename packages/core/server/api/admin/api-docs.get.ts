import { docsProjects } from '../../lib/api/docs'
import { apiBaseUrl } from '../../lib/api/problem'

/**
 * GET /api/admin/api-docs — contexte de la documentation interactive (permission api:docs) :
 * `apiBaseUrl` (NUXT_SITE_URL, sinon l'origine de la requête, + /api/v1), `specUrl`, projets actifs
 * de l'utilisateur (100 au plus) avec, s'il gère leurs identifiants, leurs clés valables (valeur
 * d'une clé publique, préfixe seul d'une clé secrète).
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, 'api:docs')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    apiBaseUrl: apiBaseUrl(event),
    specUrl: '/api/v1/openapi.json',
    projects: await docsProjects(user),
  }
})
