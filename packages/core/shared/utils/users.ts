/**
 * Statut d'un compte, déduit de la base :
 *  - `active`   : mot de passe défini, compte actif ;
 *  - `invited`  : compte actif, invitation pas encore acceptée (aucun mot de passe) ;
 *  - `inactive` : compte désactivé (connexion impossible, sessions révoquées).
 */
export const USER_STATUSES = ['active', 'invited', 'inactive'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export function userStatus(user: { isActive: boolean, hasPassword: boolean }): UserStatus {
  if (!user.isActive) return 'inactive'
  return user.hasPassword ? 'active' : 'invited'
}

/** Codes d'erreur métier renvoyés par l'API (`data.code`), traduits par l'interface. */
export const USER_ERROR_CODES = [
  'EMAIL_TAKEN', // adresse déjà utilisée par un autre compte
  'SELF_ACTION', // action interdite sur son propre compte (rôle, désactivation, suppression)
  'LAST_ADMIN', // l'opération retirerait le dernier administrateur actif
  'TOKEN_INVALID', // lien de mot de passe inconnu, expiré ou déjà utilisé
] as const
export type UserErrorCode = (typeof USER_ERROR_CODES)[number]
