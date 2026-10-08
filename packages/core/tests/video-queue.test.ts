import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKFILL_PRIORITY,
  JOB_LEASE_MS,
  type ProcessingStateValue,
  WORKER_PRESENCE_PREFIX,
  WORKER_SEEN_WINDOW_MS,
} from '../shared/utils/video-processing'
import type { Media, MediaJob, Setting } from '../server/generated/prisma/client'
import {
  cancelActiveJobs,
  catchUpJobs,
  claimNextJob,
  completeJob,
  countJobs,
  emptyJobResult,
  enqueueJob,
  failJob,
  failureDecision,
  HELD_PRIORITY,
  type JobLease,
  type JobStore,
  type JobTx,
  jobPriority,
  type MediaStateWrite,
  parseJobResult,
  PRESENCE_RETENTION_MS,
  processingDetail,
  purgeWorkerPresence,
  readWorkerPresence,
  reapExpiredLeases,
  releaseJob,
  removeWorkerPresence,
  renewLease,
  writeWorkerPresence,
} from '../server/lib/video-processing/jobs'
import {
  createJobRunner,
  type JobRunner,
  notifyJobQueued,
  registerJobRunner,
  RunnerHalt,
  RunnerStopping,
  superviseJobRunner,
  type SupervisorState,
} from '../server/lib/video-processing/runner'
import { PROCESSING_INCLUDE } from '../server/lib/media/sources'
import { servedByWorker } from '../server/lib/video-processing/status'
import { parseWorkerId, WORKER_ID_MAX, workerIdentity } from '../server/lib/video-processing/worker-id'

// Le pipeline importe le service des médias et le stockage (base, fichiers) : remplacés, seules ses
// règles pures sont testées ici (le reste l'est par le scénario de bout en bout).
vi.mock('../server/lib/media/service', () => ({}))
vi.mock('../server/lib/storage', () => ({ useMediaStorage: vi.fn() }))
// withApiUpload (server/lib/api/writes.ts) : réception, droits et compteurs remplacés.
const uploadMocks = vi.hoisted(() => ({ active: false }))
vi.mock('../server/lib/video-processing/status', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/lib/video-processing/status')>()
  return { ...original, videoProcessingActive: vi.fn(async () => uploadMocks.active) }
})
vi.mock('../server/lib/media/upload', () => ({
  receiveUpload: vi.fn(async (_event: unknown, rules: { acceptedTypes: readonly string[] }) => ({
    path: '/tmp/upload',
    size: 1,
    checksum: 'c',
    filename: 'clip.mkv',
    fields: {},
    rules,
    cleanup: vi.fn(async () => {}),
  })),
}))
vi.mock('../server/lib/api/context', () => ({ requireUploadAllowance: vi.fn() }))
vi.mock('../server/lib/access/delegated', () => ({ reserveDelegatedUpload: vi.fn(async () => true), releaseDelegatedUpload: vi.fn(async () => {}) }))

// ─── Magasin en mémoire (sous-ensemble du client Prisma utilisé par la file) ──

type Row = Record<string, unknown>
type Where = Record<string, unknown>
type Order = 'asc' | 'desc' | { sort: 'asc' | 'desc', nulls?: 'first' | 'last' }

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : a as number
  const y = b instanceof Date ? b.getTime() : b as number
  return x < y ? -1 : x > y ? 1 : 0
}

function matchValue(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null
  if (condition instanceof Date || typeof condition !== 'object') return same(value, condition)
  return Object.entries(condition as Row).every(([operator, argument]) => {
    switch (operator) {
      case 'in': return (argument as unknown[]).some(item => same(value, item))
      case 'notIn': return !(argument as unknown[]).some(item => same(value, item))
      case 'lt': return value !== null && compare(value, argument) < 0
      case 'lte': return value !== null && compare(value, argument) <= 0
      case 'gt': return value !== null && compare(value, argument) > 0
      case 'gte': return value !== null && compare(value, argument) >= 0
      case 'not': return !matchValue(value, argument)
      case 'startsWith': return typeof value === 'string' && value.startsWith(argument as string)
      case 'equals': return same(value, argument)
      default: throw new Error(`opérateur non géré par le magasin de test : ${operator}`)
    }
  })
}

class MemoryStore implements JobStore {
  jobs: MediaJob[] = []
  medias: Media[] = []
  settings: Setting[] = []
  private sequence = 0
  constructor(public clock: () => Date) {}

  private matches(table: 'job' | 'media' | 'setting', row: Row, where: Where | undefined): boolean {
    if (!where) return true
    return Object.entries(where).every(([key, condition]) => {
      if (key === 'OR') return (condition as Where[]).some(item => this.matches(table, row, item))
      if (key === 'AND') return (condition as Where[]).every(item => this.matches(table, row, item))
      if (key === 'jobs' && table === 'media') {
        const none = (condition as { none: Where }).none
        return !this.jobs.some(job => job.mediaId === row.id && this.matches('job', job as unknown as Row, none))
      }
      if (!(key in row)) throw new Error(`champ inconnu du magasin de test : ${key}`)
      return matchValue(row[key], condition)
    })
  }

  private sorted<T>(rows: T[], orderBy: Record<string, Order>[] = []): T[] {
    return [...rows].sort((a, b) => {
      for (const order of orderBy) {
        const [key, spec] = Object.entries(order)[0]!
        const { sort, nulls } = typeof spec === 'string' ? { sort: spec, nulls: undefined } : spec
        const x = (a as Row)[key]
        const y = (b as Row)[key]
        // `nulls` explicite (SortOrderInput de Prisma) : valeurs nulles en tête ou en fin, quel que soit le sens.
        if (nulls && (x === null) !== (y === null)) return (x === null) === (nulls === 'first') ? -1 : 1
        const result = compare(x, y)
        if (result !== 0) return sort === 'asc' ? result : -result
      }
      return 0
    })
  }

  private apply(row: Row, data: Row): void {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      if (value && typeof value === 'object' && !(value instanceof Date) && 'increment' in value) row[key] = (row[key] as number) + (value as { increment: number }).increment
      else row[key] = value
    }
    if ('updatedAt' in row) row.updatedAt = this.clock()
  }

  private next(prefix: string): string {
    return `${prefix}${String(++this.sequence).padStart(4, '0')}`
  }

  mediaJob: JobTx['mediaJob'] = {
    findMany: async ({ where, orderBy, take }) => this.sorted(this.jobs.filter(job => this.matches('job', job as unknown as Row, where as Where)), orderBy as Record<string, Order>[])
      .slice(0, take ?? Infinity).map(job => ({ ...job })),
    create: async ({ data }) => {
      const now = this.clock()
      const job = {
        id: this.next('job'), status: 'QUEUED', priority: 0, attempts: 0, runAfter: now, lockedBy: null, leaseUntil: null, step: null,
        progress: null, result: null, errorCode: null, errorDetail: null, createdAt: now, updatedAt: now, startedAt: null, finishedAt: null,
        ...data,
      } as MediaJob
      this.jobs.push(job)
      return { ...job }
    },
    updateMany: async ({ where, data }) => {
      const rows = this.jobs.filter(job => this.matches('job', job as unknown as Row, where as Where))
      for (const row of rows) this.apply(row as unknown as Row, data as Row)
      return { count: rows.length }
    },
    count: async ({ where }) => this.jobs.filter(job => this.matches('job', job as unknown as Row, where as Where)).length,
  }

  media: JobTx['media'] = {
    findMany: async ({ where, orderBy, take }) => this.sorted(this.medias.filter(media => this.matches('media', media as unknown as Row, where as Where)), orderBy as Record<string, Order>[])
      .slice(0, take ?? Infinity).map(media => ({ ...media })),
    updateMany: async ({ where, data }) => {
      const rows = this.medias.filter(media => this.matches('media', media as unknown as Row, where as Where))
      for (const row of rows) this.apply(row as unknown as Row, data as Row)
      return { count: rows.length }
    },
  }

  setting: JobTx['setting'] = {
    findMany: async ({ where }) => this.settings.filter(setting => this.matches('setting', setting as unknown as Row, where as Where)).map(setting => ({ ...setting })),
    upsert: async ({ where, create, update }) => {
      const existing = this.settings.find(setting => setting.key === where.key)
      if (existing) {
        this.apply(existing as unknown as Row, update as Row)
        existing.updatedAt = this.clock()
        return { ...existing }
      }
      const row = { ...create, updatedAt: this.clock() } as Setting
      this.settings.push(row)
      return { ...row }
    },
    deleteMany: async ({ where }) => {
      const before = this.settings.length
      this.settings = this.settings.filter(setting => !this.matches('setting', setting as unknown as Row, where as Where))
      return { count: before - this.settings.length }
    },
  }

  /** Transaction : instantané rétabli si la fonction lève. */
  async $transaction<R>(fn: (tx: JobTx) => Promise<R>): Promise<R> {
    const snapshot = structuredClone({ jobs: this.jobs, medias: this.medias, settings: this.settings })
    try {
      return await fn(this)
    }
    catch (error) {
      Object.assign(this, snapshot)
      throw error
    }
  }

  addMedia(fields: Partial<Media> = {}): Media {
    const now = this.clock()
    const media = {
      id: this.next('media'), kind: 'VIDEO', storageKey: `originals/${this.sequence}.mp4`, processingState: 'PENDING', deletedAt: null,
      metadata: null, createdAt: now, updatedAt: now, ...fields,
    } as Media
    this.medias.push(media)
    return media
  }

  job(id: string): MediaJob {
    return this.jobs.find(job => job.id === id)!
  }

  mediaRow(id: string): Media {
    return this.medias.find(media => media.id === id)!
  }
}

/** Écriture d'état comme le service : conditionnée au fichier de la tâche et hors corbeille ; journalisée. */
function stateWriter(log: Array<{ mediaId: string, state: ProcessingStateValue }> = []): MediaStateWrite {
  return async (tx, target, state) => {
    const { count } = await tx.media.updateMany({ where: { id: target.mediaId, storageKey: target.sourceKey, deletedAt: null }, data: { processingState: state } })
    if (count === 1) log.push({ mediaId: target.mediaId, state })
    return count === 1
  }
}

const T0 = new Date('2026-10-07T10:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

let now: Date
let store: MemoryStore
let states: Array<{ mediaId: string, state: ProcessingStateValue }>
let writeState: MediaStateWrite

beforeEach(() => {
  now = T0
  store = new MemoryStore(() => now)
  states = []
  writeState = stateWriter(states)
})

/** Média vidéo et sa tâche en file. */
async function queued(fields: Partial<Media> = {}, priority = 0, runAfter = now): Promise<{ media: Media, job: MediaJob }> {
  const media = store.addMedia(fields)
  const job = await enqueueJob(store, { mediaId: media.id, sourceKey: media.storageKey, priority }, runAfter)
  return { media, job }
}

// ─── Règles pures ────────────────────────────────────────────────────────────

describe('file des vidéos : règles pures', () => {
  it('priorité : une piste de métadonnées (diffusion retenue) passe devant, même pour les vidéos existantes', () => {
    expect(jobPriority({ dataTracks: [] })).toBe(0)
    expect(jobPriority(null)).toBe(0)
    expect(jobPriority({ dataTracks: ['mebx'] })).toBe(HELD_PRIORITY)
    expect(jobPriority({ dataTracks: ['gpmd'] }, BACKFILL_PRIORITY)).toBe(HELD_PRIORITY)
    expect(jobPriority({}, BACKFILL_PRIORITY)).toBe(BACKFILL_PRIORITY)
    expect(jobPriority({ dataTracks: ['gpmd'] }, 50)).toBe(50)
  })

  it('suite d\'un échec : 30 s, 5 min, puis échec définitif ; erreur déterministe : échec aussitôt', () => {
    expect(failureDecision(0, { retryable: true })).toEqual({ attempts: 1, retryAfterMs: 30_000 })
    expect(failureDecision(1, { retryable: true })).toEqual({ attempts: 2, retryAfterMs: 300_000 })
    expect(failureDecision(2, { retryable: true })).toEqual({ attempts: 3, retryAfterMs: null })
    expect(failureDecision(0, { retryable: false })).toEqual({ attempts: 1, retryAfterMs: null })
  })

  it('résultat d\'une tâche lu en base : valeurs inconnues ignorées', () => {
    expect(parseJobResult(null)).toEqual(emptyJobResult())
    expect(parseJobResult({ steps: ['sanitize', 'bogus', 'poster'], warnings: ['hdr_converted', 1], renditions: ['h264', 'vp9'] }))
      .toEqual({ steps: ['sanitize', 'poster'], warnings: ['hdr_converted'], renditions: ['h264'] })
  })

  it('identifiant de processus : hôte:pid:aléa, borné pour la clé de présence', () => {
    expect(workerIdentity('web-1', 42, 'a1b2c3d4')).toBe('web-1:42:a1b2c3d4')
    expect(workerIdentity('bad host:\n', 7, 'ffffffff')).toBe('badhost:7:ffffffff')
    expect(workerIdentity('', 7, 'ffffffff')).toBe('host:7:ffffffff')
    const long = workerIdentity('h'.repeat(500), 123456, '0123abcd')
    expect(long.length).toBe(WORKER_ID_MAX)
    expect(long.endsWith(':123456:0123abcd')).toBe(true)
    expect(`${WORKER_PRESENCE_PREFIX}${long}`.length).toBeLessThanOrEqual(191)
  })

  it('processus de travail : seule la sonde de santé est servie', () => {
    expect(servedByWorker('/api/health')).toBe(true)
    for (const path of ['/', '/admin', '/api/admin/media', '/api/v1/me', '/m/abc/v1/x.mp4', '/api/health/x', '/api/_auth/session']) {
      expect(servedByWorker(path)).toBe(false)
    }
  })

  it('vue de la fiche : dernière tâche, codes inconnus ignorés', async () => {
    expect(processingDetail(null)).toBeNull()
    const { job } = await queued()
    await store.mediaJob.updateMany({ where: { id: job.id }, data: { step: 'transcode', progress: 0.5, errorCode: 'WHATEVER', result: { warnings: ['poster_failed'] } } })
    const detail = processingDetail(store.job(job.id))!
    expect(detail).toMatchObject({ status: 'QUEUED', step: 'transcode', progress: 0.5, attempts: 0, errorCode: null, warnings: ['poster_failed'] })
  })
})

// ─── Prise, bail, fin ────────────────────────────────────────────────────────

describe('file des vidéos : prise et bail', () => {
  it('prend la tâche prête la plus prioritaire, puis la plus ancienne ; le média passe « en cours »', async () => {
    const old = await queued()
    now = at(1000)
    const held = await queued({}, HELD_PRIORITY)
    await queued({}, BACKFILL_PRIORITY)
    await queued({}, 50, at(60_000)) // pas encore prête (nouvel essai différé)

    const first = await claimNextJob(store, 'worker-a', now, writeState)
    expect(first).toMatchObject({ id: held.job.id, mediaId: held.media.id, lockedBy: 'worker-a', attempts: 0, result: emptyJobResult() })
    expect(store.job(held.job.id)).toMatchObject({ status: 'RUNNING', lockedBy: 'worker-a', leaseUntil: at(1000 + JOB_LEASE_MS), startedAt: now })
    expect(store.mediaRow(held.media.id).processingState).toBe('PROCESSING')

    const second = await claimNextJob(store, 'worker-a', now, writeState)
    expect(second?.id).toBe(old.job.id)
  })

  it('file vide ou tâches différées : rien', async () => {
    await queued({}, 0, at(30_000))
    expect(await claimNextJob(store, 'worker-a', now, writeState)).toBeNull()
    now = at(30_000)
    expect(await claimNextJob(store, 'worker-a', now, writeState)).not.toBeNull()
  })

  it('prise atomique : deux processus sur la même tâche, un seul la prend, l\'autre passe à la suivante', async () => {
    const a = await queued()
    now = at(1)
    const b = await queued()
    // Le processus A lit les tâches, puis B prend la première avant que A ne l'écrive.
    const findMany = store.mediaJob.findMany
    let raced = false
    store.mediaJob.findMany = async (args) => {
      const rows = await findMany(args)
      if (!raced) {
        raced = true
        expect(await claimNextJob(store, 'worker-b', now, writeState)).toMatchObject({ id: a.job.id })
      }
      return rows
    }
    const claimed = await claimNextJob(store, 'worker-a', now, writeState)
    expect(claimed).toMatchObject({ id: b.job.id, lockedBy: 'worker-a' })
    expect(store.job(a.job.id).lockedBy).toBe('worker-b')
    expect(store.jobs.filter(job => job.status === 'RUNNING')).toHaveLength(2)
  })

  it('tâche orpheline (fichier remplacé sans annulation, corbeille) : annulée, jamais calculée', async () => {
    const stale = await queued()
    store.mediaRow(stale.media.id).storageKey = 'originals/other.mp4'
    now = at(1)
    const trashed = await queued()
    store.mediaRow(trashed.media.id).deletedAt = now
    now = at(2)
    const good = await queued()

    const claimed = await claimNextJob(store, 'worker-a', now, writeState)
    expect(claimed?.id).toBe(good.job.id)
    expect(store.job(stale.job.id).status).toBe('CANCELLED')
    expect(store.job(trashed.job.id).status).toBe('CANCELLED')
    expect(store.mediaRow(stale.media.id).processingState).toBe('PENDING')
  })

  it('bail : renouvelé par son détenteur, refusé après annulation ou reprise par un autre', async () => {
    const { media } = await queued()
    const lease = (await claimNextJob(store, 'worker-a', now, writeState))!
    now = at(30_000)
    expect(await renewLease(store, lease, now, { step: 'transcode', progress: 0.25 })).toBe(true)
    expect(store.job(lease.id)).toMatchObject({ leaseUntil: at(30_000 + JOB_LEASE_MS), step: 'transcode', progress: 0.25 })
    expect(await renewLease(store, { ...lease, lockedBy: 'worker-b' }, now)).toBe(false)

    expect(await cancelActiveJobs(store, media.id, now)).toBe(1)
    expect(await renewLease(store, lease, now)).toBe(false)
    expect(store.job(lease.id)).toMatchObject({ status: 'CANCELLED', finishedAt: now, leaseUntil: null })
  })

  it('annulation : tâches en file et en cours seulement', async () => {
    const { media } = await queued()
    const done = await enqueueJob(store, { mediaId: media.id, sourceKey: media.storageKey, priority: 0 }, now)
    await store.mediaJob.updateMany({ where: { id: done.id }, data: { status: 'DONE' } })
    await claimNextJob(store, 'worker-a', now, writeState)
    await enqueueJob(store, { mediaId: media.id, sourceKey: media.storageKey, priority: 0 }, now)
    expect(await cancelActiveJobs(store, media.id, now)).toBe(2)
    expect(store.jobs.map(job => job.status).sort()).toEqual(['CANCELLED', 'CANCELLED', 'DONE'])
  })

  it('tâche créée pour une copie : rendus déjà copiés repris dans son résultat', async () => {
    const media = store.addMedia()
    const job = await enqueueJob(store, { mediaId: media.id, sourceKey: media.storageKey, priority: 0, renditions: ['h264'] }, now)
    expect(parseJobResult(job.result).renditions).toEqual(['h264'])
    expect((await claimNextJob(store, 'worker-a', now, writeState))?.result.renditions).toEqual(['h264'])
  })
})

describe('file des vidéos : fin d\'une tâche', () => {
  async function running(): Promise<{ media: Media, lease: JobLease }> {
    const { media } = await queued()
    return { media, lease: (await claimNextJob(store, 'worker-a', now, writeState))! }
  }

  it('réussite : DONE, résultat enregistré, média « prêt »', async () => {
    const { media, lease } = await running()
    const result = { steps: ['transcode', 'poster'], warnings: ['hdr_converted'], renditions: ['h264'] } as JobLease['result']
    expect(await completeJob(store, lease, now, result, writeState)).toBe(true)
    expect(store.job(lease.id)).toMatchObject({ status: 'DONE', finishedAt: now, leaseUntil: null, step: null, errorCode: null })
    expect(parseJobResult(store.job(lease.id).result)).toEqual(result)
    expect(store.mediaRow(media.id).processingState).toBe('READY')
  })

  it('réussite après la perte du bail : rien n\'est écrit', async () => {
    const { media, lease } = await running()
    await cancelActiveJobs(store, media.id, now)
    expect(await completeJob(store, lease, now, emptyJobResult(), writeState)).toBe(false)
    expect(store.job(lease.id).status).toBe('CANCELLED')
    expect(store.mediaRow(media.id).processingState).toBe('PROCESSING')
  })

  it('erreur passagère : deux nouveaux essais différés (30 s, 5 min), puis échec définitif', async () => {
    const { media } = await queued()
    const failure = { code: 'TIMEOUT', detail: 'Délai dépassé.', retryable: true } as const
    const outcomes: string[] = []
    for (const delay of [30_000, 300_000, null]) {
      const lease = (await claimNextJob(store, 'worker-a', now, writeState))!
      expect(store.mediaRow(media.id).processingState).toBe('PROCESSING')
      outcomes.push(await failJob(store, lease, now, failure, emptyJobResult(), writeState))
      const job = store.job(lease.id)
      if (delay === null) {
        expect(job).toMatchObject({ status: 'FAILED', attempts: 3, errorCode: 'TIMEOUT', finishedAt: now })
        expect(store.mediaRow(media.id).processingState).toBe('FAILED')
      }
      else {
        expect(job).toMatchObject({ status: 'QUEUED', lockedBy: null, leaseUntil: null, errorCode: 'TIMEOUT', runAfter: at(now.getTime() - T0.getTime() + delay) })
        expect(store.mediaRow(media.id).processingState).toBe('PENDING')
        expect(await claimNextJob(store, 'worker-a', now, writeState)).toBeNull()
        now = new Date(job.runAfter)
      }
    }
    expect(outcomes).toEqual(['retry', 'retry', 'failed'])
  })

  it('erreur déterministe : échec aussitôt, résumé tronqué à 191 caractères', async () => {
    const { media, lease } = await running()
    const outcome = await failJob(store, lease, now, { code: 'NO_VIDEO_TRACK', detail: 'x'.repeat(500), retryable: false }, emptyJobResult(), writeState)
    expect(outcome).toBe('failed')
    expect(store.job(lease.id)).toMatchObject({ status: 'FAILED', attempts: 1, errorCode: 'NO_VIDEO_TRACK' })
    expect(store.job(lease.id).errorDetail).toHaveLength(191)
    expect(store.mediaRow(media.id).processingState).toBe('FAILED')
  })

  it('échec après la perte du bail : rien n\'est écrit', async () => {
    const { lease } = await running()
    await store.mediaJob.updateMany({ where: { id: lease.id }, data: { lockedBy: 'worker-b' } })
    expect(await failJob(store, lease, now, { code: 'TIMEOUT', detail: '', retryable: true }, emptyJobResult(), writeState)).toBe('lost')
    expect(store.job(lease.id)).toMatchObject({ status: 'RUNNING', attempts: 0, lockedBy: 'worker-b' })
  })

  it('arrêt du processus : tâche rendue sans compter d\'essai, prête aussitôt, rendus déjà faits gardés', async () => {
    const { media, lease } = await running()
    now = at(10_000)
    expect(await releaseJob(store, lease, now, { ...emptyJobResult(), renditions: ['h264'] }, writeState)).toBe(true)
    expect(store.job(lease.id)).toMatchObject({ status: 'QUEUED', attempts: 0, runAfter: now, lockedBy: null, leaseUntil: null })
    expect(store.mediaRow(media.id).processingState).toBe('PENDING')
    expect((await claimNextJob(store, 'worker-b', now, writeState))?.result.renditions).toEqual(['h264'])
  })

  it('le fichier a changé entre-temps : la tâche se termine sans toucher à l\'état du nouveau fichier', async () => {
    const { media, lease } = await running()
    store.mediaRow(media.id).storageKey = 'originals/new.mp4'
    store.mediaRow(media.id).processingState = 'PENDING'
    expect(await completeJob(store, lease, now, emptyJobResult(), writeState)).toBe(true)
    expect(store.mediaRow(media.id).processingState).toBe('PENDING')
  })
})

describe('file des vidéos : baux échus et rattrapage', () => {
  it('bail échu (processus tué) : remise en file avec un essai de plus, échec au 3e', async () => {
    const { media } = await queued()
    for (const expected of ['QUEUED', 'QUEUED', 'FAILED'] as const) {
      const lease = (await claimNextJob(store, 'worker-a', now, writeState))!
      // Bail encore valide : rien à reprendre.
      now = new Date(now.getTime() + JOB_LEASE_MS - 1)
      expect(await reapExpiredLeases(store, now, writeState)).toEqual([])
      now = new Date(now.getTime() + 2)
      const reaped = await reapExpiredLeases(store, now, writeState)
      expect(reaped).toEqual([{ id: lease.id, mediaId: media.id, sourceKey: media.storageKey, outcome: expected === 'FAILED' ? 'failed' : 'retry' }])
      expect(store.job(lease.id).status).toBe(expected)
      expect(store.job(lease.id).errorCode).toBe('CONVERSION_FAILED')
      expect(store.mediaRow(media.id).processingState).toBe(expected === 'FAILED' ? 'FAILED' : 'PENDING')
      if (expected !== 'FAILED') now = new Date(store.job(lease.id).runAfter)
    }
    expect(store.jobs[0]!.attempts).toBe(3)
  })

  it('deux processus reprennent le même bail échu en même temps : un seul essai compté', async () => {
    await queued()
    const lease = (await claimNextJob(store, 'worker-a', now, writeState))!
    now = at(JOB_LEASE_MS + 1)
    const [first, second] = await Promise.all([reapExpiredLeases(store, now, writeState), reapExpiredLeases(store, now, writeState)])
    expect(first.length + second.length).toBe(1)
    expect(store.job(lease.id).attempts).toBe(1)
  })

  it('le processus d\'origine écrit après la reprise : refusé (bail perdu)', async () => {
    await queued()
    const lease = (await claimNextJob(store, 'worker-a', now, writeState))!
    now = at(JOB_LEASE_MS + 1)
    await reapExpiredLeases(store, now, writeState)
    now = at(JOB_LEASE_MS + 30_001)
    const retaken = await claimNextJob(store, 'worker-b', now, writeState)
    expect(retaken?.id).toBe(lease.id)
    expect(await renewLease(store, lease, now)).toBe(false)
    expect(await completeJob(store, lease, now, emptyJobResult(), writeState)).toBe(false)
    expect(store.job(lease.id)).toMatchObject({ status: 'RUNNING', lockedBy: 'worker-b' })
  })

  it('rattrapage : médias en attente ou en cours sans tâche active, hors corbeille et images', async () => {
    const orphan = store.addMedia({ metadata: { dataTracks: ['gpmd'] } as Media['metadata'] })
    const stuck = store.addMedia({ processingState: 'PROCESSING' })
    const withJob = await queued()
    store.addMedia({ deletedAt: now })
    store.addMedia({ kind: 'IMAGE' })
    store.addMedia({ processingState: 'READY' })
    store.addMedia({ processingState: null })

    const caught = await catchUpJobs(store, now, writeState)
    expect(caught.sort()).toEqual([orphan.id, stuck.id].sort())
    const created = store.jobs.filter(job => job.mediaId !== withJob.media.id)
    expect(created).toHaveLength(2)
    expect(created.find(job => job.mediaId === orphan.id)).toMatchObject({ status: 'QUEUED', priority: HELD_PRIORITY, sourceKey: orphan.storageKey })
    expect(store.mediaRow(stuck.id).processingState).toBe('PENDING')
    expect(await catchUpJobs(store, now, writeState)).toEqual([])
  })

  it('rattrapage par deux processus au même moment : une seule tâche active reste', async () => {
    const orphan = store.addMedia()
    await Promise.all([catchUpJobs(store, now, writeState), catchUpJobs(store, now, writeState)])
    const active = store.jobs.filter(job => job.mediaId === orphan.id && ['QUEUED', 'RUNNING'].includes(job.status))
    expect(active).toHaveLength(1)
  })

  it('rattrapage en double : la « dernière tâche » lue par l\'API (PROCESSING_INCLUDE) est celle qui tourne, jamais le doublon annulé', async () => {
    // Horloge qui avance à chaque lecture : le doublon est créé après la tâche gardée (la plus ancienne).
    let tick = 0
    store = new MemoryStore(() => at(++tick))
    const orphan = store.addMedia()
    await Promise.all([catchUpJobs(store, now, writeState), catchUpJobs(store, now, writeState)])
    const [kept, duplicate] = [...store.jobs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    expect(duplicate).toMatchObject({ status: 'CANCELLED' })
    const latest = async () => (await store.mediaJob.findMany({ where: { mediaId: orphan.id }, ...PROCESSING_INCLUDE.jobs }))[0]
    expect(await latest()).toMatchObject({ id: kept!.id, status: 'QUEUED' })

    now = at(60_000)
    const lease = (await claimNextJob(store, 'worker-a', now, writeState))!
    expect(lease.id).toBe(kept!.id)
    expect(await latest()).toMatchObject({ id: kept!.id, status: 'RUNNING' })
    await completeJob(store, lease, at(120_000), emptyJobResult(), writeState)
    expect(await latest()).toMatchObject({ id: kept!.id, status: 'DONE' })
  })
})

describe('file des vidéos : présence des processus de travail, compteurs', () => {
  const info = { host: 'worker-1', pid: 12, version: '6.1.1', encoders: ['libx264', 'aac'], concurrency: 1 }

  it('présence écrite, lue, active 5 minutes, effacée après un jour', async () => {
    await writeWorkerPresence(store, 'worker-1:12:abcd', info, now)
    expect(store.settings[0]!.key).toBe(`${WORKER_PRESENCE_PREFIX}worker-1:12:abcd`)
    let workers = await readWorkerPresence(store, now)
    expect(workers).toEqual([{ id: 'worker-1:12:abcd', ...info, halted: false, seenAt: now, active: true }])

    workers = await readWorkerPresence(store, at(WORKER_SEEN_WINDOW_MS + 1))
    expect(workers[0]!.active).toBe(false)
    expect(await purgeWorkerPresence(store, at(PRESENCE_RETENTION_MS))).toBe(0)
    expect(await purgeWorkerPresence(store, at(PRESENCE_RETENTION_MS + 1))).toBe(1)
    expect(await readWorkerPresence(store, now)).toEqual([])
  })

  it('présence d\'un autre processus : valeurs contrôlées, autres réglages ignorés', async () => {
    store.settings.push({ key: `${WORKER_PRESENCE_PREFIX}x`, value: { host: 42, encoders: ['aac', 3], concurrency: 'two' }, updatedAt: now })
    store.settings.push({ key: 'transformPolicy', value: {}, updatedAt: now })
    expect(await readWorkerPresence(store, now)).toEqual([{ id: 'x', host: '', pid: 0, version: null, encoders: ['aac'], concurrency: 0, halted: false, seenAt: now, active: true }])
  })

  it('processus dont la boucle est arrêtée : vu, mais jamais actif ; présence effacée à l\'arrêt', async () => {
    await writeWorkerPresence(store, 'worker-1:12:abcd', { ...info, halted: true }, now)
    expect(await readWorkerPresence(store, now)).toMatchObject([{ id: 'worker-1:12:abcd', halted: true, active: false }])
    await writeWorkerPresence(store, 'worker-1:12:abcd', { ...info, halted: false }, now)
    expect(await readWorkerPresence(store, now)).toMatchObject([{ halted: false, active: true }])
    // Valeur écrite par un autre processus : seul `true` arrête.
    store.settings[0]!.value = { ...info, halted: 'yes' }
    expect(await readWorkerPresence(store, now)).toMatchObject([{ halted: false, active: true }])
    await removeWorkerPresence(store, 'worker-1:12:abcd')
    expect(await readWorkerPresence(store, now)).toEqual([])
  })

  it('tâches par statut', async () => {
    await queued()
    await queued()
    await claimNextJob(store, 'worker-a', now, writeState)
    expect(await countJobs(store)).toEqual({ queued: 1, running: 1, done: 0, failed: 0, cancelled: 0 })
  })
})

// ─── Boucle d'exécution ──────────────────────────────────────────────────────

/** Promesse contrôlée de l'extérieur. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const tick = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

/** Attentes de la boucle, relâchées par le test (ou par un réveil). */
function controlledSleep() {
  const pending: Array<{ ms: number, release: () => void }> = []
  const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
    const entry = { ms, release: resolve }
    pending.push(entry)
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
  return { pending, sleep, wakeAll: () => pending.splice(0).forEach(entry => entry.release()) }
}

describe('boucle d\'exécution des tâches', () => {
  afterEach(() => registerJobRunner(null))

  it('au plus `concurrency` tâches, puis attente ; une place libérée relance la recherche', async () => {
    const queue = ['a', 'b', 'c']
    const gates = new Map(queue.map(id => [id, deferred()]))
    const started: string[] = []
    const { pending, sleep } = controlledSleep()
    const runner = createJobRunner<string>({
      concurrency: 2,
      claim: async () => queue.shift() ?? null,
      execute: async (job) => {
        started.push(job)
        await gates.get(job)!.promise
      },
      sleep,
    })
    runner.start()
    await tick()
    expect(started).toEqual(['a', 'b'])
    expect(runner.active).toBe(2)
    expect(pending).toHaveLength(1)

    gates.get('a')!.resolve()
    await tick()
    expect(started).toEqual(['a', 'b', 'c'])
    gates.get('b')!.resolve()
    gates.get('c')!.resolve()
    await tick()
    expect(runner.active).toBe(0)
    await runner.stop()
    expect(runner.state).toBe('stopped')
  })

  it('file vide : une recherche toutes les 5 s ; `notify` (nouvelle tâche) réveille aussitôt', async () => {
    const queue: string[] = []
    let claims = 0
    const done: string[] = []
    const { pending, sleep } = controlledSleep()
    const runner = createJobRunner<string>({
      concurrency: 1,
      claim: async () => {
        claims++
        return queue.shift() ?? null
      },
      execute: async (job) => {
        done.push(job)
      },
      sleep,
    })
    registerJobRunner(runner)
    runner.start()
    await tick()
    expect(claims).toBe(1)
    expect(pending.map(entry => entry.ms)).toEqual([5000])

    queue.push('x')
    notifyJobQueued()
    await tick()
    expect(done).toEqual(['x'])
    await runner.stop()
  })

  it('réveil arrivé pendant une recherche : nouvelle recherche sans attendre', async () => {
    const queue: string[] = []
    const done: string[] = []
    const gate = deferred()
    let first = true
    const { sleep } = controlledSleep()
    const runner = createJobRunner<string>({
      concurrency: 1,
      claim: async () => {
        if (first) {
          first = false
          // La tâche est créée (et le réveil envoyé) pendant cette recherche, qui ne la voit pas.
          queue.push('late')
          runner.notify()
          await gate.promise
          return null
        }
        return queue.shift() ?? null
      },
      execute: async (job) => {
        done.push(job)
      },
      sleep,
    })
    runner.start()
    gate.resolve()
    await tick(10)
    expect(done).toEqual(['late'])
    await runner.stop()
  })

  it('arrêt : tâches en cours interrompues (RunnerStopping) et attendues, plus aucune prise', async () => {
    let claims = 0
    const reasons: unknown[] = []
    const runner = createJobRunner<number>({
      concurrency: 2,
      claim: async () => (++claims <= 2 ? claims : null),
      execute: (_job, signal) => new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          reasons.push(signal.reason)
          // Tâche rendue à la file (asynchrone) avant de rendre la main.
          setTimeout(resolve, 5)
        })
      }),
      sleep: controlledSleep().sleep,
    })
    runner.start()
    await tick()
    expect(runner.active).toBe(2)
    await runner.stop()
    expect(reasons).toHaveLength(2)
    expect(reasons.every(reason => reason instanceof RunnerStopping)).toBe(true)
    expect(runner.active).toBe(0)
    expect(runner.state).toBe('stopped')
    const before = claims
    runner.notify()
    await tick()
    expect(claims).toBe(before)
  })

  it('arrêt borné : une tâche qui ignore l\'interruption ne bloque pas l\'arrêt du serveur', async () => {
    const runner = createJobRunner<number>({
      concurrency: 1,
      claim: async () => 1,
      execute: () => new Promise<void>(() => {}),
      sleep: controlledSleep().sleep,
      stopTimeoutMs: 20,
    })
    runner.start()
    await tick()
    const started = Date.now()
    await runner.stop()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(runner.state).toBe('stopped')
  })

  it('ffmpeg devenu inutilisable (RunnerHalt) : la boucle s\'arrête ; base indisponible : nouvel essai', async () => {
    const errors: unknown[] = []
    let calls = 0
    const { pending, sleep } = controlledSleep()
    const runner = createJobRunner<number>({
      concurrency: 1,
      claim: async () => {
        calls++
        if (calls === 1) throw new Error('base indisponible')
        return calls
      },
      execute: async () => {
        throw new RunnerHalt('ffmpeg introuvable')
      },
      sleep,
      onError: error => errors.push(error),
    })
    runner.start()
    await tick()
    expect(errors).toHaveLength(1)
    expect(pending).toHaveLength(1)
    pending[0]!.release()
    await tick(10)
    expect(errors[1]).toBeInstanceOf(RunnerHalt)
    expect(runner.state).toBe('stopped')
  })

  it('entretien (baux échus) au plus toutes les `maintenanceMs`, horloge injectée', async () => {
    let clock = 0
    let maintenance = 0
    const { pending, sleep } = controlledSleep()
    const runner = createJobRunner<number>({
      concurrency: 1,
      claim: async () => null,
      execute: async () => {},
      sleep,
      now: () => clock,
      maintenance: async () => {
        maintenance++
      },
      maintenanceMs: 30_000,
    })
    runner.start()
    await tick()
    expect(maintenance).toBe(1)
    clock = 10_000
    pending.shift()!.release()
    await tick()
    expect(maintenance).toBe(1)
    clock = 30_000
    pending.shift()!.release()
    await tick()
    expect(maintenance).toBe(2)
    await runner.stop()
  })

  it('arrêt pendant une prise : la tâche prise ensuite est lancée déjà arrêtée, et l\'arrêt l\'attend', async () => {
    const claim = deferred()
    let claimed: number | null = 42
    const signals: AbortSignal[] = []
    const finished = deferred()
    const runner = createJobRunner<number>({
      concurrency: 1,
      claim: async () => {
        await claim.promise
        const job = claimed
        claimed = null
        return job
      },
      execute: async (_job, signal) => {
        signals.push(signal)
        // Le pipeline rend la tâche à la file (écriture en base) avant de se terminer.
        await finished.promise
      },
    })
    runner.start()
    await tick()
    let stopped = false
    const stopping = runner.stop().then(() => {
      stopped = true
    })
    claim.resolve()
    await tick(10)
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(true)
    expect(signals[0]!.reason).toBeInstanceOf(RunnerStopping)
    expect(stopped).toBe(false)
    finished.resolve()
    await stopping
    expect(runner.state).toBe('stopped')
    expect(runner.active).toBe(0)
  })

  it('arrêt avant le démarrage : résout aussitôt', async () => {
    const runner = createJobRunner<number>({ concurrency: 1, claim: async () => null, execute: async () => {} })
    await runner.stop()
    expect(runner.state).toBe('stopped')
    runner.start()
    expect(runner.state).toBe('stopped')
  })
})

// ─── Superviseur : démarrage, nouvel essai, reprise ─────────────────────────

/** Minuteries manuelles du superviseur. */
function manualTimers() {
  const timers: Array<{ task: () => void, ms: number, cleared: boolean }> = []
  return {
    timers,
    setTimer: (task: () => void, ms: number) => {
      const timer = { task, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer: unknown) => {
      (timer as { cleared: boolean }).cleared = true
    },
    /** Exécute la dernière minuterie programmée (non annulée). */
    fire: () => {
      const timer = timers.filter(entry => !entry.cleared).pop()
      if (!timer) throw new Error('aucune minuterie')
      timer.cleared = true
      timer.task()
    },
  }
}

/** Boucle factice : démarrée, arrêtée, et le rappel d'arrêt (RunnerHalt) qu'elle a reçu. */
function fakeRunner(onHalt: (error: RunnerHalt) => void) {
  let state: JobRunner['state'] = 'idle'
  const runner: JobRunner & { halt: () => void } = {
    start: () => {
      state = 'running'
    },
    stop: async () => {
      state = 'stopped'
    },
    notify: () => {},
    get state() {
      return state
    },
    get active() {
      return 0
    },
    halt: () => {
      state = 'stopped'
      onHalt(new RunnerHalt('ffmpeg introuvable'))
    },
  }
  return runner
}

describe('superviseur de la boucle', () => {
  it('ffmpeg utilisable : préparation puis boucle ; états publiés', async () => {
    const states: SupervisorState[] = []
    const runners: ReturnType<typeof fakeRunner>[] = []
    const supervisor = superviseJobRunner({
      detect: async () => true,
      prepare: async () => true,
      createRunner: (onHalt) => {
        const runner = fakeRunner(onHalt)
        runners.push(runner)
        return runner
      },
      onState: state => states.push(state),
    })
    supervisor.start()
    await tick()
    expect(states).toEqual(['starting', 'running'])
    expect(runners[0]!.state).toBe('running')
    await supervisor.stop()
    expect(states.at(-1)).toBe('stopped')
    expect(runners[0]!.state).toBe('stopped')
  })

  it('ffmpeg inutilisable au démarrage : désactivé, aucune boucle', async () => {
    const states: SupervisorState[] = []
    let created = 0
    const supervisor = superviseJobRunner({
      detect: async () => false,
      prepare: async () => true,
      createRunner: (onHalt) => {
        created++
        return fakeRunner(onHalt)
      },
      onState: state => states.push(state),
    })
    supervisor.start()
    await tick()
    expect(states).toEqual(['starting', 'disabled'])
    expect(created).toBe(0)
    await supervisor.stop()
  })

  it('base indisponible au démarrage : nouvel essai, délai doublé, puis boucle', async () => {
    const timers = manualTimers()
    const errors: unknown[] = []
    let prepares = 0
    const states: SupervisorState[] = []
    const supervisor = superviseJobRunner({
      detect: async () => true,
      prepare: async () => {
        prepares++
        if (prepares <= 2) throw new Error('database is locked')
        return true
      },
      createRunner: onHalt => fakeRunner(onHalt),
      onState: state => states.push(state),
      onError: error => errors.push(error),
      retryMs: 1000,
      retryMaxMs: 5000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    supervisor.start()
    await tick()
    expect(errors).toHaveLength(1)
    expect(timers.timers.map(timer => timer.ms)).toEqual([1000])
    timers.fire()
    await tick()
    expect(timers.timers.map(timer => timer.ms)).toEqual([1000, 2000])
    timers.fire()
    await tick()
    expect(prepares).toBe(3)
    expect(states.at(-1)).toBe('running')
    await supervisor.stop()
  })

  it('RunnerHalt : arrêté, détection refaite, boucle relancée quand ffmpeg revient', async () => {
    const timers = manualTimers()
    const states: SupervisorState[] = []
    const runners: ReturnType<typeof fakeRunner>[] = []
    const detections: boolean[] = []
    let usable = true
    const supervisor = superviseJobRunner({
      detect: async (recovering) => {
        detections.push(recovering)
        return usable
      },
      prepare: async () => true,
      createRunner: (onHalt) => {
        const runner = fakeRunner(onHalt)
        runners.push(runner)
        return runner
      },
      onState: state => states.push(state),
      recoveryMs: 60_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    supervisor.start()
    await tick()
    usable = false
    runners[0]!.halt()
    expect(supervisor.state).toBe('halted')
    expect(timers.timers.at(-1)!.ms).toBe(60_000)
    // Toujours absent : nouvelle détection plus tard, aucune boucle.
    timers.fire()
    await tick()
    expect(runners).toHaveLength(1)
    expect(supervisor.state).toBe('halted')
    usable = true
    timers.fire()
    await tick()
    expect(detections).toEqual([false, true, true])
    expect(runners).toHaveLength(2)
    expect(runners[1]!.state).toBe('running')
    expect(states).toEqual(['starting', 'running', 'halted', 'running'])
    // Un arrêt de l'ancienne boucle (rappel tardif) ne touche pas la nouvelle.
    runners[0]!.halt()
    expect(supervisor.state).toBe('running')
    await supervisor.stop()
    expect(timers.timers.every(timer => timer.cleared)).toBe(true)
  })

  it('arrêt pendant un nouvel essai programmé : minuterie annulée, plus rien ne démarre', async () => {
    const timers = manualTimers()
    let created = 0
    const supervisor = superviseJobRunner({
      detect: async () => true,
      prepare: async () => {
        throw new Error('base indisponible')
      },
      createRunner: (onHalt) => {
        created++
        return fakeRunner(onHalt)
      },
      onError: () => {},
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    supervisor.start()
    await tick()
    await supervisor.stop()
    expect(timers.timers.every(timer => timer.cleared)).toBe(true)
    expect(supervisor.state).toBe('stopped')
    expect(created).toBe(0)
  })
})

// ─── Pipeline : classement des échecs, tolérances ────────────────────────────

describe('identité des processus', () => {
  it('hôte et pid relus depuis l\'identifiant ; formes inattendues refusées', () => {
    expect(parseWorkerId(workerIdentity('vm-1', 4242, 'a1b2c3d4'))).toEqual({ host: 'vm-1', pid: 4242 })
    expect(parseWorkerId('host:0:ab')).toBeNull()
    expect(parseWorkerId('host:12')).toBeNull()
    expect(parseWorkerId('host:12:zz')).toBeNull()
    expect(parseWorkerId('')).toBeNull()
  })
})

describe('pipeline : suite donnée aux erreurs', async () => {
  const { classifyFailure, durationTolerance } = await import('../server/lib/video-processing/pipeline')
  const { VideoToolError } = await import('../server/lib/video-processing/run')
  const { VideoProbeError } = await import('../server/lib/media/video/probe')

  it('erreurs d\'outil : délai passager, fichier illisible définitif', () => {
    expect(classifyFailure(new VideoToolError('TIMEOUT', 'Délai'))).toEqual({ code: 'TIMEOUT', detail: 'Délai', retryable: true })
    expect(classifyFailure(new VideoToolError('UNREADABLE', 'illisible'))).toMatchObject({ code: 'UNREADABLE', retryable: false })
    expect(classifyFailure(new VideoProbeError('unreadable', 'bad box'))).toMatchObject({ code: 'CONVERSION_FAILED', retryable: false })
  })

  it('refus du service : conflit et file pleine passagers, sortie refusée définitive', () => {
    expect(classifyFailure({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })).toMatchObject({ code: 'CONVERSION_FAILED', retryable: true })
    expect(classifyFailure({ statusCode: 503, data: { code: 'SERVER_BUSY' } })).toMatchObject({ retryable: true })
    expect(classifyFailure({ statusCode: 415, data: { code: 'UNSUPPORTED_TYPE' } })).toMatchObject({ retryable: false })
  })

  it('erreur interne (stockage, base) : passagère, résumé fixe sans aucun morceau de chemin', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const failure = classifyFailure(new Error('ENOENT: no such file or directory, open \'/srv/media/originals/2026/10/abc.mp4\''))
      expect(failure.retryable).toBe(true)
      expect(failure.detail).not.toContain('/srv/media')
      expect(failure.detail.length).toBeLessThanOrEqual(191)
      // Chemins avec espaces (nom d'utilisateur Windows, dossier « surge media ») : rien ne passe.
      const windows = Object.assign(new Error('EACCES: permission denied, mkdtemp \'C:\\Users\\Jean Dupont\\AppData\\Local\\Temp\\surge-media-job-x\''), { code: 'EACCES' })
      expect(classifyFailure(windows)).toEqual({ code: 'CONVERSION_FAILED', detail: 'Erreur interne (EACCES) : nouvel essai prévu.', retryable: true })
      const spaced = Object.assign(new Error('ENOSPC: no space left on device, open \'/srv/surge media/storage/a.mp4\''), { code: 'ENOSPC' })
      expect(classifyFailure(spaced).detail).not.toMatch(/Dupont|media|storage/)
      // Code inattendu (texte libre) : jamais recopié.
      expect(classifyFailure(Object.assign(new Error('x'), { code: 'see /etc/passwd' })).detail).toBe('Erreur interne : nouvel essai prévu.')
      // Le message complet reste dans le journal du serveur.
      expect(errorLog).toHaveBeenCalled()
    }
    finally {
      errorLog.mockRestore()
    }
  })

  it('dossiers temporaires : préfixe propre à l\'installation (même base, même dossier de lancement)', async () => {
    const { jobDirPrefix, JOB_DIR_PREFIX } = await import('../server/lib/video-processing/pipeline')
    expect(jobDirPrefix()).toMatch(new RegExp(`^${JOB_DIR_PREFIX}[0-9a-f]{8}-$`))
    expect(jobDirPrefix()).toBe(jobDirPrefix())
  })

  it('tolérance de durée : 0,5 s ou 2 %, élargie pour une durée estimée', () => {
    expect(durationTolerance(10, false)).toBe(0.5)
    expect(durationTolerance(600, false)).toBe(12)
    expect(durationTolerance(10, true)).toBe(2)
    expect(durationTolerance(600, true)).toBe(60)
  })
})

// ─── Réception par l'API : types de l'installation ───────────────────────────

describe('envois par l\'API v1 : types acceptés en ce moment', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({ media: { maxUploadSize: 1000, maxVideoUploadSize: 5000 } }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function acceptedFor(active: boolean, types?: string[]): Promise<readonly string[]> {
    uploadMocks.active = active
    const { withApiUpload } = await import('../server/lib/api/writes')
    const principal = { delegated: types ? { upload: { types } } : null } as unknown as Parameters<typeof withApiUpload>[1]
    let accepted: readonly string[] | undefined
    await withApiUpload({} as never, principal, async (_upload, options) => {
      accepted = options.acceptedTypes
    })
    return accepted!
  }

  it('formats convertis seulement quand le traitement est actif ; restriction d\'un jeton appliquée à la liste du moment', async () => {
    expect(await acceptedFor(false)).not.toContain('video/x-matroska')
    expect(await acceptedFor(true)).toContain('video/x-matroska')
    expect(await acceptedFor(true, ['video/x-matroska', 'image/png'])).toEqual(['image/png', 'video/x-matroska'])
    expect(await acceptedFor(false, ['video/x-matroska', 'image/png'])).toEqual(['image/png'])
  })
})
