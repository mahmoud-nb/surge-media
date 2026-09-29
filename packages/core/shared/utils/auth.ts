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
