import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media, MediaJob, MediaRendition } from '../server/generated/prisma/client'
import { checkSignature } from '../server/lib/media/signing'
import { PROCESSING_INCLUDE } from '../server/lib/media/sources'
import { processingDetail } from '../server/lib/video-processing/jobs'

/**
 * Routes du module E (phase D3, architecture § 35) appelées directement, fonctions globales de Nitro
 * remplacées, base remplacée par un faux client : revalidation des listes v1 pendant un traitement (ETag
 * en deux temps), « Relancer » (`requestProcessing` et ses erreurs), traitement des vidéos existantes
 * (droits, journal, interruption en route), interrogation légère de la fiche, sources des liens de
 * l'administration. Les représentations elles-mêmes sont testées dans video-admin.test.ts et
 * api-video.test.ts.
 */

const mocks = vi.hoisted(() => ({ active: true, revision: 7 }))
vi.mock('../server/lib/storage', () => ({ useMediaStorage: vi.fn() }))
vi.mock('../server/lib/video-processing/status', () => ({ videoProcessingActive: vi.fn(async () => mocks.active) }))
vi.mock('../server/lib/video-processing/runner', () => ({ notifyJobQueued: vi.fn() }))
vi.mock('../server/lib/cache/revisions', () => ({ getRevision: vi.fn(async () => mocks.revision), bumpRevision: vi.fn(async () => {}) }))
vi.mock('../server/lib/media/cache', async importOriginal => ({ ...await importOriginal<object>(), mediaChanged: vi.fn(async () => {}) }))
vi.mock('../server/lib/transforms/service', () => ({ spaceTransformOptions: vi.fn(async () => null) }))
vi.mock('../server/lib/api/queries', () => ({ listApiMedia: vi.fn() }))
vi.mock('../server/lib/api/context', () => ({
  defineApiHandler: (handler: (event: H3Event, principal: unknown) => unknown) => (event: H3Event) => handler(event, { type: 'secret' }),
  requireApiProject: vi.fn(async () => ({ project: { id: 'p1', publicListing: true }, publicOnly: false })),
  parseApiQuery: vi.fn(() => ({ sort: 'newest', limit: 20 })),
}))

const { mediaChanged } = await import('../server/lib/media/cache')
const { notifyJobQueued } = await import('../server/lib/video-processing/runner')
const { listApiMedia } = await import('../server/lib/api/queries')

/** Erreur HTTP comme celle de h3 (statut, code dans `data`), sans dépendre du paquet à l'exécution. */
function createError(input: { statusCode: number, statusMessage: string, data?: unknown }): Error {
  return Object.assign(new Error(input.statusMessage), input)
}

const SECRET = 'secret-de-test'
const BASE = 'https://media.example.com'
const NOW = new Date('2026-10-08T12:00:00Z')
const id = 'cmvideo0001'

/** Requête simulée : en-têtes, paramètres, corps ; la réponse (statut, en-têtes) est notée à côté. */
interface FakeEvent {
  headers: Record<string, string>
  params: Record<string, string>
  body?: unknown
  response: { status: number, headers: Record<string, string> }
}

function fakeEvent(fields: Partial<Omit<FakeEvent, 'response'>> = {}): FakeEvent {
  return { headers: {}, params: { id }, ...fields, response: { status: 200, headers: {} } }
}

let audit: ReturnType<typeof vi.fn>
let requireAuth: ReturnType<typeof vi.fn>
let requireMediaAccess: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mocks.active = true
  mocks.revision = 7
  audit = vi.fn(async () => {})
  requireAuth = vi.fn(async () => ({ id: 'admin', role: 'ADMIN' }))
  requireMediaAccess = vi.fn(async (_event: H3Event, find: () => Promise<unknown>) => {
    const media = await find()
    if (!media) throw createError({ statusCode: 404, statusMessage: 'Media not found' })
    return { media, access: { project: null, projectRole: null, scopes: ['media:read', 'media:write'] } }
  })
  vi.stubGlobal('useRuntimeConfig', () => ({ siteUrl: '', media: { publicUrl: BASE, signingSecret: SECRET, previousSigningSecret: '' }, session: {} }))
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('defineRouteMeta', () => {})
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('spaceOfMedia', (media: Pick<Media, 'projectId'>) => (media.projectId ? { type: 'project', id: media.projectId } : { type: 'library' }))
  vi.stubGlobal('describeAccess', () => ({ space: { type: 'library', project: null }, projectRole: null, scopes: [] }))
  vi.stubGlobal('requireAuth', requireAuth)
  vi.stubGlobal('requireMediaAccess', requireMediaAccess)
  vi.stubGlobal('sessionTagViewer', async () => ({ confidential: true }))
  vi.stubGlobal('recordAudit', audit)
  vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => event.params[name])
  vi.stubGlobal('getRequestHeader', (event: FakeEvent, name: string) => event.headers[name])
  vi.stubGlobal('readValidatedBody', async (event: FakeEvent, parse: (body: unknown) => unknown) => parse(event.body))
  vi.stubGlobal('setResponseStatus', (event: FakeEvent, status: number) => { event.response.status = status })
  vi.stubGlobal('setResponseHeader', (event: FakeEvent, name: string, value: string) => { event.response.headers[name] = value })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** Appelle une route (gestionnaire par défaut du module) avec une requête simulée. */
async function call(load: () => Promise<{ default: unknown }>, event: FakeEvent): Promise<unknown> {
  const handler = (await load()).default as (event: FakeEvent) => Promise<unknown>
  return handler(event)
}

// ─── Données ─────────────────────────────────────────────────────────────────

function job(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    id: 'job-1', mediaId: id, sourceKey: 'originals/ab/cd.mp4', status: 'RUNNING', priority: 0, attempts: 0, runAfter: NOW, lockedBy: 'w', leaseUntil: null,
    step: 'transcode', progress: 0.2, result: null, errorCode: null, errorDetail: null, createdAt: NOW, updatedAt: NOW, startedAt: NOW, finishedAt: null,
    ...overrides,
  }
}

function rendition(): MediaRendition {
  return {
    id: 'r-h264', mediaId: id, name: 'h264', container: 'mp4', mimeType: 'video/mp4', codecs: 'avc1.640028,mp4a.40.2', width: 1920, height: 1080,
    duration: 12.48, bitrate: 5_100_000, size: 7_968_750, checksum: 'c'.repeat(64), storageKey: `variants/${id}/rendition-h264-Qx7Kp.mp4`, createdAt: NOW,
  }
}

/** Vidéo complète (MEDIA_INCLUDE / API_MEDIA_INCLUDE) : HEVC 4K, sans affiche. */
function video(overrides: Partial<Media> = {}, relations: { renditions?: MediaRendition[], jobs?: MediaJob[] } = {}) {
  return {
    id, projectId: 'p1', folderId: null, kind: 'VIDEO', visibility: 'PUBLIC', storageKey: 'originals/ab/cd.mp4', version: 3, originalName: 'Clip.mp4',
    mimeType: 'video/mp4', size: 40_000_000, checksum: 'a'.repeat(64), width: 3840, height: 2160, duration: 12.5, title: null, altText: null,
    searchTitle: null, searchName: 'clip.mp4', searchAlt: null, focalX: null, focalY: null,
    metadata: { container: 'mp4', videoCodec: 'hvc1', audioCodec: 'mp4a', codecs: 'hvc1.2.4.L153.B0,mp4a.40.2', bitrate: 25_000_000, playback: 'variable', dataTracks: [] },
    posterKey: null, posterWidth: null, posterHeight: null, posterSize: null, posterTime: null, processingState: 'READY',
    uploadedById: null, uploadedByTokenId: null, uploadSubject: null, duplicatedFromId: null,
    createdAt: NOW, updatedAt: NOW, deletedAt: null,
    uploadedBy: null, uploadedByToken: null, textTracks: [], renditions: [], jobs: [],
    ...overrides,
    ...relations,
  } as Media & { renditions: MediaRendition[], jobs: MediaJob[], textTracks: [] }
}

/** Faux client Prisma : transaction directe, écritures notées. */
function fakePrisma(record: ReturnType<typeof video> | null = video()) {
  const tx = {
    media: { updateMany: vi.fn(async (_args: unknown) => ({ count: 1 })) },
    mediaJob: {
      updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job-new', ...data })),
    },
  }
  const prisma = {
    tx,
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    media: { ...tx.media, findUnique: vi.fn(async (_args: unknown) => record), findMany: vi.fn(async (_args: unknown) => [] as unknown[]) },
    mediaJob: tx.mediaJob,
  }
  vi.stubGlobal('usePrisma', async () => prisma)
  return prisma
}

// ─── API v1 : liste et traitement ────────────────────────────────────────────

describe('GET /api/v1/projects/:projectId/media : revalidation pendant un traitement', () => {
  const listRoute = () => import('../server/api/v1/projects/[projectId]/media/index.get')
  const page = (...items: ReturnType<typeof video>[]) => vi.mocked(listApiMedia).mockResolvedValue({ items, nextCursor: null } as never)

  it('aucun traitement en cours : 304 sur la révision seule, sans relire la page ; nouvelle révision → 200', async () => {
    page(video())
    const first = fakeEvent()
    const body = await call(listRoute, first) as { items: Array<{ processing: unknown }> }
    expect(first.response.status).toBe(200)
    expect(body.items[0]!.processing).toMatchObject({ status: 'ready' })
    const etag = first.response.headers.ETag!

    const again = fakeEvent({ headers: { 'if-none-match': etag } })
    expect(await call(listRoute, again)).toBeNull()
    expect(again.response).toMatchObject({ status: 304, headers: { ETag: etag } })
    expect(listApiMedia).toHaveBeenCalledTimes(1)

    mocks.revision = 8
    const changed = fakeEvent({ headers: { 'if-none-match': etag } })
    await call(listRoute, changed)
    expect(changed.response.status).toBe(200)
    expect(changed.response.headers.ETag).not.toBe(etag)
  })

  it('traitement en cours : ETag propre à la page, relue à chaque revalidation ; 304 tant que la tâche n\'a pas bougé, 200 à l\'avancement', async () => {
    page(video({ processingState: 'PROCESSING' }, { jobs: [job()] }))
    const first = fakeEvent()
    await call(listRoute, first)
    const etag = first.response.headers.ETag!

    const again = fakeEvent({ headers: { 'if-none-match': etag } })
    expect(await call(listRoute, again)).toBeNull()
    expect(again.response).toMatchObject({ status: 304, headers: { ETag: etag } })
    expect(listApiMedia).toHaveBeenCalledTimes(2)

    // Avancement écrit sur la tâche seule : ni révision, ni `Media.updatedAt`.
    page(video({ processingState: 'PROCESSING' }, { jobs: [job({ progress: 0.6, updatedAt: new Date(NOW.getTime() + 5_000) })] }))
    const progressed = fakeEvent({ headers: { 'if-none-match': etag } })
    const body = await call(listRoute, progressed) as { items: Array<{ processing: unknown }> }
    expect(progressed.response.status).toBe(200)
    expect(progressed.response.headers.ETag).not.toBe(etag)
    expect(body.items[0]!.processing).toMatchObject({ status: 'processing', progress: 0.6 })
  })

  it('même révision : l\'ETag d\'une page en cours de traitement n\'est jamais celui de la révision seule (pas de 304 sans relecture)', async () => {
    page(video())
    const idle = fakeEvent()
    await call(listRoute, idle)
    page(video({ processingState: 'PENDING' }, { jobs: [job({ status: 'QUEUED', step: null, progress: null })] }))
    const pending = fakeEvent()
    await call(listRoute, pending)
    expect(pending.response.headers.ETag).not.toBe(idle.response.headers.ETag)
  })
})

// ─── Administration : relance ────────────────────────────────────────────────

describe('POST /api/admin/media/:id/process (requestProcessing)', () => {
  const processRoute = () => import('../server/api/admin/media/[id]/process.post')

  it('portée media:write ; état « en attente » conditionné au fichier, tâche active annulée puis nouvelle tâche, annoncée', async () => {
    const prisma = fakePrisma(video({ processingState: 'FAILED' }, { jobs: [job({ status: 'FAILED', errorCode: 'TIMEOUT', finishedAt: NOW })] }))
    const event = fakeEvent()
    await call(processRoute, event)
    expect(requireMediaAccess).toHaveBeenCalledWith(event, expect.any(Function), 'media:write')
    expect(prisma.tx.media.updateMany).toHaveBeenCalledWith({ where: { id, storageKey: 'originals/ab/cd.mp4', deletedAt: null }, data: { processingState: 'PENDING' } })
    expect(prisma.tx.mediaJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }))
    expect(prisma.tx.mediaJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ mediaId: id, sourceKey: 'originals/ab/cd.mp4', priority: 0 }) })
    expect(mediaChanged).toHaveBeenCalledWith([id], { type: 'project', id: 'p1' })
    expect(notifyJobQueued).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['image', { kind: 'IMAGE', mimeType: 'image/jpeg' }, true, { statusCode: 422, data: { code: 'KIND_MISMATCH' } }],
    ['corbeille', { deletedAt: NOW }, true, { statusCode: 409, data: { code: 'IN_TRASH' } }],
    ['traitement inactif', {}, false, { statusCode: 409, data: { code: 'PROCESSING_DISABLED' } }],
  ] as const)('%s : refusé avant toute écriture', async (_label, fields, active, error) => {
    mocks.active = active
    const prisma = fakePrisma(video(fields as Partial<Media>))
    await expect(call(processRoute, fakeEvent())).rejects.toMatchObject(error)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(notifyJobQueued).not.toHaveBeenCalled()
  })

  it('fichier remplacé entre-temps : 409 VERSION_CONFLICT, aucune tâche créée ni annoncée', async () => {
    const prisma = fakePrisma()
    prisma.tx.media.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(call(processRoute, fakeEvent())).rejects.toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
    expect(prisma.tx.mediaJob.create).not.toHaveBeenCalled()
    expect(mediaChanged).not.toHaveBeenCalled()
    expect(notifyJobQueued).not.toHaveBeenCalled()
  })
})

// ─── Administration : vidéos existantes ──────────────────────────────────────

describe('POST /api/admin/video-processing/backfill', () => {
  const backfillRoute = () => import('../server/api/admin/video-processing/backfill.post')

  /** Vidéos jamais traitées lues par le service ; les relectures d'espace (processingChanged) renvoient p1. */
  function candidates(prisma: ReturnType<typeof fakePrisma>, ids: string[]): void {
    prisma.media.findMany.mockImplementation(async (args: unknown) => {
      const { select, where } = args as { select: Record<string, boolean>, where: { id?: { in?: string[] } } }
      if (select.projectId) return (where.id?.in ?? []).map(() => ({ projectId: 'p1' }))
      return ids.map(mediaId => ({ id: mediaId, storageKey: `originals/${mediaId}.mp4`, metadata: null }))
    })
  }

  it('réservé à `settings:manage` : refusé avant toute lecture', async () => {
    const prisma = fakePrisma()
    requireAuth.mockRejectedValueOnce(createError({ statusCode: 403, statusMessage: 'Forbidden' }))
    const event = fakeEvent()
    await expect(call(backfillRoute, event)).rejects.toMatchObject({ statusCode: 403 })
    expect(requireAuth).toHaveBeenCalledWith(event, 'settings:manage')
    expect(prisma.media.findMany).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('rien à traiter : { count: 0 }, ni journal ni annonce', async () => {
    fakePrisma()
    expect(await call(backfillRoute, fakeEvent())).toEqual({ count: 0 })
    expect(audit).not.toHaveBeenCalled()
    expect(notifyJobQueued).not.toHaveBeenCalled()
  })

  it('tâches créées (une vidéo prise entre-temps ignorée) : journal avec leur nombre, annonce', async () => {
    const prisma = fakePrisma()
    candidates(prisma, ['v1', 'v2'])
    prisma.tx.media.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const event = fakeEvent()
    expect(await call(backfillRoute, event)).toEqual({ count: 1 })
    expect(prisma.tx.mediaJob.create).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(event, { action: 'media.processing_backfill', data: { count: 1 } })
    expect(mediaChanged).toHaveBeenCalledWith(['v1'], { type: 'project', id: 'p1' })
    expect(notifyJobQueued).toHaveBeenCalledTimes(1)
  })

  it('erreur en route : l\'erreur remonte, les tâches déjà créées sont journalisées (`partial`) et annoncées', async () => {
    const prisma = fakePrisma()
    candidates(prisma, ['v1', 'v2', 'v3'])
    const lost = new Error('base injoignable')
    prisma.$transaction
      .mockImplementationOnce(async fn => fn(prisma.tx))
      .mockImplementationOnce(async fn => fn(prisma.tx))
      .mockRejectedValueOnce(lost)
    const event = fakeEvent()
    await expect(call(backfillRoute, event)).rejects.toBe(lost)
    expect(audit).toHaveBeenCalledWith(event, { action: 'media.processing_backfill', data: { count: 2, partial: true } })
    expect(mediaChanged).toHaveBeenCalledWith(['v1', 'v2'], { type: 'project', id: 'p1' }, { type: 'project', id: 'p1' })
    expect(notifyJobQueued).toHaveBeenCalledTimes(1)
  })

  it('traitement inactif : 409 PROCESSING_DISABLED, sans journal', async () => {
    mocks.active = false
    fakePrisma()
    await expect(call(backfillRoute, fakeEvent())).rejects.toMatchObject({ statusCode: 409, data: { code: 'PROCESSING_DISABLED' } })
    expect(audit).not.toHaveBeenCalled()
  })
})

// ─── Administration : interrogation légère, liens ────────────────────────────

describe('GET /api/admin/media/:id/processing', () => {
  const pollRoute = () => import('../server/api/admin/media/[id]/processing.get')

  it('portée media:read, jamais en cache, dernière tâche (PROCESSING_INCLUDE) sans rendus ni pistes', async () => {
    const running = job()
    const prisma = fakePrisma(video({ processingState: 'PROCESSING' }, { jobs: [running] }))
    const event = fakeEvent()
    expect(await call(pollRoute, event)).toEqual({ version: 3, processingState: 'PROCESSING', processing: processingDetail(running) })
    expect(event.response.headers['Cache-Control']).toBe('no-store')
    expect(requireMediaAccess).toHaveBeenCalledWith(event, expect.any(Function), 'media:read')
    expect(prisma.media.findUnique).toHaveBeenCalledWith({ where: { id }, select: { projectId: true, version: true, processingState: true, jobs: PROCESSING_INCLUDE.jobs } })
  })

  it('état null (fichier remplacé, traitement inactif) : pas de traitement, même avec la tâche terminée de l\'ancien fichier', async () => {
    fakePrisma(video({ processingState: null }, { jobs: [job({ status: 'FAILED', errorCode: 'TIMEOUT', finishedAt: NOW })] }))
    expect(await call(pollRoute, fakeEvent())).toMatchObject({ processingState: null, processing: null })
  })
})

describe('liens de l\'administration : sources d\'une vidéo', () => {
  it('POST …/signed-url, vidéo privée : `sources` signées comme l\'original, à la même échéance', async () => {
    fakePrisma(video({ visibility: 'PRIVATE' }, { renditions: [rendition()] }))
    const body = await call(() => import('../server/api/admin/media/[id]/signed-url.post'), fakeEvent({ body: { expiresIn: 3600 } })) as {
      url: string
      sources: Array<{ url: string, rendition: string | null }>
    }
    const original = new URL(body.url)
    expect(body.sources).toEqual([expect.objectContaining({ rendition: 'h264', url: `${BASE}/m/${id}/v3/renditions/h264.mp4${original.search}` })])
    const query = Object.fromEntries(new URL(body.sources[0]!.url).searchParams)
    expect(query.exp).toBe(String(Math.floor(NOW.getTime() / 1000) + 3600))
    expect(checkSignature([SECRET], { mediaId: id, version: 3, variant: 'original' }, query, Math.floor(NOW.getTime() / 1000))).toMatchObject({ status: 'valid' })
  })

  it('GET /api/admin/media/:id : `publicSources` absolues et permanentes pour une vidéo publique, vides sinon', async () => {
    const detailRoute = () => import('../server/api/admin/media/[id].get')
    fakePrisma(video({}, { renditions: [rendition()] }))
    const pub = await call(detailRoute, fakeEvent()) as { publicSources: Array<{ url: string, rendition: string | null }> }
    expect(pub.publicSources).toEqual([expect.objectContaining({ rendition: 'h264', url: `${BASE}/m/${id}/v3/renditions/h264.mp4` })])
    fakePrisma(video({ visibility: 'PRIVATE' }, { renditions: [rendition()] }))
    expect(await call(detailRoute, fakeEvent())).toMatchObject({ publicSources: [] })
  })
})
