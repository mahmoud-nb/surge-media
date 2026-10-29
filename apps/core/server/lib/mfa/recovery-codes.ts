import { createHash, randomInt } from 'node:crypto'
import { RECOVERY_CODE_COUNT } from '#shared/utils/mfa'

/**
 * Codes de secours de la double authentification : 10 caractères en deux groupes (`k7q2m-x9fd4`),
 * dans un alphabet sans caractères ambigus (ni i, l, o, 0 ni 1), soit environ 50 bits chacun. Usage
 * unique ; seule leur empreinte SHA-256 est stockée (l'entropie rend argon2 inutile). Fonctions
 * pures, testées (tests/mfa.test.ts).
 */

export const RECOVERY_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const GROUP_LENGTH = 5
const CODE_LENGTH = GROUP_LENGTH * 2

/** Un code aléatoire, tiré uniformément (`randomInt`), au format d'affichage `xxxxx-xxxxx`. */
export function generateRecoveryCode(): string {
  let compact = ''
  for (let i = 0; i < CODE_LENGTH; i++) compact += RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)]
  return `${compact.slice(0, GROUP_LENGTH)}-${compact.slice(GROUP_LENGTH)}`
}

/** Jeu complet de codes distincts. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>()
  while (codes.size < count) codes.add(generateRecoveryCode())
  return [...codes]
}

/**
 * Saisie d'un code → forme compacte de 10 caractères (casse, espaces et tirets ignorés) ; null si la
 * longueur ou un caractère ne correspond pas.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const compact = input.toLowerCase().replace(/[\s-]/g, '')
  if (compact.length !== CODE_LENGTH) return null
  for (const char of compact) if (!RECOVERY_CODE_ALPHABET.includes(char)) return null
  return compact
}

/** Empreinte stockée en base : SHA-256 de la forme compacte. */
export function hashRecoveryCode(code: string): string {
  const compact = normalizeRecoveryCode(code)
  if (!compact) throw new Error('Code de secours invalide')
  return createHash('sha256').update(compact).digest('hex')
}
