/**
 * Confirmation du mot de passe avant une action sensible (« mode sudo ») : création d'une clé
 * secrète ou d'un jeton personnel, rotation d'une clé secrète, gestion des membres d'un projet.
 * La connexion compte comme une saisie ; au-delà de la fenêtre, l'API répond 403 REAUTH_REQUIRED
 * et l'interface demande le mot de passe avant de rejouer l'action.
 */

/** Durée pendant laquelle une saisie du mot de passe autorise les actions sensibles (secondes). */
export const REAUTH_WINDOW_SECONDS = 10 * 60

/** Codes d'erreur de la confirmation du mot de passe (`data.code`). */
export const AUTH_ERROR_CODES = [
  'REAUTH_REQUIRED', // action sensible : mot de passe à confirmer
  'PASSWORD_INCORRECT', // confirmation refusée (pas 401 : la session reste valide)
] as const
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number]

export function isRecentlyVerified(verifiedAt: Date | string, now = Date.now()): boolean {
  return now - new Date(verifiedAt).getTime() < REAUTH_WINDOW_SECONDS * 1000
}

/**
 * Appareil de confiance : en cochant la case du dialogue de confirmation, l'utilisateur dispense ce
 * navigateur de ressaisir son mot de passe pour les actions sensibles pendant cette durée (jours).
 * Réglable par NUXT_PUBLIC_TRUSTED_DEVICE_DAYS ; 0 désactive l'option (et ignore les appareils déjà
 * de confiance).
 */
export const TRUSTED_DEVICE_DEFAULT_DAYS = 15
export const TRUSTED_DEVICE_MAX_DAYS = 365

/** Durée effective (jours entiers, 0 = option désactivée) d'une valeur de configuration quelconque. */
export function trustedDeviceDays(value: unknown): number {
  const days = Math.floor(Number(value))
  return Number.isFinite(days) && days > 0 ? Math.min(days, TRUSTED_DEVICE_MAX_DAYS) : 0
}

/** Retrait de la confiance : l'appareil courant seulement, ou tous les appareils du compte. */
export const TRUSTED_DEVICE_SCOPES = ['current', 'all'] as const
export type TrustedDeviceScope = (typeof TRUSTED_DEVICE_SCOPES)[number]
