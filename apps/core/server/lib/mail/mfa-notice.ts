import en from '../../../i18n/locales/en.json'
import fr from '../../../i18n/locales/fr.json'
import type { EmailLocale } from '../../../shared/utils/users'
import { escapeHtml, formatExpiry, interpolate } from './password-link'
import type { MailMessage } from './transport'

/**
 * E-mail au titulaire d'un compte quand sa double authentification change : activée, désactivée,
 * réinitialisée par un administrateur ou par l'exploitant, code de secours utilisé. Dans la langue du
 * compte ; un changement inattendu se voit ainsi aussitôt. Module pur (testé), comme password-link.ts.
 */

export const MFA_NOTICE_KINDS = ['enabled', 'disabled', 'reset', 'recoveryUsed'] as const
export type MfaNoticeKind = (typeof MFA_NOTICE_KINDS)[number]

type Messages = { app: string, mail: typeof fr.mail }
const MESSAGES: Record<EmailLocale, Messages> = {
  fr: { app: fr.app.name, mail: fr.mail },
  en: { app: en.app.name, mail: en.mail },
}

export interface MfaNoticeInput {
  locale: EmailLocale
  kind: MfaNoticeKind
  /** Adresse du compte (destinataire). */
  to: string
  /** Date du changement. */
  date: Date
  /** Origine de l'installation (https://media.example.com). */
  site: string
  /** Réinitialisation : auteur (nom ou adresse d'un administrateur, ou « l'exploitant du serveur »). */
  by?: string
  /** Code de secours utilisé : codes restants. */
  remaining?: number
}

export function mfaNoticeMail(input: MfaNoticeInput): MailMessage {
  const texts = MESSAGES[input.locale].mail
  const kind = texts.mfa[input.kind]
  const values = {
    app: MESSAGES[input.locale].app,
    email: input.to,
    site: input.site,
    date: formatExpiry(input.date, input.locale),
    by: input.by ?? '',
    remaining: String(input.remaining ?? 0),
  }
  const t = (template: string) => interpolate(template, values)
  const subject = t(kind.subject)
  const text = [t(texts.greeting), '', t(kind.intro), '', t(texts.mfa.notYou), '', t(texts.signature)].join('\n')

  const h = (template: string) => escapeHtml(t(template))
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
<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;">${h(texts.mfa.notYou)}</p>
<p style="margin:0;font-size:13px;color:#6b7280;">${h(texts.signature)}</p>
</div>
</body>
</html>
`
  return { to: input.to, subject, text, html }
}
