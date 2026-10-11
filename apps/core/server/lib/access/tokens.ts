import { createHash, randomBytes } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { TOKEN_PREFIXES, TOKEN_TYPES, type TokenType } from '#shared/utils/credentials'

/**
 * Format des identifiants opaques (jetons personnels, clés de projet) — fonctions pures, testées.
 *
 *   sm_<type>_<corps : 32 octets aléatoires en base62, 43 caractères><CRC32 en base62, 6 caractères>
 *
 * - La sécurité vient des 256 bits aléatoires ; le CRC32 (calculé sur tout ce qui précède, préfixe
 *   compris) permet de rejeter un jeton mal formé ou tronqué sans interroger la base, et aide les
 *   outils de détection de secrets à limiter les faux positifs (à la manière des jetons GitHub).
 * - Seule l'empreinte SHA-256 est stockée (256 bits d'entropie : pas besoin d'un hachage lent).
 * - Le préfixe lisible (`sm_sk_4fQ9Zt`) sert à reconnaître l'identifiant dans l'administration.
 */

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BODY_BYTES = 32
/** 62^43 > 2^256 : 43 caractères suffisent toujours pour 32 octets. */
export const TOKEN_BODY_LENGTH = 43
/** 62^6 > 2^32 : 6 caractères pour le CRC32. */
export const TOKEN_CHECKSUM_LENGTH = 6
/** Caractères du corps conservés dans le préfixe affiché. */
const DISPLAY_BODY_LENGTH = 6

function toBase62(value: bigint, length: number): string {
  let out = ''
  let rest = value
  while (rest > 0n) {
    out = BASE62[Number(rest % 62n)] + out
    rest /= 62n
  }
  return out.padStart(length, '0')
}

function checksum(payload: string): string {
  return toBase62(BigInt(crc32(payload)), TOKEN_CHECKSUM_LENGTH)
}

export interface GeneratedToken {
  /** Valeur complète, à montrer une seule fois (sauf clé publique). */
  value: string
  /** Empreinte stockée en base. */
  hash: string
  /** Préfixe affiché dans l'administration. */
  prefix: string
}

export function hashAccessToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function displayPrefix(value: string, type: TokenType): string {
  return value.slice(0, TOKEN_PREFIXES[type].length + DISPLAY_BODY_LENGTH)
}

export function generateAccessToken(type: TokenType, random: Buffer = randomBytes(BODY_BYTES)): GeneratedToken {
  if (random.length !== BODY_BYTES) throw new Error(`Un jeton exige ${BODY_BYTES} octets aléatoires.`)
  const payload = TOKEN_PREFIXES[type] + toBase62(BigInt(`0x${random.toString('hex')}`), TOKEN_BODY_LENGTH)
  const value = payload + checksum(payload)
  return { value, hash: hashAccessToken(value), prefix: displayPrefix(value, type) }
}

const TOKEN_PATTERN = new RegExp(`^sm_(pat|sk|pk)_[0-9A-Za-z]{${TOKEN_BODY_LENGTH + TOKEN_CHECKSUM_LENGTH}}$`)

/**
 * Type d'un identifiant bien formé (préfixe, longueur, alphabet et CRC corrects), ou null :
 * contrôle sans accès à la base, fait avant toute recherche d'empreinte.
 */
export function parseAccessToken(value: string): TokenType | null {
  if (!TOKEN_PATTERN.test(value)) return null
  const payload = value.slice(0, -TOKEN_CHECKSUM_LENGTH)
  if (checksum(payload) !== value.slice(-TOKEN_CHECKSUM_LENGTH)) return null
  return TOKEN_TYPES.find(type => payload.startsWith(TOKEN_PREFIXES[type])) ?? null
}
