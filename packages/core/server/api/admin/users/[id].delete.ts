/**
 * DELETE /api/admin/users/:id — suppression définitive (sessions, liens et jetons personnels
 * supprimés en cascade ; les médias, projets et clés créés par le compte sont conservés, sans
 * auteur). 403 SELF_ACTION · 409 LAST_ADMIN. Préférer la désactivation pour garder l'historique.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:manage')
  const target = await findUserOr404(getRouterParam(event, 'id') ?? '')

  await assertUserChangeAllowed(actor, target, { delete: true })

  const prisma = await usePrisma()
  await prisma.user.delete({ where: { id: target.id } })
  await recordAudit(event, { action: 'user.deleted', targetType: 'user', targetId: target.id, data: { label: target.email, role: target.role } })
  setResponseStatus(event, 204)
  return null
})
