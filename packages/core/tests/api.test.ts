import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeCursor, encodeCursor } from '../server/lib/api/cursor'
import { ApiProblem, apiProblem, invalidRequest, problemBody, toProblem } from '../server/lib/api/problem'
import { createTokenBucketLimiter, rateLimitHeaders } from '../server/lib/api/rate-limit'
import { etagMatches, mediaEtag, toApiMedia, weakEtag } from '../server/lib/api/serializers'
import { createLruCache } from '../server/lib/cache/lru'
import { resolveRange } from '../server/lib/media/range'
import { checkSignature, keyId } from '../server/lib/media/signing'
import { toMetadataInput } from '../server/lib/api/writes'
import {
  apiDuplicateBodySchema,
  apiMediaListQuerySchema,
  apiMediaSchema,
  apiMediaUpdateSchema,
  apiMediaUploadFieldsSchema,
  apiSignedUrlBodySchema,
  apiSignedUrlsBodySchema,
} from '../shared/schemas/api'
import { API_ERRORS } from '../shared/utils/api'
import { credentialScopes, MEDIA_SCOPES, spaceScopes, type Scope } from '../shared/utils/permissions'
import { mediaSearchColumns, normalizeSearchText } from '../shared/utils/search'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('portées effectives des identifiants', () => {
  const ALL = ['project:read', ...MEDIA_SCOPES]
  const owner = (role: 'ADMIN' | 'MANAGER' | 'DEVELOPER' | 'EDITOR', memberRole?: 'OWNER' | 'DEVELOPER' | 'EDITOR') =>
    spaceScopes(role, { type: 'project', memberRole, archived: false })

  it('jeton personnel : portées du jeton ∩ droits actuels du propriétaire, seulement dans sa sélection', () => {
    expect(credentialScopes({ type: 'PERSONAL', scopes: ALL, inSelection: true, ownerScopes: owner('DEVELOPER', 'OWNER') })).toEqual(ALL)
    expect(credentialScopes({ type: 'PERSONAL', scopes: ['project:read', 'media:read'], inSelection: true, ownerScopes: owner('DEVELOPER', 'OWNER') }))
      .toEqual(['project:read', 'media:read'])
    expect(credentialScopes({ type: 'PERSONAL', scopes: ALL, inSelection: false, ownerScopes: owner('ADMIN') })).toEqual([])
    // Propriétaire retiré du projet : plus rien, même si le jeton le sélectionne.
    expect(credentialScopes({ type: 'PERSONAL', scopes: ALL, inSelection: true, ownerScopes: owner('DEVELOPER') })).toEqual([])
    // Jamais de portée de gestion, même pour un propriétaire ADMIN.
    const scopes = credentialScopes({ type: 'PERSONAL', scopes: [...ALL, 'project:members', 'project:settings'], inSelection: true, ownerScopes: owner('ADMIN') })
    expect(scopes).toEqual(ALL)
  })

  it('clé secrète : ses portées dans son projet, rien ailleurs', () => {
    expect(credentialScopes({ type: 'SECRET', scopes: ['project:read', 'media:read', 'media:upload'], ownProject: true }))
      .toEqual(['project:read', 'media:read', 'media:upload'])
    expect(credentialScopes({ type: 'SECRET', scopes: ALL, ownProject: false })).toEqual([])
  })

  it('clé publique : lecture seulement, dans son projet', () => {
    expect(credentialScopes({ type: 'PUBLISHABLE', ownProject: true })).toEqual(['project:read', 'media:read'])
    expect(credentialScopes({ type: 'PUBLISHABLE', ownProject: false })).toEqual([])
  })

  it('bibliothèque : droits du propriétaire (sans project:read)', () => {
    const library = spaceScopes('EDITOR', { type: 'library' })
    expect(credentialScopes({ type: 'PERSONAL', scopes: ALL, inSelection: true, ownerScopes: library }))
      .toEqual(MEDIA_SCOPES.filter(scope => (library as Scope[]).includes(scope)))
    // Seul l'ADMIN gère la bibliothèque : le jeton d'un autre rôle n'y fait que lire.
    for (const role of ['MANAGER', 'DEVELOPER', 'EDITOR'] as const) {
      expect(credentialScopes({ type: 'PERSONAL', scopes: ALL, inSelection: true, ownerScopes: spaceScopes(role, { type: 'library' }) }))
        .toEqual(['media:read'])
    }
    expect(credentialScopes({ type: 'PERSONAL', scopes: ALL, inSelection: true, ownerScopes: spaceScopes('ADMIN', { type: 'library' }) }))
      .toEqual([...MEDIA_SCOPES])
  })

  it('jeton personnel d\'un gestionnaire : propriétaire de ses projets, plafonné aux portées d\'un jeton', () => {
    const managerScopes = spaceScopes('MANAGER', { type: 'project', memberRole: 'EDITOR', archived: false })
    expect(credentialScopes({ type: 'PERSONAL', scopes: ALL, inSelection: true, ownerScopes: managerScopes })).toEqual(ALL)
    expect(credentialScopes({ type: 'PERSONAL', scopes: ALL, inSelection: true, ownerScopes: spaceScopes('MANAGER', { type: 'project', memberRole: null, archived: false }) }))
      .toEqual([])
  })
})

describe('curseurs', () => {
  it('aller-retour, refus d\'un autre tri ou d\'une valeur altérée', () => {
    const raw = encodeCursor({ sort: 'newest', value: '2026-09-29T10:00:00.000Z', id: 'cm1abc' })
    expect(decodeCursor(raw, 'newest')).toEqual({ sort: 'newest', value: '2026-09-29T10:00:00.000Z', id: 'cm1abc' })
    expect(decodeCursor(raw, 'size')).toBeNull()
    expect(decodeCursor('pas-un-curseur', 'newest')).toBeNull()
    expect(decodeCursor(Buffer.from('{"a":1}').toString('base64url'), 'newest')).toBeNull()
    expect(decodeCursor(Buffer.from(JSON.stringify(['size', { x: 1 }, 'id'])).toString('base64url'), 'size')).toBeNull()
    expect(decodeCursor(encodeCursor({ sort: 'size', value: 42, id: 'x' }), 'size')?.value).toBe(42)
  })
})

describe('requêtes partielles (Range)', () => {
  it('résout les formes valides', () => {
    expect(resolveRange(undefined, 1000)).toEqual({ type: 'full' })
    expect(resolveRange('bytes=0-99', 1000)).toEqual({ type: 'partial', start: 0, end: 99 })
    expect(resolveRange('bytes=500-', 1000)).toEqual({ type: 'partial', start: 500, end: 999 })
    expect(resolveRange('bytes=-100', 1000)).toEqual({ type: 'partial', start: 900, end: 999 })
    expect(resolveRange('bytes=-5000', 1000)).toEqual({ type: 'partial', start: 0, end: 999 })
    expect(resolveRange('bytes=900-5000', 1000)).toEqual({ type: 'partial', start: 900, end: 999 })
  })

  it('ignore les formes non gérées, refuse les plages hors du fichier', () => {
    expect(resolveRange('bytes=0-1,5-6', 1000)).toEqual({ type: 'full' })
    expect(resolveRange('items=0-1', 1000)).toEqual({ type: 'full' })
    expect(resolveRange('bytes=10-5', 1000)).toEqual({ type: 'full' })
    expect(resolveRange('bytes=-', 1000)).toEqual({ type: 'full' })
    expect(resolveRange('bytes=1000-', 1000)).toEqual({ type: 'unsatisfiable' })
    expect(resolveRange('bytes=-0', 1000)).toEqual({ type: 'unsatisfiable' })
    expect(resolveRange('bytes=0-', 0)).toEqual({ type: 'unsatisfiable' })
  })
})

describe('recherche normalisée', () => {
  it('minuscules, sans accents, espaces réduits', () => {
    expect(normalizeSearchText('  Été   à  PARIS ')).toBe('ete a paris')
    expect(normalizeSearchText('Crème Brûlée.JPG')).toBe('creme brulee.jpg')
    expect(normalizeSearchText('Ǆemal Œuvre ﬁne')).toBe('dzemal œuvre fine')
    expect(normalizeSearchText('x'.repeat(300))).toHaveLength(191)
  })

  it('colonnes d\'un média', () => {
    expect(mediaSearchColumns({ originalName: 'Façade.png', title: null, altText: 'Une FAÇADE' }))
      .toEqual({ searchName: 'facade.png', searchTitle: null, searchAlt: 'une facade' })
  })
})

describe('limitation de débit (seau à jetons)', () => {
  it('consomme puis recharge en continu', () => {
    let now = 0
    const limiter = createTokenBucketLimiter({ now: () => now })
    for (let i = 0; i < 3; i++) expect(limiter.take('k', 3, 60).allowed).toBe(true)
    const refused = limiter.take('k', 3, 60)
    expect(refused).toMatchObject({ allowed: false, remaining: 0, retryAfter: 20 })
    now += 20_000
    expect(limiter.take('k', 3, 60).allowed).toBe(true)
    expect(limiter.take('autre', 3, 60).remaining).toBe(2)
  })

  it('en-têtes du brouillon IETF', () => {
    expect(rateLimitHeaders('secret', { allowed: true, limit: 1200, remaining: 1190, reset: 1, retryAfter: 0 }))
      .toEqual({ 'RateLimit-Policy': '"secret";q=1200;w=60', 'RateLimit': '"secret";r=1190;t=1' })
  })
})

describe('cache LRU', () => {
  it('expire, évince le moins récent et supprime par prédicat', () => {
    let now = 0
    const cache = createLruCache<number>({ max: 2, ttlMs: 1000, now: () => now })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a')
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    now = 1000
    expect(cache.get('a')).toBeUndefined()
    cache.set('x', 10)
    cache.set('y', 20)
    cache.deleteWhere(value => value > 15)
    expect(cache.get('y')).toBeUndefined()
    expect(cache.get('x')).toBe(10)
  })
})

describe('ETag', () => {
  it('liste : dépend de chaque ingrédient', () => {
    const a = weakEtag(['media-list', 'p1', 3, { sort: 'newest' }, 'full', 1000])
    expect(a).toMatch(/^W\/"[\w-]{27}"$/)
    expect(weakEtag(['media-list', 'p1', 3, { sort: 'newest' }, 'full', 1000])).toBe(a)
    expect(weakEtag(['media-list', 'p1', 4, { sort: 'newest' }, 'full', 1000])).not.toBe(a)
    expect(weakEtag(['media-list', 'p1', 3, { sort: 'newest' }, 'public', 1000])).not.toBe(a)
  })

  it('détail : échéance des liens incluse seulement pour un média privé', () => {
    const updatedAt = new Date(0)
    expect(mediaEtag({ id: 'm', version: 2, updatedAt, visibility: 'PUBLIC' }, 99)).toBe('W/"m-2-0"')
    expect(mediaEtag({ id: 'm', version: 2, updatedAt, visibility: 'PRIVATE' }, 99)).toBe('W/"m-2-0-99"')
  })

  it('If-None-Match : liste, comparaison faible, joker', () => {
    expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('"x", W/"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('*', 'W/"abc"')).toBe(true)
    expect(etagMatches('W/"abd"', 'W/"abc"')).toBe(false)
    expect(etagMatches(undefined, 'W/"abc"')).toBe(false)
  })
})

describe('contrat Media v1', () => {
  const media = {
    id: 'cmmedia0001', projectId: 'p1', folderId: null, kind: 'IMAGE', visibility: 'PUBLIC', storageKey: 'originals/2026/09/x.jpg',
    version: 3, originalName: 'Affiche été.jpg', mimeType: 'image/jpeg', size: 1234, checksum: 'a'.repeat(64), width: 800, height: 600,
    duration: null, title: 'Affiche été', altText: 'Plage', searchTitle: null, searchName: '', searchAlt: null, metadata: null, focalX: null, focalY: null,
    uploadedById: null, duplicatedFromId: null, createdAt: new Date('2026-09-29T10:00:00Z'), updatedAt: new Date('2026-09-29T11:00:00Z'), deletedAt: null,
  } as const

  it('média public : URL permanentes absolues, valeurs en minuscules', () => {
    const result = toApiMedia(media as never, 'https://media.example.com', 0)
    expect(apiMediaSchema.parse(result)).toBeTruthy()
    expect(result).toMatchObject({
      projectId: 'p1',
      kind: 'image',
      visibility: 'public',
      filename: 'Affiche été.jpg',
      extension: 'jpg',
      url: 'https://media.example.com/m/cmmedia0001/v3/affiche-ete.jpg',
      previewUrl: 'https://media.example.com/m/cmmedia0001/v3/preview/affiche-ete.webp',
      urlTemplate: 'https://media.example.com/m/cmmedia0001/v3/{transform}/affiche-ete.{format}',
      focalPoint: null,
      urlExpiresAt: null,
    })
    expect(JSON.stringify(result)).not.toContain('originals/')
    expect(toApiMedia({ ...media, focalX: 0.25, focalY: 0.6 } as never, 'https://media.example.com', 0).focalPoint).toEqual({ x: 0.25, y: 0.6 })
    // Hors images : ni aperçu ni gabarit.
    const pdf = toApiMedia({ ...media, kind: 'DOCUMENT', mimeType: 'application/pdf' } as never, 'https://media.example.com', 0)
    expect([pdf.previewUrl, pdf.urlTemplate]).toEqual([null, null])
  })

  it('média privé : URL signées vérifiables jusqu\'à l\'échéance', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ media: { signingSecret: 'secret-de-test', previousSigningSecret: '' }, session: {} }))
    const result = toApiMedia({ ...media, visibility: 'PRIVATE' } as never, 'https://media.example.com', 2_000_000_000)
    expect(result.urlExpiresAt).toBe(new Date(2_000_000_000 * 1000).toISOString())
    const query = Object.fromEntries(new URL(result.url).searchParams)
    expect(query.kid).toBe(keyId('secret-de-test'))
    expect(checkSignature(['secret-de-test'], { mediaId: media.id, version: 3, variant: 'original' }, query, 1_900_000_000).status).toBe('valid')
    const preview = Object.fromEntries(new URL(result.previewUrl!).searchParams)
    expect(checkSignature(['secret-de-test'], { mediaId: media.id, version: 3, variant: 'preview' }, preview, 1_900_000_000).status).toBe('valid')
    // La signature de l'aperçu n'ouvre pas l'original.
    expect(checkSignature(['secret-de-test'], { mediaId: media.id, version: 3, variant: 'original' }, preview, 1_900_000_000).status).toBe('invalid')
    // Gabarit : droit « derived », valable pour toute transformation, jamais pour l'original.
    const template = result.urlTemplate!
    expect(template.startsWith('https://media.example.com/m/cmmedia0001/v3/{transform}/affiche-ete.{format}?')).toBe(true)
    const derived = Object.fromEntries(new URLSearchParams(template.split('?')[1]))
    expect(derived.scope).toBe('derived')
    expect(checkSignature(['secret-de-test'], { mediaId: media.id, version: 3, variant: 't:w_800,h_450' }, derived, 1_900_000_000).status).toBe('valid')
    expect(checkSignature(['secret-de-test'], { mediaId: media.id, version: 3, variant: 'original' }, derived, 1_900_000_000).status).toBe('invalid')
  })
})

describe('paramètres de l\'API', () => {
  it('liste : valeurs par défaut, ids dédoublonnés, validation stricte', () => {
    expect(apiMediaListQuerySchema.parse({})).toEqual({ sort: 'newest', limit: 24 })
    expect(apiMediaListQuerySchema.parse({ ids: 'abcdefgh1, abcdefgh2,abcdefgh1', withTotal: 'true', limit: '100' }))
      .toMatchObject({ ids: ['abcdefgh1', 'abcdefgh2'], withTotal: true, limit: 100 })
    for (const query of [{ limit: '0' }, { limit: '101' }, { sort: 'random' }, { kind: 'IMAGE' }, { visibility: 'secret' }, { ids: '../x' }, { withTotal: 'yes' }]) {
      expect(apiMediaListQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false)
    }
    expect(apiMediaListQuerySchema.safeParse({ ids: Array.from({ length: 101 }, (_, i) => `media${String(i).padStart(4, '0')}`).join(',') }).success).toBe(false)
  })

  it('écriture : champs d\'un envoi et d\'un PATCH (texte vide → null, visibilité en minuscules, champ inconnu refusé)', () => {
    expect(apiMediaUploadFieldsSchema.parse({ title: '  Affiche  ', altText: '', visibility: 'private' }))
      .toEqual({ title: 'Affiche', altText: null, visibility: 'private' })
    expect(apiMediaUpdateSchema.parse({ title: null })).toEqual({ title: null })
    expect(apiMediaUpdateSchema.parse({})).toEqual({})
    for (const body of [{ visibility: 'PRIVATE' }, { title: 'x'.repeat(192) }, { folderId: '../x' }, { titre: 'x' }]) {
      expect(apiMediaUpdateSchema.safeParse(body).success, JSON.stringify(body)).toBe(false)
    }
    expect(toMetadataInput({ title: null, visibility: 'private' })).toEqual({ title: null, visibility: 'PRIVATE' })
    // Visibilité imposée par un jeton délégué : prioritaire sur le champ envoyé.
    expect(toMetadataInput({ visibility: 'public' }, { visibility: 'private' })).toEqual({ visibility: 'PRIVATE' })
    expect(toMetadataInput({})).toEqual({})
    // Point d'intérêt : arrondi à 4 décimales, null efface ; bornes et champs stricts.
    expect(apiMediaUpdateSchema.parse({ focalPoint: { x: 0.123456, y: 1 } })).toEqual({ focalPoint: { x: 0.1235, y: 1 } })
    expect(apiMediaUpdateSchema.parse({ focalPoint: null })).toEqual({ focalPoint: null })
    for (const focalPoint of [{ x: 1.2, y: 0 }, { x: -0.1, y: 0.5 }, { x: 0.5 }, { x: 0.5, y: 0.5, z: 0 }, [0.5, 0.5], '0.5,0.5']) {
      expect(apiMediaUpdateSchema.safeParse({ focalPoint }).success, JSON.stringify(focalPoint)).toBe(false)
    }
    expect(toMetadataInput({ focalPoint: { x: 0.5, y: 0.25 } })).toEqual({ focalPoint: { x: 0.5, y: 0.25 } })
    expect(toMetadataInput({ focalPoint: null })).toEqual({ focalPoint: null })
    // Dossier : null = hors dossier ; imposé par un jeton délégué.
    expect(toMetadataInput({ folderId: null })).toEqual({ folderId: null })
    expect(toMetadataInput({ folderId: 'cmfolder0001' }, { folderId: 'cmfolder0002' })).toEqual({ folderId: 'cmfolder0002' })
  })

  it('duplication : projet ou bibliothèque, un seul à la fois', () => {
    expect(apiDuplicateBodySchema.parse({})).toEqual({})
    expect(apiDuplicateBodySchema.parse({ target: { projectId: 'cmproject0001' } })).toEqual({ target: { projectId: 'cmproject0001' } })
    expect(apiDuplicateBodySchema.parse({ target: { library: true } })).toEqual({ target: { library: true } })
    for (const body of [{ target: { library: false } }, { target: { projectId: '../x' } }, { target: { projectId: 'cmproject0001', library: true } }, { projectId: 'x' }]) {
      expect(apiDuplicateBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false)
    }
  })

  it('lien signé : cible, préréglage ou transformation selon la cible, format, durée bornée', () => {
    expect(apiSignedUrlBodySchema.parse({})).toEqual({ target: 'file', expiresIn: 3600 })
    expect(apiSignedUrlBodySchema.safeParse({ target: 'preset' }).success).toBe(false)
    expect(apiSignedUrlBodySchema.parse({ target: 'preset', preset: 'carte-produit' }).preset).toBe('carte-produit')
    expect(apiSignedUrlBodySchema.safeParse({ expiresIn: 30 }).success).toBe(false)
    expect(apiSignedUrlBodySchema.safeParse({ target: 'transform' }).success).toBe(false)
    expect(apiSignedUrlBodySchema.parse({ target: 'transform', transform: 'h_450,w_800', format: 'avif' }))
      .toEqual({ target: 'transform', transform: 'h_450,w_800', format: 'avif', expiresIn: 3600 })
    // Transformation vide admise (forme canonique : préréglage « full »).
    expect(apiSignedUrlBodySchema.safeParse({ target: 'transform', transform: '' }).success).toBe(true)
    expect(apiSignedUrlBodySchema.parse({ target: 'derived', transform: 'w_400' }).transform).toBe('w_400')
    const invalid = [
      { preset: 'preview' }, // préréglage avec l'original
      { format: 'webp' },
      { target: 'preset', preset: 'Preview' },
      { target: 'preset', preset: 'preview', transform: 'w_10' },
      { target: 'transform', transform: 'w_10', preset: 'preview' },
      { target: 'derived', preset: 'preview', transform: 'w_10' },
      { target: 'transform', transform: 'w_10', format: 'jpeg' },
      { target: 'transform', transform: 'w_10', format: 'gif' },
      { target: 'transform', transform: 'x'.repeat(201) },
      { target: 'file', expiresIn: 3600, extra: true },
    ]
    for (const body of invalid) expect(apiSignedUrlBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false)
  })

  it('liens par lot : 1 à 100, chaque lien validé à sa place', () => {
    expect(apiSignedUrlsBodySchema.parse({ items: [{ mediaId: 'cmmedia0001' }] })).toEqual({ items: [{ mediaId: 'cmmedia0001', target: 'file' }], expiresIn: 3600 })
    expect(apiSignedUrlsBodySchema.safeParse({ items: [] }).success).toBe(false)
    expect(apiSignedUrlsBodySchema.safeParse({ items: Array.from({ length: 101 }, () => ({ mediaId: 'cmmedia0001' })) }).success).toBe(false)
    const result = apiSignedUrlsBodySchema.safeParse({ items: [{ mediaId: 'cmmedia0001' }, { mediaId: 'cmmedia0002', target: 'preset' }] })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(issue => issue.path.join('.'))).toEqual(['items.1.preset'])
    expect(apiSignedUrlsBodySchema.safeParse({ items: [{ mediaId: '../x' }] }).success).toBe(false)
  })
})

describe('problèmes RFC 9457', () => {
  it('corps normalisé, détail omis s\'il répète le titre', () => {
    const body = problemBody(apiProblem('INSUFFICIENT_SCOPE', 'This credential lacks the media:write scope.'), {
      base: 'https://media.example.com/api/v1',
      instance: '/api/v1/projects/p1/media',
      requestId: 'req-1',
    })
    expect(body).toEqual({
      type: 'https://media.example.com/api/v1/errors#INSUFFICIENT_SCOPE',
      title: 'Insufficient scope',
      status: 403,
      code: 'INSUFFICIENT_SCOPE',
      detail: 'This credential lacks the media:write scope.',
      instance: '/api/v1/projects/p1/media',
      requestId: 'req-1',
    })
    expect(problemBody(new ApiProblem('NOT_FOUND'), { base: '', instance: '/x', requestId: 'r' })).not.toHaveProperty('detail')
  })

  it('conversion des erreurs', () => {
    expect(toProblem({ statusCode: 400, statusMessage: 'Bad' }).code).toBe('INVALID_REQUEST')
    expect(toProblem({ statusCode: 404 }).code).toBe('NOT_FOUND')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(toProblem(new Error('boom')).code).toBe('INTERNAL_ERROR')
    const problem = invalidRequest([{ path: ['limit'], message: 'Too big' }])
    expect(problem.options.errors).toEqual([{ path: 'limit', message: 'Too big' }])
    for (const [code, { status }] of Object.entries(API_ERRORS)) expect(new ApiProblem(code as keyof typeof API_ERRORS).status).toBe(status)
  })

  it('erreurs métier des médias (data.code) → problème du catalogue, avec détail et Retry-After', () => {
    const tooLarge = toProblem({ statusCode: 413, data: { code: 'FILE_TOO_LARGE', maxSize: 1000 } })
    expect([tooLarge.code, tooLarge.status, tooLarge.options.detail]).toEqual(['FILE_TOO_LARGE', 413, 'The file exceeds the maximum size of 1000 bytes.'])
    const unsupported = toProblem({ statusCode: 415, data: { code: 'UNSUPPORTED_TYPE', accepted: ['image/png'] } })
    expect(unsupported.options.detail).toContain('image/png')
    const busy = toProblem({ statusCode: 503, data: { code: 'SERVER_BUSY', retryAfter: 5 } })
    expect([busy.status, busy.options.headers]).toEqual([503, { 'Retry-After': '5' }])
    expect(toProblem({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } }).status).toBe(409)
    // Détail porté par l'erreur métier (transformations).
    const invalidTransform = toProblem({ statusCode: 400, data: { code: 'INVALID_TRANSFORM', detail: 'w expects an integer from 1 to 4096.' } })
    expect([invalidTransform.code, invalidTransform.options.detail]).toEqual(['INVALID_TRANSFORM', 'w expects an integer from 1 to 4096.'])
    expect(toProblem({ statusCode: 429, data: { code: 'TRANSFORM_QUOTA', retryAfter: 12 } }).options.headers).toEqual({ 'Retry-After': '12' })
    // Code métier inconnu du catalogue : repli sur le statut HTTP.
    expect(toProblem({ statusCode: 400, data: { code: 'SOMETHING_ELSE' } }).code).toBe('INVALID_REQUEST')
  })
})
