/**
 * Licence commerciale (fichier de licence signé Ed25519) : catalogue et règles partagés par le serveur et
 * l'interface (architecture : .claude/architecture-licence.md). Fonctions pures, testées.
 *
 * Une licence active des fonctions payantes ; elle n'arrête jamais le reste du produit (diffusion, API,
 * administration). États : `none` (Community, sans licence) · `invalid` · `pending` (pas encore valable) ·
 * `valid` · `expiring` (échéance dans 30 jours ou moins) · `grace` (échue depuis 30 jours ou moins) ·
 * `expired`. Les fonctions payantes restent actives jusqu'à la fin de la grâce.
 */

/** Fonctions payantes connues de cette version. Une licence peut en citer d'autres (version plus récente). */
export const LICENSE_FEATURES = ['sso', 'siem', 'scim'] as const
export type LicenseFeature = (typeof LICENSE_FEATURES)[number]

/** Offres commerciales (libellé seulement : ce sont les fonctions listées dans la licence qui comptent). */
export const LICENSE_PLANS = ['pro', 'business', 'enterprise', 'enterprise-global', 'agency', 'oem', 'trial'] as const
export type LicensePlan = (typeof LICENSE_PLANS)[number]

export const LICENSE_STATES = ['none', 'invalid', 'pending', 'valid', 'expiring', 'grace', 'expired'] as const
export type LicenseState = (typeof LICENSE_STATES)[number]
/** État d'une licence dont la signature est valable : il ne dépend plus que de ses dates. */
export type LicenseTermState = Extract<LicenseState, 'pending' | 'valid' | 'expiring' | 'grace' | 'expired'>

/** États où les fonctions payantes de la licence sont actives. */
export const LICENSE_ACTIVE_STATES: readonly LicenseState[] = ['valid', 'expiring', 'grace']

/** Avertissement avant l'échéance, puis grâce après elle (jours). */
export const LICENSE_WARNING_DAYS = 30
export const LICENSE_GRACE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** Raisons d'un refus, traduites par l'interface (`license.reasons.*`). */
export const LICENSE_INVALID_REASONS = [
  'malformed', // pas un jeton à trois parties base64url, ou JSON illisible
  'algorithm', // en-tête autre que EdDSA / surge-media-license
  'unknown-key', // clé de signature inconnue de cette version (ou clé de développement hors développement)
  'signature', // signature fausse : licence altérée
  'product', // licence d'un autre produit ou d'un autre émetteur
  'version', // format plus récent que cette version : la mettre à jour
  'payload', // champs absents ou incohérents
] as const
export type LicenseInvalidReason = (typeof LICENSE_INVALID_REASONS)[number]

/** Codes d'erreur de la licence (`data.code`), traduits par l'interface (`license.errors.*`). */
export const LICENSE_ERROR_CODES = [
  'LICENSE_INVALID', // licence refusée à l'installation (422, `data.reason`)
  'LICENSE_FROM_ENV', // licence fournie par NUXT_LICENSE_KEY : rien à installer ni à retirer ici (409)
  'LICENSE_REQUIRED', // fonction payante sans licence active qui la couvre (403, `data.feature`)
] as const
export type LicenseErrorCode = (typeof LICENSE_ERROR_CODES)[number]

/** D'où vient la licence en vigueur : la variable d'environnement l'emporte sur la base. */
export type LicenseSource = 'env' | 'database'

/** Période d'une licence (millisecondes). */
export interface LicensePeriod {
  startsAt: number
  expiresAt: number
}

/** Fin de la grâce : les fonctions payantes s'éteignent à cette date. */
export function licenseGraceEndsAt(expiresAt: number): number {
  return expiresAt + LICENSE_GRACE_DAYS * DAY_MS
}

/** État d'une licence signée, à la date de référence (bornes : 30 jours pile avant ou après = encore averti / en grâce). */
export function licenseTermState(period: LicensePeriod, referenceMs: number): LicenseTermState {
  if (referenceMs < period.startsAt) return 'pending'
  if (referenceMs < period.expiresAt) return period.expiresAt - referenceMs <= LICENSE_WARNING_DAYS * DAY_MS ? 'expiring' : 'valid'
  return referenceMs <= licenseGraceEndsAt(period.expiresAt) ? 'grace' : 'expired'
}

export function licenseFeaturesActive(state: LicenseState): boolean {
  return LICENSE_ACTIVE_STATES.includes(state)
}

/** Jours entiers restants avant une date (0 si elle est passée), pour l'affichage. */
export function daysUntil(targetMs: number, referenceMs: number): number {
  return Math.max(0, Math.ceil((targetMs - referenceMs) / DAY_MS))
}

/**
 * Date de référence de la licence : la plus récente des dates connues (horloge du système, repère gardé
 * en base, heure du serveur de base). Reculer l'horloge du système ne rajeunit donc pas une licence.
 */
export function licenseReferenceTime(systemMs: number, ...witnesses: Array<number | null | undefined>): number {
  return Math.max(systemMs, ...witnesses.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))
}

/** Réglage (`Setting`) du repère : la plus haute date de référence déjà vue, en millisecondes (serveur et CLI). */
export const LICENSE_CLOCK_SETTING_KEY = 'licenseClock'

/** Valeur stockée du repère → millisecondes (nombre JSON, ou texte selon le pilote qui la lit) ; null sinon. */
export function parseLicenseClock(value: unknown): number | null {
  const ms = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : null
}

/** Au-delà de ce retard de l'horloge du système sur la date de référence, les administrateurs sont avertis. */
export const LICENSE_CLOCK_WARNING_MS = 60 * 60 * 1000
/** Le repère n'est réécrit en base que s'il avance d'au moins cette durée. */
export const LICENSE_CLOCK_SAVE_MS = 10 * 60 * 1000

/** Retard de l'horloge du système sur la date de référence (0 si elle est à l'heure ou en avance). */
export function licenseClockBehindMs(systemMs: number, referenceMs: number): number {
  return Math.max(0, referenceMs - systemMs)
}

/** Licence collée ou lue dans un fichier → jeton compact : espaces et retours à la ligne ignorés (e-mail replié). */
export function normalizeLicenseToken(input: string): string {
  return input.replace(/\s+/g, '')
}

/** Licence en vigueur telle que l'API la décrit (dates ISO). */
export interface LicenseDetails {
  id: string
  licensee: { name: string, country?: string }
  plan: string
  features: string[]
  instances: number | null
  issuedAt: string
  startsAt: string
  expiresAt: string
  graceEndsAt: string
  supportEndsAt: string
}
