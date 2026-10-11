import { emailPasswordLinkSchema } from '#shared/schemas/users'
import { passwordLinkMail } from '../../../../../lib/mail/password-link'
import { mailEnabled, sendMail } from '../../../../../lib/mail/transport'

// Envois par compte destinataire : un lien se renvoie au besoin, sans permettre d'inonder une boîte.
const sends = createRateLimiter({ max: 5, windowMs: 60 * 60_000 })

/**
 * POST /api/admin/users/:id/password-link/email — { token, locale, timeZone? } : envoie par e-mail le
 * lien d'invitation ou de réinitialisation affiché dans l'administration, **à l'adresse du compte**
 * seulement. Le jeton (renvoyé par le navigateur, jamais stocké en clair) doit être le lien encore
 * valable de ce compte. Mêmes droits que l'émission du lien (users:invite ; gestionnaire : ses invités
 * et leur invitation). Langue et fuseau de l'expéditeur.
 * 200 { to } · 404 (compte invisible) · 404 TOKEN_INVALID (lien utilisé, remplacé ou expiré) ·
 * 409 MAIL_NOT_CONFIGURED · 409 INVITATION_ACCEPTED · 429 (5 envois par heure et par compte) ·
 * 502 MAIL_FAILED (détail dans les journaux du serveur).
 */
export default defineEventHandler(async (event) => {
  const actor = await requireAuth(event, 'users:invite')
  const target = await findVisibleUserOr404(actor, getRouterParam(event, 'id') ?? '')
  const input = await readValidatedBody(event, body => emailPasswordLinkSchema.parse(body))
  if (!mailEnabled(event)) throw userError(409, 'MAIL_NOT_CONFIGURED')

  const record = await findValidPasswordToken(input.token)
  if (!record || record.userId !== target.id) throw userError(404, 'TOKEN_INVALID')
  if (record.purpose !== 'INVITATION' && !hasPermission(actor.role, 'users:manage')) throw userError(409, 'INVITATION_ACCEPTED')

  const retryAfter = sends.retryAfter(target.id)
  if (retryAfter > 0) {
    setResponseHeader(event, 'Retry-After', retryAfter)
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }
  sends.hit(target.id)

  const site = (useRuntimeConfig(event).siteUrl || getRequestURL(event).origin).replace(/\/+$/, '')
  const message = passwordLinkMail({
    locale: input.locale,
    purpose: record.purpose,
    to: target.email,
    url: `${site}/password/${input.token}`,
    expiresAt: record.expiresAt,
    timeZone: input.timeZone,
    sender: actor.name || actor.email,
    site,
  })
  try {
    await sendMail(event, message)
  }
  catch (error) {
    console.error(`[surge-media] Envoi d'e-mail impossible (${target.email}) :`, error instanceof Error ? error.message : error)
    throw createError({ statusCode: 502, statusMessage: 'MAIL_FAILED', data: { code: 'MAIL_FAILED' } })
  }

  await recordAudit(event, { action: 'user.link_emailed', targetType: 'user', targetId: target.id, data: { label: target.email, purpose: record.purpose } })
  return { to: target.email }
})
