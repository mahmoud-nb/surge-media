import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media, MediaJob, MediaRendition } from '../server/generated/prisma/client'
import { toProblem } from '../server/lib/api/problem'
import { activeProcessingParts, type ApiMediaRecord, mediaEtag, toApiMedia, toApiProcessing, weakEtag } from '../server/lib/api/serializers'
import { issueSignedUrl } from '../server/lib/api/signed-urls'
import { checkSignature } from '../server/lib/media/signing'
import { apiDelegatedTokenBodySchema, apiMediaSchema, apiSignedUrlSchema, delegatedTokenClaimsSchema } from '../shared/schemas/api'

/**
 * Contrat vidéo de l'API v1 (phase D3, architecture § 35) : `sources` (ordre, signature, formats
 * convertis), `processing`, ETag qui suit l'avancement, liens signés de l'original avec leurs sources,
 * types convertis des jetons délégués. L'ordre des sources lui-même est testé dans video-sources.test.ts ;
 * ici, son passage par l'API (URL absolues, signature commune, schéma de réponse).
 */

// withApiUpload (server/lib/api/writes.ts) : droits, réservation et état du traitement remplacés ; la
// réception (receiveUpload) et les règles d'envoi (uploadRules) sont les vraies.
const mocks = vi.hoisted(() => ({ active: false }))
vi.mock('../server/lib/video-processing/status', () => ({ videoProcessingActive: vi.fn(async () => mocks.active) }))
vi.mock('../server/lib/api/context', () => ({ requireUploadAllowance: vi.fn() }))
vi.mock('../server/lib/access/delegated', () => ({ reserveDelegatedUpload: vi.fn(async () => true), releaseDelegatedUpload: vi.fn(async () => {}) }))

const SECRET = 'secret-de-test'
const BASE = 'https://media.example.com'
const EXPIRES = 2_000_000_000
const NOW = 1_900_000_000

beforeEach(() => {
  vi.stubGlobal('useRuntimeConfig', () => ({
    media: { signingSecret: SECRET, previousSigningSecret: '', maxUploadSize: 1000, maxVideoUploadSize: 5000 },
    session: {},
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const MP4_METADATA = {
  container: 'mp4', videoCodec: 'avc1', audioCodec: 'mp4a', codecs: 'avc1.64001F,mp4a.40.2', hasAudio: true, rotation: 0, bitrate: 4_000_000,
  faststart: true, hasLocation: false, playback: 'broad', prepared: ['faststart'], durationEstimated: false, dataTracks: [], hdr: null, rewrites: [],
}

function video(overrides: Partial<ApiMediaRecord> = {}): ApiMediaRecord {
  return {
    id: 'cmvideo0001', projectId: 'p1', folderId: null, kind: 'VIDEO', visibility: 'PUBLIC', storageKey: 'originals/2026/10/x.mp4',
    version: 4, originalName: 'Vacances.mp4', mimeType: 'video/mp4', size: 40_000_000, checksum: 'a'.repeat(64), width: 3840, height: 2160,
    duration: 12.5, title: 'Vacances', altText: null, searchTitle: null, searchName: '', searchAlt: null, metadata: MP4_METADATA, focalX: null, focalY: null,
    posterKey: null, posterWidth: null, posterHeight: null, posterSize: null, posterTime: null, processingState: null,
    uploadedById: null, uploadedByTokenId: null, uploadSubject: null, duplicatedFromId: null,
    createdAt: new Date('2026-10-08T10:00:00Z'), updatedAt: new Date('2026-10-08T11:00:00Z'), deletedAt: null,
    textTracks: [], renditions: [], jobs: [],
    ...overrides,
  } as unknown as ApiMediaRecord
}

function rendition(name: 'av1' | 'h264'): MediaRendition {
  const av1 = name === 'av1'
  return {
    id: `cmrend${name}`, mediaId: 'cmvideo0001', name, container: av1 ? 'webm' : 'mp4', mimeType: av1 ? 'video/webm' : 'video/mp4',
    codecs: av1 ? 'av01.0.08M.08,opus' : 'avc1.640028,mp4a.40.2', width: 1920, height: 1080, duration: 12.5, bitrate: av1 ? 2_400_000 : 5_100_000,
    size: av1 ? 3_750_000 : 7_968_750, checksum: 'b'.repeat(64), storageKey: `variants/cmvideo0001/rendition-${name}-zz.${av1 ? 'webm' : 'mp4'}`,
    createdAt: new Date('2026-10-08T11:00:00Z'),
  }
}

function job(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    id: 'cmjob0001', mediaId: 'cmvideo0001', sourceKey: 'originals/2026/10/x.mp4', status: 'QUEUED', priority: 0, attempts: 0,
    runAfter: new Date('2026-10-08T11:00:00Z'), lockedBy: null, leaseUntil: null, step: null, progress: null, result: null,
    errorCode: null, errorDetail: null, createdAt: new Date('2026-10-08T11:00:00Z'), updatedAt: new Date('2026-10-08T11:00:05Z'),
    startedAt: null, finishedAt: null,
    ...overrides,
  }
}

const queryOf = (url: string) => new URL(url).search

describe('sources v1', () => {
  it('rendus présents : AV1 puis H.264, URL absolues, l\'original reste dans `url`', () => {
    const result = toApiMedia(video({ renditions: [rendition('h264'), rendition('av1')] }), BASE, 0)
    expect(apiMediaSchema.parse(result)).toBeTruthy()
    expect(result.url).toBe('https://media.example.com/m/cmvideo0001/v4/vacances.mp4')
    expect(result.sources).toEqual([
      { url: 'https://media.example.com/m/cmvideo0001/v4/renditions/av1.webm', type: 'video/webm; codecs="av01.0.08M.08, opus"', width: 1920, height: 1080, bitrate: 2_400_000, size: 3_750_000, rendition: 'av1' },
      { url: 'https://media.example.com/m/cmvideo0001/v4/renditions/h264.mp4', type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"', width: 1920, height: 1080, bitrate: 5_100_000, size: 7_968_750, rendition: 'h264' },
    ])
    // Ni clé de stockage des rendus, ni original parmi les sources quand le rendu H.264 existe.
    expect(JSON.stringify(result)).not.toContain('variants/')
  })

  it('sans rendu : l\'original lisible seul ; MOV annoncé video/mp4 ; AV1 sans H.264 : l\'original en dernier recours', () => {
    expect(toApiMedia(video(), BASE, 0).sources).toEqual([
      { url: 'https://media.example.com/m/cmvideo0001/v4/vacances.mp4', type: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"', width: 3840, height: 2160, bitrate: 4_000_000, size: 40_000_000, rendition: null },
    ])
    const mov = toApiMedia(video({ mimeType: 'video/quicktime', originalName: 'Vacances.mov', metadata: { ...MP4_METADATA, container: 'mov' } }), BASE, 0)
    expect(mov.sources.map(source => [source.url, source.type])).toEqual([['https://media.example.com/m/cmvideo0001/v4/vacances.mov', 'video/mp4; codecs="avc1.64001F, mp4a.40.2"']])
    const av1Only = toApiMedia(video({ renditions: [rendition('av1')] }), BASE, 0)
    expect(av1Only.sources.map(source => source.rendition)).toEqual(['av1', null])
  })

  it('format converti : aucune source tant que le rendu H.264 n\'existe pas ; image : aucune', () => {
    const mkv = video({
      mimeType: 'video/x-matroska', originalName: 'Clip.mkv', title: null, width: null, height: null, duration: null, processingState: 'PROCESSING',
      metadata: { ...MP4_METADATA, container: 'mkv', videoCodec: null, audioCodec: null, codecs: null, playback: 'none', bitrate: null },
      jobs: [job({ status: 'RUNNING', step: 'transcode', progress: 0.3 })],
    })
    const pending = toApiMedia(mkv, BASE, 0)
    expect(apiMediaSchema.parse(pending)).toBeTruthy()
    expect(pending.sources).toEqual([])
    expect(pending.url).toBe('https://media.example.com/m/cmvideo0001/v4/clip.mkv')
    expect(toApiMedia({ ...mkv, renditions: [rendition('h264')] }, BASE, 0).sources.map(source => source.rendition)).toEqual(['h264'])
    const image = toApiMedia(video({ kind: 'IMAGE', mimeType: 'image/jpeg', originalName: 'a.jpg', metadata: null }), BASE, 0)
    expect([image.sources, image.processing]).toEqual([[], null])
  })

  it('média privé : chaque source porte la signature de `url` (droit sur le fichier, même échéance) ; public : URL permanentes', () => {
    const result = toApiMedia(video({ visibility: 'PRIVATE', renditions: [rendition('av1'), rendition('h264')] }), BASE, EXPIRES)
    const query = queryOf(result.url)
    expect(query).toContain(`exp=${EXPIRES}`)
    expect(result.sources).toHaveLength(2)
    for (const source of result.sources) {
      expect(queryOf(source.url)).toBe(query)
      // La diffusion vérifie un rendu avec le droit de l'original (delivery-path.ts, `deliveryVariant`).
      const params = Object.fromEntries(new URL(source.url).searchParams)
      expect(checkSignature([SECRET], { mediaId: 'cmvideo0001', version: 4, variant: 'original' }, params, NOW).status).toBe('valid')
    }
    expect(result.urlExpiresAt).toBe(new Date(EXPIRES * 1000).toISOString())
    const open = toApiMedia(video({ renditions: [rendition('h264')] }), BASE, EXPIRES)
    expect(open.sources.map(source => queryOf(source.url))).toEqual([''])
  })
})

describe('processing v1', () => {
  it('null pour un média jamais traité, même avec une ancienne tâche', () => {
    expect(toApiProcessing(video(), undefined)).toBeNull()
    expect(toApiMedia(video({ jobs: [job({ status: 'CANCELLED' })] }), BASE, 0).processing).toBeNull()
  })

  it('pending, processing (avancement), ready : statut en minuscules, date de la dernière écriture de la tâche', () => {
    expect(toApiProcessing(video({ processingState: 'PENDING' }), job())).toEqual({ status: 'pending', progress: null, error: null, updatedAt: '2026-10-08T11:00:05.000Z' })
    // Sans tâche (état en cours de reprise) : date du média.
    expect(toApiProcessing(video({ processingState: 'PENDING' }), undefined)?.updatedAt).toBe('2026-10-08T11:00:00.000Z')
    const running = job({ status: 'RUNNING', step: 'transcode', progress: 0.42, updatedAt: new Date('2026-10-08T11:01:00Z') })
    expect(toApiProcessing(video({ processingState: 'PROCESSING' }), running)).toEqual({ status: 'processing', progress: 0.42, error: null, updatedAt: '2026-10-08T11:01:00.000Z' })
    // Étape non mesurée : avancement inconnu.
    expect(toApiProcessing(video({ processingState: 'PROCESSING' }), job({ status: 'RUNNING', step: 'sanitize' }))?.progress).toBeNull()
    expect(toApiProcessing(video({ processingState: 'READY' }), job({ status: 'DONE', progress: 0.99 }))).toMatchObject({ status: 'ready', progress: null, error: null })
  })

  it('failed : code de l\'échec seulement, jamais son détail technique ; code inconnu ou état non final → null', () => {
    const failed = job({ status: 'FAILED', attempts: 3, errorCode: 'TOO_LONG', errorDetail: 'ffmpeg: /var/lib/surge/tmp/job-1/in.mp4 too long' })
    const result = toApiMedia(video({ processingState: 'FAILED', jobs: [failed] }), BASE, 0)
    expect(apiMediaSchema.parse(result)).toBeTruthy()
    expect(result.processing).toEqual({ status: 'failed', progress: null, error: 'TOO_LONG', updatedAt: '2026-10-08T11:00:05.000Z' })
    expect(JSON.stringify(result)).not.toContain('/var/lib')
    expect(toApiProcessing(video({ processingState: 'FAILED' }), job({ status: 'FAILED', errorCode: 'SOMETHING_NEW' }))?.error).toBeNull()
    // Échec passager, nouvel essai en attente : pas d'erreur exposée.
    expect(toApiProcessing(video({ processingState: 'PENDING' }), job({ errorCode: 'TIMEOUT', attempts: 1 }))?.error).toBeNull()
  })
})

describe('ETag et traitement', () => {
  const at = (iso: string) => new Date(iso)

  it('détail : change avec l\'état et avec chaque écriture de la tâche (avancement), échéance des liens privés toujours en dernier', () => {
    const base = { id: 'm', version: 2, updatedAt: new Date(0), visibility: 'PUBLIC' as const }
    const never = mediaEtag({ ...base, processingState: null, jobs: [] }, 99)
    expect(never).toBe('W/"m-2-0"')
    const pending = mediaEtag({ ...base, processingState: 'PENDING', jobs: [{ id: 'j1', updatedAt: at('2026-10-08T11:00:00Z') }] }, 99)
    const started = mediaEtag({ ...base, processingState: 'PROCESSING', jobs: [{ id: 'j1', updatedAt: at('2026-10-08T11:00:00Z') }] }, 99)
    const progressed = mediaEtag({ ...base, processingState: 'PROCESSING', jobs: [{ id: 'j1', updatedAt: at('2026-10-08T11:00:05Z') }] }, 99)
    const retried = mediaEtag({ ...base, processingState: 'PROCESSING', jobs: [{ id: 'j2', updatedAt: at('2026-10-08T11:00:05Z') }] }, 99)
    expect(new Set([never, pending, started, progressed, retried]).size).toBe(5)
    expect(mediaEtag({ ...base, processingState: 'PROCESSING', jobs: [{ id: 'j1', updatedAt: at('2026-10-08T11:00:05Z') }] }, 99)).toBe(progressed)

    // Média privé : l'échéance des URL signées reste un ingrédient (un 304 ne prolonge jamais des URL expirées).
    const hidden = { ...base, visibility: 'PRIVATE' as const, processingState: 'PROCESSING' as const, jobs: [{ id: 'j1', updatedAt: at('2026-10-08T11:00:05Z') }] }
    expect(mediaEtag(hidden, 99)).toMatch(/-99"$/)
    expect(mediaEtag(hidden, 99)).not.toBe(mediaEtag(hidden, 100))
  })

  it('liste : ingrédients des seuls traitements en attente ou en cours, qui suivent l\'avancement', () => {
    const item = (processingState: Media['processingState'], updatedAt = '2026-10-08T11:00:00Z') =>
      ({ id: `m-${processingState}`, version: 1, updatedAt: new Date(0), visibility: 'PUBLIC' as const, processingState, jobs: [{ id: 'j', updatedAt: at(updatedAt) }] })
    expect(activeProcessingParts([])).toBeNull()
    expect(activeProcessingParts([item(null), item('READY'), item('FAILED')])).toBeNull()
    const before = activeProcessingParts([item('READY'), item('PROCESSING')])
    const after = activeProcessingParts([item('READY'), item('PROCESSING', '2026-10-08T11:00:05Z')])
    expect(before).toHaveLength(1)
    expect(after).not.toEqual(before)
    expect(activeProcessingParts([item('PENDING')])).toHaveLength(1)
    // ETag d'une page active jamais égal à celui de la révision seule (le raccourci 304 sans requête).
    const parts = ['media-list', 'p1', 3, { sort: 'newest' }, 'full', 1000]
    expect(weakEtag([...parts, before])).not.toBe(weakEtag(parts))
    expect(weakEtag([...parts, before])).not.toBe(weakEtag([...parts, after]))
  })
})

describe('liens signés de l\'original d\'une vidéo', () => {
  const options = { base: BASE, policy: 'OPEN' as const, delegated: false, expires: EXPIRES }

  it('média privé : `sources` signées comme `url`, à la même échéance', async () => {
    const result = await issueSignedUrl(video({ visibility: 'PRIVATE', renditions: [rendition('av1'), rendition('h264')] }), { target: 'file' }, options)
    expect(apiSignedUrlSchema.parse(result)).toBeTruthy()
    expect(result.expiresAt).toBe(new Date(EXPIRES * 1000).toISOString())
    expect(result.sources?.map(source => source.url)).toEqual([
      `https://media.example.com/m/cmvideo0001/v4/renditions/av1.webm?${result.query}`,
      `https://media.example.com/m/cmvideo0001/v4/renditions/h264.mp4?${result.query}`,
    ])
    expect(result.url).toBe(`https://media.example.com/m/cmvideo0001/v4/vacances.mp4?${result.query}`)
    const params = Object.fromEntries(new URLSearchParams(result.query))
    expect(checkSignature([SECRET], { mediaId: 'cmvideo0001', version: 4, variant: 'original' }, params, NOW)).toMatchObject({ status: 'valid', expires: EXPIRES })
  })

  it('média public : URL permanentes ; pas de `sources` pour une image ni pour une autre cible', async () => {
    const open = await issueSignedUrl(video({ renditions: [rendition('h264')] }), { target: 'file' }, options)
    expect(open).toEqual({
      url: 'https://media.example.com/m/cmvideo0001/v4/vacances.mp4',
      query: '',
      expiresAt: null,
      sources: [expect.objectContaining({ url: 'https://media.example.com/m/cmvideo0001/v4/renditions/h264.mp4', rendition: 'h264' })],
    })
    // Format converti pas encore prêt : liste vide, mais présente (cible `file` d'une vidéo).
    const mkv = video({ mimeType: 'video/x-matroska', originalName: 'Clip.mkv', metadata: { ...MP4_METADATA, container: 'mkv', playback: 'none' } })
    expect((await issueSignedUrl(mkv, { target: 'file' }, options)).sources).toEqual([])
    const image = await issueSignedUrl(video({ kind: 'IMAGE', mimeType: 'image/png', originalName: 'a.png', metadata: null }), { target: 'file' }, options)
    expect(image).not.toHaveProperty('sources')
    const track = { id: 'cmtrack0001', kind: 'CAPTIONS', language: 'fr', label: 'Français', isDefault: true, storageKey: 'k', size: 1, checksum: 'c', cueCount: 1, sourceFormat: 'vtt', createdAt: new Date(0) }
    const trackLink = await issueSignedUrl(video({ visibility: 'PRIVATE', textTracks: [track] as never }), { target: 'track', trackId: 'cmtrack0001' }, options)
    expect(trackLink).not.toHaveProperty('sources')
  })
})

describe('jetons délégués et formats convertis', () => {
  it('`upload.types` accepte les types convertis (charge du jeton comprise), refuse un type inconnu', () => {
    const body = { scopes: ['media:upload'], upload: { types: ['video/x-matroska', 'video/mp4'] } }
    expect(apiDelegatedTokenBodySchema.parse(body).upload?.types).toEqual(['video/x-matroska', 'video/mp4'])
    expect(apiDelegatedTokenBodySchema.safeParse({ ...body, upload: { types: ['video/x-flv'] } }).success).toBe(false)
    const claims = { v: 1, jti: 'jti-00001', iss: 'cmkey00001', project: 'cmproject1', scopes: ['media:upload'], upload: { types: ['video/x-ms-wmv'] }, iat: 1, exp: 2, kid: 'k1' }
    expect(delegatedTokenClaimsSchema.safeParse(claims).success).toBe(true)
  })

  it('jeton limité aux formats convertis, traitement inactif : 415 UNSUPPORTED_TYPE d\'emblée, envoi réservé libéré', async () => {
    const { withApiUpload } = await import('../server/lib/api/writes')
    const delegated = await import('../server/lib/access/delegated')
    const grant = { upload: { types: ['video/x-matroska', 'video/x-msvideo'] } }
    const principal = { delegated: grant } as unknown as Parameters<typeof withApiUpload>[1]
    const event = { node: { req: { headers: { 'content-type': 'multipart/form-data; boundary=x' } } } } as never
    const task = vi.fn()
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input))

    mocks.active = false
    const error = await withApiUpload(event, principal, task).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ statusCode: 415, data: { code: 'UNSUPPORTED_TYPE', accepted: [] } })
    expect(task).not.toHaveBeenCalled()
    expect(delegated.releaseDelegatedUpload).toHaveBeenCalledWith(grant)
    const problem = toProblem(error)
    expect([problem.code, problem.status]).toEqual(['UNSUPPORTED_TYPE', 415])
    expect(problem.options.detail).toContain('video processing')
  })
})
