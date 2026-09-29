/**
 * DELETE /api/admin/users/:id/sessions — ferme toutes les sessions du compte (appareil perdu,
 * départ…). Sur son propre compte, la session en cours est conservée.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:manage')
  const target = await findUserOr404(getRouterParam(event, 'id') ?? '')

  const where: { userId: string, tokenHash?: { not: string } } = { userId: target.id }
  if (target.id === actor.id) {
    const { secure } = await getUserSession(event)
    if (secure?.token) where.tokenHash = { not: hashToken(secure.token) }
  }

  const prisma = await usePrisma()
  const { count } = await prisma.session.deleteMany({ where })
  await recordAudit(event, { action: 'user.sessions_revoked', targetType: 'user', targetId: target.id, data: { label: target.email, count } })
  return { revoked: count }
})
