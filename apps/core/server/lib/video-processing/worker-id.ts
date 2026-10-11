import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { JOB_TEXT_MAX, WORKER_PRESENCE_PREFIX } from '#shared/utils/video-processing'

/**
 * Identifiant d'un processus qui exécute des tâches vidéo (phase D3, § 31.2) : `<hôte>:<pid>:<aléa>`.
 *   - l'hôte et le pid servent au diagnostic (« Réglages », journal : qui tenait la tâche) ;
 *   - l'aléa est indispensable : en développement, Nitro tourne dans un fil de travail rechargé à
 *     chaque modification, avec le pid du processus `nuxi` ; deux processus de deux conteneurs peuvent
 *     aussi avoir le même nom d'hôte et le même pid (1). Sans lui, une instance rechargée prendrait pour
 *     siennes les tâches de la précédente.
 * Il sert de `MediaJob.lockedBy` et de clé de présence (`Setting` `videoWorker:<id>`), toutes deux de
 * 191 caractères au plus (MySQL : VARCHAR(191)) : l'hôte est tronqué pour que la clé de présence tienne.
 */

/** Longueur maximale de l'identifiant : la clé de présence (préfixe compris) tient dans 191 caractères. */
export const WORKER_ID_MAX = JOB_TEXT_MAX - WORKER_PRESENCE_PREFIX.length

/** Identifiant d'après l'hôte, le pid et un aléa (pur : les trois sont des paramètres, testé). */
export function workerIdentity(host: string, pid: number, random: string): string {
  const suffix = `:${pid}:${random}`
  // `:` sépare les parties ; caractères de contrôle et espaces retirés (journal, clé de base).
  // eslint-disable-next-line no-control-regex
  const cleanHost = host.replace(/[\u0000- \u007F:]/g, '') || 'host'
  return `${cleanHost.slice(0, Math.max(1, WORKER_ID_MAX - suffix.length))}${suffix}`.slice(0, WORKER_ID_MAX)
}

let current: string | undefined

/** Identifiant de ce processus (ou de ce fil de travail Nitro), tiré une fois. */
export function useWorkerId(): string {
  current ??= workerIdentity(hostname(), process.pid, randomBytes(4).toString('hex'))
  return current
}

/** Hôte et pid d'un identifiant (null s'il n'a pas la forme `<hôte>:<pid>:<aléa>`). */
export function parseWorkerId(id: string): { host: string, pid: number } | null {
  const match = /^(.+):(\d{1,10}):[\da-f]+$/.exec(id)
  if (!match) return null
  const pid = Number(match[2])
  return Number.isSafeInteger(pid) && pid > 0 ? { host: match[1]!, pid } : null
}
