import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { readDatabaseEnv } from '#shared/database'
import type { LicensePayload } from '#shared/schemas/license'
import {
  LICENSE_CLOCK_SAVE_MS,
  LICENSE_CLOCK_SETTING_KEY,
  LICENSE_USAGE_SETTING_KEY,
  licenseClockBehindMs,
  licenseFeaturesActive,
  licenseReferenceTime,
  licenseTermState,
  licenseUsageStale,
  parseLicenseClock,
  parseLicenseUsage,
  type LicenseDetails,
  type LicenseErrorCode,
  type LicenseFeature,
  type LicenseInvalidReason,
  type LicenseSource,
  type LicenseState,
  type LicenseUsage,
  type LicenseUsageDeclaration,
} from '#shared/utils/license'
import { LICENSE_PUBLIC_KEYS, trustedLicenseKeys } from '../lib/license/keys'
import { licenseDetails, licensePeriod, verifyLicense } from '../lib/license/token'

/**
 * Licence commerciale — architecture : .claude/architecture-licence.md.
 *
 * Source : NUXT_LICENSE_KEY, sinon la licence installée depuis Réglages › Licence (`Setting` `license`).
 * Vérification hors ligne (server/lib/license/), état jugé à la **date de référence** : la plus récente entre
 * l'horloge du système, le repère gardé en base (`licenseClock`, repris du dernier événement d'audit s'il
 * manque) et, en PostgreSQL / MySQL, l'heure du serveur de base. Reculer l'horloge ne rajeunit donc pas une
 * licence. État recalculé au plus toutes les 5 minutes par processus. Sans licence active, seules les
 * fonctions payantes sont refusées (`requireLicenseFeature`) : rien d'autre ne s'arrête.
 */

const LICENSE_SETTING_KEY = 'license'
const INSTANCE_SETTING_KEY = 'instanceId'
const STATUS_CACHE_MS = 5 * 60_000

export interface LicenseStatus {
  state: LicenseState
  source: LicenseSource | null
  /** Raison du refus (état `invalid`). */
  reason: LicenseInvalidReason | null
  license: LicenseDetails | null
  /** Fonctions payantes actives (vide hors des états valable, bientôt échu et en grâce). */
  features: string[]
  /** Date de référence (ISO) et retard de l'horloge du système sur elle (ms). */
  referenceAt: string
  clockBehindMs: number
}

/** Erreur de la licence : statut HTTP + code (`data.code`) traduit par l'interface. */
export function licenseError(statusCode: 403 | 409 | 422, code: LicenseErrorCode, data: Record<string, unknown> = {}) {
  return createError({ statusCode, statusMessage: code, data: { code, ...data } })
}

function licenseKeyFromEnv(event?: H3Event): string {
  return (event ? useRuntimeConfig(event) : useRuntimeConfig()).license?.key?.trim() ?? ''
}

/** La licence vient-elle de NUXT_LICENSE_KEY ? Elle ne s'installe ni ne se retire alors depuis l'interface. */
export function licenseFromEnv(event: H3Event): boolean {
  return licenseKeyFromEnv(event) !== ''
}

// ─── Date de référence ────────────────────────────────────────────────────────

/** Heure du serveur de base (PostgreSQL, MySQL) : un témoin indépendant de l'horloge de ce serveur. */
async function databaseTime(): Promise<number | null> {
  const { provider } = readDatabaseEnv()
  if (provider === 'sqlite') return null
  try {
    const prisma = await usePrisma()
    // En millisecondes depuis l'époque Unix : indépendant du fuseau de la session.
    const rows = provider === 'postgresql'
      ? await prisma.$queryRawUnsafe<{ now: unknown }[]>('SELECT CAST(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000 AS BIGINT) AS now')
      : await prisma.$queryRawUnsafe<{ now: unknown }[]>('SELECT CAST(UNIX_TIMESTAMP(NOW(3)) * 1000 AS SIGNED) AS now')
    const now = Number(rows[0]?.now)
    return Number.isFinite(now) && now > 0 ? now : null
  }
  catch (error) {
    console.warn('[surge-media] Licence : heure du serveur de base illisible, ignorée.', error)
    return null
  }
}

/** Date de référence de la licence ; avance le repère gardé en base (jamais en arrière). */
async function readReferenceTime(): Promise<{ referenceMs: number, systemMs: number }> {
  const prisma = await usePrisma()
  const systemMs = Date.now()
  const stored = parseLicenseClock((await prisma.setting.findUnique({ where: { key: LICENSE_CLOCK_SETTING_KEY } }))?.value)
  // Repère absent (premier calcul, ligne supprimée) : le dernier événement d'audit en tient lieu.
  const mark = stored ?? (await prisma.auditEvent.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }))?.at.getTime() ?? null
  const referenceMs = licenseReferenceTime(systemMs, mark, await databaseTime())
  if (stored === null || referenceMs - stored >= LICENSE_CLOCK_SAVE_MS) {
    try {
      await prisma.setting.upsert({
        where: { key: LICENSE_CLOCK_SETTING_KEY },
        create: { key: LICENSE_CLOCK_SETTING_KEY, value: referenceMs },
        update: { value: referenceMs },
      })
    }
    catch (error) {
      // Création simultanée par un autre processus : le repère est écrit, le prochain calcul le relira.
      if (!isUniqueViolation(error)) throw error
    }
  }
  return { referenceMs, systemMs }
}

// ─── État ─────────────────────────────────────────────────────────────────────

async function readStoredLicense(): Promise<string | null> {
  const prisma = await usePrisma()
  const value = (await prisma.setting.findUnique({ where: { key: LICENSE_SETTING_KEY } }))?.value
  return typeof value === 'string' && value ? value : null
}

/**
 * Clés acceptées. `import.meta.dev` est remplacé par `false` à la construction : la branche de développement
 * disparaît alors du serveur construit, clé de développement comprise.
 */
const TRUSTED_KEYS = import.meta.dev ? trustedLicenseKeys(true) : LICENSE_PUBLIC_KEYS

function verify(token: string) {
  return verifyLicense(token, TRUSTED_KEYS)
}

async function computeLicenseStatus(event?: H3Event): Promise<LicenseStatus> {
  const fromEnv = licenseKeyFromEnv(event)
  const token = fromEnv || await readStoredLicense()
  const { referenceMs, systemMs } = await readReferenceTime()
  const clock = { referenceAt: new Date(referenceMs).toISOString(), clockBehindMs: licenseClockBehindMs(systemMs, referenceMs) }
  if (!token) return { state: 'none', source: null, reason: null, license: null, features: [], ...clock }

  const source: LicenseSource = fromEnv ? 'env' : 'database'
  const result = verify(token)
  if (!result.ok) return { state: 'invalid', source, reason: result.reason, license: null, features: [], ...clock }
  const state = licenseTermState(licensePeriod(result.payload), referenceMs)
  return {
    state,
    source,
    reason: null,
    license: licenseDetails(result.payload),
    features: licenseFeaturesActive(state) ? result.payload.features : [],
    ...clock,
  }
}

let cached: { at: number, status: Promise<LicenseStatus> } | undefined

/** État de la licence (cache de 5 minutes par processus ; `fresh` pour le recalculer). */
export function licenseStatus(event?: H3Event, options: { fresh?: boolean } = {}): Promise<LicenseStatus> {
  if (options.fresh || !cached || Date.now() - cached.at > STATUS_CACHE_MS) {
    const status = computeLicenseStatus(event)
    cached = { at: Date.now(), status }
    // Échec (base indisponible) : ne pas garder la promesse rejetée, le prochain appel réessaie.
    status.catch(() => {
      if (cached?.status === status) cached = undefined
    })
  }
  return cached.status
}

/** La licence en vigueur active-t-elle cette fonction payante ? */
export async function licenseAllows(event: H3Event, feature: LicenseFeature): Promise<boolean> {
  return (await licenseStatus(event)).features.includes(feature)
}

/** Refuse une fonction payante sans licence active qui la couvre : 403 LICENSE_REQUIRED. */
export async function requireLicenseFeature(event: H3Event, feature: LicenseFeature): Promise<void> {
  if (!await licenseAllows(event, feature)) throw licenseError(403, 'LICENSE_REQUIRED', { feature })
}

// ─── Installation ─────────────────────────────────────────────────────────────

/** Vérifie puis enregistre une licence collée ; 422 LICENSE_INVALID (+ `reason`) si elle est refusée. */
export async function installLicense(event: H3Event, token: string): Promise<LicensePayload> {
  const result = verify(token)
  if (!result.ok) throw licenseError(422, 'LICENSE_INVALID', { reason: result.reason })
  const prisma = await usePrisma()
  const value = token.replace(/\s+/g, '')
  await prisma.setting.upsert({ where: { key: LICENSE_SETTING_KEY }, create: { key: LICENSE_SETTING_KEY, value }, update: { value } })
  await licenseStatus(event, { fresh: true })
  return result.payload
}

/** Retire la licence installée ; rend son contenu s'il était lisible (pour le journal d'audit), null si aucune. */
export async function removeLicense(event: H3Event): Promise<{ payload: LicensePayload | null } | null> {
  const token = await readStoredLicense()
  if (!token) return null
  const prisma = await usePrisma()
  await prisma.setting.deleteMany({ where: { key: LICENSE_SETTING_KEY } })
  await licenseStatus(event, { fresh: true })
  const result = verify(token)
  return { payload: result.ok ? result.payload : null }
}

// ─── Identifiant d'instance ───────────────────────────────────────────────────

/**
 * Identifiant aléatoire de cette installation, créé à la première lecture et jamais modifié : affiché dans
 * Réglages › Licence (support, déclaration des instances de production), jamais transmis par le produit
 * (l'administrateur peut le joindre à l'e-mail d'enregistrement facultatif).
 */
export async function readInstanceId(): Promise<string> {
  const prisma = await usePrisma()
  const existing = await prisma.setting.findUnique({ where: { key: INSTANCE_SETTING_KEY } })
  if (existing) return String(existing.value)
  try {
    return String((await prisma.setting.create({ data: { key: INSTANCE_SETTING_KEY, value: randomUUID() } })).value)
  }
  catch (error) {
    // Création simultanée par un autre processus : garder la sienne.
    if (!isUniqueViolation(error)) throw error
    return String((await prisma.setting.findUniqueOrThrow({ where: { key: INSTANCE_SETTING_KEY } })).value)
  }
}

// ─── Usage déclaré ────────────────────────────────────────────────────────────

/** Déclaration d'usage de l'instance (architecture : .claude/architecture-usage.md), avec son ancienneté. */
export async function readLicenseUsage(): Promise<(LicenseUsageDeclaration & { stale: boolean }) | null> {
  const prisma = await usePrisma()
  const declaration = parseLicenseUsage((await prisma.setting.findUnique({ where: { key: LICENSE_USAGE_SETTING_KEY } }))?.value)
  return declaration ? { ...declaration, stale: licenseUsageStale(declaration, Date.now()) } : null
}

/** Enregistre la déclaration (redéclarer la même valeur la confirme) ; rend la précédente pour le journal d'audit. */
export async function declareLicenseUsage(usage: LicenseUsage): Promise<{ previous: LicenseUsageDeclaration | null, current: LicenseUsageDeclaration }> {
  const prisma = await usePrisma()
  const previous = parseLicenseUsage((await prisma.setting.findUnique({ where: { key: LICENSE_USAGE_SETTING_KEY } }))?.value)
  const current: LicenseUsageDeclaration = { usage, declaredAt: new Date().toISOString() }
  const value = { ...current }
  await prisma.setting.upsert({ where: { key: LICENSE_USAGE_SETTING_KEY }, create: { key: LICENSE_USAGE_SETTING_KEY, value }, update: { value } })
  return { previous, current }
}

/** Ce que les routes de Réglages › Licence ajoutent à l'état : identifiant d'instance, version, usage déclaré. */
export async function licenseExtras() {
  return { instanceId: await readInstanceId(), version: SURGE_MEDIA_VERSION, usage: await readLicenseUsage() }
}
