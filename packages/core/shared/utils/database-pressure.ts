/**
 * Pression sur une base SQLite : règles pures (testées) de l'alerte du tableau de bord (2026-10-10).
 *
 * Avec SQLite (better-sqlite3), chaque accès à la base s'exécute de façon **synchrone** dans le processus :
 * pendant une requête SQL — et pendant l'attente du verrou d'écriture tenu par un autre processus (jusqu'à
 * 10 s) — le serveur ne fait rien d'autre, pas même servir un fichier. Mesuré au test de charge : un aperçu
 * sans accès à la base attend 12 s quand un autre processus tient le verrou ; 400 écritures/s divisent par
 * 16 le débit des aperçus du même processus, par 32 avec un second processus qui écrit dans la même base.
 *
 * Chaque processus compte, par minute : requêtes HTTP, opérations sur la base, écritures, temps passé dans la
 * base (= temps bloqué), opérations lentes et attentes de verrou dépassées. `evaluateDatabasePressure`
 * en déduit un niveau sur la fenêtre des dernières minutes :
 *   - `warning` : symptômes d'une base saturée ou disputée (échecs d'attente du verrou, opérations lentes,
 *     processus occupé surtout par la base plusieurs minutes) ;
 *   - `info` : trafic élevé pour SQLite (requêtes ou écritures par seconde, part notable du temps dans la
 *     base) — prévoir PostgreSQL ou MySQL avant d'en arriver aux symptômes.
 * Seuils prudents, choisis d'après les mesures d'un portable récent (≈ 1 600 requêtes/s mixtes, ≈ 600
 * écritures/s au plus par processus) : un petit serveur sature plus tôt.
 */

/** Durée d'une tranche de comptage (ms). */
export const PRESSURE_MINUTE_MS = 60_000
/** Tranches examinées (minutes). */
export const PRESSURE_WINDOW_MINUTES = 15
/** Opération lente (ms) : attente du verrou d'un autre processus, ou requête coûteuse. */
export const PRESSURE_SLOW_OPERATION_MS = 500
/** Opérations lentes dans la fenêtre au-delà desquelles l'alerte devient `warning`. */
export const PRESSURE_SLOW_OPERATIONS = 5
/** Part du temps d'une minute passée dans la base au-delà de laquelle la minute est « chargée ». */
export const PRESSURE_LOADED_SHARE = 0.5
/** Minutes chargées dans la fenêtre au-delà desquelles l'alerte devient `warning`. */
export const PRESSURE_LOADED_MINUTES = 3
/** Trafic élevé (`info`) : requêtes par seconde (moyenne d'une minute). */
export const PRESSURE_HIGH_REQUESTS = 300
/** Trafic élevé (`info`) : écritures par seconde (moyenne d'une minute). */
export const PRESSURE_HIGH_WRITES = 30
/** Trafic élevé (`info`) : part du temps passée dans la base pendant une minute. */
export const PRESSURE_NOTABLE_SHARE = 0.25
/** Écriture du constat en base au plus toutes les… (ms), sauf aggravation. */
export const PRESSURE_REPORT_INTERVAL_MS = 5 * 60_000
/** Durée d'affichage d'un constat au tableau de bord (ms). */
export const PRESSURE_DISPLAY_MS = 24 * 3_600_000
/** Clé du constat dans la table `Setting` (partagé par le serveur web et les processus de travail). */
export const PRESSURE_SETTING_KEY = 'databasePressure'

/** Compteurs d'une minute d'un processus. */
export interface PressureMinute {
  /** Début de la minute (ms depuis l'époque, multiple de PRESSURE_MINUTE_MS). */
  start: number
  requests: number
  operations: number
  writes: number
  /** Temps passé dans la base (ms) : avec SQLite, temps pendant lequel le processus est bloqué. */
  databaseMs: number
  /** Opérations d'au moins PRESSURE_SLOW_OPERATION_MS. */
  slow: number
  /** Attentes de verrou ou de transaction dépassées (requête en échec). */
  busy: number
}

export type PressureLevel = 'warning' | 'info'

/** Constat sur la fenêtre examinée. */
export interface DatabasePressure {
  level: PressureLevel
  /** Attentes de verrou ou de transaction dépassées. */
  busy: number
  /** Opérations lentes. */
  slow: number
  /** Minutes où la base a occupé au moins PRESSURE_LOADED_SHARE du temps. */
  loadedMinutes: number
  /** Pointes (moyennes d'une minute) : requêtes et écritures par seconde, part du temps dans la base (0 à 1). */
  peakRequests: number
  peakWrites: number
  peakShare: number
}

/** Constat enregistré (table `Setting`) et affiché au tableau de bord. */
export interface DatabasePressureReport extends DatabasePressure {
  /** Dernière observation (ISO). */
  at: string
}

export function emptyPressureMinute(start: number): PressureMinute {
  return { start, requests: 0, operations: 0, writes: 0, databaseMs: 0, slow: 0, busy: 0 }
}

/** Début de la minute contenant `time`. */
export function pressureMinuteStart(time: number): number {
  return Math.floor(time / PRESSURE_MINUTE_MS) * PRESSURE_MINUTE_MS
}

/**
 * Niveau de pression d'après les minutes de la fenêtre (minute en cours comprise : ses taux sont rapportés
 * à sa durée écoulée, au moins 10 s pour ne pas grossir ses premières secondes). Null : rien à signaler.
 */
export function evaluateDatabasePressure(minutes: readonly PressureMinute[], now: number): DatabasePressure | null {
  const since = pressureMinuteStart(now) - (PRESSURE_WINDOW_MINUTES - 1) * PRESSURE_MINUTE_MS
  let busy = 0
  let slow = 0
  let loadedMinutes = 0
  let peakRequests = 0
  let peakWrites = 0
  let peakShare = 0
  for (const minute of minutes) {
    if (minute.start < since || minute.start > now) continue
    const elapsedMs = Math.max(10_000, Math.min(PRESSURE_MINUTE_MS, now - minute.start))
    const share = Math.min(1, minute.databaseMs / elapsedMs)
    busy += minute.busy
    slow += minute.slow
    if (share >= PRESSURE_LOADED_SHARE) loadedMinutes++
    peakRequests = Math.max(peakRequests, minute.requests / (elapsedMs / 1000))
    peakWrites = Math.max(peakWrites, minute.writes / (elapsedMs / 1000))
    peakShare = Math.max(peakShare, share)
  }
  const warning = busy > 0 || slow >= PRESSURE_SLOW_OPERATIONS || loadedMinutes >= PRESSURE_LOADED_MINUTES
  const info = peakRequests >= PRESSURE_HIGH_REQUESTS || peakWrites >= PRESSURE_HIGH_WRITES || peakShare >= PRESSURE_NOTABLE_SHARE
  if (!warning && !info) return null
  return {
    level: warning ? 'warning' : 'info',
    busy,
    slow,
    loadedMinutes,
    peakRequests: Math.round(peakRequests),
    peakWrites: Math.round(peakWrites),
    peakShare: Math.round(peakShare * 100) / 100,
  }
}

/** Le niveau `next` aggrave-t-il `previous` (constat à enregistrer aussitôt) ? */
export function pressureWorsened(previous: PressureLevel | null, next: PressureLevel): boolean {
  return previous === null || (previous === 'info' && next === 'warning')
}

/** Constat lu en base, encore affichable (moins de PRESSURE_DISPLAY_MS), ou null. */
export function readPressureReport(value: unknown, now: number): DatabasePressureReport | null {
  if (!value || typeof value !== 'object') return null
  const report = value as Partial<Record<keyof DatabasePressureReport, unknown>>
  const at = typeof report.at === 'string' ? Date.parse(report.at) : Number.NaN
  if (!Number.isFinite(at) || now - at > PRESSURE_DISPLAY_MS || at - now > PRESSURE_MINUTE_MS) return null
  if (report.level !== 'warning' && report.level !== 'info') return null
  const count = (input: unknown) => (typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : 0)
  return {
    level: report.level,
    at: new Date(at).toISOString(),
    busy: count(report.busy),
    slow: count(report.slow),
    loadedMinutes: count(report.loadedMinutes),
    peakRequests: count(report.peakRequests),
    peakWrites: count(report.peakWrites),
    peakShare: Math.min(1, count(report.peakShare)),
  }
}

/** Codes Prisma d'une attente dépassée : opération (P1008), pool (P2024), transaction (P2028), conflit (P2034). */
const BUSY_CODES = new Set(['P1008', 'P2024', 'P2028', 'P2034'])
const BUSY_MESSAGE = /SQLITE_BUSY|database (?:table )?is locked|Operation has timed out|Unable to start a transaction|Transaction already closed/i

/** Erreur due à une attente de verrou ou de transaction dépassée (base disputée), d'après son code ou son message. */
export function isDatabaseBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown, message?: unknown }
  if (typeof code === 'string' && BUSY_CODES.has(code)) return true
  return typeof message === 'string' && BUSY_MESSAGE.test(message)
}

const WRITE_OPERATIONS = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn',
  'upsert', 'delete', 'deleteMany', '$executeRaw', '$executeRawUnsafe',
])

/** Opération Prisma qui écrit (nom donné par une extension `$allOperations`). */
export function isWriteOperation(operation: string): boolean {
  return WRITE_OPERATIONS.has(operation)
}
