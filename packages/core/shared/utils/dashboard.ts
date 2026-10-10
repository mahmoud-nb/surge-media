import type { DatabasePressureReport } from './database-pressure'

/**
 * Tableau de bord : constantes et calculs purs (testés) partagés entre le serveur et l'interface.
 *
 * Envois par jour : le rendu serveur ignore le fuseau horaire du visiteur. Le serveur compte donc
 * les médias par heure UTC (UPLOAD_WINDOW_HOURS, liste creuse) et le navigateur regroupe ces heures
 * par jour local (dailyUploads). Les fuseaux décalés d'une demi-heure rattachent au plus 30 minutes
 * au jour voisin.
 */

/** Jours affichés par le graphique des envois. */
export const UPLOAD_CHART_DAYS = 30
/** Heures comptées par le serveur : 31 jours couvrent 30 jours locaux dans tout fuseau. */
export const UPLOAD_WINDOW_HOURS = (UPLOAD_CHART_DAYS + 1) * 24
/** Échéance proche d'un jeton ou d'une clé (jours). */
export const EXPIRING_SOON_DAYS = 7
/** Projets listés par le widget « Projets ». */
export const DASHBOARD_PROJECTS = 6
/** Entrées du journal du widget « Activité récente ». */
export const DASHBOARD_ACTIVITY = 8

const HOUR_MS = 3_600_000

/** Début de l'heure UTC contenant `date`. */
export function startOfUtcHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS)
}

/**
 * Comptes par heure depuis `since` (début d'une heure UTC) : liste creuse [rang de l'heure, nombre],
 * triée. Les dates hors de la fenêtre [since, since + hours[ sont ignorées.
 */
export function hourlyCounts(dates: readonly Date[], since: Date, hours = UPLOAD_WINDOW_HOURS): [number, number][] {
  const counts = new Map<number, number>()
  for (const date of dates) {
    const index = Math.floor((date.getTime() - since.getTime()) / HOUR_MS)
    if (index >= 0 && index < hours) counts.set(index, (counts.get(index) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => a[0] - b[0])
}

/** Jour calendaire (AAAA-MM-JJ) d'un instant dans un fuseau ; fuseau invalide → UTC. */
export function calendarDay(date: Date, timeZone: string): string {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' } as const
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone })
  }
  catch {
    format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' })
  }
  return format.format(date)
}

/**
 * Envois par jour local sur les `days` derniers jours (aujourd'hui compris), du plus ancien au plus
 * récent, à partir des comptes horaires du serveur.
 */
export function dailyUploads(
  since: Date,
  hours: readonly (readonly [number, number])[],
  timeZone: string,
  now = new Date(),
  days = UPLOAD_CHART_DAYS,
): { date: string, count: number }[] {
  // Jours calendaires (arithmétique sur des dates à midi UTC : indépendante des changements d'heure).
  const [year, month, day] = calendarDay(now, timeZone).split('-').map(Number) as [number, number, number]
  const keys = Array.from({ length: days }, (_, offset) =>
    new Date(Date.UTC(year, month - 1, day - (days - 1 - offset), 12)).toISOString().slice(0, 10))
  const totals = new Map(keys.map(key => [key, 0]))
  for (const [index, count] of hours) {
    const key = calendarDay(new Date(since.getTime() + index * HOUR_MS), timeZone)
    if (totals.has(key)) totals.set(key, totals.get(key)! + count)
  }
  return keys.map(date => ({ date, count: totals.get(date)! }))
}

/** Points d'attention du tableau de bord (assemblés par le serveur, selon les droits). */
export type DashboardAttention =
  | { kind: 'siteUrl' }
  | ({ kind: 'database' } & DatabasePressureReport)
  | { kind: 'mail' }
  | { kind: 'expiringTokens', items: { id: string, name: string, expiresAt: Date | string }[] }
  | { kind: 'expiringKeys', items: { id: string, name: string, type: string, environment: string | null, project: { id: string, name: string }, expiresAt: Date | string }[] }
  | { kind: 'invitations', pending: number, expired: number }
  | { kind: 'trash', total: number, spaces: ({ type: 'library', count: number } | { type: 'project', id: string, name: string, count: number })[] }

/** Gravité d'un point d'attention : `warning` demande d'agir, `info` renseigne. */
export function attentionSeverity(item: DashboardAttention): 'warning' | 'info' {
  if (item.kind === 'database') return item.level
  if (item.kind === 'invitations') return item.expired > 0 ? 'warning' : 'info'
  return item.kind === 'trash' || item.kind === 'mail' ? 'info' : 'warning'
}
