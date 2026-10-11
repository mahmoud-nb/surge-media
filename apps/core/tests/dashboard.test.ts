import { describe, expect, it } from 'vitest'
import {
  attentionSeverity,
  calendarDay,
  dailyUploads,
  hourlyCounts,
  startOfUtcHour,
  UPLOAD_CHART_DAYS,
  UPLOAD_WINDOW_HOURS,
} from '../shared/utils/dashboard'

const now = new Date('2026-10-04T15:42:10Z')
const since = new Date(startOfUtcHour(now).getTime() - (UPLOAD_WINDOW_HOURS - 1) * 3_600_000)

describe('envois par heure (serveur)', () => {
  it('cale la fenêtre sur des heures UTC entières', () => {
    expect(startOfUtcHour(now).toISOString()).toBe('2026-10-04T15:00:00.000Z')
    expect(since.toISOString()).toBe('2026-09-03T16:00:00.000Z')
  })

  it('compte par heure, en liste creuse triée, sans les dates hors fenêtre', () => {
    const dates = [
      new Date('2026-10-04T15:10:00Z'),
      new Date('2026-10-04T15:59:59Z'),
      new Date('2026-09-03T16:00:00Z'),
      new Date('2026-09-03T15:59:59Z'), // avant la fenêtre
      new Date('2026-10-04T16:00:00Z'), // après
    ]
    expect(hourlyCounts(dates, since)).toEqual([[0, 1], [UPLOAD_WINDOW_HOURS - 1, 2]])
  })
})

describe('envois par jour local (navigateur)', () => {
  it('30 jours du plus ancien à aujourd\'hui, dans le fuseau du visiteur', () => {
    const hours = hourlyCounts([new Date('2026-10-03T22:30:00Z'), new Date('2026-10-03T21:30:00Z')], since)
    const paris = dailyUploads(since, hours, 'Europe/Paris', now)
    expect(paris).toHaveLength(UPLOAD_CHART_DAYS)
    expect(paris.at(-1)).toEqual({ date: '2026-10-04', count: 1 }) // 00:30 à Paris
    expect(paris.at(-2)).toEqual({ date: '2026-10-03', count: 1 }) // 23:30 à Paris
    expect(paris[0]!.date).toBe('2026-09-05')
    const utc = dailyUploads(since, hours, 'UTC', now)
    expect(utc.at(-2)).toEqual({ date: '2026-10-03', count: 2 })
    expect(utc.at(-1)).toEqual({ date: '2026-10-04', count: 0 })
  })

  it('jours consécutifs et uniques malgré un changement d\'heure', () => {
    const springNow = new Date('2026-04-05T10:00:00Z')
    const springSince = new Date(startOfUtcHour(springNow).getTime() - (UPLOAD_WINDOW_HOURS - 1) * 3_600_000)
    const days = dailyUploads(springSince, [], 'Europe/Paris', springNow).map(day => day.date)
    expect(new Set(days).size).toBe(UPLOAD_CHART_DAYS)
    expect(days).toContain('2026-03-29') // passage à l'heure d'été
    expect(days.at(-1)).toBe('2026-04-05')
  })

  it('fuseau invalide : UTC', () => {
    expect(calendarDay(new Date('2026-10-03T23:30:00Z'), 'Pas/Un_Fuseau')).toBe('2026-10-03')
    expect(calendarDay(new Date('2026-10-03T23:30:00Z'), 'Asia/Tokyo')).toBe('2026-10-04')
  })
})

describe('points d\'attention', () => {
  it('distingue ce qui demande d\'agir de ce qui renseigne', () => {
    expect(attentionSeverity({ kind: 'expiringTokens', items: [] })).toBe('warning')
    expect(attentionSeverity({ kind: 'siteUrl' })).toBe('warning')
    expect(attentionSeverity({ kind: 'invitations', pending: 2, expired: 0 })).toBe('info')
    expect(attentionSeverity({ kind: 'invitations', pending: 2, expired: 1 })).toBe('warning')
    expect(attentionSeverity({ kind: 'trash', total: 3, spaces: [] })).toBe('info')
    expect(attentionSeverity({ kind: 'mail' })).toBe('info')
    const pressure = { at: now.toISOString(), busy: 0, slow: 0, loadedMinutes: 0, peakRequests: 400, peakWrites: 0, peakShare: 0.1 }
    expect(attentionSeverity({ kind: 'database', level: 'info', ...pressure })).toBe('info')
    expect(attentionSeverity({ kind: 'database', level: 'warning', ...pressure, busy: 2 })).toBe('warning')
  })
})
