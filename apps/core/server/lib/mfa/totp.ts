import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { TOTP_DIGITS } from '#shared/utils/mfa'

/**
 * TOTP (RFC 6238) sur HOTP (RFC 4226) : HMAC-SHA1, 6 chiffres, pas de 30 s — les réglages que toutes
 * les applications d'authentification comprennent (Google et Microsoft Authenticator, 1Password,
 * Bitwarden, Aegis…). Écrit avec node:crypto, sans dépendance ; fonctions pures testées sur les
 * vecteurs de la RFC 6238 (tests/mfa.test.ts).
 */

export const TOTP_PERIOD_SECONDS = 30
/** Pas acceptés de part et d'autre du pas courant (décalage d'horloge du téléphone). */
export const TOTP_WINDOW = 1
/** Taille d'un secret, en octets (160 bits, la taille d'une sortie SHA-1 recommandée par la RFC 4226). */
export const TOTP_SECRET_BYTES = 20

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Octets → base32 (RFC 4648, majuscules, sans `=`), le format des applications d'authentification. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

/** Base32 → octets (casse, espaces et `=` ignorés) ; null si un caractère n'appartient pas à l'alphabet. */
export function base32Decode(input: string): Buffer | null {
  const clean = input.toUpperCase().replace(/[\s=]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) return null
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Nouveau secret aléatoire. */
export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES)
}

/** Pas TOTP d'un instant (millisecondes depuis l'époque Unix). */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS)
}

/** Code HOTP d'un compteur (RFC 4226, troncature dynamique). */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', secret).update(message).digest()
  const offset = hmac[hmac.length - 1]! & 0x0F
  const binary = ((hmac[offset]! & 0x7F) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** Code TOTP d'un instant. */
export function totpCode(secret: Uint8Array, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(nowMs), digits)
}

/**
 * Vérifie un code (déjà normalisé : `normalizeTotpCode`) sur les pas t − 1, t et t + 1. Anti-rejeu :
 * un pas inférieur ou égal à `lastStep` (dernier pas accepté pour ce compte) est refusé. Tous les pas
 * sont calculés et comparés à temps constant. Retourne le pas accepté (à enregistrer), ou null.
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  options: { nowMs: number, lastStep?: number | null, window?: number },
): number | null {
  const window = options.window ?? TOTP_WINDOW
  const current = totpStep(options.nowMs)
  const given = Buffer.from(code)
  let accepted: number | null = null
  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset
    // Toujours TOTP_DIGITS chiffres : un code tronqué ne doit jamais correspondre à une troncature plus courte.
    const expected = Buffer.from(hotp(secret, step))
    const match = expected.length === given.length && timingSafeEqual(expected, given)
    const fresh = options.lastStep == null || step > options.lastStep
    if (match && fresh && accepted === null) accepted = step
  }
  return accepted
}

/**
 * URI `otpauth://` lue par les applications (QR code ou lien) : libellé « émetteur:compte », secret
 * base32 et réglages explicites (certaines applications ne supposent pas les valeurs par défaut).
 */
export function otpauthUri(options: { secret: Uint8Array, account: string, issuer: string }): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`
  const params = new URLSearchParams({
    secret: base32Encode(options.secret),
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`
}

/** Secret base32 groupé par 4 caractères, pour la saisie manuelle (« ABCD EFGH … »). */
export function formatSecretForDisplay(secret: Uint8Array): string {
  return base32Encode(secret).replace(/(.{4})(?=.)/g, '$1 ')
}
