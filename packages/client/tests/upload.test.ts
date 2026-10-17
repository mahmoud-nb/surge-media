import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSurgeClient } from '../src/client'
import { SurgeApiError } from '../src/errors'
import { errorMessage } from '../src/i18n'
import type { Media, UploadRules } from '../src/types'
import { typeLabels } from '../src/upload/file-types'
import { createUploadQueue, type UploadItem } from '../src/upload/queue'
import { abortError } from '../src/upload/request'
import { acceptAttribute, acceptedExtensions, checkFile, fileKind, matchFileType, maxSizeFor, uploadKinds } from '../src/upload/rules'
import { delegatedToken, imageMedia, videoMedia } from './fixtures'

/**
 * Envoi (architecture phase E, § 12.3) : règles et pré-contrôle, messages précis, requête multipart
 * (fetch hors navigateur, XMLHttpRequest simulé dans un navigateur), file d'envoi sans framework.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const rules: UploadRules = {
  types: [
    { mimeType: 'image/jpeg', extension: 'jpg', kind: 'image', maxSize: 1000, converted: false },
    { mimeType: 'image/png', extension: 'png', kind: 'image', maxSize: 1000, converted: false },
    { mimeType: 'video/mp4', extension: 'mp4', kind: 'video', maxSize: 5000, converted: false },
    { mimeType: 'video/mp2t', extension: 'ts', kind: 'video', maxSize: 5000, converted: true },
  ],
  remaining: null,
  visibility: null,
  folderId: null,
}

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type })
const BASE = 'https://media.example.com'
/** Espaces insécables d'Intl (« 25 Mo », « 1 000 ») remplacés par des espaces simples. */
const plain = (text: string) => text.replace(/[\u00A0\u202F]/g, ' ')

describe('règles d\'envoi et pré-contrôle', () => {
  it('genres, tailles, extensions et attribut accept', () => {
    expect(uploadKinds(rules)).toEqual(['image', 'video'])
    expect(uploadKinds(rules, ['video'])).toEqual(['video'])
    expect(maxSizeFor(rules, 'video')).toBe(5000)
    expect(maxSizeFor({ ...rules, types: [] }, 'image')).toBe(0)
    expect(acceptedExtensions(rules)).toEqual(['jpg', 'png', 'mp4', 'ts'])
    expect(acceptedExtensions(rules, undefined, { converted: false })).toEqual(['jpg', 'png', 'mp4'])
    const accept = acceptAttribute(rules, ['image']).split(',')
    expect(accept).toEqual(['image/jpeg', 'image/png', 'image/jpg', '.jpg', '.jpeg', '.jpe', '.png'])
    expect(acceptAttribute(rules, ['video'])).toContain('.mts')
  })

  it('type annoncé, alias, extension pour un type générique ou un format converti', () => {
    expect(matchFileType(file('a.jpg', 'image/jpg'), rules)?.mimeType).toBe('image/jpeg')
    expect(matchFileType(file('clip', 'video/x-m4v'), rules)?.mimeType).toBe('video/mp4')
    expect(matchFileType(file('a.png', ''), rules)?.mimeType).toBe('image/png')
    expect(matchFileType(file('a.mts', 'text/vnd.trolltech.linguist'), rules)?.mimeType).toBe('video/mp2t')
    // Type annoncé précis et différent : l'extension ne suffit pas (photo HEIC renommée en .jpg).
    expect(matchFileType(file('a.jpg', 'image/heic'), rules)).toBeNull()
    expect(fileKind(file('a.mov', 'video/quicktime'))).toBe('video')
    expect(fileKind(file('a.webp', ''))).toBe('image')
    expect(fileKind(file('notes.txt', 'text/plain'))).toBeNull()
  })

  it('erreurs du pré-contrôle : fichier vide, type refusé, trop gros ; type inconnu du système accepté', () => {
    expect(checkFile(file('a.png', 'image/png'), rules)).toBeNull()
    expect(checkFile(file('a.png', 'image/png', 0), rules)?.code).toBe('NO_FILE')
    const unsupported = checkFile(file('a.svg', 'image/svg+xml'), rules)
    expect([unsupported?.code, unsupported?.status, unsupported?.extensions.accepted]).toEqual(['UNSUPPORTED_TYPE', 0, ['image/jpeg', 'image/png', 'video/mp4', 'video/mp2t']])
    expect(checkFile(file('a.mp4', 'video/mp4'), rules, ['image'])?.code).toBe('UNSUPPORTED_TYPE')
    expect(checkFile(file('a.webm', ''), rules)?.code).toBe('UNSUPPORTED_TYPE')
    const tooLarge = checkFile(file('a.jpg', 'image/jpeg', 1001), rules)
    expect([tooLarge?.code, tooLarge?.extensions.maxSize]).toEqual(['FILE_TOO_LARGE', 1000])
    expect(checkFile(file('VIDEO0001', '', 4000), rules)).toBeNull()
    expect(checkFile(file('VIDEO0001', '', 6000), rules)?.extensions.maxSize).toBe(5000)
    expect(checkFile(file('a.png', 'image/png'), { ...rules, types: [] })?.code).toBe('UNSUPPORTED_TYPE')
  })

  it('messages précis dans la langue demandée', () => {
    expect(plain(errorMessage('FILE_TOO_LARGE', 'fr', { maxSize: 25 * 1024 * 1024 }))).toBe('Ce fichier est trop volumineux. Taille maximale : 25 Mo.')
    expect(plain(errorMessage('FILE_TOO_LARGE', 'en', { maxSize: 25 * 1024 * 1024 }))).toBe('This file is too large. Maximum size: 25 MB.')
    expect(errorMessage('UNSUPPORTED_TYPE', 'fr', { accepted: ['image/jpeg', 'image/png', 'application/x-y'] }))
      .toBe('Ce type de fichier n\'est pas accepté. Types acceptés : JPG, PNG, APPLICATION/X-Y.')
    expect(errorMessage('UNSUPPORTED_TYPE', 'en', { accepted: [] })).toBe('This file type is not accepted. No file type is accepted right now.')
    expect(errorMessage('FILE_TOO_LARGE', 'fr')).toBe('Ce fichier est trop volumineux.')
    expect(plain(new SurgeApiError({ status: 0, code: 'FILE_TOO_LARGE', extensions: { maxSize: 2048 } }).localizedMessage('en'))).toBe('This file is too large. Maximum size: 2 kB.')
    expect(typeLabels(['video/mp4', 'video/mp4', 'video/x-matroska'])).toBe('MP4, MKV')
  })
})

/** `fetch` simulé : enregistre les requêtes (corps compris) et rejoue les réponses données. */
function mockFetch(responses: Response[]) {
  const calls: { url: string, method: string, headers: Record<string, string>, body: unknown }[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', headers: { ...(init?.headers as Record<string, string>) }, body: init?.body })
    const next = responses.shift()
    if (!next) throw new Error('Unexpected request')
    return next
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const problem = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, instance: '/x', requestId: 'req-9', ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  })

describe('envoi par fetch (hors navigateur)', () => {
  it('multipart : champs avant le fichier, champs absents omis, Media rendu', async () => {
    const { fetch, calls } = mockFetch([json(imageMedia, 201)])
    const client = createSurgeClient({ baseUrl: BASE, projectId: 'cmproject01', getToken: () => delegatedToken({ exp: 4_102_444_800, scopes: ['media:upload'] }), fetch })
    const media = await client.media.upload(file('photo.png', 'image/png'), { title: 'Photo', altText: 'Un chat', visibility: 'private' })
    expect(media).toEqual(imageMedia)
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/projects/cmproject01/media`)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.headers.Authorization).toMatch(/^Bearer sm_dt_/)
    const form = calls[0]!.body as FormData
    expect([...form.keys()]).toEqual(['title', 'altText', 'visibility', 'file'])
    expect((form.get('file') as File).name).toBe('photo.png')
  })

  it('erreur RFC 9457 avec membres d\'extension ; un seul nouvel essai après un jeton expiré', async () => {
    const { fetch, calls } = mockFetch([
      problem(401, { code: 'TOKEN_EXPIRED' }),
      problem(413, { code: 'FILE_TOO_LARGE', detail: 'too big', maxSize: 1000 }),
    ])
    let issued = 0
    const client = createSurgeClient({
      baseUrl: BASE,
      projectId: 'cmproject01',
      getToken: () => {
        issued++
        return delegatedToken({ exp: 4_102_444_800, scopes: ['media:upload'] })
      },
      fetch,
    })
    const error = await client.media.upload(file('big.png', 'image/png')).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SurgeApiError)
    expect(error).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE', requestId: 'req-9', extensions: { maxSize: 1000 } })
    expect(plain(client.errorMessage(error, 'fr'))).toBe('Ce fichier est trop volumineux. Taille maximale : 1 000 o.')
    expect([calls.length, issued]).toEqual([2, 2])
  })

  it('affiche : PUT avec l\'instant arrondi ; règles d\'envoi lues dans /me', async () => {
    const { fetch, calls } = mockFetch([
      json(videoMedia),
      json({ credential: {}, delegated: null, user: null, project: null, access: null, upload: rules }),
      json({ credential: {}, delegated: null, user: null, project: null, access: null, upload: null }),
    ])
    const client = createSurgeClient({ baseUrl: BASE, projectId: 'cmproject01', publishableKey: 'sm_pk_x', fetch })
    await client.media.setPoster('cmvideo0001', new Blob([new Uint8Array(4)], { type: 'image/jpeg' }), { time: 1.23456 })
    expect([calls[0]!.method, calls[0]!.url]).toEqual(['PUT', `${BASE}/api/v1/projects/cmproject01/media/cmvideo0001/poster`])
    const form = calls[0]!.body as FormData
    expect([form.get('time'), (form.get('file') as File).name]).toEqual(['1.235', 'poster.jpg'])
    expect(await client.uploadRules()).toEqual(rules)
    expect(await client.uploadRules()).toBeNull()
  })

  it('erreur réseau et annulation', async () => {
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) throw abortError()
      throw new TypeError('fetch failed')
    }) as unknown as typeof globalThis.fetch
    const client = createSurgeClient({ baseUrl: BASE, projectId: 'cmproject01', publishableKey: 'sm_pk_x', fetch })
    await expect(client.media.upload(file('a.png', 'image/png'))).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
    const controller = new AbortController()
    controller.abort()
    await expect(client.media.upload(file('a.png', 'image/png'), {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

/** XMLHttpRequest simulé (navigateur) : progression, réponse, erreur réseau, annulation. */
class FakeXhr {
  static instances: FakeXhr[] = []
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: FormData | null = null
  status = 0
  responseText = ''
  responseType = ''
  responseHeaders: Record<string, string> = {}
  upload: { onprogress: ((event: { loaded: number, total: number, lengthComputable: boolean }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  constructor() {
    FakeXhr.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null
  }

  send(body: FormData) {
    this.body = body
  }

  abort() {
    this.onabort?.()
  }

  respond(status: number, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.responseHeaders = headers
    this.onload?.()
  }
}

describe('envoi par XMLHttpRequest (navigateur)', () => {
  it('progression, en-têtes, réponse, problème avec Retry-After, erreur réseau, annulation', async () => {
    FakeXhr.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    const client = createSurgeClient({ baseUrl: BASE, projectId: 'cmproject01', publishableKey: 'sm_pk_x', fetch })
    const progress: number[] = []

    const sent = client.media.upload(file('a.png', 'image/png', 100), {}, { onProgress: value => progress.push(value.fraction) })
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1))
    const xhr = FakeXhr.instances[0]!
    expect([xhr.method, xhr.url, xhr.headers.Authorization, xhr.responseType]).toEqual(['POST', `${BASE}/api/v1/projects/cmproject01/media`, 'Bearer sm_pk_x', 'text'])
    xhr.upload.onprogress?.({ loaded: 50, total: 200, lengthComputable: true })
    xhr.upload.onprogress?.({ loaded: 200, total: 200, lengthComputable: true })
    xhr.respond(201, imageMedia)
    expect(await sent).toEqual(imageMedia)
    expect(progress).toEqual([0.25, 1])
    expect(fetch).not.toHaveBeenCalled()

    const busy = client.media.upload(file('a.png', 'image/png'))
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(2))
    FakeXhr.instances[1]!.respond(503, { code: 'SERVER_BUSY' }, { 'content-type': 'application/problem+json', 'retry-after': '7' })
    await expect(busy).rejects.toMatchObject({ code: 'SERVER_BUSY', retryAfter: 7 })

    const offline = client.media.upload(file('a.png', 'image/png'))
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(3))
    FakeXhr.instances[2]!.onerror?.()
    await expect(offline).rejects.toMatchObject({ code: 'NETWORK_ERROR' })

    const controller = new AbortController()
    const canceled = client.media.upload(file('a.png', 'image/png'), {}, { signal: controller.signal })
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(4))
    controller.abort()
    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
  })
})

/** Client simulé pour la file : chaque envoi attend qu'on le termine (`uploads[i].resolve`). */
function fakeClient() {
  const uploads: { name: string, fields: unknown, resolve: (media: Media) => void, reject: (error: unknown) => void, progress: (fraction: number) => void }[] = []
  const posters: { id: string, time: number | undefined }[] = []
  const client = {
    media: {
      upload: vi.fn((blob: Blob, fields: unknown, options: { filename?: string, signal?: AbortSignal, onProgress?: (progress: { loaded: number, total: number, fraction: number }) => void } = {}) =>
        new Promise<Media>((resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(abortError()))
          uploads.push({ name: options.filename ?? '', fields, resolve, reject, progress: fraction => options.onProgress?.({ loaded: fraction, total: 1, fraction }) })
        })),
      setPoster: vi.fn(async (id: string, _image: Blob, options: { time?: number } = {}) => {
        posters.push({ id, time: options.time })
        return { ...videoMedia, id, poster: { url: 'p.jpg', width: 1, height: 1, time: options.time ?? null } } as Media
      }),
    },
  }
  return { client: client as never, uploads, posters }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const statuses = (items: readonly UploadItem[]) => items.map(item => item.status)

describe('file d\'envoi', () => {
  it('pré-contrôle à l\'ajout, deux envois à la fois, progression, fin de file', async () => {
    const { client, uploads } = fakeClient()
    const uploaded: string[] = []
    const settled = vi.fn()
    const queue = createUploadQueue({ client, rules, onUploaded: media => uploaded.push(media.id), onSettled: settled })
    const seen: string[][] = []
    queue.subscribe(items => seen.push(statuses(items)))

    queue.add([file('a.png', 'image/png'), file('b.png', 'image/png'), file('c.svg', 'image/svg+xml'), file('d.png', 'image/png')], { title: 'Commun' })
    expect(statuses(queue.items)).toEqual(['uploading', 'uploading', 'error', 'queued'])
    expect(queue.items[2]!.error?.code).toBe('UNSUPPORTED_TYPE')
    expect(uploads.map(upload => upload.name)).toEqual(['a.png', 'b.png'])
    expect(uploads[0]!.fields).toEqual({ title: 'Commun' })
    expect(queue.busy).toBe(true)

    uploads[0]!.progress(0.5)
    expect(queue.items[0]!.progress).toBe(0.5)
    uploads[0]!.resolve({ ...imageMedia, id: 'm-a' })
    await flush()
    expect(statuses(queue.items)).toEqual(['done', 'uploading', 'error', 'uploading'])
    uploads[1]!.resolve({ ...imageMedia, id: 'm-b' })
    uploads[2]!.resolve({ ...imageMedia, id: 'm-d' })
    await flush()
    expect(uploaded).toEqual(['m-a', 'm-b', 'm-d'])
    expect(queue.items[0]!.media?.id).toBe('m-a')
    expect(queue.busy).toBe(false)
    expect(settled).toHaveBeenCalledTimes(1)
    expect(seen.length).toBeGreaterThan(5)

    queue.clear()
    expect(queue.items).toEqual([])
  })

  it('annulation, retrait, nouvel essai manuel', async () => {
    const { client, uploads } = fakeClient()
    const queue = createUploadQueue({ client, rules, concurrency: 1 })
    const [first, second] = queue.add([file('a.png', 'image/png'), file('b.png', 'image/png')])
    queue.cancel(second!.id)
    expect(statuses(queue.items)).toEqual(['uploading', 'canceled'])
    queue.cancel(first!.id)
    await flush()
    expect(statuses(queue.items)).toEqual(['canceled', 'canceled'])
    queue.retry(first!.id)
    expect(statuses(queue.items)).toEqual(['uploading', 'canceled'])
    uploads[1]!.reject(new SurgeApiError({ status: 422, code: 'UNREADABLE_FILE' }))
    await flush()
    expect([queue.items[0]!.status, queue.items[0]!.error?.code, queue.items[0]!.attempts]).toEqual(['error', 'UNREADABLE_FILE', 2])
    queue.remove(second!.id)
    expect(queue.items).toHaveLength(1)
  })

  it('nouveaux essais automatiques après 429 / 503 (Retry-After, 3 au plus), jamais après un refus', async () => {
    vi.useFakeTimers()
    const { client, uploads } = fakeClient()
    const queue = createUploadQueue({ client, rules })
    queue.add([file('a.png', 'image/png')])
    uploads[0]!.reject(new SurgeApiError({ status: 429, code: 'RATE_LIMITED', retryAfter: 5 }))
    await vi.advanceTimersByTimeAsync(0)
    expect([queue.items[0]!.status, queue.items[0]!.error?.code]).toEqual(['queued', 'RATE_LIMITED'])
    expect(queue.items[0]!.retryAt).not.toBeNull()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(uploads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(uploads).toHaveLength(2)
    for (const index of [1, 2, 3]) {
      uploads[index]!.reject(new SurgeApiError({ status: 503, code: 'SERVER_BUSY' }))
      await vi.advanceTimersByTimeAsync(60_000)
    }
    // Quatre essais (1 + 3 automatiques), puis l'erreur reste.
    expect(uploads).toHaveLength(4)
    expect(queue.items[0]!.status).toBe('error')
    queue.add([file('b.png', 'image/png')])
    uploads[4]!.reject(new SurgeApiError({ status: 413, code: 'FILE_TOO_LARGE' }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect([uploads.length, queue.items[1]!.status]).toEqual([5, 'error'])
  })

  it('envois restants du jeton : au-delà, refus sans envoi', async () => {
    const { client, uploads } = fakeClient()
    const queue = createUploadQueue({ client, rules: { ...rules, remaining: 2 }, concurrency: 1 })
    queue.add([file('a.png', 'image/png'), file('b.png', 'image/png'), file('c.png', 'image/png')])
    expect(statuses(queue.items)).toEqual(['uploading', 'queued', 'error'])
    expect(queue.items[2]!.error?.code).toBe('UPLOAD_LIMIT_REACHED')
    uploads[0]!.reject(new SurgeApiError({ status: 422, code: 'UNREADABLE_FILE' }))
    await flush()
    // Un envoi échoué ne compte pas : le troisième peut être relancé.
    queue.retry(queue.items[2]!.id)
    expect(statuses(queue.items)).toEqual(['error', 'uploading', 'queued'])
    queue.setRules({ ...rules, remaining: 0 })
    uploads[1]!.resolve(imageMedia)
    await flush()
    expect([queue.items[2]!.status, queue.items[2]!.error?.code]).toEqual(['error', 'UPLOAD_LIMIT_REACHED'])
  })

  it('mode « détails » : champs modifiés avant l\'envoi, départ par start()', async () => {
    const { client, uploads } = fakeClient()
    const queue = createUploadQueue({ client, rules, autoStart: false, fields: { visibility: 'private' } })
    const [item] = queue.add([file('a.png', 'image/png')])
    expect(statuses(queue.items)).toEqual(['queued'])
    expect(queue.busy).toBe(false)
    queue.update(item!.id, { title: 'Titre', altText: 'Texte' })
    queue.start()
    expect(uploads[0]!.fields).toEqual({ visibility: 'private', title: 'Titre', altText: 'Texte' })
  })

  it('vidéo : affiche capturée pendant l\'envoi puis envoyée ; échec de capture sans conséquence', async () => {
    const { client, uploads, posters } = fakeClient()
    const frame = { blob: new Blob([new Uint8Array(3)], { type: 'image/jpeg' }), time: 2.5 }
    const captureFrame = vi.fn(async () => frame)
    const queue = createUploadQueue({ client, rules, captureFrame })
    queue.add([file('clip.mp4', 'video/mp4'), file('a.png', 'image/png')])
    expect(captureFrame).toHaveBeenCalledTimes(1)
    uploads[0]!.resolve({ ...videoMedia, id: 'cmvideo0002', poster: null })
    await flush()
    expect(posters).toEqual([{ id: 'cmvideo0002', time: 2.5 }])
    expect([queue.items[0]!.status, queue.items[0]!.media?.poster?.time]).toEqual(['done', 2.5])

    // Affiche déjà présente (extraite par le serveur) : rien n'est envoyé.
    const other = createUploadQueue({ client, rules, captureFrame: async () => null })
    other.add([file('clip.mp4', 'video/mp4')])
    uploads[2]!.resolve({ ...videoMedia, id: 'cmvideo0003', poster: null })
    await flush()
    expect([other.items[0]!.status, posters]).toEqual(['done', [{ id: 'cmvideo0002', time: 2.5 }]])
  })

  it('destruction : envois interrompus, abonnés oubliés', async () => {
    const { client } = fakeClient()
    const queue = createUploadQueue({ client, rules })
    const listener = vi.fn()
    queue.add([file('a.png', 'image/png')])
    queue.subscribe(listener)
    queue.destroy()
    await flush()
    expect(listener).not.toHaveBeenCalled()
    expect(queue.add([file('b.png', 'image/png')])).toEqual([])
  })
})
