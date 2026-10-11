import { createUserSchema } from '#shared/schemas/users'

/**
 * POST /api/admin/users — { email, name?, role, projectIds?, projectRole? } → crée un compte sans
 * mot de passe, le rattache aux projets choisis et renvoie son lien d'invitation (affiché une
 * seule fois). Permission users:invite :
 *   - le rôle doit faire partie de invitableRoles(auteur) — 403 ROLE_NOT_INVITABLE ;
 *   - sans users:manage (gestionnaire), au moins un projet — 422 PROJECTS_REQUIRED ;
 *   - chaque projet doit être actif et l'auteur doit en gérer les membres — 422 PROJECT_UNAVAILABLE ;
 *   - le rôle de projet doit être attribuable au rôle invité — 422 ROLE_NOT_ASSIGNABLE.
 * Rattacher à des projets revient à ajouter des membres : confirmation récente du mot de passe
 * exigée (403 REAUTH_REQUIRED). 409 EMAIL_TAKEN si l'adresse existe.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:invite')
  const input = await readValidatedBody(event, body => createUserSchema.parse(body))

  if (!invitableRoles(actor.role).includes(input.role)) throw userError(403, 'ROLE_NOT_INVITABLE')
  const projectIds = input.projectIds ?? []
  if (projectIds.length === 0 && !hasPermission(actor.role, 'users:manage')) throw userError(422, 'PROJECTS_REQUIRED')

  const projects = []
  for (const id of projectIds) {
    const access = await resolveSpaceAccess(actor, spaceFor(id))
    // Projet archivé : la portée project:members est retirée par l'archivage.
    if (!access?.project || !hasScope(access.scopes, 'project:members')) throw userError(422, 'PROJECT_UNAVAILABLE')
    projects.push(access.project)
  }
  const projectRole = input.projectRole
  if (projects.length && (!projectRole || !assignableProjectRoles(input.role).includes(projectRole))) {
    throw userError(422, 'ROLE_NOT_ASSIGNABLE')
  }
  if (projects.length) await requireRecentPassword(event)

  const prisma = await usePrisma()
  let user
  try {
    user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name ?? null,
        role: input.role,
        invitedById: actor.id,
        projectMemberships: { create: projects.map(project => ({ projectId: project.id, role: projectRole! })) },
      },
      include: USER_SUMMARY_INCLUDE,
    })
  }
  catch (error) {
    if (isUniqueViolation(error)) throw userError(409, 'EMAIL_TAKEN')
    throw error
  }

  const invitation = await issuePasswordLink(user, actor.id)
  await recordAudit(event, {
    action: 'user.created',
    targetType: 'user',
    targetId: user.id,
    data: { label: user.email, role: user.role, ...(projects.length ? { projects: projects.map(project => project.name) } : {}) },
  })
  for (const project of projects) {
    await recordAudit(event, {
      action: 'member.added',
      projectId: project.id,
      targetType: 'user',
      targetId: user.id,
      data: { label: user.email, role: projectRole },
    })
  }
  setResponseStatus(event, 201)
  return { user: toUserSummary(user), invitation }
})
