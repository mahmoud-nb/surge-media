import { listProjectKeys } from '../../../../../lib/credentials/service'

/**
 * GET /api/admin/projects/:id/keys — clés d'API du projet (publiques et secrètes, tous
 * environnements, révoquées et expirées comprises) ; portée project:credentials.
 * Aucune empreinte n'est renvoyée ; la valeur complète seulement pour les clés publiques.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  return { keys: await listProjectKeys(access.project!.id) }
})
