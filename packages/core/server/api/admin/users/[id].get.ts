/**
 * GET /api/admin/users/:id — détail d'un compte : profil, sessions ouvertes, lien de mot de passe
 * en attente (type et échéance seulement, jamais le jeton) et projets dont il est membre, parmi
 * ceux que voit l'auteur de la requête. Administrateur : tout compte ; gestionnaire : ses invités
 * (404 sinon).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:invite')
  const user = await findVisibleUserOr404(actor, getRouterParam(event, 'id') ?? '')

  const prisma = await usePrisma()
  const [activeSessions, pendingLink, memberships] = await Promise.all([
    prisma.session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } }),
    pendingPasswordLink(user.id),
    prisma.projectMember.findMany({
      where: {
        userId: user.id,
        ...(hasPermission(actor.role, 'projects:all') ? {} : { project: { members: { some: { userId: actor.id } } } }),
      },
      select: { role: true, project: { select: { id: true, name: true, archivedAt: true } } },
      orderBy: { project: { name: 'asc' } },
    }),
  ])

  const projects = memberships.map(({ role, project }) => ({ ...project, role: effectiveProjectRole(user.role, role) }))
  return { user: toUserSummary(user), activeSessions, pendingLink, projects }
})
