import { describe, expect, it } from 'vitest'
import { DEFAULT_MFA_POLICY, MFA_POLICIES, mfaRequiredFor, normalizeTotpCode, parseMfaPolicy } from '#shared/utils/mfa'
import { ROLES } from '#shared/utils/permissions'
import { otpauthQrSvg } from '../server/lib/mfa/qr'
import {
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
} from '../server/lib/mfa/recovery-codes'
import { MfaSecretError, openMfaSecret, sealMfaSecret } from '../server/lib/mfa/secret-box'
import {
  base32Decode,
  base32Encode,
  formatSecretForDisplay,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from '../server/lib/mfa/totp'

// RFC 6238, annexe B (SHA-1) : secret ASCII « 12345678901234567890 », codes à 8 chiffres.
const RFC_SECRET = Buffer.from('12345678901234567890')
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1_111_111_109, '07081804'],
  [1_111_111_111, '14050471'],
  [1_234_567_890, '89005924'],
  [2_000_000_000, '69279037'],
  [20_000_000_000, '65353130'],
]

// Clé de chiffrement de test, sans valeur réelle (faux positif de gitleaks, voir .gitleaksignore).
const KEY = 'cle-de-chiffrement-de-test-0123456789abcdef' // gitleaks:allow

describe('TOTP (RFC 6238)', () => {
  it.each(RFC_VECTORS)('t = %i s → %s', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, seconds * 1000, 8)).toBe(expected)
    // 6 chiffres : les 6 derniers du code à 8 chiffres (même troncature, modulo 10^6).
    expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(expected.slice(2))
  })

  it('HOTP de la RFC 4226 (annexe D)', () => {
    expect(hotp(RFC_SECRET, 0)).toBe('755224')
    expect(hotp(RFC_SECRET, 9)).toBe('520489')
  })

  it('accepte le pas courant et ses voisins, et renvoie le pas accepté', () => {
    const now = 1_800_000_000_000
    const step = totpStep(now)
    for (const offset of [-1, 0, 1]) {
      const code = hotp(RFC_SECRET, step + offset)
      expect(verifyTotp(RFC_SECRET, code, { nowMs: now })).toBe(step + offset)
    }
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), { nowMs: now })).toBeNull()
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), { nowMs: now })).toBeNull()
  })

  it('refuse un code déjà utilisé ou plus ancien (anti-rejeu)', () => {
    const now = 1_800_000_000_000
    const step = totpStep(now)
    const code = hotp(RFC_SECRET, step)
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastStep: step })).toBeNull()
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), { nowMs: now, lastStep: step - 1 })).toBeNull()
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastStep: step - 1 })).toBe(step)
  })

  it('refuse un code faux ou de mauvaise longueur', () => {
    const now = 1_800_000_000_000
    const good = totpCode(RFC_SECRET, now)
    const wrong = String((Number(good) + 1) % 1_000_000).padStart(6, '0')
    expect(verifyTotp(RFC_SECRET, wrong, { nowMs: now })).toBeNull()
    expect(verifyTotp(RFC_SECRET, good.slice(1), { nowMs: now })).toBeNull()
  })

  it('normalise la saisie d’un code', () => {
    expect(normalizeTotpCode(' 123 456 ')).toBe('123456')
    expect(normalizeTotpCode('123-456')).toBe('123456')
    expect(normalizeTotpCode('12345')).toBeNull()
    expect(normalizeTotpCode('12345a')).toBeNull()
  })
})

describe('base32 et URI otpauth', () => {
  it('encode et décode les vecteurs de la RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
    expect(base32Encode(Buffer.from('f'))).toBe('MY')
    expect(base32Decode('MZXW6YTBOI')?.toString()).toBe('foobar')
    expect(base32Decode('mzxw 6ytb oi==')?.toString()).toBe('foobar')
    expect(base32Decode('MZXW1')).toBeNull()
  })

  it('fait l’aller-retour d’un secret aléatoire de 20 octets', () => {
    const secret = generateTotpSecret()
    expect(secret).toHaveLength(20)
    expect(base32Encode(secret)).toHaveLength(32)
    expect(base32Decode(base32Encode(secret))?.equals(secret)).toBe(true)
    expect(formatSecretForDisplay(secret)).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
  })

  it('construit l’URI avec émetteur, compte et réglages explicites', () => {
    const uri = otpauthUri({ secret: Buffer.from('foobar'), account: 'ana@example.com', issuer: 'SurgeMedia (media.example.com)' })
    expect(uri).toBe('otpauth://totp/SurgeMedia%20(media.example.com):ana%40example.com?secret=MZXW6YTBOI&issuer=SurgeMedia%20%28media.example.com%29&algorithm=SHA1&digits=6&period=30')
  })

  it('produit un QR code SVG noir sur blanc', () => {
    const svg = otpauthQrSvg('otpauth://totp/SurgeMedia:ana%40example.com?secret=MZXW6YTBOI')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('#000000')
    expect(svg).toContain('#ffffff')
  })
})

describe('codes de secours', () => {
  it('génère 10 codes distincts au format xxxxx-xxxxx', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    const pattern = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{5}-[${RECOVERY_CODE_ALPHABET}]{5}$`)
    for (const code of codes) expect(code).toMatch(pattern)
  })

  it('n’utilise aucun caractère ambigu', () => {
    for (const char of 'il0o1') expect(RECOVERY_CODE_ALPHABET).not.toContain(char)
    expect(RECOVERY_CODE_ALPHABET).toHaveLength(31)
  })

  it('tolère la casse, les espaces et les tirets à la saisie', () => {
    const code = generateRecoveryCode()
    const compact = code.replace('-', '')
    expect(normalizeRecoveryCode(code)).toBe(compact)
    expect(normalizeRecoveryCode(` ${code.toUpperCase()} `)).toBe(compact)
    expect(normalizeRecoveryCode(compact.replace(/(.{3})/g, '$1 '))).toBe(compact)
    expect(normalizeRecoveryCode('abcde-fghi')).toBeNull()
    expect(normalizeRecoveryCode('abcde-fgh0j')).toBeNull()
  })

  it('a une empreinte stable, indépendante de la présentation', () => {
    const code = generateRecoveryCode()
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashRecoveryCode(code.toUpperCase().replace('-', ' '))).toBe(hashRecoveryCode(code))
    expect(hashRecoveryCode(generateRecoveryCode())).not.toBe(hashRecoveryCode(code))
    expect(() => hashRecoveryCode('trop-court')).toThrow()
  })
})

describe('chiffrement des secrets', () => {
  it('fait l’aller-retour et change à chaque chiffrement (IV aléatoire)', () => {
    const secret = generateTotpSecret()
    const sealed = sealMfaSecret(secret, 'user_1', KEY)
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(openMfaSecret(sealed, 'user_1', KEY).equals(secret)).toBe(true)
    expect(sealMfaSecret(secret, 'user_1', KEY)).not.toBe(sealed)
  })

  it('refuse une autre clé, un autre compte ou une donnée altérée', () => {
    const sealed = sealMfaSecret(generateTotpSecret(), 'user_1', KEY)
    expect(() => openMfaSecret(sealed, 'user_1', `${KEY}-autre`)).toThrow(MfaSecretError)
    expect(() => openMfaSecret(sealed, 'user_2', KEY)).toThrow(MfaSecretError)
    const parts = sealed.split('.')
    parts[3] = `${parts[3]!.slice(0, -2)}AA`
    expect(() => openMfaSecret(parts.join('.'), 'user_1', KEY)).toThrow(MfaSecretError)
    expect(() => openMfaSecret('v2.a.b.c', 'user_1', KEY)).toThrow(MfaSecretError)
  })

  it('exige une clé configurée et assez longue', () => {
    const secret = generateTotpSecret()
    expect(() => sealMfaSecret(secret, 'user_1', undefined)).toThrow(expect.objectContaining({ reason: 'missing-key' }))
    expect(() => sealMfaSecret(secret, 'user_1', 'courte')).toThrow(expect.objectContaining({ reason: 'weak-key' }))
  })
})

describe('politique', () => {
  it('lit la valeur stockée, avec « facultatif » par défaut', () => {
    expect(DEFAULT_MFA_POLICY).toBe('optional')
    for (const policy of MFA_POLICIES) expect(parseMfaPolicy(policy)).toBe(policy)
    expect(parseMfaPolicy(undefined)).toBe('optional')
    expect(parseMfaPolicy('always')).toBe('optional')
  })

  it('impose la double authentification selon le rôle', () => {
    for (const role of ROLES) {
      expect(mfaRequiredFor(role, 'optional')).toBe(false)
      expect(mfaRequiredFor(role, 'everyone')).toBe(true)
      expect(mfaRequiredFor(role, 'admins')).toBe(role === 'ADMIN')
    }
  })
})

describe('e-mail de notification', () => {
  it('prévient le titulaire dans sa langue, avec les détails du changement', async () => {
    const { mfaNoticeMail } = await import('../server/lib/mail/mfa-notice')
    const date = new Date('2026-10-30T10:00:00Z')
    const fr = mfaNoticeMail({ locale: 'fr', kind: 'recoveryUsed', to: 'ana@example.com', date, site: 'https://media.example.com', remaining: 7 })
    expect(fr.subject).toBe('Code de secours utilisé sur SurgeMedia')
    expect(fr.text).toContain('Il vous en reste 7.')
    expect(fr.text).toContain('prévenez sans attendre votre administrateur')
    const en = mfaNoticeMail({ locale: 'en', kind: 'reset', to: 'ana@example.com', date, site: 'https://media.example.com', by: 'Bob <script>' })
    expect(en.subject).toBe('Two-factor authentication reset on SurgeMedia')
    expect(en.text).toContain('reset by Bob <script>')
    expect(en.html).toContain('Bob &lt;script&gt;')
    expect(en.html).not.toContain('<script>')
  })
})
