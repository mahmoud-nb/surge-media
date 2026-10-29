import en from '../../../i18n/locales/en.json'
import fr from '../../../i18n/locales/fr.json'
import type { EmailLocale } from '../../../shared/utils/users'
import type { MailMessage } from './transport'

/**
 * E-mail d'un lien d'invitation ou de réinitialisation, dans la langue de l'expéditeur : textes
 * `mail.*` des fichiers de traduction, version texte et version HTML (valeurs échappées, lien
 * cliquable et adresse en clair). Module pur (testé) : aucune dépendance au serveur.
 */

type Messages = { app: string, mail: typeof fr.mail }
const MESSAGES: Record<EmailLocale, Messages> = {
  fr: { app: fr.app.name, mail: fr.mail },
  en: { app: en.app.name, mail: en.mail },
}

export interface PasswordLinkMailInput {
  locale: EmailLocale
  purpose: 'INVITATION' | 'RESET'
  /** Adresse du compte (destinataire). */
  to: string
  /** Adresse absolue de la page de saisie du mot de passe. */
  url: string
  expiresAt: Date
  /** Fuseau horaire de l'expéditeur (IANA) ; invalide ou absent : celui du serveur. */
  timeZone?: string
  /** Nom (ou adresse) de la personne qui envoie le lien. */
  sender: string
  /** Origine de l'installation (https://media.example.com). */
  site: string
}

export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[char]!)
}

/** Date d'échéance lisible, avec son fuseau (le destinataire peut en avoir un autre). */
export function formatExpiry(date: Date, locale: EmailLocale, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date)
  }
  catch {
    return new Intl.DateTimeFormat(locale, options).format(date)
  }
}

export function passwordLinkMail(input: PasswordLinkMailInput): MailMessage {
  const texts = MESSAGES[input.locale].mail
  const kind = input.purpose === 'INVITATION' ? texts.passwordLink.invitation : texts.passwordLink.reset
  const values = {
    app: MESSAGES[input.locale].app,
    email: input.to,
    sender: input.sender,
    site: input.site,
    date: formatExpiry(input.expiresAt, input.locale, input.timeZone),
  }
  const t = (template: string) => interpolate(template, values)
  const subject = t(kind.subject)
  const paragraphs = [t(kind.intro)]
  const after = [t(kind.expires), t(kind.ignore)]
  const signature = t(texts.signature)

  const text = [
    t(texts.greeting),
    '',
    ...paragraphs,
    '',
    t(kind.textAction),
    input.url,
    '',
    ...after,
    '',
    signature,
  ].join('\n')

  const h = (template: string) => escapeHtml(t(template))
  const url = escapeHtml(input.url)
  const html = `<!doctype html>
<html lang="${input.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px;background-color:#f4f5f7;color:#1f2937;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div role="article" aria-roledescription="email" aria-label="${escapeHtml(subject)}" lang="${input.locale}" style="max-width:560px;margin:0 auto;padding:32px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${h(kind.heading)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${h(texts.greeting)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${h(kind.intro)}</p>
<p style="margin:0 0 24px;"><a href="${url}" style="display:inline-block;padding:12px 20px;background-color:#1d4ed8;color:#ffffff;font-weight:600;text-decoration:none;border-radius:8px;">${h(kind.action)}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#4b5563;">${h(texts.fallback)}</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${url}" style="color:#1d4ed8;">${url}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#4b5563;">${h(kind.expires)}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;">${h(kind.ignore)}</p>
<p style="margin:0;font-size:13px;color:#6b7280;">${h(texts.signature)}</p>
</div>
</body>
</html>
`
  return { to: input.to, subject, text, html }
}
