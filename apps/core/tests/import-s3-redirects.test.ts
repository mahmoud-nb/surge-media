import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { en } from '../cli/i18n/en'
import { fr } from '../cli/i18n/fr'
import { parseCsv } from '../cli/lib/import/csv'
import { parseManifest, sourceKind } from '../cli/lib/import/manifest'
import { scanBucket } from '../cli/lib/import/plan'
import { buildRedirects, type MappingRow, oldAddress, parseMapping, REDIRECT_FORMATS, redirectOrigin, renderRedirects } from '../cli/lib/import/redirects'
import { createS3Reader, parseS3Url, S3_ACCESS_KEY_VARIABLE, S3_SECRET_KEY_VARIABLE, type S3Sdk, s3SettingsFrom, s3SourceError, s3Url } from '../cli/lib/import/s3'
import { openSource, type SourceError } from '../cli/lib/import/sources'
import { renderMapping } from '../cli/lib/import/state'

/**
 * Module I-3 de l'import (.claude/architecture-import.md) : source `s3://` (SDK remplacé par un faux) et
 * redirections des anciennes adresses (fonctions pures).
 */

const TMP = mkdtempSync(join(tmpdir(), 'surge-media-import-s3-'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const png = (seed: string) => Buffer.concat([PNG, Buffer.from(seed)])

/** Faux SDK : un compartiment en mémoire, pages de deux objets, commandes enregistrées. */
function fakeSdk(objects: Record<string, Buffer>, failures: Record<string, unknown> = {}) {
  const commands: { type: string, input: Record<string, unknown> }[] = []
  const configs: Record<string, unknown>[] = []
  class Command {
    constructor(readonly type: string, readonly input: Record<string, unknown>) {}
  }
  const sdk: S3Sdk = {
    S3Client: class {
      constructor(config: Record<string, unknown>) {
        configs.push(config)
      }

      async send(command: unknown) {
        const { type, input } = command as Command
        commands.push({ type, input })
        if (type === 'list') {
          if (failures.list) throw failures.list
          const keys = Object.keys(objects).filter(key => key.startsWith(String(input.Prefix ?? ''))).sort()
          const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0
          const page = keys.slice(start, start + 2)
          const more = start + 2 < keys.length
          return { Contents: page.map(key => ({ Key: key, Size: objects[key]!.length })), IsTruncated: more, NextContinuationToken: more ? String(start + 2) : undefined }
        }
        const key = String(input.Key)
        if (failures[key]) throw failures[key]
        const body = objects[key]
        if (!body) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } })
        const range = /^bytes=0-(\d+)$/.exec(String(input.Range ?? ''))
        const slice = range ? body.subarray(0, Number(range[1]) + 1) : body
        return { ContentLength: slice.length, Body: Readable.from([slice]) }
      }
    } as never,
    ListObjectsV2Command: class extends Command {
      constructor(input: Record<string, unknown>) {
        super('list', input)
      }
    },
    GetObjectCommand: class extends Command {
      constructor(input: Record<string, unknown>) {
        super('get', input)
      }
    },
  }
  return { sdk, commands, configs }
}

const SETTINGS = { region: 'eu-west-3', forcePathStyle: false, accessKeyId: 'AKIDTEST', secretAccessKey: 'secret-de-test' }

describe('adresse et réglages S3', () => {
  it('s3://compartiment/clé : compartiment et clé, clé telle quelle', () => {
    expect(parseS3Url('s3://anciens-medias/uploads/2024/a b%.jpg')).toEqual({ bucket: 'anciens-medias', key: 'uploads/2024/a b%.jpg' })
    expect(parseS3Url('s3://anciens-medias')).toEqual({ bucket: 'anciens-medias', key: '' })
    expect(parseS3Url('s3://anciens-medias/')).toEqual({ bucket: 'anciens-medias', key: '' })
    expect(parseS3Url('S3://Bucket.Name-1/x')).toEqual({ bucket: 'Bucket.Name-1', key: 'x' })
    for (const url of ['s3://', 's3:///cle', 's3://a/x', 'https://bucket/x', 's3://bucket avec espace/x']) expect(parseS3Url(url), url).toBeNull()
    expect(s3Url('b-1', 'a/b.jpg')).toBe('s3://b-1/a/b.jpg')
  })

  it('identifiants lus dans l\'environnement seulement ; région par défaut', () => {
    expect(s3SettingsFrom({}, {})).toBeNull()
    expect(s3SettingsFrom({ [S3_ACCESS_KEY_VARIABLE]: 'id' }, {})).toBeNull()
    expect(s3SettingsFrom({ [S3_ACCESS_KEY_VARIABLE]: ' id ', [S3_SECRET_KEY_VARIABLE]: ' secret ' }, {}))
      .toEqual({ region: 'us-east-1', forcePathStyle: false, accessKeyId: 'id', secretAccessKey: 'secret' })
    expect(s3SettingsFrom({ [S3_ACCESS_KEY_VARIABLE]: 'id', [S3_SECRET_KEY_VARIABLE]: 's', SURGE_MEDIA_IMPORT_S3_SESSION_TOKEN: 'jeton' }, { endpoint: 'http://127.0.0.1:9000', region: 'auto', pathStyle: true }))
      .toEqual({ endpoint: 'http://127.0.0.1:9000', region: 'auto', forcePathStyle: true, accessKeyId: 'id', secretAccessKey: 's', sessionToken: 'jeton' })
  })

  it('erreurs du SDK → codes de source', () => {
    const code = (error: unknown) => [s3SourceError(error).code, s3SourceError(error).detail]
    expect(code({ name: 'NoSuchKey' })).toEqual(['SOURCE_NOT_FOUND', 'NoSuchKey'])
    expect(code({ name: 'NoSuchBucket' })).toEqual(['SOURCE_NOT_FOUND', 'NoSuchBucket'])
    expect(code({ name: 'Unknown', $metadata: { httpStatusCode: 404 } })).toEqual(['SOURCE_NOT_FOUND', 'Unknown'])
    expect(code({ name: 'AccessDenied' })).toEqual(['SOURCE_UNREADABLE', 'AccessDenied'])
    expect(code({ name: 'SignatureDoesNotMatch' })).toEqual(['SOURCE_UNREADABLE', 'SignatureDoesNotMatch'])
    expect(code({ name: 'TimeoutError' })).toEqual(['DOWNLOAD_FAILED', 'TimeoutError'])
    expect(code(new Error('boom'))).toEqual(['DOWNLOAD_FAILED', 'Error'])
  })
})

describe('lecteur S3', () => {
  const objects = { 'uploads/a.png': png('a'), 'uploads/b.png': png('b'), 'uploads/c.png': png('c'), 'autre/x.png': png('x') }

  it('client configuré avec les identifiants de la source, sans sommes de contrôle imposées', () => {
    const { sdk, configs } = fakeSdk({})
    createS3Reader(sdk, { ...SETTINGS, endpoint: 'http://127.0.0.1:9000', forcePathStyle: true })
    expect(configs[0]).toMatchObject({
      region: 'eu-west-3',
      endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true,
      credentials: { accessKeyId: 'AKIDTEST', secretAccessKey: 'secret-de-test' },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  })

  it('liste un préfixe page après page', async () => {
    const { sdk, commands } = fakeSdk(objects)
    const listed: string[] = []
    for await (const object of createS3Reader(sdk, SETTINGS).list('b', 'uploads/')) listed.push(`${object.key}:${object.size}`)
    expect(listed).toEqual(['uploads/a.png:9', 'uploads/b.png:9', 'uploads/c.png:9'])
    expect(commands.map(command => command.input.ContinuationToken)).toEqual([undefined, '2'])
  })

  it('lit le début d\'un objet par une requête partielle', async () => {
    const { sdk, commands } = fakeSdk({ 'gros.png': png('x'.repeat(5000)) })
    const head = await createS3Reader(sdk, SETTINGS).head('b', 'gros.png', 1024)
    expect(head.length).toBe(1024)
    expect(commands[0]!.input).toMatchObject({ Bucket: 'b', Key: 'gros.png', Range: 'bytes=0-1023' })
  })

  it('télécharge un objet ; refuse au-delà de la taille permise, et un objet vide ou absent', async () => {
    const { sdk } = fakeSdk({ ...objects, 'vide.png': Buffer.alloc(0) })
    const reader = createS3Reader(sdk, SETTINGS)
    const path = join(TMP, 'objet')
    expect(await reader.download('b', 'uploads/a.png', path, { maxBytes: 100 })).toEqual({ size: 9 })
    expect(readFileSync(path).equals(png('a'))).toBe(true)
    const code = (key: string, maxBytes = 100) => reader.download('b', key, path, { maxBytes }).then(() => 'ok', error => (error as SourceError).code)
    expect(await code('uploads/a.png', 4)).toBe('DOWNLOAD_TOO_LARGE')
    expect(await code('vide.png')).toBe('SOURCE_EMPTY')
    expect(await code('absent.png')).toBe('SOURCE_NOT_FOUND')
  })

  it('compartiment refusé : erreur de source dès la liste', async () => {
    const { sdk } = fakeSdk({}, { list: { name: 'AccessDenied' } })
    await expect(createS3Reader(sdk, SETTINGS).list('b', '').next()).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE', detail: 'AccessDenied' })
  })
})

describe('import plan sur un compartiment', () => {
  it('mêmes règles qu\'un dossier : types d\'après le contenu, dossiers sous le préfixe, cachés et marqueurs ignorés', async () => {
    const { sdk, commands } = fakeSdk({
      'uploads/': Buffer.alloc(0),
      'uploads/a.png': png('a'),
      'uploads/blog/2024/b.png': png('b'),
      'uploads/.thumbs/c.png': png('c'),
      'uploads/notes.txt': Buffer.from('texte'),
      'uploads/vide.png': Buffer.alloc(0),
      'uploads/refuse.png': png('r'),
      'ailleurs/z.png': png('z'),
    }, { 'uploads/refuse.png': { name: 'AccessDenied' } })
    const seen: number[] = []
    const report = await scanBucket(createS3Reader(sdk, SETTINGS), 'anciens', 'uploads/', { foldersFromPath: true, onFile: count => seen.push(count) })
    expect(report.files.map(file => [file.source, file.mimeType, file.folder])).toEqual([
      ['s3://anciens/uploads/a.png', 'image/png', ''],
      ['s3://anciens/uploads/blog/2024/b.png', 'image/png', 'blog/2024'],
    ])
    expect(report.rejected.map(item => [item.source, item.reason, item.detail])).toEqual([
      ['s3://anciens/uploads/notes.txt', 'UNSUPPORTED_TYPE', null],
      ['s3://anciens/uploads/refuse.png', 'SOURCE_UNREADABLE', 'AccessDenied'],
      ['s3://anciens/uploads/vide.png', 'SOURCE_EMPTY', null],
    ])
    expect(report.skipped).toEqual({ symlinks: 0, hidden: 1, special: 1 })
    expect(seen.at(-1)).toBe(5)
    // Un objet vide n'est pas lu ; les autres par une requête partielle.
    expect(commands.filter(command => command.type === 'get').every(command => String(command.input.Range).startsWith('bytes=0-'))).toBe(true)
    expect(commands.filter(command => command.type === 'get')).toHaveLength(4)
  })

  it('préfixe partiel : le dossier part du dernier « / » du préfixe', async () => {
    const { sdk } = fakeSdk({ 'uploads/2024/a.png': png('a'), 'uploads/2025/b.png': png('b') })
    const report = await scanBucket(createS3Reader(sdk, SETTINGS), 'anciens', 'uploads/20', { foldersFromPath: true })
    expect(report.files.map(file => file.folder)).toEqual(['2024', '2025'])
    expect((await scanBucket(createS3Reader(sdk, SETTINGS), 'anciens', '', { foldersFromPath: false })).files.map(file => file.folder)).toEqual(['', ''])
  })
})

describe('sources s3:// d\'un manifeste', () => {
  it('reconnues par le manifeste, avec une clé', () => {
    expect(sourceKind('s3://anciens/uploads/a.png')).toBe('s3')
    expect(sourceKind('s3://anciens')).toBeNull()
    expect(sourceKind('s3://')).toBeNull()
    const { rows, issues } = parseManifest('source\ns3://anciens/uploads/a.png\ns3://anciens/\n')
    expect(rows).toMatchObject([{ kind: 's3', source: 's3://anciens/uploads/a.png', ref: 's3://anciens/uploads/a.png' }])
    expect(issues.map(issue => [issue.line, issue.code])).toEqual([[3, 'sourceScheme']])
  })

  it('téléchargées dans un dossier temporaire ; nom de fichier = dernier segment de la clé, tel quel', async () => {
    const calls: unknown[] = []
    const { sdk } = fakeSdk({ 'uploads/100% été?.png': png('a') })
    const reader = createS3Reader(sdk, SETTINGS)
    const row = { source: 's3://anciens/uploads/100% été?.png', kind: 's3' as const, filename: null }
    const file = await openSource(row, {
      root: TMP,
      maxBytes: 100,
      s3: (source, path, options) => {
        calls.push([source, options.maxBytes])
        const location = parseS3Url(source)!
        return reader.download(location.bucket, location.key, path, options)
      },
    })
    expect([file.size, file.filename]).toEqual([9, '100% été?.png'])
    expect(calls).toEqual([['s3://anciens/uploads/100% été?.png', 100]])
    expect(readFileSync(file.path).equals(png('a'))).toBe(true)
    await file.cleanup()
    expect(() => readFileSync(file.path)).toThrow()
    await expect(openSource(row, { root: TMP, maxBytes: 100 })).rejects.toMatchObject({ code: 'SOURCE_UNREADABLE' })
    await expect(openSource({ ...row, source: 's3://anciens/absent.png' }, { root: TMP, maxBytes: 100, s3: (source, path, options) => reader.download('anciens', 'absent.png', path, options) }))
      .rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
  })
})

describe('redirections des anciennes adresses', () => {
  const NEW = 'https://media.example.com/m'
  const row = (source: string, id: string, status: MappingRow['status'] = 'created'): MappingRow => ({ source, status, url: status === 'created' || status === 'exists' || status === 'deduplicated' ? `${NEW}/${id}/v1/x.jpg` : '' })
  const options = (format: (typeof REDIRECT_FORMATS)[number], extra: Partial<Parameters<typeof buildRedirects>[1]> = {}) => ({ format, prefix: '', origin: null, ...extra })

  it('table de correspondance relue, colonnes trouvées par leur nom', () => {
    const text = renderMapping([{ source: 'a, b.jpg', ref: 'a' }, { source: 'c.jpg', ref: 'c' }], new Map([['a', { ref: 'a', source: 'a, b.jpg', status: 'created', mediaId: 'm1', version: 1, url: `${NEW}/m1/v1/a.jpg`, code: null, detail: null, at: 'x' }]]))
    expect(parseMapping(text)).toEqual([{ source: 'a, b.jpg', status: 'created', url: `${NEW}/m1/v1/a.jpg` }, { source: 'c.jpg', status: 'pending', url: '' }])
    expect(parseMapping('url,status,source\nu,exists,s\n')).toEqual([{ source: 's', status: 'exists', url: 'u' }])
    expect(parseMapping('')).toBe('empty')
    expect(parseMapping('source,ref\na,b\n')).toBe('columns')
  })

  it('ancienne adresse : chemin décodé d\'une URL, préfixe pour un chemin ou une clé S3', () => {
    expect(oldAddress('https://www.exemple.fr/uploads/2024/plage%20%C3%A9t%C3%A9.jpg?v=2', '')).toEqual({ path: '/uploads/2024/plage été.jpg', origin: 'https://www.exemple.fr' })
    expect(oldAddress('https://www.exemple.fr/a%2Fb.jpg', '')!.path).toBe('/a%2Fb.jpg')
    expect(oldAddress('blog/2024/a.jpg', '/uploads/')).toEqual({ path: '/uploads/blog/2024/a.jpg', origin: null })
    expect(oldAddress('.\\blog\\a.jpg', 'uploads')).toEqual({ path: '/uploads/blog/a.jpg', origin: null })
    expect(oldAddress('s3://anciens/uploads/a.jpg', '/files')).toEqual({ path: '/files/uploads/a.jpg', origin: null })
    for (const source of ['C:\\photos\\a.jpg', '../a.jpg', 'https://www.exemple.fr/%E0%A4%A.jpg', 's3://anciens', 'ftp://hote/a.jpg', '']) expect(oldAddress(source, ''), source).toBeNull()
  })

  it('--origin : un domaine http(s) sans chemin', () => {
    expect(redirectOrigin('https://www.example.com/')).toBe('https://www.example.com')
    expect(redirectOrigin('http://localhost:8080')).toBe('http://localhost:8080')
    for (const value of ['www.example.com', 'https://www.example.com/uploads', 'https://u:p@www.example.com', 'https://www.example.com?x=1', 'ftp://www.example.com']) expect(redirectOrigin(value), value).toBeNull()
  })

  it('une règle par ancienne adresse importée ; le reste est compté ou expliqué', () => {
    const rows = [
      row('a.jpg', 'm1'),
      row('b.jpg', 'm2', 'exists'),
      row('copie-de-a.jpg', 'm1', 'deduplicated'),
      row('refuse.jpg', '', 'rejected'),
      row('echec.jpg', '', 'failed'),
      row('pas-encore.jpg', '', 'pending'),
      row('C:\\photos\\x.jpg', 'm3'),
      row('dit "oui".jpg', 'm4'),
      row('prix$.jpg', 'm5'),
      row('a.jpg', 'm6'),
      row('a.jpg', 'm1'),
    ]
    const plan = buildRedirects(rows, options('nginx', { prefix: '/uploads' }))
    expect(plan.rules.map(rule => [rule.path, rule.to])).toEqual([
      ['/uploads/a.jpg', `${NEW}/m1/v1/x.jpg`],
      ['/uploads/b.jpg', `${NEW}/m2/v1/x.jpg`],
      ['/uploads/copie-de-a.jpg', `${NEW}/m1/v1/x.jpg`],
    ])
    expect(plan.notImported).toBe(3)
    expect(plan.skipped).toEqual([
      { source: 'C:\\photos\\x.jpg', reason: 'invalid' },
      { source: 'dit "oui".jpg', reason: 'unsafe' },
      { source: 'prix$.jpg', reason: 'unsafe' },
      { source: 'a.jpg', reason: 'conflict' },
    ])
    // JSON et CSV échappent eux-mêmes : rien n'y est écarté pour un caractère.
    expect(buildRedirects(rows, options('json')).skipped.map(item => item.reason)).toEqual(['invalid', 'conflict'])
  })

  it('cloudflare : adresses complètes exigées ; deux domaines peuvent porter le même chemin', () => {
    const rows = [row('https://a.exemple.fr/x.jpg', 'm1'), row('https://b.exemple.fr/x.jpg', 'm2'), row('local.jpg', 'm3')]
    const plan = buildRedirects(rows, options('cloudflare'))
    expect(plan.rules).toHaveLength(2)
    expect(plan.skipped).toEqual([{ source: 'local.jpg', reason: 'noOrigin' }])
    expect(buildRedirects(rows, options('cloudflare', { origin: 'https://www.exemple.fr' })).rules.at(-1)).toEqual({ path: '/local.jpg', origin: 'https://www.exemple.fr', to: `${NEW}/m3/v1/x.jpg` })
    // Une configuration vaut pour un seul site : le même chemin ne peut pas mener à deux médias.
    expect(buildRedirects(rows, options('caddy')).skipped).toEqual([{ source: 'https://b.exemple.fr/x.jpg', reason: 'conflict' }])
  })

  const rules = [
    { path: '/uploads/plage été (1).jpg', origin: 'https://www.exemple.fr', to: `${NEW}/m1/v1/plage.jpg` },
    { path: '/uploads/a+b.png', origin: 'https://www.exemple.fr', to: `${NEW}/m2/v1/a-b.png` },
  ]
  const labels = { title: 'Titre', usage: ['Usage'] }

  it('nginx : table map sur le chemin décodé, vide par défaut', () => {
    expect(renderRedirects('nginx', rules, labels)).toBe([
      '# Titre',
      '# Usage',
      'map $uri $surge_media_redirect {',
      '    default "";',
      `    "/uploads/plage été (1).jpg" "${NEW}/m1/v1/plage.jpg";`,
      `    "/uploads/a+b.png" "${NEW}/m2/v1/a-b.png";`,
      '}',
      '',
    ].join('\n'))
  })

  it('caddy : map sur {path}, puis redir seulement quand une cible existe', () => {
    expect(renderRedirects('caddy', rules, labels)).toBe([
      '# Titre',
      '# Usage',
      'map {path} {surge_media_redirect} {',
      `\t"/uploads/plage été (1).jpg" "${NEW}/m1/v1/plage.jpg"`,
      `\t"/uploads/a+b.png" "${NEW}/m2/v1/a-b.png"`,
      '\tdefault ""',
      '}',
      '@surge_media_moved expression `{surge_media_redirect} != ""`',
      'redir @surge_media_moved {surge_media_redirect} 301',
      '',
    ].join('\n'))
  })

  it('apache : RedirectMatch sur le chemin exact, caractères d\'expression échappés', () => {
    const text = renderRedirects('apache', rules, labels)
    expect(text).toContain(`RedirectMatch 301 "^/uploads/plage été \\(1\\)\\.jpg$" "${NEW}/m1/v1/plage.jpg"\n`)
    expect(text).toContain(`RedirectMatch 301 "^/uploads/a\\+b\\.png$" "${NEW}/m2/v1/a-b.png"\n`)
    const pattern = /RedirectMatch 301 "(.*)" "/.exec(text.split('\n')[2]!)![1]!
    expect(new RegExp(pattern).test('/uploads/plage été (1).jpg')).toBe(true)
    expect(new RegExp(pattern).test('/uploads/plage été (1)Xjpg')).toBe(false)
  })

  it('cloudflare : CSV sans en-tête, hôte et chemin encodé, cible, 301', () => {
    const text = renderRedirects('cloudflare', [...rules, { path: '/a,b.jpg', origin: 'http://old.exemple.fr:8080', to: `${NEW}/m3/v1/a.jpg` }], labels)
    expect(parseCsv(text).map(record => record.fields)).toEqual([
      ['www.exemple.fr/uploads/plage%20%C3%A9t%C3%A9%20(1).jpg', `${NEW}/m1/v1/plage.jpg`, '301'],
      ['www.exemple.fr/uploads/a+b.png', `${NEW}/m2/v1/a-b.png`, '301'],
      ['old.exemple.fr:8080/a,b.jpg', `${NEW}/m3/v1/a.jpg`, '301'],
    ])
    expect(text).not.toContain('#')
  })

  it('json : la liste brute', () => {
    expect(JSON.parse(renderRedirects('json', rules, labels))).toEqual([
      { from: '/uploads/plage été (1).jpg', origin: 'https://www.exemple.fr', to: `${NEW}/m1/v1/plage.jpg`, status: 301 },
      { from: '/uploads/a+b.png', origin: 'https://www.exemple.fr', to: `${NEW}/m2/v1/a-b.png`, status: 301 },
    ])
  })
})

describe('messages de la CLI', () => {
  it('un message par raison d\'écart et par format, dans les deux langues', () => {
    for (const messages of [fr, en] as Record<string, string>[]) {
      for (const reason of ['invalid', 'unsafe', 'conflict', 'noOrigin']) expect(messages[`import.redirects.skipped.${reason}`], reason).toBeTruthy()
      expect(messages['import.error.redirectFormat']).toContain('{formats}')
    }
    expect(REDIRECT_FORMATS).toEqual(['nginx', 'caddy', 'apache', 'cloudflare', 'json'])
  })
})
