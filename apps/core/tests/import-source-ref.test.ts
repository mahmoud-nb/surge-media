import { afterEach, describe, expect, it, vi } from 'vitest'
import { toProblem } from '../server/lib/api/problem'
import { listApiMedia } from '../server/lib/api/queries'
import { seesSourceRef, toApiMedia } from '../server/lib/api/serializers'
import { createMedia, findMediaBySourceRef } from '../server/lib/media/service'
import { jobPriority } from '../server/lib/video-processing/jobs'
import { apiMediaListQuerySchema, apiMediaSchema, apiMediaUploadFieldsSchema, apiProblemSchema } from '../shared/schemas/api'
import { API_ERRORS } from '../shared/utils/api'
import { normalizeSourceRef, SOURCE_REF_MAX_LENGTH } from '../shared/utils/media'
import { BACKFILL_PRIORITY, IMPORT_PRIORITY } from '../shared/utils/video-processing'

/**
 * Référence d'origine des médias importés (.claude/architecture-import.md, module I-1) : normalisation,
 * contrat de l'API v1 (champ d'envoi, filtres, représentation réservée aux identifiants de serveur),
 * refus d'une référence déjà présente avant toute écriture, priorité des vidéos importées.
 */

vi.mock('../server/lib/storage', () => ({ useMediaStorage: async () => ({}) }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function createError(input: { statusCode: number, statusMessage: string, data?: unknown }): Error {
  return Object.assign(new Error(input.statusMessage), input)
}

describe('normalizeSourceRef', () => {
  it('retire les espaces de bord et passe en NFC, sans toucher à la casse', () => {
    expect(normalizeSourceRef('  /Uploads/Été.JPG ')).toBe('/Uploads/Été.JPG')
    expect(normalizeSourceRef('café.jpg')).toBe('café.jpg')
    expect(normalizeSourceRef('https://cdn.exemple.fr/a b.jpg?v=2')).toBe('https://cdn.exemple.fr/a b.jpg?v=2')
  })

  it('refuse le vide, le trop long et les caractères de contrôle, sans jamais tronquer', () => {
    expect(normalizeSourceRef('   ')).toBeNull()
    expect(normalizeSourceRef('a\nb')).toBeNull()
    expect(normalizeSourceRef('a\u0000b')).toBeNull()
    expect(normalizeSourceRef('x'.repeat(SOURCE_REF_MAX_LENGTH))).toHaveLength(SOURCE_REF_MAX_LENGTH)
    expect(normalizeSourceRef('x'.repeat(SOURCE_REF_MAX_LENGTH + 1))).toBeNull()
  })
})

describe('contrat de l\'API v1', () => {
  it('champ d\'envoi `sourceRef` : normalisé, invalide → 400', () => {
    expect(apiMediaUploadFieldsSchema.parse({ sourceRef: ' img:4812 ' })).toEqual({ sourceRef: 'img:4812' })
    expect(apiMediaUploadFieldsSchema.parse({ title: 'Plage' })).toEqual({ title: 'Plage' })
    for (const sourceRef of ['', '  ', 'a\tb', 'x'.repeat(SOURCE_REF_MAX_LENGTH + 1)]) {
      expect(apiMediaUploadFieldsSchema.safeParse({ sourceRef }).success, JSON.stringify(sourceRef)).toBe(false)
    }
  })

  it('filtres `sourceRef` et `checksum` de la liste', () => {
    const checksum = 'AB'.repeat(32)
    expect(apiMediaListQuerySchema.parse({ sourceRef: ' /uploads/a.jpg ', checksum })).toMatchObject({ sourceRef: '/uploads/a.jpg', checksum: checksum.toLowerCase() })
    for (const query of [{ checksum: 'abc' }, { checksum: 'g'.repeat(64) }, { sourceRef: '' }]) {
      expect(apiMediaListQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false)
    }
  })

  it('erreur SOURCE_REF_EXISTS : 409, détail et `mediaId` en extension', () => {
    expect(API_ERRORS.SOURCE_REF_EXISTS.status).toBe(409)
    const problem = toProblem({ statusCode: 409, data: { code: 'SOURCE_REF_EXISTS', mediaId: 'cmmedia0001' } })
    expect([problem.code, problem.status]).toEqual(['SOURCE_REF_EXISTS', 409])
    expect(problem.options.detail).toContain('mediaId')
    expect(problem.options.extensions).toEqual({ mediaId: 'cmmedia0001' })
    expect(toProblem({ statusCode: 409, data: { code: 'SOURCE_REF_EXISTS', mediaId: 12 } }).options.extensions).toBeUndefined()
    expect(apiProblemSchema.shape.mediaId).toBeDefined()
  })
})

describe('représentation : référence réservée aux identifiants de serveur', () => {
  const media = {
    id: 'cmmedia0001', projectId: 'p1', folderId: null, kind: 'IMAGE', visibility: 'PUBLIC', storageKey: 'originals/2026/11/x.jpg',
    version: 1, originalName: 'plage.jpg', mimeType: 'image/jpeg', size: 1234, checksum: 'a'.repeat(64), width: 800, height: 600,
    duration: null, title: null, altText: null, searchTitle: null, searchName: '', searchAlt: null, metadata: null, focalX: null, focalY: null,
    posterKey: null, posterWidth: null, posterHeight: null, posterSize: null, posterTime: null, textTracks: [], tags: [],
    processingState: null, renditions: [], jobs: [], sourceRef: 'https://cdn.exemple.fr/uploads/plage.jpg',
    uploadedById: null, duplicatedFromId: null, createdAt: new Date('2026-11-16T10:00:00Z'), updatedAt: new Date('2026-11-16T10:00:00Z'), deletedAt: null,
  } as const

  it('seesSourceRef : clé secrète et jeton personnel seulement', () => {
    expect((['secret', 'personal', 'publishable', 'delegated'] as const).filter(type => seesSourceRef({ type }))).toEqual(['secret', 'personal'])
  })

  it('toApiMedia : valeur pour un identifiant de serveur, null pour un navigateur ou sans lecteur', () => {
    const base = 'https://media.example.com'
    const server = toApiMedia(media as never, base, 0, { type: 'secret' })
    expect(apiMediaSchema.parse(server)).toBeTruthy()
    expect(server.sourceRef).toBe(media.sourceRef)
    expect(toApiMedia(media as never, base, 0, { type: 'personal' }).sourceRef).toBe(media.sourceRef)
    expect(toApiMedia(media as never, base, 0, { type: 'publishable' }).sourceRef).toBeNull()
    expect(toApiMedia(media as never, base, 0, { type: 'delegated' }).sourceRef).toBeNull()
    expect(toApiMedia(media as never, base, 0).sourceRef).toBeNull()
    // Jamais l'empreinte ni la clé de stockage, pour personne.
    expect(JSON.stringify(server)).not.toContain(media.checksum)
    expect(JSON.stringify(server)).not.toContain(media.storageKey)
  })
})

describe('recherche par référence (comparaison à l\'identique)', () => {
  it('findMediaBySourceRef : médias actifs de l\'espace, variantes de casse ou d\'accents écartées (MySQL)', async () => {
    const findMany = vi.fn(async () => [{ id: 'm-variant', sourceRef: '/UPLOADS/A.jpg' }, { id: 'm-exact', sourceRef: '/uploads/a.jpg' }])
    vi.stubGlobal('usePrisma', async () => ({ media: { findMany } }))
    expect(await findMediaBySourceRef({ type: 'project', id: 'p1' }, '/uploads/a.jpg')).toEqual({ id: 'm-exact', sourceRef: '/uploads/a.jpg' })
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { projectId: 'p1', sourceRef: '/uploads/a.jpg', deletedAt: null } })
    expect(await findMediaBySourceRef({ type: 'project', id: 'p1' }, '/uploads/b.jpg')).toBeNull()
  })

  it('listApiMedia : filtres ajoutés au périmètre du projet, variantes écartées', async () => {
    const rows = [{ id: 'm1', sourceRef: 'img:1', createdAt: new Date(0) }, { id: 'm2', sourceRef: 'IMG:1', createdAt: new Date(0) }]
    const findMany = vi.fn(async () => rows)
    vi.stubGlobal('usePrisma', async () => ({ media: { findMany, count: vi.fn() } }))
    const checksum = 'c'.repeat(64)
    const query = apiMediaListQuerySchema.parse({ sourceRef: 'img:1', checksum })
    const page = await listApiMedia('p1', query, false)
    expect(page.items.map(item => item.id)).toEqual(['m1'])
    expect(JSON.stringify(findMany.mock.calls[0]![0])).toContain(JSON.stringify({ projectId: 'p1', deletedAt: null, sourceRef: 'img:1', checksum }).slice(1, -1))
  })
})

describe('envoi avec une référence déjà présente', () => {
  it('createMedia : 409 SOURCE_REF_EXISTS avec le média existant, avant toute analyse et toute écriture', async () => {
    const create = vi.fn()
    const findMany = vi.fn(async () => [{ id: 'cmexisting01', sourceRef: 'img:4812' }])
    vi.stubGlobal('usePrisma', async () => ({ media: { findMany, create } }))
    vi.stubGlobal('createError', createError)
    const upload = { path: '/introuvable', size: 10, checksum: 'a'.repeat(64), filename: 'plage.jpg', fields: {}, cleanup: async () => {} }
    const attempt = createMedia({ type: 'project', id: 'p1' }, upload, {}, { userId: null, tokenId: 't1', sourceRef: 'img:4812' })
    await expect(attempt).rejects.toMatchObject({ statusCode: 409, data: { code: 'SOURCE_REF_EXISTS', mediaId: 'cmexisting01' } })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('priorité des vidéos importées', () => {
  it('après les envois courants, avant le traitement de l\'existant ; un fichier retenu garde sa priorité haute', () => {
    expect(IMPORT_PRIORITY).toBeLessThan(0)
    expect(IMPORT_PRIORITY).toBeGreaterThan(BACKFILL_PRIORITY)
    expect(jobPriority({ dataTracks: [] }, IMPORT_PRIORITY)).toBe(IMPORT_PRIORITY)
    expect(jobPriority({ dataTracks: [{ codec: 'gpmd' }] }, IMPORT_PRIORITY)).toBeGreaterThan(0)
  })
})
