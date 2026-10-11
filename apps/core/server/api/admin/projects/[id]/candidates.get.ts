import { memberCandidatesQuerySchema } from '#shared/schemas/projects'
import { listMemberCandidates } from '../../../../lib/projects/service'

/**
 * GET /api/admin/projects/:id/candidates?q= — comptes actifs non membres (20 au plus), avec les
 * rôles qu'on peut leur attribuer (portée project:members). Route distincte de
 * /members/:userId : une route statique voisine d'une route dynamique brouille l'inférence des
 * types Nitro.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:members')
  const { q } = await getValidatedQuery(event, value => memberCandidatesQuerySchema.parse(value))
  return { candidates: await listMemberCandidates(access.project!.id, q) }
})
