import type { H3Event } from 'h3'
import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Envoi d'e-mails par SMTP (nodemailer), configuré par NUXT_SMTP_* (runtimeConfig.smtp, côté serveur
 * seulement). Sans hôte ni expéditeur, l'envoi est désactivé : l'interface ne propose pas le bouton et
 * l'API répond 409 MAIL_NOT_CONFIGURED. Délais courts : une requête de l'administration attend l'envoi.
 */

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export function smtpConfig(event: H3Event): SmtpConfig {
  const config = useRuntimeConfig(event).smtp
  // Mode démo : envoi coupé quel que soit le réglage, sinon la démo publique servirait de relais de spam.
  const demo = useDemo().enabled
  return {
    host: demo ? '' : String(config.host ?? '').trim(),
    port: Number(config.port) || 587,
    secure: config.secure === true || String(config.secure) === 'true',
    user: String(config.user ?? ''),
    password: String(config.password ?? ''),
    from: String(config.from ?? '').trim(),
  }
}

/** L'envoi d'e-mails est-il configuré (hôte et expéditeur) ? */
export function mailEnabled(event: H3Event): boolean {
  const config = smtpConfig(event)
  return Boolean(config.host && config.from)
}

// Une connexion SMTP réutilisée tant que la configuration ne change pas.
let cached: { key: string, transporter: Transporter } | null = null

function transporterFor(config: SmtpConfig): Transporter {
  const key = JSON.stringify(config)
  if (cached?.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.password } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    }
  }
  return cached.transporter
}

/** Envoie un e-mail ; lève l'erreur du serveur SMTP (à journaliser sans la renvoyer telle quelle). */
export async function sendMail(event: H3Event, message: MailMessage): Promise<void> {
  const config = smtpConfig(event)
  if (!config.host || !config.from) throw new Error('SMTP non configuré')
  await transporterFor(config).sendMail({ from: config.from, ...message })
}
