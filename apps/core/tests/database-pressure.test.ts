import { describe, expect, it } from 'vitest'
import { createPressureMonitor } from '../server/lib/database/pressure'
import {
  emptyPressureMinute,
  evaluateDatabasePressure,
  isDatabaseBusyError,
  isWriteOperation,
  PRESSURE_DISPLAY_MS,
  PRESSURE_MINUTE_MS,
  PRESSURE_WINDOW_MINUTES,
  pressureMinuteStart,
  pressureWorsened,
  readPressureReport,
  type PressureMinute,
} from '../shared/utils/database-pressure'

const NOW = Date.parse('2026-10-10T12:30:30Z')
const CURRENT = pressureMinuteStart(NOW)
/** Minute `ago` minutes avant la minute en cours, compteurs donnés. */
const minute = (ago: number, values: Partial<PressureMinute> = {}): PressureMinute =>
  ({ ...emptyPressureMinute(CURRENT - ago * PRESSURE_MINUTE_MS), ...values })

describe('evaluateDatabasePressure', () => {
  it('trafic modéré : rien à signaler', () => {
    expect(evaluateDatabasePressure([], NOW)).toBeNull()
    expect(evaluateDatabasePressure([minute(1, { requests: 6000, writes: 600, databaseMs: 6000 })], NOW)).toBeNull()
  })

  it('une attente de verrou dépassée suffit pour un warning', () => {
    expect(evaluateDatabasePressure([minute(3, { busy: 1, slow: 1, databaseMs: 11_000 })], NOW))
      .toMatchObject({ level: 'warning', busy: 1, slow: 1 })
  })

  it('opérations lentes : warning à partir de 5 dans la fenêtre', () => {
    expect(evaluateDatabasePressure([minute(2, { slow: 2 }), minute(5, { slow: 2 })], NOW)).toBeNull()
    expect(evaluateDatabasePressure([minute(2, { slow: 2 }), minute(5, { slow: 3 })], NOW)).toMatchObject({ level: 'warning', slow: 5 })
  })

  it('base occupant au moins la moitié du temps pendant 3 minutes : warning ; une ou deux : info', () => {
    const loaded = (ago: number) => minute(ago, { databaseMs: 0.6 * PRESSURE_MINUTE_MS })
    expect(evaluateDatabasePressure([loaded(1), loaded(2)], NOW)).toMatchObject({ level: 'info', loadedMinutes: 2, peakShare: 0.6 })
    expect(evaluateDatabasePressure([loaded(1), loaded(2), loaded(4)], NOW)).toMatchObject({ level: 'warning', loadedMinutes: 3 })
  })

  it('trafic élevé : info (requêtes, écritures ou part du temps dans la base)', () => {
    expect(evaluateDatabasePressure([minute(1, { requests: 300 * 60 })], NOW)).toMatchObject({ level: 'info', peakRequests: 300 })
    expect(evaluateDatabasePressure([minute(1, { writes: 30 * 60 })], NOW)).toMatchObject({ level: 'info', peakWrites: 30 })
    expect(evaluateDatabasePressure([minute(1, { databaseMs: 0.25 * PRESSURE_MINUTE_MS })], NOW)).toMatchObject({ level: 'info', peakShare: 0.25 })
    expect(evaluateDatabasePressure([minute(1, { requests: 299 * 60, writes: 29 * 60, databaseMs: 0.24 * PRESSURE_MINUTE_MS })], NOW)).toBeNull()
  })

  it('minute en cours rapportée à sa durée écoulée (au moins 10 s)', () => {
    // 30 s écoulées : 9 000 requêtes = 300 par seconde.
    expect(evaluateDatabasePressure([minute(0, { requests: 9000 })], NOW)).toMatchObject({ level: 'info', peakRequests: 300 })
    // Premières secondes d'une minute : comptées sur 10 s au moins (pas de pointe artificielle).
    const early = CURRENT + 2000
    expect(evaluateDatabasePressure([{ ...emptyPressureMinute(CURRENT), requests: 2000 }], early)).toBeNull()
  })

  it('ignore les minutes hors de la fenêtre', () => {
    expect(evaluateDatabasePressure([minute(PRESSURE_WINDOW_MINUTES, { busy: 3 })], NOW)).toBeNull()
    expect(evaluateDatabasePressure([minute(PRESSURE_WINDOW_MINUTES - 1, { busy: 3 })], NOW)).toMatchObject({ level: 'warning' })
  })
})

describe('pressureWorsened', () => {
  it('premier constat ou passage de info à warning', () => {
    expect(pressureWorsened(null, 'info')).toBe(true)
    expect(pressureWorsened('info', 'warning')).toBe(true)
    expect(pressureWorsened('info', 'info')).toBe(false)
    expect(pressureWorsened('warning', 'info')).toBe(false)
    expect(pressureWorsened('warning', 'warning')).toBe(false)
  })
})

describe('readPressureReport', () => {
  const report = { level: 'warning', at: new Date(NOW - 3_600_000).toISOString(), busy: 2, slow: 7, loadedMinutes: 1, peakRequests: 420, peakWrites: 35, peakShare: 0.7 }

  it('rend un constat récent et valide', () => {
    expect(readPressureReport(report, NOW)).toEqual(report)
  })

  it('ignore un constat de plus de 24 h, futur, mal formé ou absent', () => {
    expect(readPressureReport({ ...report, at: new Date(NOW - PRESSURE_DISPLAY_MS - 1).toISOString() }, NOW)).toBeNull()
    expect(readPressureReport({ ...report, at: new Date(NOW + 3_600_000).toISOString() }, NOW)).toBeNull()
    expect(readPressureReport({ ...report, level: 'critical' }, NOW)).toBeNull()
    expect(readPressureReport({ ...report, at: 'hier' }, NOW)).toBeNull()
    expect(readPressureReport(null, NOW)).toBeNull()
    expect(readPressureReport('warning', NOW)).toBeNull()
  })

  it('remplace les compteurs invalides par 0 et borne la part du temps', () => {
    expect(readPressureReport({ ...report, busy: -1, slow: 'x', peakShare: 3 }, NOW)).toMatchObject({ busy: 0, slow: 0, peakShare: 1 })
  })
})

describe('isDatabaseBusyError', () => {
  it('reconnaît les attentes dépassées par leur code Prisma ou leur message', () => {
    // Constaté le 2026-10-10 : verrou tenu par un autre processus au-delà de 10 s.
    expect(isDatabaseBusyError({ code: 'P1008', message: 'Invalid `prisma.media.update()` invocation: Operation has timed out' })).toBe(true)
    expect(isDatabaseBusyError({ code: 'P2028', message: 'Transaction API error: Unable to start a transaction in the given time.' })).toBe(true)
    expect(isDatabaseBusyError({ code: 'P2034' })).toBe(true)
    expect(isDatabaseBusyError(new Error('SqliteError: database is locked'))).toBe(true)
    expect(isDatabaseBusyError(new Error('SQLITE_BUSY: database is busy'))).toBe(true)
  })

  it('ignore les autres erreurs', () => {
    expect(isDatabaseBusyError({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false)
    expect(isDatabaseBusyError(new Error('Record not found'))).toBe(false)
    expect(isDatabaseBusyError(null)).toBe(false)
    expect(isDatabaseBusyError('database is locked')).toBe(false)
  })
})

describe('isWriteOperation', () => {
  it('écritures de Prisma (modèles et SQL brut)', () => {
    for (const operation of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', '$executeRaw', '$executeRawUnsafe']) {
      expect(isWriteOperation(operation)).toBe(true)
    }
    for (const operation of ['findUnique', 'findMany', 'count', 'aggregate', 'groupBy', '$queryRaw', '$queryRawUnsafe']) {
      expect(isWriteOperation(operation)).toBe(false)
    }
  })
})

describe('createPressureMonitor', () => {
  it('compte par minute et oublie les minutes hors de la fenêtre', () => {
    let time = NOW
    const monitor = createPressureMonitor(() => time)
    monitor.request()
    monitor.operation('findMany', 4)
    monitor.operation('update', 600)
    monitor.operation('update', 11_000, { code: 'P1008' })
    expect(monitor.minutes()).toEqual([{ start: CURRENT, requests: 1, operations: 3, writes: 2, databaseMs: 11_604, slow: 2, busy: 1 }])
    expect(monitor.evaluate()).toMatchObject({ level: 'warning', busy: 1, slow: 2 })

    time = NOW + (PRESSURE_WINDOW_MINUTES + 1) * PRESSURE_MINUTE_MS
    monitor.request()
    expect(monitor.minutes()).toHaveLength(1)
    expect(monitor.evaluate()).toBeNull()
  })

  it('une erreur ordinaire n\'est pas une attente de verrou', () => {
    const monitor = createPressureMonitor(() => NOW)
    monitor.operation('create', 3, { code: 'P2002' })
    expect(monitor.minutes()[0]).toMatchObject({ operations: 1, writes: 1, busy: 0 })
  })
})
