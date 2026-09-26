import { createUserSchema } from '#shared/schemas/users'

/**
 * POST /api/admin/users — { email, name?, role } → crée un compte sans mot de passe et
 * renvoie son lien d'invitation (affiché une seule fois). 409 EMAIL_TAKEN si l'adresse existe.
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:manage')
  const input = await readValidatedBody(event, body => createUserSchema.parse(body))

  const prisma = await usePrisma()
  let user
  try {
    user = await prisma.user.create({
      data: { email: input.email, name: input.name ?? null, role: input.role },
    })
  }
  catch (error) {
    if (isUniqueViolation(error)) throw userError(409, 'EMAIL_TAKEN')
    throw error
  }

  const invitation = await issuePasswordLink(user, actor.id)
  setResponseStatus(event, 201)
  return { user: toUserSummary(user), invitation }
})
