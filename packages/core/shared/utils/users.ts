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

/**
 * Langues des e-mails envoyés aux comptes (celle de l'interface de l'expéditeur) : les langues de
 * l'interface (nuxt.config.ts › i18n.locales), textes `mail.*` des fichiers de traduction.
 */
export const EMAIL_LOCALES = ['fr', 'en'] as const
export type EmailLocale = (typeof EMAIL_LOCALES)[number]

/** Codes d'erreur métier renvoyés par l'API (`data.code`), traduits par l'interface. */
export const USER_ERROR_CODES = [
  'EMAIL_TAKEN', // adresse déjà utilisée par un autre compte
  'SELF_ACTION', // action interdite sur son propre compte (rôle, désactivation, suppression)
  'LAST_ADMIN', // l'opération retirerait le dernier administrateur actif
  'TOKEN_INVALID', // lien de mot de passe inconnu, expiré ou déjà utilisé
  'ROLE_NOT_INVITABLE', // rôle de plateforme que l'auteur de l'invitation ne peut pas attribuer
  'PROJECTS_REQUIRED', // un gestionnaire rattache toute invitation à au moins un de ses projets
  'PROJECT_UNAVAILABLE', // projet introuvable, archivé, ou dont l'auteur ne gère pas les membres
  'ROLE_NOT_ASSIGNABLE', // rôle de projet hors de ce que permet le rôle de plateforme invité
  'INVITATION_ACCEPTED', // le compte a déjà choisi son mot de passe : seul un administrateur le réinitialise
  'MAIL_NOT_CONFIGURED', // envoi d'e-mails non configuré (NUXT_SMTP_HOST / NUXT_SMTP_FROM)
  'MAIL_FAILED', // le serveur SMTP a refusé ou n'a pas répondu (détail dans les journaux du serveur)
] as const
export type UserErrorCode = (typeof USER_ERROR_CODES)[number]
