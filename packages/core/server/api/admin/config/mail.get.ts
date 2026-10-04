import { mailEnabled } from '../../../lib/mail/transport'

/**
 * GET /api/admin/config/mail — l'envoi d'e-mails est-il configuré (NUXT_SMTP_HOST et NUXT_SMTP_FROM) ?
 * Sert à proposer ou non le bouton « Envoyer par e-mail » des liens de mot de passe (users:invite).
 * Aucun paramètre SMTP n'est renvoyé.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'users:invite')
  return { enabled: mailEnabled(event) }
})
