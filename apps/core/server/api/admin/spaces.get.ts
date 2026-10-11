import { z } from 'zod'
import { listSpaces } from '../../lib/projects/service'

const querySchema = z.object({ scope: z.enum([...MEDIA_SCOPES, ...PROJECT_SCOPES]).catch('media:upload') })

/**
 * GET /api/admin/spaces?scope=media:upload — espaces (bibliothèque, projets actifs) où
 * l'utilisateur dispose de la portée demandée : cibles d'une duplication ou d'un déplacement.
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  const { scope } = await getValidatedQuery(event, value => querySchema.parse(value))
  return { spaces: await listSpaces(user, scope) }
})
