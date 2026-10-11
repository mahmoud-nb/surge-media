import { listPersonalTokens } from '../../../lib/credentials/service'

/** GET /api/admin/tokens — jetons personnels de l'utilisateur connecté (permission tokens:personal). */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, 'tokens:personal')
  return { tokens: await listPersonalTokens(user) }
})
