import type { LicensePublicKey } from './token'

/**
 * Clés publiques de confiance des licences. Les clés privées n'existent que chez l'éditeur (outil d'émission,
 * dépôt privé `surge-up-licensing`), jamais dans un dépôt, sur un serveur ni dans la CI. Rotation : ajouter la
 * nouvelle clé, garder l'ancienne tant que des licences signées par elle sont en cours. Aucune variable
 * d'environnement ne peut ajouter une clé : sinon n'importe qui signerait sa propre licence.
 */
export const LICENSE_PUBLIC_KEYS: readonly LicensePublicKey[] = [
  // Clé de production 2026, générée par l'éditeur le 2026-10-30 (`keygen` de l'outil d'émission).
  { kid: 'surge-up-2026-1', x: 'q5lYJqUDyi2pYWDsL3mEm790DC5vgFYLAjrwsqEYigI' },
]

/**
 * Clé de développement : acceptée seulement par `nuxt dev` (`import.meta.dev`, jamais vrai dans un build).
 * Sa clé privée est publique (scripts/dev-license.ts) : elle sert à essayer l'écran Licence en local.
 */
export const LICENSE_DEV_PUBLIC_KEY: LicensePublicKey = { kid: 'surge-up-dev', x: 'u6hXch05CZcVW4UxyZxrIgLdN-UX875LFCRF74UqVls' }

/** Clés acceptées : celles de production, plus celle de développement en développement seulement. */
export function trustedLicenseKeys(dev: boolean): readonly LicensePublicKey[] {
  return dev ? [...LICENSE_PUBLIC_KEYS, LICENSE_DEV_PUBLIC_KEY] : LICENSE_PUBLIC_KEYS
}
