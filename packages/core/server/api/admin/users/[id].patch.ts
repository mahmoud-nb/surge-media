import { updateUserSchema } from '#shared/schemas/users'
import { invalidateUserCredentials } from '../../../lib/access/credentials'
import { membershipNormalization } from '../../../lib/projects/service'

/**
 * PATCH /api/admin/users/:id — { name?, role?, isActive? }.
 * 403 SELF_ACTION (son propre rôle ou sa désactivation) · 409 LAST_ADMIN.
 * Désactiver un compte ferme immédiatement toutes ses sessions ; un changement de rôle
 * s'applique à la requête suivante (le rôle est relu en base à chaque vérification) et ramène
 * ses adhésions aux projets dans les bornes du nouveau rôle (même transaction).
 * Changements de rôle et de statut inscrits au journal d'audit.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:manage')
  const target = await findUserOr404(getRouterParam(event, 'id') ?? '')
  const input = await readValidatedBody(event, body => updateUserSchema.parse(body))

  await assertUserChangeAllowed(actor, target, { role: input.role, isActive: input.isActive })

  const prisma = await usePrisma()
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: input, include: USER_SUMMARY_INCLUDE }),
    ...(input.isActive === false ? [prisma.session.deleteMany({ where: { userId: target.id } })] : []),
    // Nouveau rôle : adhésions ramenées entre son plancher et son plafond (ex. gestionnaire → propriétaire).
    ...(input.role !== undefined && input.role !== target.role ? membershipNormalization(prisma, target.id, input.role) : []),
  ])

  // Rôle ou statut changé : les jetons personnels du compte sont relus à la requête suivante.
  invalidateUserCredentials(target.id)

  const changes: Record<string, { from: unknown, to: unknown }> = {}
  if (input.role !== undefined && input.role !== target.role) changes.role = { from: target.role, to: input.role }
  if (input.isActive !== undefined && input.isActive !== target.isActive) changes.isActive = { from: target.isActive, to: input.isActive }
  if (Object.keys(changes).length) {
    await recordAudit(event, { action: 'user.updated', targetType: 'user', targetId: target.id, data: { label: target.email, changes } })
  }

  return { user: toUserSummary(user) }
})
