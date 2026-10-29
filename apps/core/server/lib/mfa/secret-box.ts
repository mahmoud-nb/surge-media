import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Chiffrement des secrets TOTP en base (`User.mfaSecret`) : AES-256-GCM, clé de 32 octets dérivée par
 * HKDF-SHA256 de NUXT_MFA_ENCRYPTION_KEY (contexte `surge-media/mfa/v1`), identifiant du compte en
 * données associées (un secret recopié sur la ligne d'un autre compte ne se déchiffre pas). Format
 * stocké : `v1.<iv>.<tag>.<chiffré>` en base64url — le préfixe de version permettra une rotation.
 * Fonctions pures (la clé est passée en paramètre), testées (tests/mfa.test.ts).
 */

const VERSION = 'v1'
const HKDF_INFO = 'surge-media/mfa/v1'
const IV_BYTES = 12
/** Longueur minimale de la clé configurée (init et l'image Docker en génèrent 43 : 32 octets en base64url). */
export const MFA_KEY_MIN_LENGTH = 32

/** Clé absente, trop courte, ou secret qui ne se déchiffre pas avec elle (clé changée, donnée altérée). */
export class MfaSecretError extends Error {
  constructor(readonly reason: 'missing-key' | 'weak-key' | 'malformed' | 'undecryptable') {
    super(`MFA secret: ${reason}`)
    this.name = 'MfaSecretError'
  }
}

function deriveKey(keyMaterial: string | undefined): Buffer {
  if (!keyMaterial) throw new MfaSecretError('missing-key')
  if (keyMaterial.length < MFA_KEY_MIN_LENGTH) throw new MfaSecretError('weak-key')
  return Buffer.from(hkdfSync('sha256', keyMaterial, Buffer.alloc(0), HKDF_INFO, 32))
}

/** Chiffre un secret pour un compte. */
export function sealMfaSecret(secret: Uint8Array, userId: string, keyMaterial: string | undefined): string {
  const key = deriveKey(keyMaterial)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(userId))
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv, tag, encrypted].map(part => typeof part === 'string' ? part : part.toString('base64url')).join('.')
}

/** Déchiffre le secret d'un compte ; `MfaSecretError` si la clé manque ou ne convient pas. */
export function openMfaSecret(sealed: string, userId: string, keyMaterial: string | undefined): Buffer {
  const key = deriveKey(keyMaterial)
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new MfaSecretError('malformed')
  const [iv, tag, encrypted] = parts.slice(1).map(part => Buffer.from(part, 'base64url')) as [Buffer, Buffer, Buffer]
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new MfaSecretError('malformed')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(userId))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()])
  }
  catch {
    throw new MfaSecretError('undecryptable')
  }
}
