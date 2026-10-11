import { auditQuerySchema } from '#shared/schemas/credentials'
import { listAuditEvents } from '../../lib/audit/service'

/**
 * GET /api/admin/audit — ?category&project&page → { items, total, page, pageSize: 50, filterProject }
 * (permission audit:read). Entrées les plus récentes d'abord.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'audit:read')
  const query = await getValidatedQuery(event, value => auditQuerySchema.parse(value))
  return listAuditEvents(query)
})
