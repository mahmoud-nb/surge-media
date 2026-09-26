import { USERS_PAGE_SIZE, userListQuerySchema } from '#shared/schemas/users'

/**
 * GET /api/admin/users?q=&role=&status=&page= — liste paginée des comptes (users:manage).
 * Les filtres invalides sont ignorés plutôt que refusés (URL partagée ou modifiée à la main).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'users:manage')
  const query = await getValidatedQuery(event, value => userListQuerySchema.parse(value))

  const prisma = await usePrisma()
  const where = userListWhere(query)
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { email: 'asc' },
      skip: (query.page - 1) * USERS_PAGE_SIZE,
      take: USERS_PAGE_SIZE,
    }),
  ])

  return {
    items: users.map(toUserSummary),
    total,
    page: query.page,
    pageSize: USERS_PAGE_SIZE,
  }
})
