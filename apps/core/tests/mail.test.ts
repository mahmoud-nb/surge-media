import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatExpiry, passwordLinkMail } from '../server/lib/mail/password-link'
import { emailPasswordLinkSchema } from '../shared/schemas/users'
import { EMAIL_LOCALES } from '../shared/utils/users'

const base = {
  to: 'invite@example.com',
  url: 'https://media.example.com/password/AbC_dEf-123',
  expiresAt: new Date('2026-10-11T08:30:00Z'),
  timeZone: 'Europe/Paris',
  sender: 'Alice Martin',
  site: 'https://media.example.com',
} as const

describe('e-mail d\'un lien de mot de passe', () => {
  it('invitation en français : objet, expéditeur, compte, lien, échéance avec fuseau', () => {
    const mail = passwordLinkMail({ ...base, locale: 'fr', purpose: 'INVITATION' })
    expect(mail.to).toBe('invite@example.com')
    expect(mail.subject).toBe('Votre invitation à surgeMedia')
    expect(mail.text).toContain('Alice Martin vous invite à rejoindre l\'administration de surgeMedia avec le compte invite@example.com.')
    expect(mail.text).toContain(`ouvrez ce lien :\n${base.url}\n`)
    expect(mail.text).toContain('11 octobre 2026')
    expect(mail.text).toContain('10:30')
    expect(mail.text).not.toMatch(/\{\w+\}/)
    expect(mail.html).toContain('<html lang="fr">')
    expect(mail.html).toContain(`href="${base.url}"`)
    expect(mail.html).not.toMatch(/\{\w+\}/)
  })

  it('réinitialisation en anglais', () => {
    const mail = passwordLinkMail({ ...base, locale: 'en', purpose: 'RESET' })
    expect(mail.subject).toBe('Reset your surgeMedia password')
    expect(mail.text).toContain('Alice Martin requested a password reset for your surgeMedia account (invite@example.com).')
    expect(mail.text).toContain('October 11, 2026')
    expect(mail.html).toContain('<html lang="en">')
  })

  it('échappe les valeurs dans la version HTML', () => {
    const mail = passwordLinkMail({ ...base, locale: 'fr', purpose: 'INVITATION', sender: '<script>alert(1)</script> & co' })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co')
    expect(mail.text).toContain('<script>alert(1)</script> & co')
  })

  it('fuseau horaire invalide : celui du serveur, sans erreur', () => {
    expect(() => formatExpiry(base.expiresAt, 'fr', 'Pas/Un_Fuseau')).not.toThrow()
    expect(formatExpiry(base.expiresAt, 'en', 'UTC')).toContain('08:30')
  })

  it('langues des e-mails = langues de l\'interface (nuxt.config.ts)', () => {
    const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
    const codes = [...config.matchAll(/\{ code: '(\w+)'/g)].map(match => match[1])
    expect([...EMAIL_LOCALES].sort()).toEqual(codes.sort())
  })

  it('demande d\'envoi : jeton d\'un lien, langue connue', () => {
    expect(emailPasswordLinkSchema.safeParse({ token: 'AbC_dEf-123', locale: 'fr', timeZone: 'Europe/Paris' }).success).toBe(true)
    expect(emailPasswordLinkSchema.safeParse({ token: '../x', locale: 'fr' }).success).toBe(false)
    expect(emailPasswordLinkSchema.safeParse({ token: 'abc', locale: 'de' }).success).toBe(false)
    expect(emailPasswordLinkSchema.safeParse({ token: '', locale: 'en' }).success).toBe(false)
  })
})
