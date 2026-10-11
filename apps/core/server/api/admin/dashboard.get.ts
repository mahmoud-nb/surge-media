import { dashboardData } from '../../lib/dashboard/service'

/**
 * GET /api/admin/dashboard — données du tableau de bord du compte connecté, limitées à ses droits
 * (server/lib/dashboard/service.ts) : médias, dérivés, envois récents par heure UTC, projets,
 * comptes ou invitations, identifiants d'API, points d'attention, activité récente (audit:read).
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  return dashboardData(event, user)
})
