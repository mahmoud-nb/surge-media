/**
 * POST /api/admin/users/:id/password-link — nouveau lien à usage unique : invitation si le
 * compte n'a pas de mot de passe, réinitialisation sinon. Le lien précédent est annulé.
 * Le mot de passe actuel reste valable jusqu'à l'utilisation du lien.
 * Gestionnaire (users:invite) : seulement pour un compte qu'il a invité (404 sinon) et tant que
 * l'invitation n'est pas acceptée (409 INVITATION_ACCEPTED : la réinitialisation reste à
 * l'administrateur).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:invite')
  const target = await findVisibleUserOr404(actor, getRouterParam(event, 'id') ?? '')
  if (!target.isActive) {
    throw createError({ statusCode: 409, statusMessage: 'User is inactive' })
  }
  if (target.passwordHash !== null && !hasPermission(actor.role, 'users:manage')) {
    throw userError(409, 'INVITATION_ACCEPTED')
  }
  const link = await issuePasswordLink(target, actor.id)
  await recordAudit(event, { action: 'user.password_link', targetType: 'user', targetId: target.id, data: { label: target.email, purpose: link.purpose } })
  return link
})
