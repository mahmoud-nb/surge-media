/**
 * Identifiants d'API (jetons personnels, clés secrètes et publiques de projet) et origines
 * autorisées : constantes, formats et codes d'erreur partagés entre l'interface et le serveur.
 * Architecture : .claude/architecture-phase-b.md § 4.
 */

/** Doit rester identique à l'enum `TokenType` de prisma/schema.prisma (vérifié à la compilation). */
export const TOKEN_TYPES = ['PERSONAL', 'SECRET', 'PUBLISHABLE'] as const
export type TokenType = (typeof TOKEN_TYPES)[number]

/** Types de clés d'un projet. */
export const PROJECT_KEY_TYPES = ['PUBLISHABLE', 'SECRET'] as const satisfies readonly TokenType[]
export type ProjectKeyType = (typeof PROJECT_KEY_TYPES)[number]

/** Préfixe lisible de chaque type : repérage par les outils de détection de secrets. */
export const TOKEN_PREFIXES: Record<TokenType, string> = {
  PERSONAL: 'sm_pat_',
  SECRET: 'sm_sk_',
  PUBLISHABLE: 'sm_pk_',
}

export const TOKEN_NAME_MAX_LENGTH = 100

/** Étiquettes d'environnement proposées ; une étiquette libre suit ENVIRONMENT_PATTERN. */
export const KEY_ENVIRONMENTS = ['production', 'staging', 'development', 'test'] as const
export const ENVIRONMENT_MAX_LENGTH = 32
/** Minuscules non accentuées, chiffres et tirets simples (ex. « preview-eu »). */
export const ENVIRONMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Durées de validité d'un jeton personnel (jours) : toujours limitées. */
export const PERSONAL_TOKEN_LIFETIMES = ['30', '90', '365'] as const
export type PersonalTokenLifetime = (typeof PERSONAL_TOKEN_LIFETIMES)[number]
export const DEFAULT_PERSONAL_TOKEN_LIFETIME: PersonalTokenLifetime = '90'

/** Durées de validité d'une clé secrète (jours, ou sans échéance). Les clés publiques n'expirent pas. */
export const SECRET_KEY_LIFETIMES = ['30', '90', '365', 'never'] as const
export type SecretKeyLifetime = (typeof SECRET_KEY_LIFETIMES)[number]
export const DEFAULT_SECRET_KEY_LIFETIME: SecretKeyLifetime = '365'

/** Période pendant laquelle l'ancienne clé reste valable après une rotation. */
export const ROTATION_OVERLAPS = ['now', '1h', '24h', '7d'] as const
export type RotationOverlap = (typeof ROTATION_OVERLAPS)[number]
export const ROTATION_OVERLAP_SECONDS: Record<RotationOverlap, number> = {
  'now': 0,
  '1h': 3600,
  '24h': 86_400,
  '7d': 604_800,
}

/** Statut calculé d'un identifiant. */
export const TOKEN_STATUSES = ['active', 'expired', 'revoked'] as const
export type TokenStatus = (typeof TOKEN_STATUSES)[number]

export function tokenStatus(token: { revokedAt: Date | string | null, expiresAt: Date | string | null }, now = Date.now()): TokenStatus {
  if (token.revokedAt) return 'revoked'
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now) return 'expired'
  return 'active'
}

/** Nombre maximal d'origines autorisées par projet. */
export const MAX_ALLOWED_ORIGINS = 100
export const ORIGIN_MAX_LENGTH = 191

/** Codes d'erreur métier des identifiants et origines (`data.code`), traduits par l'interface. */
export const CREDENTIAL_ERROR_CODES = [
  'TOKEN_NOT_ACTIVE', // révocation ou rotation d'un identifiant expiré ou déjà révoqué
  'TOKEN_ACTIVE', // suppression d'un identifiant encore actif (le révoquer d'abord)
  'TOKEN_REPLACED', // rotation d'une clé déjà remplacée
  'PROJECT_UNAVAILABLE', // projet choisi pour un jeton personnel inaccessible ou archivé
  'ORIGIN_EXISTS', // origine déjà autorisée pour ce projet
  'ORIGIN_LIMIT_REACHED', // nombre maximal d'origines atteint
] as const
export type CredentialErrorCode = (typeof CREDENTIAL_ERROR_CODES)[number]
