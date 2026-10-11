import {
  type JobStep,
  JOB_LEASE_MS,
  JOB_STEPS,
  MEDIA_JOB_STATUSES,
  type MediaJobStatusValue,
  type ProcessingStateValue,
  type RenditionName,
  RENDITION_NAMES,
  retryDelay,
  truncateText,
  VIDEO_JOB_ERROR_CODES,
  type VideoJobErrorCode,
  type VideoJobWarning,
  VIDEO_JOB_WARNINGS,
  WORKER_PRESENCE_PREFIX,
  WORKER_SEEN_WINDOW_MS,
} from '#shared/utils/video-processing'
import type { Media, MediaJob, Prisma, Setting } from '../../generated/prisma/client'

/**
 * File persistante des traitements vidéo (phase D3, architecture § 31, DD27) : une ligne `MediaJob` par
 * fichier à traiter, prise par un processus à la fois (bail renouvelé), reprise après un arrêt, essais
 * limités. Portable sur SQLite, PostgreSQL et MySQL, sans `SKIP LOCKED` :
 *   - **prise atomique** : lecture des prochaines tâches, puis `updateMany({ id, status: 'QUEUED' })` ;
 *     compte 0 = un autre processus l'a prise, on passe à la suivante ;
 *   - **chaque écriture d'une tâche en cours est conditionnée au bail** (`id`, `lockedBy`, `RUNNING`) :
 *     compte 0 = tâche annulée (remplacement, corbeille, relance) ou reprise par un autre après expiration
 *     du bail → le calcul est abandonné, rien n'est écrit ;
 *   - **transactions courtes, une écriture en premier** : sous SQLite (WAL) partagé par le serveur web et
 *     un processus de travail, une transaction qui lit puis écrit peut échouer aussitôt (SQLITE_BUSY sans
 *     attente) si l'autre processus a écrit entre-temps ; une transaction qui commence par écrire prend le
 *     verrou d'emblée et attend le délai configuré (server/utils/prisma.ts). Et **aucune exception
 *     volontaire après une écriture** : les contrôles sortent en renvoyant une valeur. L'adaptateur
 *     better-sqlite3 n'a qu'une connexion par processus : une requête concurrente du même processus peut
 *     s'exécuter dans la transaction ouverte, et une annulation l'emporterait avec elle.
 *
 * L'état résumé du média (`Media.processingState`) suit chaque transition dans la même transaction, par
 * `MediaStateWrite`, fourni par le service des médias (écriture conditionnée au fichier de la tâche ; le
 * service appelle ensuite `mediaChanged`). Le magasin est injecté (`JobStore`, sous-ensemble du client
 * Prisma) : la logique de prise, de bail et de reprise est testée sur un magasin en mémoire
 * (tests/video-queue.test.ts).
 */

// ─── Magasin ─────────────────────────────────────────────────────────────────

type Count = Promise<{ count: number }>

/** Opérations utilisées par la file (sous-ensemble du client Prisma, ou d'une transaction). */
export interface JobTx {
  mediaJob: {
    findMany: (args: { where?: Prisma.MediaJobWhereInput, orderBy?: Prisma.MediaJobOrderByWithRelationInput[], take?: number }) => Promise<MediaJob[]>
    create: (args: { data: Prisma.MediaJobUncheckedCreateInput }) => Promise<MediaJob>
    updateMany: (args: { where: Prisma.MediaJobWhereInput, data: Prisma.MediaJobUncheckedUpdateManyInput }) => Count
    count: (args: { where?: Prisma.MediaJobWhereInput }) => Promise<number>
  }
  media: {
    findMany: (args: { where?: Prisma.MediaWhereInput, orderBy?: Prisma.MediaOrderByWithRelationInput[], take?: number }) => Promise<Media[]>
    updateMany: (args: { where: Prisma.MediaWhereInput, data: Prisma.MediaUncheckedUpdateManyInput }) => Count
  }
  setting: {
    findMany: (args: { where?: Prisma.SettingWhereInput }) => Promise<Setting[]>
    upsert: (args: { where: Prisma.SettingWhereUniqueInput, create: Prisma.SettingUncheckedCreateInput, update: Prisma.SettingUncheckedUpdateInput }) => Promise<Setting>
    deleteMany: (args: { where?: Prisma.SettingWhereInput }) => Count
  }
}

/** Magasin de la file : opérations + transactions interactives (client Prisma). */
export interface JobStore extends JobTx {
  $transaction: <R>(fn: (tx: JobTx) => Promise<R>, options?: { maxWait?: number, timeout?: number }) => Promise<R>
}

/**
 * Options des transactions de la file : attente du verrou SQLite (10 s, server/utils/prisma.ts) comprise
 * dans le délai de la transaction (5 s par défaut chez Prisma) ; better-sqlite3 attend de façon synchrone.
 */
export const JOB_TRANSACTION = { maxWait: 10_000, timeout: 20_000 } as const

/** Cible d'une écriture d'état : le média, tant que son fichier est celui de la tâche. */
export interface JobTarget {
  mediaId: string
  sourceKey: string
}

/**
 * Écriture de l'état du média dans la transaction d'une transition (fournie par le service des médias) :
 * conditionnée au fichier de la tâche (`storageKey`) et hors corbeille ; false si rien n'a été écrit.
 */
export type MediaStateWrite = (tx: JobTx, target: JobTarget, state: ProcessingStateValue) => Promise<boolean>

// ─── Règles pures ────────────────────────────────────────────────────────────

/** Tâches actives (une seule par média en temps normal). */
export const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING'] as const satisfies readonly MediaJobStatusValue[]

/**
 * Priorité d'une vidéo dont la diffusion est retenue (piste de métadonnées à retirer, § 32.4) : devant
 * les envois récents (0) et les vidéos existantes (-10) ; le retrait des positions GPS ne doit pas
 * attendre derrière de longs encodages.
 */
export const HELD_PRIORITY = 10

/** Tâches lues à chaque recherche de la prochaine tâche à prendre. */
const CLAIM_BATCH = 5
/** Présence d'un processus de travail : effacée après un jour sans nouvelle. */
export const PRESENCE_RETENTION_MS = 24 * 3600_000
/** Baux échus et rattrapage : lots bornés. */
const REAP_BATCH = 50
const CATCH_UP_BATCH = 200
/** Détail enregistré quand le bail d'une tâche expire (processus arrêté net pendant le calcul). */
const LEASE_EXPIRED_DETAIL = 'Traitement interrompu : le processus qui l\'exécutait s\'est arrêté (bail expiré).'

/** Priorité d'une tâche : `base`, relevée à HELD_PRIORITY si la vidéo a une piste de métadonnées. */
export function jobPriority(metadata: unknown, base = 0): number {
  const tracks = (metadata as { dataTracks?: unknown } | null)?.dataTracks
  return Array.isArray(tracks) && tracks.length > 0 ? Math.max(base, HELD_PRIORITY) : base
}

/** Fin du bail pris ou renouvelé à `now`. */
export function leaseEnd(now: Date): Date {
  return new Date(now.getTime() + JOB_LEASE_MS)
}

/** Résultat d'une tâche (`MediaJob.result`) : étapes faites, avertissements, rendus déjà enregistrés. */
export interface JobResult {
  steps: JobStep[]
  warnings: VideoJobWarning[]
  /** Rendus enregistrés par cette tâche : une reprise après un arrêt ne les refait pas. */
  renditions: RenditionName[]
}

export function emptyJobResult(): JobResult {
  return { steps: [], warnings: [], renditions: [] }
}

/** Résultat lu en base (JSON quelconque), valeurs inconnues ignorées. */
export function parseJobResult(value: unknown): JobResult {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const pick = <T extends string>(field: unknown, allowed: readonly T[]): T[] =>
    Array.isArray(field) ? allowed.filter(item => field.includes(item)) : []
  return {
    steps: pick(raw.steps, JOB_STEPS),
    warnings: pick(raw.warnings, VIDEO_JOB_WARNINGS),
    renditions: pick(raw.renditions, RENDITION_NAMES),
  }
}

function resultJson(result: JobResult): Prisma.InputJsonValue {
  return { steps: [...result.steps], warnings: [...result.warnings], renditions: [...result.renditions] }
}

/** Tâche prise par un processus : identité, bail, résultat accumulé (repris d'un essai précédent). */
export interface JobLease {
  id: string
  mediaId: string
  sourceKey: string
  lockedBy: string
  attempts: number
  priority: number
  result: JobResult
}

/**
 * Tâche perdue pendant une écriture de résultat : annulée (remplacement, corbeille, relance), reprise par
 * un autre processus après expiration du bail, ou fichier du média changé. Le résultat est jeté (ses
 * fichiers supprimés) et rien d'autre n'est écrit : la tâche n'appartient plus à ce processus.
 */
export class JobLost extends Error {
  constructor(message = 'Tâche annulée ou reprise par un autre processus.') {
    super(message)
    this.name = 'JobLost'
  }
}

/** Échec d'un essai : code affiché, résumé (jamais de chemin du serveur), erreur passagère ou non. */
export interface JobFailure {
  code: VideoJobErrorCode
  detail: string
  /** Passagère (délai, processus tué, stockage) : nouvel essai différé tant qu'il en reste ; sinon échec définitif. */
  retryable: boolean
}

/**
 * Suite d'un échec (pure) : essais comptés, nouvel essai différé de `retryDelay(attempts)` pour une
 * erreur passagère tant que JOB_MAX_ATTEMPTS n'est pas atteint, sinon échec définitif (`retryAfterMs` null).
 */
export function failureDecision(attempts: number, failure: Pick<JobFailure, 'retryable'>): { attempts: number, retryAfterMs: number | null } {
  const next = attempts + 1
  return { attempts: next, retryAfterMs: failure.retryable ? retryDelay(next) : null }
}

function leaseWhere(lease: Pick<JobLease, 'id' | 'lockedBy'>): Prisma.MediaJobWhereInput {
  return { id: lease.id, lockedBy: lease.lockedBy, status: 'RUNNING' }
}

function targetOf(job: { mediaId: string, sourceKey: string }): JobTarget {
  return { mediaId: job.mediaId, sourceKey: job.sourceKey }
}

/** Champs remis à zéro quand une tâche quitte l'état RUNNING. */
const RELEASED = { lockedBy: null, leaseUntil: null, step: null, progress: null } as const

// ─── Création, annulation (dans les transactions du service) ────────────────

export interface NewJob {
  mediaId: string
  sourceKey: string
  priority: number
  /** Rendus déjà présents pour ce fichier (copie d'un média dupliqué) : la tâche ne les refait pas. */
  renditions?: RenditionName[]
}

/** Nouvelle tâche en file, prête aussitôt. */
export async function enqueueJob(tx: JobTx, job: NewJob, now: Date): Promise<MediaJob> {
  return tx.mediaJob.create({
    data: {
      mediaId: job.mediaId,
      sourceKey: job.sourceKey,
      priority: job.priority,
      runAfter: now,
      ...(job.renditions?.length ? { result: resultJson({ ...emptyJobResult(), renditions: job.renditions }) } : {}),
    },
  })
}

/**
 * Annule les tâches actives d'un média (fichier remplacé, corbeille, relance) : une tâche en cours le
 * voit à son prochain renouvellement de bail (30 s au plus) ou à sa prochaine écriture, et s'arrête.
 */
export async function cancelActiveJobs(tx: JobTx, mediaId: string, now: Date): Promise<number> {
  const { count } = await tx.mediaJob.updateMany({
    where: { mediaId, status: { in: [...ACTIVE_JOB_STATUSES] } },
    data: { status: 'CANCELLED', finishedAt: now, leaseUntil: null },
  })
  return count
}

// ─── Prise, bail ─────────────────────────────────────────────────────────────

/**
 * Prend la prochaine tâche prête (priorité, puis ancienneté) : prise conditionnelle au statut QUEUED,
 * puis média passé « en cours » dans la même transaction. Un média dont le fichier n'est plus celui de
 * la tâche, ou mis à la corbeille, rend la tâche caduque (annulée sans calcul). null : rien à faire.
 */
export async function claimNextJob(store: JobStore, workerId: string, now: Date, writeState: MediaStateWrite): Promise<JobLease | null> {
  const tried: string[] = []
  // Quelques lots au plus : un autre processus peut prendre les mêmes tâches au même moment.
  for (let round = 0; round < 3; round++) {
    const candidates = await store.mediaJob.findMany({
      where: { status: 'QUEUED', runAfter: { lte: now }, ...(tried.length > 0 ? { id: { notIn: tried } } : {}) },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: CLAIM_BATCH,
    })
    if (candidates.length === 0) return null
    for (const job of candidates) {
      tried.push(job.id)
      const lease = await store.$transaction(async (tx) => {
        const { count } = await tx.mediaJob.updateMany({
          where: { id: job.id, status: 'QUEUED', runAfter: { lte: now } },
          data: { status: 'RUNNING', lockedBy: workerId, leaseUntil: leaseEnd(now), startedAt: now, step: null, progress: null },
        })
        if (count !== 1) return null
        if (await writeState(tx, targetOf(job), 'PROCESSING')) {
          return {
            id: job.id,
            mediaId: job.mediaId,
            sourceKey: job.sourceKey,
            lockedBy: workerId,
            attempts: job.attempts,
            priority: job.priority,
            result: parseJobResult(job.result),
          } satisfies JobLease
        }
        // Tâche orpheline (base restaurée, écriture interrompue) : jamais de calcul sur un autre fichier.
        await tx.mediaJob.updateMany({ where: { id: job.id, lockedBy: workerId }, data: { status: 'CANCELLED', finishedAt: now, ...RELEASED } })
        return null
      }, JOB_TRANSACTION)
      if (lease) return lease
    }
  }
  return null
}

/**
 * Renouvelle le bail (battement toutes les 30 s, et en tête de chaque transaction d'écriture d'un
 * résultat : « écriture d'abord ») ; `data` = avancement à écrire avec. false : tâche annulée ou reprise
 * par un autre processus, le calcul doit s'arrêter.
 */
export async function renewLease(tx: JobTx, lease: Pick<JobLease, 'id' | 'lockedBy'>, now: Date, data: Prisma.MediaJobUncheckedUpdateManyInput = {}): Promise<boolean> {
  const { count } = await tx.mediaJob.updateMany({ where: leaseWhere(lease), data: { ...data, leaseUntil: leaseEnd(now) } })
  return count === 1
}

/** Champs d'avancement d'une tâche (étape en cours, 0 à 1). */
export function progressData(step: JobStep | null, progress: number | null): Prisma.MediaJobUncheckedUpdateManyInput {
  return { step, progress: progress === null ? null : Math.min(1, Math.max(0, Math.round(progress * 1000) / 1000)) }
}

/** Résultat accumulé enregistré avec le bail (rendu enregistré, avertissement). */
export function resultData(result: JobResult): Prisma.MediaJobUncheckedUpdateManyInput {
  return { result: resultJson(result) }
}

// ─── Fin d'une tâche ─────────────────────────────────────────────────────────

/** Tâche réussie : DONE, média « prêt ». false : bail perdu (rien n'est écrit). */
export async function completeJob(store: JobStore, lease: JobLease, now: Date, result: JobResult, writeState: MediaStateWrite): Promise<boolean> {
  return store.$transaction(async (tx) => {
    const { count } = await tx.mediaJob.updateMany({
      where: leaseWhere(lease),
      data: { status: 'DONE', finishedAt: now, leaseUntil: null, step: null, progress: null, result: resultJson(result), errorCode: null, errorDetail: null },
    })
    if (count !== 1) return false
    await writeState(tx, targetOf(lease), 'READY')
    return true
  }, JOB_TRANSACTION)
}

/** Suite donnée à un échec : nouvel essai, échec définitif, ou rien (bail perdu). */
export type FailOutcome = 'retry' | 'failed' | 'lost'

/**
 * Essai en échec : erreur passagère → retour en file (`runAfter` différé, média « en attente ») tant
 * qu'il reste des essais ; sinon FAILED, média « en échec ». Le code et le résumé restent sur la tâche.
 */
export async function failJob(store: JobStore, lease: JobLease, now: Date, failure: JobFailure, result: JobResult, writeState: MediaStateWrite): Promise<FailOutcome> {
  const decision = failureDecision(lease.attempts, failure)
  const error = { errorCode: failure.code, errorDetail: truncateText(failure.detail), result: resultJson(result), attempts: decision.attempts }
  return store.$transaction(async (tx) => {
    if (decision.retryAfterMs !== null) {
      const { count } = await tx.mediaJob.updateMany({
        where: leaseWhere(lease),
        data: { ...error, ...RELEASED, status: 'QUEUED', runAfter: new Date(now.getTime() + decision.retryAfterMs) },
      })
      if (count !== 1) return 'lost' as const
      await writeState(tx, targetOf(lease), 'PENDING')
      return 'retry' as const
    }
    const { count } = await tx.mediaJob.updateMany({
      where: leaseWhere(lease),
      data: { ...error, status: 'FAILED', finishedAt: now, leaseUntil: null, progress: null },
    })
    if (count !== 1) return 'lost' as const
    await writeState(tx, targetOf(lease), 'FAILED')
    return 'failed' as const
  }, JOB_TRANSACTION)
}

/**
 * Tâche rendue à la file **sans compter d'essai** (arrêt du serveur, rechargement en développement,
 * ffmpeg devenu inutilisable sur ce processus) : reprise aussitôt par un autre processus, ou par celui-ci
 * à son redémarrage. Média de nouveau « en attente ».
 */
export async function releaseJob(store: JobStore, lease: JobLease, now: Date, result: JobResult, writeState: MediaStateWrite): Promise<boolean> {
  return store.$transaction(async (tx) => {
    const { count } = await tx.mediaJob.updateMany({
      where: leaseWhere(lease),
      data: { ...RELEASED, status: 'QUEUED', runAfter: now, result: resultJson(result) },
    })
    if (count !== 1) return false
    await writeState(tx, targetOf(lease), 'PENDING')
    return true
  }, JOB_TRANSACTION)
}

/**
 * Bail rendu échu tout de suite : son détenteur est arrêté pour de bon (même machine, processus absent :
 * arrêt net, Ctrl+C sur `nuxt dev`). La reprise ordinaire des baux échus s'en charge ensuite, avec ses
 * règles (un essai de plus : un fichier qui fait tomber le processus ne boucle pas sans fin) ; seule
 * l'attente de l'expiration (2 min) est évitée. Conditionné au détenteur lu.
 */
export async function expireLease(store: JobTx, job: { id: string, lockedBy: string }, now: Date): Promise<boolean> {
  const { count } = await store.mediaJob.updateMany({
    where: { id: job.id, lockedBy: job.lockedBy, status: 'RUNNING' },
    data: { leaseUntil: new Date(now.getTime() - 1) },
  })
  return count === 1
}

// ─── Reprise des baux échus, rattrapage ──────────────────────────────────────

export interface ReapedJob extends JobTarget {
  id: string
  outcome: 'retry' | 'failed'
}

/**
 * Tâches dont le bail a expiré (processus tué, machine perdue) : retour en file avec un essai de plus,
 * ou échec définitif quand les essais sont épuisés. Écriture conditionnée au bail lu (statut, essais,
 * échéance) : deux processus qui reprennent la même tâche ne la comptent qu'une fois.
 */
export async function reapExpiredLeases(store: JobStore, now: Date, writeState: MediaStateWrite): Promise<ReapedJob[]> {
  const expired = await store.mediaJob.findMany({
    where: { status: 'RUNNING', OR: [{ leaseUntil: { lt: now } }, { leaseUntil: null }] },
    orderBy: [{ leaseUntil: 'asc' }],
    take: REAP_BATCH,
  })
  const reaped: ReapedJob[] = []
  for (const job of expired) {
    const decision = failureDecision(job.attempts, { retryable: true })
    const outcome = await store.$transaction(async (tx) => {
      const guard: Prisma.MediaJobWhereInput = { id: job.id, status: 'RUNNING', attempts: job.attempts, OR: [{ leaseUntil: { lt: now } }, { leaseUntil: null }] }
      const error = { errorCode: 'CONVERSION_FAILED', errorDetail: LEASE_EXPIRED_DETAIL, attempts: decision.attempts }
      const data: Prisma.MediaJobUncheckedUpdateManyInput = decision.retryAfterMs === null
        ? { ...error, status: 'FAILED', finishedAt: now, leaseUntil: null, progress: null }
        : { ...error, ...RELEASED, status: 'QUEUED', runAfter: new Date(now.getTime() + decision.retryAfterMs) }
      const { count } = await tx.mediaJob.updateMany({ where: guard, data })
      if (count !== 1) return null
      const failed = decision.retryAfterMs === null
      await writeState(tx, targetOf(job), failed ? 'FAILED' : 'PENDING')
      return failed ? 'failed' as const : 'retry' as const
    }, JOB_TRANSACTION)
    if (outcome) reaped.push({ id: job.id, ...targetOf(job), outcome })
  }
  return reaped
}

/**
 * Rattrapage au démarrage (§ 31.1) : un média « en attente » ou « en cours » sans tâche active (base
 * restaurée, tâche supprimée à la main) reçoit une nouvelle tâche. Deux processus qui démarrent ensemble
 * peuvent en créer deux : la plus ancienne est gardée, les autres annulées (même choix des deux côtés).
 * Renvoie les médias concernés.
 */
export async function catchUpJobs(store: JobStore, now: Date, writeState: MediaStateWrite): Promise<string[]> {
  const caught: string[] = []
  // Un média traité sort de la sélection (il a désormais une tâche active) : lots successifs, bornés.
  for (let round = 0; round < 50; round++) {
    const orphans = await store.media.findMany({
      where: {
        kind: 'VIDEO',
        deletedAt: null,
        processingState: { in: ['PENDING', 'PROCESSING'] },
        jobs: { none: { status: { in: [...ACTIVE_JOB_STATUSES] } } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: CATCH_UP_BATCH,
    })
    for (const media of orphans) {
      caught.push(media.id)
      await store.$transaction(async (tx) => {
        await enqueueJob(tx, { mediaId: media.id, sourceKey: media.storageKey, priority: jobPriority(media.metadata) }, now)
        if (media.processingState === 'PROCESSING') await writeState(tx, targetOf({ mediaId: media.id, sourceKey: media.storageKey }), 'PENDING')
      }, JOB_TRANSACTION)
      await dropDuplicateJobs(store, media.id, now)
    }
    if (orphans.length < CATCH_UP_BATCH) break
  }
  return caught
}

/** Une seule tâche active par média : la plus ancienne est gardée, les autres annulées. */
async function dropDuplicateJobs(store: JobTx, mediaId: string, now: Date): Promise<void> {
  const active = await store.mediaJob.findMany({
    where: { mediaId, status: { in: [...ACTIVE_JOB_STATUSES] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const extra = active.slice(1).map(job => job.id)
  if (extra.length > 0) {
    await store.mediaJob.updateMany({ where: { id: { in: extra }, status: { in: [...ACTIVE_JOB_STATUSES] } }, data: { status: 'CANCELLED', finishedAt: now, leaseUntil: null } })
  }
}

// ─── Présence des processus de travail, compteurs ────────────────────────────

/** Ce qu'un processus de travail publie de lui-même (« Réglages », /api/health). */
export interface WorkerPresenceInfo {
  host: string
  pid: number
  /** Version de ffmpeg. */
  version: string | null
  /** Encodeurs utiles présents (ffmpeg.ts, RELEVANT_ENCODERS). */
  encoders: string[]
  concurrency: number
  /**
   * Boucle arrêtée (ffmpeg devenu inutilisable, nouvelle détection chaque minute) : le processus vit
   * encore mais ne traite rien ; il ne compte pas pour rendre le mode `external` actif.
   */
  halted?: boolean
}

export interface WorkerPresence extends WorkerPresenceInfo {
  id: string
  halted: boolean
  /** Dernière présence écrite. */
  seenAt: Date
  /** Vu dans la fenêtre WORKER_SEEN_WINDOW_MS et en état de traiter : le mode `external` est actif. */
  active: boolean
}

/** Écrit la présence d'un processus de travail (`Setting` `videoWorker:<id>`), toutes les 60 s. */
export async function writeWorkerPresence(store: JobTx, workerId: string, info: WorkerPresenceInfo, now: Date): Promise<void> {
  const key = `${WORKER_PRESENCE_PREFIX}${workerId}`
  const value: Prisma.InputJsonValue = { ...info, encoders: [...info.encoders], halted: info.halted === true, seenAt: now.toISOString() }
  await store.setting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

/**
 * Efface la présence d'un processus de travail qui s'arrête proprement : le serveur web cesse de le
 * compter (au plus 30 s de cache) au lieu d'attendre la fin de la fenêtre de 5 min.
 */
export async function removeWorkerPresence(store: JobTx, workerId: string): Promise<void> {
  await store.setting.deleteMany({ where: { key: `${WORKER_PRESENCE_PREFIX}${workerId}` } })
}

/** Efface les présences de plus d'un jour (processus arrêtés, conteneurs remplacés). */
export async function purgeWorkerPresence(store: JobTx, now: Date): Promise<number> {
  const { count } = await store.setting.deleteMany({
    where: { key: { startsWith: WORKER_PRESENCE_PREFIX }, updatedAt: { lt: new Date(now.getTime() - PRESENCE_RETENTION_MS) } },
  })
  return count
}

function text(value: unknown, max = 191): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

/** Processus de travail connus, les plus récents d'abord (valeurs JSON contrôlées : écrites par un autre processus). */
export async function readWorkerPresence(store: JobTx, now: Date): Promise<WorkerPresence[]> {
  const rows = await store.setting.findMany({ where: { key: { startsWith: WORKER_PRESENCE_PREFIX } } })
  return rows
    .map((row) => {
      const value = (row.value && typeof row.value === 'object' ? row.value : {}) as Record<string, unknown>
      const halted = value.halted === true
      return {
        id: row.key.slice(WORKER_PRESENCE_PREFIX.length),
        host: text(value.host) ?? '',
        pid: typeof value.pid === 'number' ? value.pid : 0,
        version: text(value.version, 64),
        encoders: Array.isArray(value.encoders) ? value.encoders.filter((item): item is string => typeof item === 'string').slice(0, 16) : [],
        concurrency: typeof value.concurrency === 'number' ? value.concurrency : 0,
        halted,
        seenAt: row.updatedAt,
        active: !halted && now.getTime() - row.updatedAt.getTime() <= WORKER_SEEN_WINDOW_MS,
      }
    })
    .sort((a, b) => b.seenAt.getTime() - a.seenAt.getTime())
}

// ─── Vue de la fiche d'un média ──────────────────────────────────────────────

/** Traitement d'une vidéo vu par l'administration (dernière tâche du média). */
export interface ProcessingDetail {
  /** Statut de la tâche (QUEUED, RUNNING, DONE, FAILED, CANCELLED). */
  status: MediaJobStatusValue
  step: JobStep | null
  progress: number | null
  attempts: number
  errorCode: VideoJobErrorCode | null
  errorDetail: string | null
  warnings: VideoJobWarning[]
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  /** Prochain essai au plus tôt (tâche en file après un échec passager). */
  runAfter: Date
  updatedAt: Date
}

/** Dernière tâche d'un média, pour sa fiche (null : jamais traité). Codes inconnus ignorés. */
export function processingDetail(job: MediaJob | null): ProcessingDetail | null {
  if (!job) return null
  const result = parseJobResult(job.result)
  return {
    status: job.status,
    step: (JOB_STEPS as readonly string[]).includes(job.step ?? '') ? job.step as JobStep : null,
    progress: job.progress,
    attempts: job.attempts,
    errorCode: (VIDEO_JOB_ERROR_CODES as readonly string[]).includes(job.errorCode ?? '') ? job.errorCode as VideoJobErrorCode : null,
    errorDetail: job.errorDetail,
    warnings: result.warnings,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    runAfter: job.runAfter,
    updatedAt: job.updatedAt,
  }
}

/** Tâches par statut (« Réglages », /api/health). */
export type JobCounts = Record<Lowercase<MediaJobStatusValue>, number>

export async function countJobs(store: JobTx): Promise<JobCounts> {
  const counts = await Promise.all(MEDIA_JOB_STATUSES.map(status => store.mediaJob.count({ where: { status } })))
  return Object.fromEntries(MEDIA_JOB_STATUSES.map((status, index) => [status.toLowerCase(), counts[index]!])) as JobCounts
}
