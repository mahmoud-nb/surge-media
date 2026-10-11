import { createReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BodyReadError, readLimitedBody } from '../server/lib/http/body'
import { hookEvent, sharesRuntimeConfig } from '../server/lib/http/runtime-config'
import { closeWithResponse, responseReady } from '../server/lib/http/stream'

const options = { maxBytes: 10, timeoutMs: 1000 }

describe('readLimitedBody', () => {
  it('rend le corps entier sous la limite', async () => {
    const source = new PassThrough()
    const body = readLimitedBody(source, options)
    source.write('hello ')
    source.end('you')
    expect((await body).toString()).toBe('hello you')
  })

  it('refuse d\'emblée une taille annoncée trop grande, sans rien lire', async () => {
    const source = new PassThrough()
    await expect(readLimitedBody(source, { ...options, declaredLength: 11 })).rejects.toMatchObject({ reason: 'too_large' })
    expect(source.readableFlowing).toBeNull()
  })

  it('s\'arrête dès que la limite est dépassée (corps sans taille annoncée)', async () => {
    const source = new PassThrough()
    const body = readLimitedBody(source, options)
    source.write('0123456')
    source.write('789ab')
    await expect(body).rejects.toBeInstanceOf(BodyReadError)
    await expect(body).rejects.toMatchObject({ reason: 'too_large' })
    expect(source.isPaused()).toBe(true)
    expect(source.listenerCount('data')).toBe(0)
  })

  it('accepte exactement la limite', async () => {
    const source = new PassThrough()
    const body = readLimitedBody(source, options)
    source.end('0123456789')
    expect((await body).length).toBe(10)
  })

  it('abandonne un corps trop lent', async () => {
    const source = new PassThrough()
    const body = readLimitedBody(source, { maxBytes: 10, timeoutMs: 50 })
    source.write('01')
    await expect(body).rejects.toMatchObject({ reason: 'timeout' })
    expect(source.listenerCount('data')).toBe(0)
  })

  it('échoue si le client part avant la fin', async () => {
    const source = new PassThrough()
    const body = readLimitedBody(source, options)
    source.write('01')
    source.destroy()
    await expect(body).rejects.toThrow('Request aborted')
  })

  it('échoue aussitôt pour un flux déjà fermé ou déjà lu', async () => {
    const closed = new PassThrough()
    closed.destroy()
    await expect(readLimitedBody(closed, options)).rejects.toThrow('unavailable')
    const consumed = new PassThrough()
    consumed.end('x')
    consumed.resume()
    await new Promise(resolve => consumed.once('end', resolve))
    await expect(readLimitedBody(consumed, options)).rejects.toThrow('unavailable')
  })

  it('transmet l\'erreur du flux', async () => {
    const source = new PassThrough()
    const body = readLimitedBody(source, options)
    source.destroy(new Error('boom'))
    await expect(body).rejects.toThrow('boom')
  })
})

/**
 * closeWithResponse sur une vraie connexion HTTP. L'envoi imite h3 1.15 (`sendStream`) : `pipe`, puis
 * `stream.abort()` seulement si la méthode existe, à la fermeture de la réponse.
 */
describe('closeWithResponse', () => {
  let directory: string
  let file: string
  let port: number
  let fixed = true
  const streams: Readable[] = []
  const server = createServer((_req, res: ServerResponse) => {
    const stream = createReadStream(file)
    streams.push(stream)
    const sent = fixed ? closeWithResponse(res, stream) : stream
    sent.pipe(res)
    res.on('close', () => (sent as Readable & { abort?: () => void }).abort?.())
  })

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'surge-media-http-test-'))
    file = join(directory, 'big.bin')
    await writeFile(file, Buffer.alloc(16 * 1024 * 1024, 1))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    for (const stream of streams) stream.destroy()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  /** Requête abandonnée par le client dès le premier bloc reçu. */
  function abandonedRequest(): Promise<void> {
    return new Promise((resolve) => {
      const req = request({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.once('data', () => {
          req.destroy()
          resolve()
        })
      })
      req.on('error', () => resolve())
      req.end()
    })
  }

  async function openStreamsAfterAbandons(count: number): Promise<number> {
    streams.length = 0
    for (let i = 0; i < count; i++) await abandonedRequest()
    await new Promise(resolve => setTimeout(resolve, 300))
    return streams.filter(stream => !stream.closed).length
  }

  it('sans garde-fou, le fichier reste ouvert (comportement de h3 constaté)', async () => {
    fixed = false
    expect(await openStreamsAfterAbandons(5)).toBe(5)
  })

  it('avec garde-fou, chaque flux abandonné est fermé', async () => {
    fixed = true
    expect(await openStreamsAfterAbandons(5)).toBe(0)
  })

  it('ferme aussitôt un flux ouvert après le départ du client', () => {
    const stream = new PassThrough()
    closeWithResponse({ destroyed: true } as ServerResponse, stream)
    expect(stream.destroyed).toBe(true)
  })
})

/**
 * Connexion persistante : la réponse d'une requête arrivée avant la fin de la précédente est mise en file
 * par Node (`res.socket` null jusqu'à son tour). `sendStream` imite h3 1.15, qui rend alors la main sans
 * rien envoyer. Deux requêtes envoyées d'un coup sur une connexion (pipelining) reproduisent la situation
 * à coup sûr ; en production elle survient quand le client relance avant que le serveur ait fini d'écrire.
 */
describe('responseReady', () => {
  let port: number
  let fixed = true
  let socketAtSend: boolean[] = []
  const sendStream = (res: ServerResponse, stream: Readable) => {
    socketAtSend.push(Boolean(res.socket))
    if (!res.socket) return
    stream.pipe(res)
  }
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/slow') {
      setTimeout(() => res.end('lent'), 100)
      return
    }
    if (fixed && !await responseReady(req, res)) return
    res.setHeader('content-length', 7)
    sendStream(res, Readable.from([Buffer.from('fichier')]))
  })

  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise(resolve => server.close(resolve)))

  /** Deux requêtes d'un coup sur une connexion ; texte reçu au bout de `waitMs`. */
  function pipelined(waitMs: number): Promise<string> {
    return new Promise((resolve) => {
      const socket = connect(port, '127.0.0.1')
      let received = ''
      socket.on('data', (chunk) => { received += chunk.toString() })
      socket.on('error', () => {})
      socket.write('GET /slow HTTP/1.1\r\nHost: test\r\n\r\nGET /file HTTP/1.1\r\nHost: test\r\n\r\n')
      setTimeout(() => {
        socket.destroy()
        resolve(received)
      }, waitMs)
    })
  }

  it('sans attente, la seconde réponse n\'est jamais envoyée (comportement de h3 constaté)', async () => {
    fixed = false
    socketAtSend = []
    const received = await pipelined(400)
    expect(socketAtSend).toEqual([false])
    expect(received).toContain('lent')
    expect(received).not.toContain('fichier')
  })

  it('avec attente, la seconde réponse part dès la fin de la première', async () => {
    fixed = true
    socketAtSend = []
    const received = await pipelined(400)
    expect(socketAtSend).toEqual([true])
    expect(received.indexOf('lent')).toBeGreaterThan(-1)
    expect(received.indexOf('fichier')).toBeGreaterThan(received.indexOf('lent'))
  })

  it('client parti pendant l\'attente : false, rien n\'est envoyé', async () => {
    let ready: Promise<boolean> | undefined
    const waiting = createServer((req, res) => {
      if (req.url === '/slow') return // jamais terminée : la seconde réponse reste en file
      ready = responseReady(req, res)
    })
    await new Promise<void>(resolve => waiting.listen(0, '127.0.0.1', resolve))
    const socket = connect((waiting.address() as AddressInfo).port, '127.0.0.1')
    socket.on('error', () => {})
    socket.write('GET /slow HTTP/1.1\r\nHost: test\r\n\r\nGET /file HTTP/1.1\r\nHost: test\r\n\r\n')
    // Booléen : `expect.poll` attendrait la promesse elle-même (en suspens jusqu'au départ du client).
    await expect.poll(() => ready !== undefined).toBe(true)
    socket.destroy()
    expect(await ready).toBe(false)
    waiting.closeAllConnections()
    await new Promise(resolve => waiting.close(resolve))
  })

  it('connexion déjà attribuée : true aussitôt', async () => {
    expect(await responseReady({ socket: {} } as IncomingMessage, { socket: {} } as ServerResponse)).toBe(true)
  })
})

describe('hookEvent', () => {
  it('trouve l\'événement avec ou sans le nom du crochet en tête (hookable 5 ou autre)', () => {
    const event = { context: { nitro: { errors: [] } }, path: '/m/x' }
    expect(hookEvent(['request', event])).toBe(event)
    expect(hookEvent([event])).toBe(event)
    expect(hookEvent(['request'])).toBeUndefined()
    expect(hookEvent([])).toBeUndefined()
  })
})

describe('sharesRuntimeConfig', () => {
  it('diffusion, API et fichiers de l\'application : configuration partagée ; pages : copie', () => {
    for (const path of ['/m/abc/v1/photo.jpg', '/api/v1/projects', '/api/admin/dashboard', '/api/_auth/session', '/_nuxt/entry.js']) {
      expect(sharesRuntimeConfig(path)).toBe(true)
    }
    for (const path of ['/', '/admin', '/admin/media', '/login', '/_i18n/fr/messages.json', '/__nuxt_error', '/m', '/apix']) {
      expect(sharesRuntimeConfig(path)).toBe(false)
    }
  })
})
