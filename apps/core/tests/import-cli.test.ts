import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { en } from '../cli/i18n/en'
import { fr } from '../cli/i18n/fr'
import { importFiles, readApiKey, resolveProject, serverUrl } from '../cli/import'
import { ApiError, type ApiMedia, apiRoot, createApiClient, isFatalApiError, MAX_SERVER_WAITS, NETWORK_RETRY_DELAYS_MS, permanentUrl, retryAfterSeconds } from '../cli/lib/import/api'
import { csvField, csvLine, CsvError, parseCsv } from '../cli/lib/import/csv'
import { folderSegments, manifestHeader, manifestLine, manifestRef, type ManifestRow, parseManifest, sourceKind } from '../cli/lib/import/manifest'
import { estimatedMinutes, scanDirectory, validFolderPath } from '../cli/lib/import/plan'
import { folderKey, pendingRows, prepareFolders, prepareTags, runImport, type RunOptions, withPublicUrl } from '../cli/lib/import/run'
import type { SourceError } from '../cli/lib/import/sources'
import { displayUrl, DOWNLOAD_MAX_REDIRECTS, downloadSource, fileChecksum, filenameFromUrl, resolveFileSource } from '../cli/lib/import/sources'
import { countByStatus, type ImportEntry, parseState, renderMapping } from '../cli/lib/import/state'
import { SOURCE_REF_MAX_LENGTH } from '../shared/utils/media'

/**
 * `surge-media import` (.claude/architecture-import.md, module I-2) : manifeste, sources, client de l'API,
 * état et déroulé (reprise, dédoublonnage, refus, arrêt). Fichiers réels dans un dossier temporaire,
 * serveur remplacé par un faux client ou un faux `fetch`.
 */

const TMP = mkdtempSync(join(tmpdir(), 'surge-media-import-test-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
/** Fichier reconnu comme PNG ; `seed` distingue les contenus (donc les empreintes). */
function png(path: string, seed: string): string {
  writeFileSync(path, Buffer.concat([PNG, Buffer.from(seed)]))
  return path
}

describe('CSV', () => {
  it('lit guillemets, virgules, retours à la ligne, BOM et fins de ligne CRLF', () => {
    const records = parseCsv('\uFEFFsource,alt\r\n"a,b.jpg","dit ""bonjour"""\r\n\r\nc.jpg,"deux\nlignes"\n')
    expect(records.map(record => record.fields)).toEqual([['source', 'alt'], ['a,b.jpg', 'dit "bonjour"'], ['c.jpg', 'deux\nlignes']])
    expect(records.map(record => record.line)).toEqual([1, 2, 4])
    expect(parseCsv('a,,\n').at(0)!.fields).toEqual(['a', '', ''])
    expect(parseCsv('""\n').at(0)!.fields).toEqual([''])
  })

  it('refuse un guillemet non fermé ou mal placé, avec la ligne', () => {
    expect(() => parseCsv('source\n"a.jpg\n')).toThrowError(CsvError)
    expect(() => parseCsv('source\na"b.jpg\n')).toThrowError(/line 2: strayQuote/)
    expect(() => parseCsv('source\n"a" b\n')).toThrowError(/strayQuote/)
  })

  it('écrit ce qu\'il sait relire, sans changer la valeur', () => {
    const values = ['plage, été.jpg', 'dit "oui"', ' bord ', 'deux\nlignes', '=1+1', '', null]
    const line = csvLine(values)
    expect(parseCsv(line)[0]!.fields).toEqual(['plage, été.jpg', 'dit "oui"', ' bord ', 'deux\nlignes', '=1+1', '', ''])
    expect(csvField('simple')).toBe('simple')
    expect(csvField(12)).toBe('12')
  })
})

describe('manifeste', () => {
  it('lit les colonnes dans n\'importe quel ordre, source seule obligatoire', () => {
    const { rows, issues } = parseManifest('Alt,SOURCE,tags,folder,visibility,title\n"Plage, soir",uploads/a.jpg,Ete|plage|ete,blog / 2024,Private,Plage\nhttps://cdn.exemple.fr/b.png,,,,\n'.replace('https://cdn.exemple.fr/b.png,,,,', ',https://cdn.exemple.fr/b.png,,,,'))
    expect(issues).toEqual([])
    expect(rows[0]).toMatchObject({ line: 2, source: 'uploads/a.jpg', kind: 'file', ref: 'uploads/a.jpg', alt: 'Plage, soir', title: 'Plage', visibility: 'private', folder: ['blog', '2024'], tags: ['ete', 'plage'], filename: null })
    expect(rows[1]).toMatchObject({ line: 3, kind: 'http', ref: 'https://cdn.exemple.fr/b.png', title: null, visibility: null, folder: [], tags: [] })
    expect(parseManifest('source\na.jpg\n').rows).toHaveLength(1)
  })

  it('refuse les étiquettes mal formées et garde les slugs une seule fois', () => {
    expect(parseManifest('source,tags\na.jpg,ete|plage|ete\n').rows[0]!.tags).toEqual(['ete', 'plage'])
    expect(parseManifest('source,tags\na.jpg,Été\n').issues.map(issue => issue.code)).toEqual(['tagInvalid'])
  })

  it('signale chaque problème avec sa ligne, sans s\'arrêter au premier', () => {
    const text = [
      'source,ref,visibility,folder,title',
      ',,,,',
      'ftp://hote/a.jpg,,,,',
      'a.jpg,img:1,secret,,',
      'b.jpg,img:1,,,',
      `c.jpg,,,${Array.from({ length: 9 }, (_, index) => `n${index}`).join('/')},`,
      'd.jpg,,,a\b,',
      `e.jpg,,,,${'x'.repeat(192)}`,
      'f.jpg,x,,,,trop',
    ].join('\n')
    const { rows, issues } = parseManifest(text)
    expect(issues.map(issue => [issue.line, issue.code])).toEqual([
      [2, 'sourceMissing'],
      [3, 'sourceScheme'],
      [4, 'visibilityInvalid'],
      [5, 'refDuplicate'],
      [6, 'folderTooDeep'],
      [7, 'folderInvalid'],
      [8, 'textTooLong'],
      [9, 'tooManyFields'],
    ])
    expect(rows).toEqual([])
  })

  it('refuse un en-tête inconnu, en double ou sans colonne source, et un manifeste vide', () => {
    expect(parseManifest('source,titre\na.jpg,x\n').issues[0]).toMatchObject({ line: 1, code: 'unknownColumn', params: { column: 'titre' } })
    expect(parseManifest('source,source\na.jpg,b.jpg\n').issues[0]!.code).toBe('duplicateColumn')
    expect(parseManifest('title\nPlage\n').issues[0]!.code).toBe('sourceColumnMissing')
    expect(parseManifest('').issues[0]!.code).toBe('empty')
    expect(parseManifest('source\n').issues[0]!.code).toBe('empty')
    expect(parseManifest('source\n"a.jpg\n').issues[0]).toMatchObject({ code: 'csv', line: 2 })
  })

  it('référence : colonne ref, sinon la source ; trop longue, son empreinte stable', () => {
    expect(manifestRef('uploads/a.jpg', '')).toBe('uploads/a.jpg')
    expect(manifestRef('uploads/a.jpg', ' img:1 ')).toBe('img:1')
    const long = `https://cdn.exemple.fr/${'x'.repeat(SOURCE_REF_MAX_LENGTH)}.jpg`
    expect(manifestRef(long, '')).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(manifestRef(long, '')).toBe(manifestRef(long, ''))
    expect(manifestRef('a.jpg', 'x'.repeat(SOURCE_REF_MAX_LENGTH + 1))).toBeNull()
    expect(manifestRef('a\u0007.jpg', '')).toBeNull()
  })

  it('genre de source : chemins (Windows compris), URL http(s), autres schémas refusés', () => {
    expect(sourceKind('uploads/a.jpg')).toBe('file')
    expect(sourceKind('C:\\photos\\a.jpg')).toBe('file')
    expect(sourceKind('HTTPS://cdn.exemple.fr/a.jpg')).toBe('http')
    expect(sourceKind('s3://bucket/a.jpg')).toBe('s3')
    expect(sourceKind('ftp://hote/a.jpg')).toBeNull()
    expect(folderSegments(' /marque//2024/ été / ')).toEqual(['marque', '2024', 'été'])
  })

  it('un manifeste écrit par `plan` se relit', () => {
    const text = manifestHeader() + manifestLine({ source: 'été/plage, soir.jpg', folder: 'été' })
    expect(parseManifest(text).rows[0]).toMatchObject({ source: 'été/plage, soir.jpg', folder: ['été'] })
  })
})

describe('état et table de correspondance', () => {
  const entry = (ref: string, status: ImportEntry['status'], extra: Partial<ImportEntry> = {}): ImportEntry =>
    ({ ref, source: ref, status, mediaId: null, version: null, url: null, code: null, detail: null, at: '2026-11-16T10:00:00.000Z', ...extra })

  it('la dernière entrée d\'une référence fait foi ; ligne tronquée ignorée', () => {
    const text = [
      JSON.stringify({ type: 'header', server: 'http://127.0.0.1:3000/api/v1', projectId: 'p1', startedAt: 'x' }),
      JSON.stringify(entry('a', 'failed', { code: 'NETWORK' })),
      JSON.stringify(entry('a', 'created', { mediaId: 'm1' })),
      JSON.stringify({ ref: 'x', status: 'inconnu', source: 'x' }),
      '{"ref":"b","status":"crea',
    ].join('\n')
    const state = parseState(text)
    expect(state.header).toMatchObject({ projectId: 'p1' })
    expect([...state.entries.keys()]).toEqual(['a'])
    expect(state.entries.get('a')).toMatchObject({ status: 'created', mediaId: 'm1' })
  })

  it('table : ordre du manifeste, statut pending pour les lignes non traitées', () => {
    const rows = [{ source: 'a, b.jpg', ref: 'a' }, { source: 'c.jpg', ref: 'c' }]
    const entries = new Map([['a', entry('a', 'created', { mediaId: 'm1', version: 1, url: 'https://media.example.com/m/m1/v1/a.jpg' })]])
    expect(renderMapping(rows, entries)).toBe('source,sourceRef,status,mediaId,version,url,code\n"a, b.jpg",a,created,m1,1,https://media.example.com/m/m1/v1/a.jpg,\nc.jpg,c,pending,,,,\n')
    expect(countByStatus(rows, entries)).toEqual({ created: 1, exists: 0, deduplicated: 0, rejected: 0, failed: 0, pending: 1 })
  })

  it('reprise : jamais vues et en échec ; les refus seulement sur demande', () => {
    const rows = ['a', 'b', 'c', 'd'].map(ref => ({ ref }) as ManifestRow)
    const entries = new Map([['a', entry('a', 'created')], ['b', entry('b', 'failed')], ['c', entry('c', 'rejected')]])
    expect(pendingRows(rows, entries, false).map(row => row.ref)).toEqual(['b', 'd'])
    expect(pendingRows(rows, entries, true).map(row => row.ref)).toEqual(['b', 'c', 'd'])
  })
})

describe('sources du disque', () => {
  const root = join(TMP, 'racine')
  mkdirSync(join(root, 'sous'), { recursive: true })
  png(join(root, 'sous', 'a.png'), 'a')
  writeFileSync(join(root, 'vide.png'), '')
  writeFileSync(join(TMP, 'dehors.png'), 'x')

  it('fichier de la racine : chemin réel et taille', async () => {
    const file = await resolveFileSource(root, 'sous/a.png')
    expect(file.size).toBe(PNG.length + 1)
    expect(await fileChecksum(file.path)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refuse ce qui sort de la racine, n\'existe pas, est un dossier ou est vide', async () => {
    const code = (source: string) => resolveFileSource(root, source).then(() => 'ok', error => (error as SourceError).code)
    expect(await code('../dehors.png')).toBe('SOURCE_OUTSIDE_ROOT')
    expect(await code(join(TMP, 'dehors.png'))).toBe('SOURCE_OUTSIDE_ROOT')
    expect(await code('sous/../../dehors.png')).toBe('SOURCE_OUTSIDE_ROOT')
    expect(await code('.')).toBe('SOURCE_OUTSIDE_ROOT')
    expect(await code('absent.png')).toBe('SOURCE_NOT_FOUND')
    expect(await code('sous')).toBe('SOURCE_NOT_A_FILE')
    expect(await code('vide.png')).toBe('SOURCE_EMPTY')
  })

  it('refuse un lien symbolique qui sort de la racine', async ({ skip }) => {
    try {
      symlinkSync(join(TMP, 'dehors.png'), join(root, 'lien.png'))
    }
    catch {
      // Windows sans le droit de créer des liens symboliques.
      return skip()
    }
    await expect(resolveFileSource(root, 'lien.png')).rejects.toMatchObject({ code: 'SOURCE_OUTSIDE_ROOT' })
  })
})

describe('téléchargement d\'une source', () => {
  const directory = mkdtempSync(join(TMP, 'dl-'))
  const body = (text: string, init: ResponseInit = {}) => new Response(text, init)
  const options = (fetch: typeof globalThis.fetch, maxBytes = 1000) => ({ maxBytes, fetch })

  it('suit les redirections et écrit le fichier', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/final.png' } }))
      .mockResolvedValueOnce(body('contenu'))
    const file = await downloadSource('https://cdn.exemple.fr/a.png', directory, options(fetch))
    expect(file.size).toBe(7)
    expect(String(fetch.mock.calls[1]![0])).toBe('https://cdn.exemple.fr/final.png')
  })

  it('s\'arrête : trop de redirections, statut d\'erreur, taille annoncée ou constatée, corps vide', async () => {
    const code = (fetch: typeof globalThis.fetch, maxBytes?: number) =>
      downloadSource('https://cdn.exemple.fr/a.png', directory, options(fetch, maxBytes)).then(() => 'ok', error => (error as SourceError).code)
    const loop = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 301, headers: { location: '/encore' } }))
    expect(await code(loop)).toBe('DOWNLOAD_REDIRECTS')
    expect(loop).toHaveBeenCalledTimes(DOWNLOAD_MAX_REDIRECTS + 1)
    expect(await code(async () => body('non', { status: 404 }))).toBe('DOWNLOAD_FAILED')
    expect(await code(async () => body('x', { headers: { 'content-length': '5000' } }))).toBe('DOWNLOAD_TOO_LARGE')
    expect(await code(async () => body('x'.repeat(50)), 10)).toBe('DOWNLOAD_TOO_LARGE')
    expect(await code(async () => body(''))).toBe('SOURCE_EMPTY')
    expect(await code(async () => new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }))).toBe('DOWNLOAD_FAILED')
    expect(await code(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    })).toBe('DOWNLOAD_FAILED')
  })

  it('s\'arrête après un silence trop long', async () => {
    const fetch: typeof globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    await expect(downloadSource('https://cdn.exemple.fr/a.png', directory, { maxBytes: 1000, fetch, idleTimeoutMs: 20 })).rejects.toMatchObject({ code: 'DOWNLOAD_TIMEOUT' })
  })

  it('messages : URL sans identifiants ni paramètres ; nom de fichier tiré du chemin', () => {
    expect(displayUrl('https://user:secret@cdn.exemple.fr/a/b.jpg?sig=abc#x')).toBe('https://cdn.exemple.fr/a/b.jpg')
    expect(filenameFromUrl('https://cdn.exemple.fr/2024/plage%20%C3%A9t%C3%A9.jpg?v=2')).toBe('plage été.jpg')
    expect(filenameFromUrl('https://cdn.exemple.fr/')).toBe('media')
  })
})

describe('client de l\'API', () => {
  const KEY = 'sm_sk_test_0123456789'
  const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...init })
  const problem = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    json({ type: 'x', title: 'x', status, code, instance: '/x', requestId: 'r', ...extra }, { status, headers })
  const client = (fetch: typeof globalThis.fetch, extra: Partial<Parameters<typeof createApiClient>[0]> = {}) =>
    createApiClient({ baseUrl: 'https://media.example.com/', key: KEY, userAgent: 'test', fetch, sleep: async () => {}, ...extra })

  it('racine de l\'API, URL permanente, délai demandé par le serveur', () => {
    expect(apiRoot('https://media.example.com/')).toBe('https://media.example.com/api/v1')
    expect(apiRoot('http://127.0.0.1:3000/sous-chemin/')).toBe('http://127.0.0.1:3000/sous-chemin/api/v1')
    expect(apiRoot('https://user:pass@media.example.com')).toBeNull()
    expect(apiRoot('ftp://media.example.com')).toBeNull()
    expect(apiRoot('pas une url')).toBeNull()
    expect(permanentUrl('https://m.example.com/m/a/v1/x.jpg?exp=1&sig=z')).toBe('https://m.example.com/m/a/v1/x.jpg')
    expect(permanentUrl('https://m.example.com/m/a/v1/x.jpg')).toBe('https://m.example.com/m/a/v1/x.jpg')
    expect(retryAfterSeconds('7')).toBe(7)
    expect(retryAfterSeconds('0')).toBe(1)
    expect(retryAfterSeconds('99999')).toBe(300)
    expect(retryAfterSeconds(null)).toBe(5)
    expect(retryAfterSeconds('bientôt')).toBe(5)
    expect(retryAfterSeconds(new Date(60_000).toUTCString(), 0)).toBe(60)
  })

  it('envoie la clé en en-tête seulement, et patiente sur 429 et 503', async () => {
    const waits: unknown[] = []
    const sleep = vi.fn(async () => {})
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(problem(429, 'RATE_LIMITED', {}, { 'retry-after': '12' }))
      .mockResolvedValueOnce(problem(503, 'SERVER_BUSY'))
      .mockResolvedValueOnce(json({ items: [{ id: 'm1', version: 1, url: 'u', kind: 'image', sourceRef: 'img:1' }] }))
    const found = await client(fetch, { sleep, onWait: event => waits.push(event) }).findBySourceRef('p1', 'img:1')
    expect(found).toMatchObject({ id: 'm1' })
    expect(sleep.mock.calls.map(call => (call as unknown[])[0])).toEqual([12_000, 5_000])
    expect(waits).toEqual([{ seconds: 12, reason: 'rateLimited' }, { seconds: 5, reason: 'serverBusy' }])
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('https://media.example.com/api/v1/projects/p1/media?sourceRef=img%3A1&limit=1')
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(String(url)).not.toContain(KEY)
  })

  it('après un refus de débit, les envois passent un par un, espacés du délai demandé', async () => {
    const path = png(join(TMP, 'file.png'), 'file')
    let inFlight = 0
    let maxInFlight = 0
    let calls = 0
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--
      // Le premier envoi de la rafale est refusé : le serveur demande 2 s.
      return ++calls === 1 ? problem(429, 'RATE_LIMITED', {}, { 'retry-after': '2' }) : json({ id: `m${calls}`, version: 1, url: 'u', kind: 'image', sourceRef: null }, { status: 201 })
    })
    const sleep = vi.fn(async () => {})
    const api = client(fetch, { sleep })
    const upload = (ref: string) => api.upload('p1', { path, filename: 'a.png', mimeType: 'image/png' }, { sourceRef: ref })
    // Rafale de départ : rien ne freine encore, les trois partent ensemble.
    await Promise.all([upload('a'), upload('b'), upload('c')])
    expect(maxInFlight).toBe(3)
    maxInFlight = 0
    // Ensuite : en file, une requête à la fois, espacée des 2 s demandées.
    await Promise.all([upload('d'), upload('e'), upload('f')])
    expect(maxInFlight).toBe(1)
    expect(sleep.mock.calls.some(call => (call as unknown[])[0] === 2000)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(7)
    // Les lectures ne sont pas ralenties par le débit des envois.
    maxInFlight = 0
    await Promise.all([api.me(), api.me()])
    expect(maxInFlight).toBe(2)
  })

  it('abandonne un fichier après trop d\'attentes', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => problem(429, 'RATE_LIMITED'))
    await expect(client(fetch).me()).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 })
    expect(fetch).toHaveBeenCalledTimes(MAX_SERVER_WAITS + 1)
  })

  it('réessaie après une coupure, puis rend NETWORK sans la clé dans le message', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    const error = await client(fetch).me().then(() => null, caught => caught as ApiError) as ApiError
    expect(error).toMatchObject({ code: 'NETWORK', status: 0, detail: 'ECONNREFUSED' })
    expect(fetch).toHaveBeenCalledTimes(NETWORK_RETRY_DELAYS_MS.length + 1)
    expect(JSON.stringify([error.message, error.detail])).not.toContain(KEY)
  })

  it('problème de l\'API : code, détail et extensions ; réponse d\'un autre service reconnue', async () => {
    const refused = await client(async () => problem(409, 'SOURCE_REF_EXISTS', { detail: 'déjà là', mediaId: 'm9' })).me().catch(caught => caught as ApiError)
    expect(refused).toMatchObject({ status: 409, code: 'SOURCE_REF_EXISTS', detail: 'déjà là', extensions: { mediaId: 'm9' } })
    expect(isFatalApiError(refused)).toBe(false)
    expect(isFatalApiError(new ApiError(401, 'TOKEN_REVOKED'))).toBe(true)
    expect(isFatalApiError(new ApiError(403, 'PROJECT_ARCHIVED'))).toBe(true)
    await expect(client(async () => new Response('<html>502</html>', { status: 502 })).me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(client(async () => new Response('<html>ok</html>')).me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('envoi : champs avant le fichier, corps reconstruit à chaque essai', async () => {
    const path = png(join(TMP, 'envoi.png'), 'envoi')
    const bodies: FormData[] = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      bodies.push(init!.body as FormData)
      return bodies.length === 1 ? problem(503, 'SERVER_BUSY') : json({ id: 'm1', version: 1, url: 'u', kind: 'image', sourceRef: 'img:1' }, { status: 201 })
    })
    await client(fetch).upload('p1', { path, filename: 'plage été.png', mimeType: 'image/png' }, { sourceRef: 'img:1', title: 'Plage', altText: null, visibility: 'private', folderId: 'f1', tags: ['ete', 'plage'] })
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).not.toBe(bodies[1])
    const form = bodies[1]!
    expect([...form.keys()]).toEqual(['sourceRef', 'title', 'visibility', 'folderId', 'tags', 'file'])
    expect(form.get('tags')).toBe('ete,plage')
    const file = form.get('file') as File
    expect([file.name, file.type, file.size]).toEqual(['plage été.png', 'image/png', PNG.length + 5])
  })
})

describe('déroulé d\'un import', () => {
  const root = mkdtempSync(join(TMP, 'run-'))
  const RULES = [{ mimeType: 'image/png', extension: 'png', kind: 'image', maxSize: 1000, converted: false }]
  const row = (source: string, extra: Partial<ManifestRow> = {}): ManifestRow =>
    ({ line: 2, source, kind: 'file', ref: source, title: null, alt: null, visibility: null, folder: [], tags: [], filename: null, ...extra })
  const media = (id: string): ApiMedia => ({ id, version: 1, url: `http://127.0.0.1:3000/m/${id}/v1/x.png?sig=temporaire`, kind: 'image', sourceRef: null })

  function fakeClient(overrides: Partial<RunOptions['client']> = {}) {
    let created = 0
    return {
      findBySourceRef: vi.fn(async () => null as ApiMedia | null),
      findByChecksum: vi.fn(async () => null as ApiMedia | null),
      upload: vi.fn(async () => media(`new${++created}`)),
      media: vi.fn(async (_project: string, id: string) => media(id)),
      ...overrides,
    }
  }
  const run = (rows: ManifestRow[], client: RunOptions['client'], extra: Partial<RunOptions> = {}) => {
    const entries = extra.entries ?? new Map<string, ImportEntry>()
    return runImport({ rows, entries, client, projectId: 'p1', rules: RULES, root, folderIds: new Map(), concurrency: 2, dedupe: true, dryRun: false, retryRejected: false, defaultVisibility: null, publicUrl: null, ...extra })
      .then(outcome => ({ outcome, entries }))
  }

  it('crée un média : champs de la ligne, URL permanente sur le domaine public', async () => {
    png(join(root, 'a.png'), 'a')
    const client = fakeClient()
    const results: string[] = []
    const { outcome, entries } = await run([row('a.png', { title: 'Plage', alt: 'Soir', tags: ['ete'], folder: ['Blog', '2024'], ref: 'img:1' })], client, {
      folderIds: new Map([['blog/2024', 'f1']]),
      defaultVisibility: 'private',
      publicUrl: 'https://media.example.com/',
      onResult: (_row, entry) => results.push(entry.status),
    })
    expect(outcome).toEqual({ processed: 1, interrupted: false, fatal: null })
    expect(vi.mocked(client.upload).mock.calls[0]).toMatchObject(['p1', { filename: 'a.png', mimeType: 'image/png' }, { sourceRef: 'img:1', title: 'Plage', altText: 'Soir', visibility: 'private', folderId: 'f1', tags: ['ete'] }])
    expect(entries.get('img:1')).toMatchObject({ status: 'created', mediaId: 'new1', version: 1, url: 'https://media.example.com/m/new1/v1/x.png', source: 'a.png' })
    expect(results).toEqual(['created'])
  })

  it('import relancé : référence déjà sur le serveur, aucun envoi', async () => {
    png(join(root, 'b.png'), 'b')
    const client = fakeClient({ findBySourceRef: vi.fn(async () => media('old1')) })
    const { entries } = await run([row('b.png')], client)
    expect(entries.get('b.png')).toMatchObject({ status: 'exists', mediaId: 'old1' })
    expect(client.upload).not.toHaveBeenCalled()
  })

  it('même contenu sur deux lignes traitées ensemble : un seul envoi, l\'autre rattachée', async () => {
    png(join(root, 'c1.png'), 'meme')
    png(join(root, 'c2.png'), 'meme')
    const client = fakeClient()
    const { entries } = await run([row('c1.png'), row('c2.png')], client)
    expect(client.upload).toHaveBeenCalledTimes(1)
    expect([entries.get('c1.png')!.status, entries.get('c2.png')!.status].sort()).toEqual(['created', 'deduplicated'])
    expect(entries.get('c1.png')!.mediaId).toBe(entries.get('c2.png')!.mediaId)
  })

  it('contenu déjà dans le projet : rattaché sans envoi ; --no-dedupe envoie tout', async () => {
    png(join(root, 'd.png'), 'd')
    const known = fakeClient({ findByChecksum: vi.fn(async () => media('same1')) })
    expect((await run([row('d.png')], known)).entries.get('d.png')).toMatchObject({ status: 'deduplicated', mediaId: 'same1' })
    expect(known.upload).not.toHaveBeenCalled()
    const all = fakeClient({ findByChecksum: vi.fn(async () => media('same1')) })
    await run([row('d.png')], all, { dedupe: false })
    expect(all.findByChecksum).not.toHaveBeenCalled()
    expect(all.upload).toHaveBeenCalledTimes(1)
  })

  it('refus définitifs et échecs rejouables', async () => {
    writeFileSync(join(root, 'texte.png'), 'pas une image')
    png(join(root, 'gros.png'), 'x'.repeat(2000))
    png(join(root, 'e.png'), 'e')
    png(join(root, 'f.png'), 'f')
    const client = fakeClient({
      upload: vi.fn(async (_project, file) => {
        throw file.filename === 'e.png' ? new ApiError(422, 'UNREADABLE_FILE') : new ApiError(0, 'NETWORK', 'ECONNRESET')
      }),
    })
    const { outcome, entries } = await run([row('texte.png'), row('gros.png'), row('absent.png'), row('../dehors.png'), row('e.png'), row('f.png')], client, { concurrency: 1 })
    expect(Object.fromEntries([...entries].map(([ref, entry]) => [ref, [entry.status, entry.code]]))).toEqual({
      'texte.png': ['rejected', 'UNSUPPORTED_TYPE'],
      'gros.png': ['rejected', 'FILE_TOO_LARGE'],
      'absent.png': ['failed', 'SOURCE_NOT_FOUND'],
      '../dehors.png': ['failed', 'SOURCE_OUTSIDE_ROOT'],
      'e.png': ['rejected', 'UNREADABLE_FILE'],
      'f.png': ['failed', 'NETWORK'],
    })
    expect(outcome).toMatchObject({ processed: 6, interrupted: false, fatal: null })
  })

  it('après un envoi en échec, une autre ligne du même contenu tente sa chance', async () => {
    png(join(root, 'g1.png'), 'g')
    png(join(root, 'g2.png'), 'g')
    let calls = 0
    const client = fakeClient({
      upload: vi.fn(async () => {
        if (++calls === 1) throw new ApiError(0, 'NETWORK')
        return media('g')
      }),
    })
    const { entries } = await run([row('g1.png'), row('g2.png')], client)
    expect([entries.get('g1.png')!.status, entries.get('g2.png')!.status].sort()).toEqual(['created', 'failed'])
  })

  it('filet du serveur : 409 SOURCE_REF_EXISTS à l\'envoi → déjà importé', async () => {
    png(join(root, 'h.png'), 'h')
    const client = fakeClient({ upload: vi.fn(async () => { throw new ApiError(409, 'SOURCE_REF_EXISTS', null, { mediaId: 'race1' }) }) })
    const { entries } = await run([row('h.png')], client)
    expect(entries.get('h.png')).toMatchObject({ status: 'exists', mediaId: 'race1' })
    expect(client.media).toHaveBeenCalledWith('p1', 'race1')
  })

  it('erreur qui condamne l\'import : arrêt, ligne non enregistrée', async () => {
    for (const name of ['i1', 'i2', 'i3']) png(join(root, `${name}.png`), name)
    const client = fakeClient({ upload: vi.fn(async () => { throw new ApiError(401, 'TOKEN_REVOKED') }) })
    const { outcome, entries } = await run([row('i1.png'), row('i2.png'), row('i3.png')], client, { concurrency: 1 })
    expect(outcome.fatal).toMatchObject({ code: 'TOKEN_REVOKED' })
    expect(outcome.interrupted).toBe(true)
    expect(entries.size).toBe(0)
    expect(client.upload).toHaveBeenCalledTimes(1)
  })

  it('essai à blanc : rien n\'est envoyé, les doublons du manifeste sont vus', async () => {
    png(join(root, 'j1.png'), 'j')
    png(join(root, 'j2.png'), 'j')
    const client = fakeClient()
    const { entries } = await run([row('j1.png'), row('j2.png')], client, { dryRun: true, concurrency: 1 })
    expect(client.upload).not.toHaveBeenCalled()
    expect(entries.get('j1.png')).toMatchObject({ status: 'created', mediaId: null })
    expect(entries.get('j2.png')!.status).toBe('deduplicated')
  })

  it('reprise : les lignes terminées ne sont pas relues ; arrêt propre entre deux lignes', async () => {
    for (const name of ['k1', 'k2', 'k3']) png(join(root, `${name}.png`), name)
    const done: ImportEntry = { ref: 'k1.png', source: 'k1.png', status: 'created', mediaId: 'm', version: 1, url: 'u', code: null, detail: null, at: 'x' }
    const client = fakeClient()
    let stop = false
    const { outcome, entries } = await run([row('k1.png'), row('k2.png'), row('k3.png')], client, {
      entries: new Map([['k1.png', done]]),
      concurrency: 1,
      shouldStop: () => stop,
      onResult: () => { stop = true },
    })
    expect(client.upload).toHaveBeenCalledTimes(1)
    expect(entries.get('k1.png')).toBe(done)
    expect(entries.has('k3.png')).toBe(false)
    expect(outcome).toMatchObject({ processed: 1, interrupted: true })
  })

  it('dossiers : chemins existants retrouvés sans la casse, manquants créés parent d\'abord', async () => {
    const existing = [{ id: 'f1', parentId: null, name: 'Blog' }, { id: 'f2', parentId: 'f1', name: '2024' }]
    const createFolder = vi.fn(async (_project: string, name: string, parentId: string | null) => ({ id: `new-${name}`, parentId, name }))
    const client = { folders: vi.fn(async () => existing), createFolder }
    const rows = [{ folder: ['blog', '2024'] }, { folder: ['Blog', '2025', 'été'] }, { folder: [] }]
    const checked = await prepareFolders(client, 'p1', rows, false)
    expect(checked.ids.get(folderKey(['BLOG', '2024']))).toBe('f2')
    expect(checked.missing).toEqual(['Blog/2025/été'])
    expect(createFolder).not.toHaveBeenCalled()
    const created = await prepareFolders(client, 'p1', rows, true)
    expect(createFolder.mock.calls).toEqual([['p1', '2025', 'f1'], ['p1', 'été', 'new-2025']])
    expect(created).toMatchObject({ missing: [], created: 2 })
    expect(created.ids.get('blog/2025/été')).toBe('new-été')
  })

  it('étiquettes : absentes signalées, ou créées d\'après leur slug', async () => {
    const createTag = vi.fn(async (_project: string, slug: string) => ({ id: slug, slug, name: slug }))
    const client = { tags: vi.fn(async () => [{ id: 't1', slug: 'ete', name: 'Été' }]), createTag }
    const rows = [{ tags: ['ete', 'plage'] }, { tags: ['plage', 'hiver'] }]
    expect(await prepareTags(client, 'p1', rows, false)).toEqual({ missing: ['hiver', 'plage'], created: 0 })
    expect(await prepareTags(client, 'p1', rows, true)).toEqual({ missing: [], created: 2 })
    expect(createTag.mock.calls.map(call => call[1])).toEqual(['hiver', 'plage'])
  })

  it('domaine public : seul le chemin /m/ est gardé', () => {
    expect(withPublicUrl('http://127.0.0.1:3000/m/a/v1/x.png', 'https://cdn.example.com/media/')).toBe('https://cdn.example.com/media/m/a/v1/x.png')
    expect(withPublicUrl('http://127.0.0.1:3000/m/a/v1/x.png', null)).toBe('http://127.0.0.1:3000/m/a/v1/x.png')
  })
})

describe('import plan', () => {
  it('parcourt un dossier : types d\'après le contenu, cachés et non acceptés écartés, ordre stable', async () => {
    const root = mkdtempSync(join(TMP, 'plan-'))
    mkdirSync(join(root, 'blog', '2024'), { recursive: true })
    mkdirSync(join(root, '.git'))
    png(join(root, 'blog', '2024', 'b.png'), 'b')
    png(join(root, 'a.png'), 'a')
    png(join(root, '.cache.png'), 'c')
    png(join(root, '.git', 'x.png'), 'x')
    writeFileSync(join(root, 'notes.txt'), 'texte')
    writeFileSync(join(root, 'vide.png'), '')
    const report = await scanDirectory(root, { foldersFromPath: true })
    expect(report.files.map(file => [file.source, file.mimeType, file.folder])).toEqual([['a.png', 'image/png', ''], ['blog/2024/b.png', 'image/png', 'blog/2024']])
    expect(report.rejected.map(item => [item.source, item.reason])).toEqual([['notes.txt', 'UNSUPPORTED_TYPE'], ['vide.png', 'SOURCE_EMPTY']])
    expect(report.skipped.hidden).toBe(2)
    expect(report.totalBytes).toBe(2 * (PNG.length + 1))
    expect((await scanDirectory(root, { foldersFromPath: false })).files.every(file => file.folder === '')).toBe(true)
  })

  it('dossier proposé seulement s\'il est valable ; durée estimée', () => {
    expect(validFolderPath('blog/2024')).toBe(true)
    expect(validFolderPath(Array.from({ length: 9 }, (_, index) => `n${index}`).join('/'))).toBe(false)
    expect(validFolderPath('a\b')).toBe(false)
    expect(estimatedMinutes(0)).toBe(1)
    expect(estimatedMinutes(10_000)).toBe(167)
  })
})

describe('commande import run : réglages', () => {
  it('adresse du serveur : --url, sinon le serveur local d\'après PORT et HOST', () => {
    expect(serverUrl('https://media.example.com', {})).toBe('https://media.example.com')
    expect(serverUrl(undefined, {})).toBe('http://localhost:3000')
    expect(serverUrl(undefined, { PORT: '3200', HOST: '0.0.0.0' })).toBe('http://localhost:3200')
    expect(serverUrl(undefined, { PORT: '8080', NITRO_HOST: '10.0.0.5' })).toBe('http://10.0.0.5:8080')
  })

  it('clé : variable d\'environnement d\'abord, sinon première ligne non vide du fichier', () => {
    const file = join(TMP, 'cle.txt')
    writeFileSync(file, '\n  sm_sk_fichier  \nautre\n')
    expect(readApiKey({ SURGE_MEDIA_API_KEY: ' sm_sk_env ' }, file)).toBe('sm_sk_env')
    expect(readApiKey({}, file)).toBe('sm_sk_fichier')
    expect(readApiKey({ SURGE_MEDIA_API_KEY: '  ' }, undefined)).toBeNull()
    expect(() => readApiKey({}, join(TMP, 'absent.txt'))).toThrow()
  })

  it('fichiers d\'un manifeste', () => {
    expect(importFiles('/data/Stock.CSV')).toEqual({ state: '/data/Stock.state.jsonl', mapping: '/data/Stock.mapping.csv' })
    expect(importFiles('/data/stock')).toEqual({ state: '/data/stock.state.jsonl', mapping: '/data/stock.mapping.csv' })
  })

  it('projet : celui de la clé, ou --project par identifiant ou slug pour un jeton personnel', async () => {
    const projects = vi.fn(async () => [{ id: 'p1', name: 'Site', slug: 'site', scopes: [] }, { id: 'p2', name: 'Blog', slug: 'blog', scopes: [] }])
    const key = { project: { id: 'p1', name: 'Site', slug: 'site', archived: false } } as never
    const token = { project: null } as never
    expect(await resolveProject({ projects }, key, undefined)).toEqual({ id: 'p1' })
    expect(await resolveProject({ projects }, key, 'site')).toEqual({ id: 'p1' })
    expect(await resolveProject({ projects }, key, 'blog')).toBeNull()
    expect(projects).not.toHaveBeenCalled()
    expect(await resolveProject({ projects }, token, undefined)).toBe('ambiguous')
    expect(await resolveProject({ projects }, token, 'blog')).toMatchObject({ id: 'p2' })
    expect(await resolveProject({ projects }, token, 'p1')).toMatchObject({ id: 'p1' })
    expect(await resolveProject({ projects }, token, 'absent')).toBeNull()
  })
})

describe('messages de la CLI', () => {
  it('mêmes paramètres en français et en anglais pour chaque message de l\'import', () => {
    const params = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',')
    const keys = (Object.keys(fr) as (keyof typeof fr)[]).filter(key => /import/i.test(key))
    expect(keys.length).toBeGreaterThan(100)
    for (const key of keys) expect(params(en[key]), key).toBe(params(fr[key]))
  })
})
