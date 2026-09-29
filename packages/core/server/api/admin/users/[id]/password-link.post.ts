/**
 * POST /api/admin/users/:id/password-link — nouveau lien à usage unique : invitation si le
 * compte n'a pas de mot de passe, réinitialisation sinon. Le lien précédent est annulé.
 * Le mot de passe actuel reste valable jusqu'à l'utilisation du lien.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:manage')
  const target = await findUserOr404(getRouterParam(event, 'id') ?? '')
  if (!target.isActive) {
    throw createError({ statusCode: 409, statusMessage: 'User is inactive' })
  }
  const link = await issuePasswordLink(target, actor.id)
  await recordAudit(event, { action: 'user.password_link', targetType: 'user', targetId: target.id, data: { label: target.email, purpose: link.purpose } })
  return link
})
