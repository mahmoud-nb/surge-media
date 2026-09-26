/**
 * GET /api/admin/users/:id — détail d'un compte : profil, sessions ouvertes et lien de
 * mot de passe en attente (type et échéance seulement, jamais le jeton).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'users:manage')
  const user = await findUserOr404(getRouterParam(event, 'id') ?? '')

  const prisma = await usePrisma()
  const [activeSessions, pendingLink] = await Promise.all([
    prisma.session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } }),
    pendingPasswordLink(user.id),
  ])

  return { user: toUserSummary(user), activeSessions, pendingLink }
})
