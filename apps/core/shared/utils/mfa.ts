import type { Role } from './permissions'

/**
 * Double authentification (MFA, TOTP) de l'administration : règles partagées par le serveur et
 * l'interface (architecture : .claude/architecture-mfa.md). Fonctions pures, testées.
 *
 * Politique (réglage `mfaPolicy`, page « Réglages ») : `optional` = chacun décide pour son compte
 * (défaut) ; `admins` = obligatoire pour les comptes ADMIN ; `everyone` = obligatoire pour tous.
 * Un compte concerné qui ne l'a pas encore activé le configure pendant sa connexion suivante.
 */

export const MFA_POLICIES = ['optional', 'admins', 'everyone'] as const
export type MfaPolicy = (typeof MFA_POLICIES)[number]
export const DEFAULT_MFA_POLICY: MfaPolicy = 'optional'

/** Valeur stockée dans `Setting` → politique connue (toute autre valeur : la politique par défaut). */
export function parseMfaPolicy(value: unknown): MfaPolicy {
  return MFA_POLICIES.includes(value as MfaPolicy) ? value as MfaPolicy : DEFAULT_MFA_POLICY
}

/** La politique impose-t-elle la double authentification à ce rôle ? */
export function mfaRequiredFor(role: Role, policy: MfaPolicy): boolean {
  if (policy === 'everyone') return true
  return policy === 'admins' && role === 'ADMIN'
}

/** Étape de la connexion après le mot de passe : saisir un code, ou configurer l'application (politique). */
export const MFA_LOGIN_STEPS = ['code', 'setup'] as const
export type MfaLoginStep = (typeof MFA_LOGIN_STEPS)[number]

/** Durée d'une connexion en attente du second facteur (défi), puis d'une configuration en cours (secondes). */
export const MFA_CHALLENGE_SECONDS = 5 * 60
export const MFA_SETUP_SECONDS = 10 * 60

/** Codes d'erreur de la double authentification (`data.code`), traduits par l'interface (`mfa.errors.*`). */
export const MFA_ERROR_CODES = [
  'MFA_CODE_INVALID', // code TOTP ou de secours refusé (422, pas 401 : la session éventuelle reste valide)
  'MFA_CHALLENGE_EXPIRED', // connexion en attente expirée ou annulée : revenir au mot de passe (410)
  'MFA_SETUP_EXPIRED', // configuration en cours expirée : recommencer (410)
  'MFA_UNAVAILABLE', // clé de chiffrement absente ou qui ne convient plus (409)
  'MFA_ALREADY_ENABLED', // 409
  'MFA_NOT_ENABLED', // 409
  'MFA_REQUIRED_BY_POLICY', // désactivation refusée : la politique l'exige pour ce rôle (409)
  'MFA_SELF_RESET', // un administrateur ne réinitialise pas son propre MFA depuis la fiche (403)
] as const
export type MfaErrorCode = (typeof MFA_ERROR_CODES)[number]

/** Chiffres d'un code TOTP. */
export const TOTP_DIGITS = 6
/** Codes de secours remis à l'activation (et à chaque régénération). */
export const RECOVERY_CODE_COUNT = 10
/** À partir de ce nombre de codes restants (ou moins), le tableau de bord invite à les régénérer. */
export const RECOVERY_CODES_LOW = 2

/** Saisie d'un code TOTP → 6 chiffres, espaces et tirets ignorés (collage « 123 456 ») ; null sinon. */
export function normalizeTotpCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '')
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(digits) ? digits : null
}
