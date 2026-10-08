import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Media, MediaJob, MediaRendition } from '../server/generated/prisma/client'
import { type MediaListRecord, type MediaWithUploader, toMediaDetail, toMediaSummary } from '../server/lib/media/service'
import { checkSignature, keyId } from '../server/lib/media/signing'
import { processingDetail } from '../server/lib/video-processing/jobs'

/**
 * Contrats d'administration de la phase D3 (architecture § 35) : représentation des médias (état,
 * dernière tâche, rendus, sources et leurs liens), sonde de santé et état du traitement (« Réglages »).
 * Les routes sont appelées directement, fonctions globales de Nitro remplacées.
 */

const SECRET = 'secret-de-test'
const id = 'cmvideo0001'

vi.mock('../server/lib/storage', () => ({ useMediaStorage: async () => ({ healthcheck: async () => {} }) }))
vi.mock('../server/lib/video-processing/ffmpeg', () => ({
  useFfmpegCapabilities: async () => ({ ok: true, version: '7.1', major: 7, encoders: ['libx264', 'aac'], hdrFilters: true, av1: false, problems: [] }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

function stubSigning(): void {
  vi.stubGlobal('useRuntimeConfig', () => ({ media: { signingSecret: SECRET, previousSigningSecret: '' }, session: {} }))
}

function media(overrides: Partial<Media> = {}): Media {
  return {
    id,
    projectId: null,
    folderId: null,
    kind: 'VIDEO',
    visibility: 'PUBLIC',
    storageKey: 'originals/ab/cd.mp4',
    version: 3,
    originalName: 'Clip été.mp4',
    mimeType: 'video/mp4',
    size: 40_000_000,
    checksum: 'a'.repeat(64),
    width: 3840,
    height: 2160,
    duration: 12.5,
    title: null,
    altText: null,
    searchTitle: null,
    searchName: 'clip ete.mp4',
    searchAlt: null,
    metadata: { container: 'mp4', videoCodec: 'hvc1', audioCodec: 'mp4a', codecs: 'hvc1.2.4.L153.B0,mp4a.40.2', bitrate: 25_000_000, playback: 'variable', dataTracks: [] },
    focalX: null,
    focalY: null,
    posterKey: null,
    posterWidth: null,
    posterHeight: null,
    posterSize: null,
    posterTime: null,
    processingState: 'READY',
    uploadedById: null,
    uploadedByTokenId: null,
    uploadSubject: null,
    duplicatedFromId: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:05:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

function rendition(name: string, overrides: Partial<MediaRendition> = {}): MediaRendition {
  const av1 = name === 'av1'
  return {
    id: `r-${name}`,
    mediaId: id,
    name,
    container: av1 ? 'webm' : 'mp4',
    mimeType: av1 ? 'video/webm' : 'video/mp4',
    codecs: av1 ? 'av01.0.08M.08,opus' : 'avc1.640028,mp4a.40.2',
    width: 1920,
    height: 1080,
    duration: 12.48,
    bitrate: av1 ? 2_400_000 : 5_100_000,
    size: av1 ? 3_750_000 : 7_968_750,
    checksum: 'c'.repeat(64),
    storageKey: `variants/${id}/rendition-${name}-Qx7Kp.${av1 ? 'webm' : 'mp4'}`,
    createdAt: new Date('2026-10-01T10:04:00Z'),
    ...overrides,
  }
}

function job(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    id: 'job-1',
    mediaId: id,
    sourceKey: 'originals/ab/cd.mp4',
    status: 'DONE',
    priority: 0,
    attempts: 1,
    runAfter: new Date('2026-10-01T10:00:00Z'),
    lockedBy: null,
    leaseUntil: null,
    step: null,
    progress: null,
    result: { warnings: ['hdr_converted'], renditions: ['h264'] },
    errorCode: null,
    errorDetail: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:04:30Z'),
    startedAt: new Date('2026-10-01T10:00:01Z'),
    finishedAt: new Date('2026-10-01T10:04:30Z'),
    ...overrides,
  }
}

function listRecord(overrides: Partial<Media> = {}): MediaListRecord {
  return { ...media(overrides), uploadedBy: { id: 'u1', name: 'Ana', email: 'ana@example.test' }, uploadedByToken: null }
}

function detailRecord(overrides: Partial<Media> = {}, relations: Partial<Pick<MediaWithUploader, 'renditions' | 'jobs' | 'textTracks'>> = {}): MediaWithUploader {
  return { ...listRecord(overrides), renditions: [], jobs: [], textTracks: [], ...relations }
}

/** Paramètres signés d'une URL relative de l'administration. */
function signature(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url, 'http://localhost').searchParams)
}

describe('représentation des médias (administration)', () => {
  it('résumé : `processingState`, sans rendus ni tâche lus (requête légère des listes)', () => {
    const summary = toMediaSummary(listRecord({ processingState: 'PROCESSING' }))
    expect(summary.processingState).toBe('PROCESSING')
    expect(summary).not.toHaveProperty('processing')
    expect(summary).not.toHaveProperty('sources')
    expect(toMediaSummary(listRecord({ kind: 'IMAGE', mimeType: 'image/jpeg', processingState: null })).processingState).toBeNull()
  })

  it('fiche d\'une vidéo publique prête : dernière tâche, rendus AV1 puis H.264, sources aux mêmes adresses permanentes', () => {
    const latest = job()
    const detail = toMediaDetail(detailRecord({}, { renditions: [rendition('h264'), rendition('av1')], jobs: [latest] }))
    expect(detail.processingState).toBe('READY')
    expect(detail.processing).toEqual(processingDetail(latest))
    expect(detail.processing?.warnings).toEqual(['hdr_converted'])
    expect(detail.renditions).toEqual([
      {
        name: 'av1',
        container: 'webm',
        mimeType: 'video/webm',
        codecs: 'av01.0.08M.08,opus',
        width: 1920,
        height: 1080,
        duration: 12.48,
        bitrate: 2_400_000,
        size: 3_750_000,
        url: `/m/${id}/v3/renditions/av1.webm`,
      },
      expect.objectContaining({ name: 'h264', url: `/m/${id}/v3/renditions/h264.mp4` }),
    ])
    expect(detail.sources.map(source => [source.rendition, source.url, source.type])).toEqual([
      ['av1', `/m/${id}/v3/renditions/av1.webm`, 'video/webm; codecs="av01.0.08M.08, opus"'],
      ['h264', `/m/${id}/v3/renditions/h264.mp4`, 'video/mp4; codecs="avc1.640028, mp4a.40.2"'],
    ])
    expect(detail.url).toBe(`/m/${id}/v3/clip-ete.mp4`)
  })

  it('vidéo privée : rendus et sources signés « admin » comme l\'original, signature valable pour un rendu', () => {
    stubSigning()
    const detail = toMediaDetail(detailRecord({ visibility: 'PRIVATE' }, { renditions: [rendition('h264')], jobs: [job()] }))
    const original = signature(detail.url)
    expect(original).toMatchObject({ scope: 'admin', kid: keyId(SECRET) })
    expect(detail.renditions[0]!.url).toBe(`/m/${id}/v3/renditions/h264.mp4?${new URL(detail.url, 'http://localhost').search.slice(1)}`)
    expect(detail.sources).toEqual([expect.objectContaining({ rendition: 'h264', url: detail.renditions[0]!.url })])
    const check = checkSignature([SECRET], { mediaId: id, version: 3, variant: 'original' }, signature(detail.sources[0]!.url), Math.floor(Date.now() / 1000))
    expect(check).toMatchObject({ status: 'valid', scope: 'admin' })
  })

  it('vidéo publique retenue (piste GPS en cours de retrait) : original signé « admin », source comprise', () => {
    stubSigning()
    const held = detailRecord(
      { processingState: 'PENDING', metadata: { container: 'mp4', videoCodec: 'avc1', audioCodec: 'mp4a', codecs: 'avc1.640028,mp4a.40.2', playback: 'broad', dataTracks: ['gpmd'] } },
      { jobs: [job({ status: 'QUEUED', attempts: 0, startedAt: null, finishedAt: null, result: null, priority: 10 })] },
    )
    const detail = toMediaDetail(held)
    expect(signature(detail.url).scope).toBe('admin')
    expect(detail.sources).toEqual([expect.objectContaining({ rendition: null, url: detail.url, type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' })])
    expect(detail.processing).toMatchObject({ status: 'QUEUED', attempts: 0, warnings: [] })
  })

  it('format converti en cours de traitement : aucune source ni rendu, étape et avancement de la tâche', () => {
    const detail = toMediaDetail(detailRecord(
      {
        mimeType: 'video/x-matroska',
        width: null,
        height: null,
        duration: null,
        processingState: 'PROCESSING',
        metadata: { container: 'mkv', videoCodec: null, audioCodec: null, codecs: null, playback: 'none', dataTracks: [] },
      },
      { jobs: [job({ status: 'RUNNING', step: 'transcode', progress: 0.42, finishedAt: null, result: null })] },
    ))
    expect(detail.extension).toBe('mkv')
    expect(detail.sources).toEqual([])
    expect(detail.renditions).toEqual([])
    expect(detail.processing).toMatchObject({ status: 'RUNNING', step: 'transcode', progress: 0.42, errorCode: null })
  })

  it('échec : code et détail assaini de la tâche ; code inconnu ignoré ; rendu de nom inconnu ignoré', () => {
    const failed = toMediaDetail(detailRecord(
      { processingState: 'FAILED' },
      { renditions: [rendition('hevc')], jobs: [job({ status: 'FAILED', errorCode: 'TIMEOUT', errorDetail: 'Délai dépassé (transcode).' })] },
    ))
    expect(failed.processing).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT', errorDetail: 'Délai dépassé (transcode).' })
    expect(failed.renditions).toEqual([])
    expect(failed.sources.map(source => source.rendition)).toEqual([null])
    const unknown = toMediaDetail(detailRecord({ processingState: 'FAILED' }, { jobs: [job({ status: 'FAILED', errorCode: 'SEGFAULT' })] }))
    expect(unknown.processing?.errorCode).toBeNull()
  })

  it('état null (fichier remplacé pendant que le traitement est inactif) : pas de traitement, même avec la tâche de l\'ancien fichier', () => {
    const detail = toMediaDetail(detailRecord({ processingState: null }, { jobs: [job({ status: 'FAILED', errorCode: 'TIMEOUT', errorDetail: 'Délai dépassé (transcode).' })] }))
    expect(detail.processingState).toBeNull()
    expect(detail.processing).toBeNull()
  })

  it('image : ni traitement, ni rendus, ni sources', () => {
    const detail = toMediaDetail(detailRecord({ kind: 'IMAGE', mimeType: 'image/jpeg', processingState: null, metadata: null, duration: null }))
    expect(detail.processing).toBeNull()
    expect(detail.renditions).toEqual([])
    expect(detail.sources).toEqual([])
  })
})

// ─── Routes : sonde de santé, état du traitement ─────────────────────────────

/** Présences de processus de travail (`Setting` videoWorker:<id>) : actif, arrêté, ancien. */
function presenceRows(now = Date.now()) {
  return [
    { key: 'videoWorker:box:12:aa', value: { host: 'box', pid: 12, version: '7.1', encoders: ['libx264'], concurrency: 2, halted: false }, updatedAt: new Date(now - 30_000) },
    { key: 'videoWorker:box:13:bb', value: { host: 'box', pid: 13, version: '7.1', encoders: [], concurrency: 1, halted: true }, updatedAt: new Date(now - 30_000) },
    { key: 'videoWorker:old:14:cc', value: { host: 'old', pid: 14, version: '6.0', encoders: [], concurrency: 1 }, updatedAt: new Date(now - 3_600_000) },
  ]
}

interface FakePrisma {
  $queryRaw: () => Promise<unknown>
  mediaJob: { count: ReturnType<typeof vi.fn> }
  setting: { findMany: ReturnType<typeof vi.fn> }
  media: { aggregate: ReturnType<typeof vi.fn> }
}

function fakePrisma(overrides: { database?: boolean, jobs?: () => Promise<number> } = {}): FakePrisma {
  return {
    $queryRaw: async () => {
      if (overrides.database === false) throw new Error('connexion refusée')
      return [{ 1: 1 }]
    },
    mediaJob: { count: vi.fn(overrides.jobs ?? (async ({ where }: { where: { status: string } }) => (where.status === 'QUEUED' ? 4 : 1))) },
    setting: { findMany: vi.fn(async () => presenceRows()) },
    media: { aggregate: vi.fn(async () => ({ _count: { _all: 2 }, _sum: { duration: 90.5 } })) },
  }
}

/** Appelle une route avec les fonctions globales de Nitro remplacées ; réglages relus (modules rechargés). */
async function callRoute(route: 'health' | 'video-processing', config: Record<string, unknown>, prisma: FakePrisma) {
  const response: { status: number, headers: Record<string, string> } = { status: 200, headers: {} }
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('useRuntimeConfig', () => config)
  vi.stubGlobal('usePrisma', async () => prisma)
  vi.stubGlobal('requireAuth', vi.fn(async () => ({ id: 'admin', role: 'ADMIN' })))
  vi.stubGlobal('setResponseStatus', (_event: H3Event, status: number) => { response.status = status })
  vi.stubGlobal('setResponseHeader', (_event: H3Event, name: string, value: string) => { response.headers[name] = value })
  const module = route === 'health' ? await import('../server/api/health.get') : await import('../server/api/admin/video-processing/index.get')
  const handler = module.default as unknown as (event: H3Event) => Promise<Record<string, unknown>>
  const body = await handler({} as H3Event)
  return { ...response, body }
}

describe('GET /api/health : videoProcessing', () => {
  it('mode off : rien n\'est lu, champs null, statut inchangé', async () => {
    const prisma = fakePrisma()
    const { status, body } = await callRoute('health', { video: { processing: 'off' } }, prisma)
    expect(status).toBe(200)
    expect(body.videoProcessing).toEqual({ mode: 'off', workers: null, queued: null })
    expect(body.checks).not.toHaveProperty('videoProcessing')
    expect(prisma.mediaJob.count).not.toHaveBeenCalled()
    expect(prisma.setting.findMany).not.toHaveBeenCalled()
  })

  it('mode external : processus de travail actifs (ni arrêtés ni anciens) et tâches en attente, sans hôte ni version', async () => {
    const { status, body } = await callRoute('health', { video: { processing: 'external' } }, fakePrisma())
    expect(status).toBe(200)
    expect(body.videoProcessing).toEqual({ mode: 'external', workers: 1, queued: 4 })
  })

  it('mode embedded : ce serveur compte quand sa boucle tourne (sans présence), en plus des processus de travail', async () => {
    const { body } = await callRoute('health', { video: { processing: 'embedded' } }, fakePrisma())
    expect(body.videoProcessing).toEqual({ mode: 'embedded', workers: 2, queued: 4 })
    vi.resetModules()
    const worker = await callRoute('health', { serverRole: 'worker', video: { processing: 'embedded' } }, fakePrisma())
    expect(worker.body.videoProcessing).toEqual({ mode: 'embedded', workers: 1, queued: 4 })
  })

  it('lecture en échec : champs null, jamais d\'erreur ni de 503', async () => {
    const prisma = fakePrisma({ jobs: async () => { throw new Error('table absente') } })
    const { status, body } = await callRoute('health', { video: { processing: 'embedded' } }, prisma)
    expect(status).toBe(200)
    expect(body).toMatchObject({ status: 'ok', videoProcessing: { mode: 'embedded', workers: null, queued: null } })
  })

  it('base injoignable : 503 par `checks.database` seul, traitement non interrogé', async () => {
    const prisma = fakePrisma({ database: false })
    const { status, body } = await callRoute('health', { video: { processing: 'external' } }, prisma)
    expect(status).toBe(503)
    expect(body.videoProcessing).toEqual({ mode: 'external', workers: null, queued: null })
    expect(prisma.mediaJob.count).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/video-processing', () => {
  it('serveur web en mode external : ffmpeg null, processus de travail sans pid ni chemins, compteurs', async () => {
    const config = { ffmpegPath: '/opt/secret/ffmpeg', ffprobePath: '/opt/secret/ffprobe', video: { processing: 'external', concurrency: 2, crf: 26, av1: 'on' } }
    const { body, headers } = await callRoute('video-processing', config, fakePrisma())
    expect(headers['Cache-Control']).toBe('no-store')
    expect(body).toMatchObject({
      mode: 'external',
      role: 'web',
      active: true,
      halted: false,
      ffmpeg: null,
      jobs: { queued: 4, running: 1, done: 1, failed: 1, cancelled: 1 },
      backfill: { count: 2, totalDuration: 90.5 },
    })
    expect(body.settings).toEqual({ concurrency: 2, threads: expect.any(Number), rendition: 'auto', preset: 'veryfast', crf: 26, av1: true, maxDuration: 10_800 })
    expect(body.workers).toEqual([
      { id: 'box:12:aa', host: 'box', seenAt: expect.any(Date), version: '7.1', concurrency: 2, active: true, halted: false },
      { id: 'box:13:bb', host: 'box', seenAt: expect.any(Date), version: '7.1', concurrency: 1, active: false, halted: true },
      { id: 'old:14:cc', host: 'old', seenAt: expect.any(Date), version: '6.0', concurrency: 1, active: false, halted: false },
    ])
    expect(JSON.stringify(body)).not.toContain('/opt/secret')
  })

  it('mode embedded : capacités de ffmpeg détectées par ce processus', async () => {
    const { body } = await callRoute('video-processing', { video: { processing: 'embedded' } }, fakePrisma())
    expect(body).toMatchObject({ mode: 'embedded', active: true, ffmpeg: { ok: true, version: '7.1', encoders: ['libx264', 'aac'], hdrFilters: true, av1: false, problems: [] } })
  })

  it('mode off : ffmpeg null, traitement inactif', async () => {
    const { body } = await callRoute('video-processing', { video: { processing: 'off' } }, fakePrisma())
    expect(body).toMatchObject({ mode: 'off', active: false, ffmpeg: null })
  })
})
