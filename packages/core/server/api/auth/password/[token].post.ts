import { newPasswordSchema } from '#shared/schemas/users'

/**
 * POST /api/auth/password/:token — { password, confirmation } → enregistre le mot de passe,
 * consomme le lien et ferme les sessions du compte. 404 TOKEN_INVALID si le lien n'est plus valable.
 */
export default defineEventHandler(async (event) => {
  const record = await findValidPasswordToken(getRouterParam(event, 'token') ?? '')
  if (!record) throw userError(404, 'TOKEN_INVALID')

  const { password } = await readValidatedBody(event, body => newPasswordSchema.parse(body))
  if (!(await consumePasswordToken(record, password))) throw userError(404, 'TOKEN_INVALID')

  setResponseStatus(event, 204)
  return null
})
