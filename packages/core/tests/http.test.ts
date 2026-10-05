import { createReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, request, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, type Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BodyReadError, readLimitedBody } from '../server/lib/http/body'
import { closeWithResponse } from '../server/lib/http/stream'

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
