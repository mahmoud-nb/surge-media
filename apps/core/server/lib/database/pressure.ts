import { readDatabaseEnv } from '#shared/database'
import {
  emptyPressureMinute,
  evaluateDatabasePressure,
  isDatabaseBusyError,
  isWriteOperation,
  PRESSURE_MINUTE_MS,
  PRESSURE_REPORT_INTERVAL_MS,
  PRESSURE_SETTING_KEY,
  PRESSURE_SLOW_OPERATION_MS,
  PRESSURE_WINDOW_MINUTES,
  pressureMinuteStart,
  pressureWorsened,
  readPressureReport,
  type DatabasePressure,
  type DatabasePressureReport,
  type PressureLevel,
  type PressureMinute,
} from '#shared/utils/database-pressure'
import type { PrismaClient } from '../../generated/prisma/client'

/** Accès aux réglages (table `Setting`) : le client Prisma, passé par l'appelant (pas de cycle avec `usePrisma`). */
export type PressureStore = Pick<PrismaClient, 'setting'>

/**
 * Surveillance de la pression sur une base SQLite (règles : `shared/utils/database-pressure.ts`).
 *
 *   - compteurs du processus, par minute : requêtes HTTP (plugin `database-pressure.ts`), opérations de
 *     Prisma chronométrées par l'extension de `usePrisma()` (écritures, temps dans la base, opérations
 *     lentes, attentes dépassées) ;
 *   - toutes les minutes (plugin), le constat de la fenêtre est **enregistré dans `Setting`** : partagé par
 *     le serveur web et les processus de travail (`surge-media worker`), il survit à un redémarrage et
 *     s'affiche au tableau de bord pendant 24 h. Une écriture toutes les 5 minutes au plus, aussitôt en cas
 *     d'aggravation ; jamais un constat moins grave à la place d'un `warning` récent d'un autre processus ;
 *   - journal : un avertissement au passage en `warning`, au plus toutes les 15 minutes.
 * Rien n'est compté ni enregistré avec PostgreSQL ou MySQL (accès asynchrones, plusieurs connexions).
 */

/** Compteurs d'un processus (horloge injectable pour les tests). */
export function createPressureMonitor(now: () => number = Date.now) {
  const minutes = new Map<number, PressureMinute>()

  function current(): PressureMinute {
    const start = pressureMinuteStart(now())
    let minute = minutes.get(start)
    if (!minute) {
      minute = emptyPressureMinute(start)
      minutes.set(start, minute)
      const oldest = start - PRESSURE_WINDOW_MINUTES * PRESSURE_MINUTE_MS
      for (const key of minutes.keys()) {
        if (key < oldest) minutes.delete(key)
      }
    }
    return minute
  }

  return {
    /** Une requête HTTP reçue. */
    request(): void {
      current().requests++
    },
    /** Une opération de Prisma terminée (`error` si elle a échoué). */
    operation(operation: string, durationMs: number, error?: unknown): void {
      const minute = current()
      minute.operations++
      if (isWriteOperation(operation)) minute.writes++
      minute.databaseMs += durationMs
      if (durationMs >= PRESSURE_SLOW_OPERATION_MS) minute.slow++
      if (error !== undefined && isDatabaseBusyError(error)) minute.busy++
    },
    evaluate(): DatabasePressure | null {
      return evaluateDatabasePressure([...minutes.values()], now())
    },
    minutes(): PressureMinute[] {
      return [...minutes.values()]
    },
  }
}

export type PressureMonitor = ReturnType<typeof createPressureMonitor>

let monitor: PressureMonitor | null | undefined

/** Compteurs de ce processus ; null hors SQLite. */
export function useDatabasePressureMonitor(): PressureMonitor | null {
  if (monitor === undefined) monitor = readDatabaseEnv().provider === 'sqlite' ? createPressureMonitor() : null
  return monitor
}

const LOG_INTERVAL_MS = 15 * 60_000
let lastReport: { level: PressureLevel, at: number } | null = null
let lastLog = 0

/** Constat le plus grave, puis le plus récent. */
function morePressing(a: DatabasePressureReport | null, b: DatabasePressureReport | null): DatabasePressureReport | null {
  if (!a || !b) return a ?? b
  if (a.level !== b.level) return a.level === 'warning' ? a : b
  return a.at >= b.at ? a : b
}

/**
 * Évalue la fenêtre de ce processus et enregistre le constat s'il y a lieu (appelé chaque minute par le
 * plugin). Jamais d'exception : la surveillance ne doit pas aggraver ce qu'elle observe.
 */
export async function reportDatabasePressure(store: PressureStore, now = Date.now()): Promise<void> {
  const pressure = useDatabasePressureMonitor()?.evaluate()
  if (!pressure) return
  const due = !lastReport || pressureWorsened(lastReport.level, pressure.level) || now - lastReport.at >= PRESSURE_REPORT_INTERVAL_MS
  if (!due) return
  if (pressure.level === 'warning' && now - lastLog >= LOG_INTERVAL_MS) {
    lastLog = now
    console.warn(`[surge-media] Base SQLite sous pression (15 dernières minutes) : ${pressure.busy} attente(s) de verrou dépassée(s), `
      + `${pressure.slow} opération(s) de plus de ${PRESSURE_SLOW_OPERATION_MS} ms, ${pressure.loadedMinutes} minute(s) passée(s) surtout dans la base `
      + `(pointes : ${pressure.peakRequests} requêtes/s, ${pressure.peakWrites} écritures/s). Pour un trafic soutenu ou plusieurs processus, `
      + 'passez à PostgreSQL ou MySQL.')
  }
  try {
    const report: DatabasePressureReport = { ...pressure, at: new Date(now).toISOString() }
    const existing = readPressureReport((await store.setting.findUnique({ where: { key: PRESSURE_SETTING_KEY } }))?.value, now)
    // Un `warning` récent d'un autre processus n'est pas remplacé par un constat moins grave.
    if (existing?.level === 'warning' && report.level === 'info' && now - Date.parse(existing.at) < PRESSURE_REPORT_INTERVAL_MS) return
    const value = { ...report }
    await store.setting.upsert({ where: { key: PRESSURE_SETTING_KEY }, create: { key: PRESSURE_SETTING_KEY, value }, update: { value } })
    lastReport = { level: pressure.level, at: now }
  }
  catch {
    // Base indisponible ou verrouillée : nouvel essai à la prochaine minute.
  }
}

/**
 * Constat affiché au tableau de bord (ADMIN) : enregistré par n'importe quel processus dans les dernières
 * 24 h, ou évaluation en cours de ce processus si elle est plus grave (pas encore enregistrée). Null hors
 * SQLite ou sans rien à signaler.
 */
export async function readDatabasePressure(store: PressureStore, now = Date.now()): Promise<DatabasePressureReport | null> {
  const current = useDatabasePressureMonitor()
  if (!current) return null
  const stored = readPressureReport((await store.setting.findUnique({ where: { key: PRESSURE_SETTING_KEY } }))?.value, now)
  const live = current.evaluate()
  return morePressing(stored, live ? { ...live, at: new Date(now).toISOString() } : null)
}
