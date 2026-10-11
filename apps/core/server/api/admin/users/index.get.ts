import { USERS_PAGE_SIZE, userListQuerySchema } from '#shared/schemas/users'

/**
 * GET /api/admin/users?q=&role=&status=&page= — liste paginée des comptes : tous pour un
 * administrateur (users:manage), ceux qu'il a invités pour un gestionnaire (users:invite).
 * Les filtres invalides sont ignorés plutôt que refusés (URL partagée ou modifiée à la main).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:invite')
  const query = await getValidatedQuery(event, value => userListQuerySchema.parse(value))

  const prisma = await usePrisma()
  const where = userListWhere(query, actor)
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: USER_SUMMARY_INCLUDE,
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
