/**
 * GET /api/admin/users/:id — détail d'un compte : profil, sessions ouvertes, lien de mot de passe
 * en attente (type et échéance seulement, jamais le jeton), projets dont il est membre, parmi
 * ceux que voit l'auteur de la requête, appareils de confiance valables et double authentification (date
 * d'activation, codes de secours restants) pour un administrateur. Administrateur : tout compte ; gestionnaire : ses invités
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
  // Appareils de confiance encore valables : administrateur seulement (null pour un gestionnaire).
  const trustedDevices = hasPermission(actor.role, 'users:manage') ? await countTrustedDevices(user.id) : null
  const mfa = hasPermission(actor.role, 'users:manage') && user.mfaSecret
    ? { enabledAt: user.mfaEnabledAt, recoveryCodesLeft: await countRecoveryCodes(user.id) }
    : null
  return { user: toUserSummary(user), activeSessions, pendingLink, projects, trustedDevices, mfa }
})
