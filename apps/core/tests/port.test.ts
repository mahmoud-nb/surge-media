import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPort, findFreePort, listenHost, parsePort } from '../cli/lib/port'
import { listenErrorMessage } from '../server/lib/listen-error'

const servers: Server[] = []

/** Occupe un port libre choisi par le système, sur la boucle locale. */
async function occupy(): Promise<number> {
  const server = createServer()
  servers.push(server)
  await new Promise<void>(done => server.listen({ port: 0, host: '127.0.0.1' }, done))
  return (server.address() as { port: number }).port
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(done => server.close(done))))
})

describe('parsePort', () => {
  it('accepte un entier de 1 à 65535 écrit en chiffres', () => {
    expect(parsePort('3000')).toBe(3000)
    expect(parsePort(' 8080 ')).toBe(8080)
    expect(parsePort('1')).toBe(1)
    expect(parsePort('65535')).toBe(65_535)
  })

  it('refuse le reste', () => {
    for (const value of ['', '0', '65536', '3e3', '-1', '30.5', 'abc', '300000', undefined]) expect(parsePort(value)).toBeUndefined()
  })
})

describe('checkPort et findFreePort', () => {
  it('port occupé : busy, puis le suivant libre est proposé', async () => {
    const port = await occupy()
    expect(await checkPort(port, '127.0.0.1')).toBe('busy')
    const free = await findFreePort(port, '127.0.0.1')
    expect(free).toBeGreaterThan(port)
    expect(await checkPort(free!, '127.0.0.1')).toBe('free')
  })

  it('port libéré après l\'essai : le serveur peut l\'utiliser aussitôt', async () => {
    const port = await occupy()
    await new Promise(done => servers.pop()!.close(done))
    expect(await checkPort(port, '127.0.0.1')).toBe('free')
    const server = createServer()
    servers.push(server)
    await new Promise<void>((done, fail) => {
      server.once('error', fail)
      server.listen({ port, host: '127.0.0.1' }, done)
    })
  })

  it('hôte qui n\'existe pas sur la machine : laissé au serveur', async () => {
    expect(await checkPort(3000, '192.0.2.1')).toBe('unknown')
  })

  it('aucun port libre dans la plage : undefined', async () => {
    const port = await occupy()
    expect(await findFreePort(port, '127.0.0.1', 1)).toBeUndefined()
  })
})

describe('listenHost', () => {
  it('environnement puis .env, NITRO_HOST avant HOST', () => {
    const saved = { NITRO_HOST: process.env.NITRO_HOST, HOST: process.env.HOST }
    delete process.env.NITRO_HOST
    delete process.env.HOST
    try {
      expect(listenHost({})).toBeUndefined()
      expect(listenHost({ HOST: '127.0.0.1' })).toBe('127.0.0.1')
      expect(listenHost({ HOST: '127.0.0.1', NITRO_HOST: '::1' })).toBe('::1')
      process.env.HOST = '0.0.0.0'
      expect(listenHost({ NITRO_HOST: '::1' })).toBe('0.0.0.0')
    }
    finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })
})

describe('listenErrorMessage', () => {
  const listenError = (code: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`listen ${code}`), { code, syscall: 'listen', port: 3000, address: '::', ...extra })

  it('port déjà utilisé : variables à changer, WORKER_PORT pour un processus de travail', () => {
    const web = listenErrorMessage(listenError('EADDRINUSE'), false)!
    expect(web).toContain('Port 3000 déjà utilisé')
    expect(web).toContain('PORT')
    expect(web).toContain('SURGE_MEDIA_PORT')
    expect(web).not.toContain('WORKER_PORT')
    expect(listenErrorMessage(listenError('EADDRINUSE'), true)).toContain('WORKER_PORT')
  })

  it('port interdit, puis toute autre erreur d\'écoute', () => {
    expect(listenErrorMessage(listenError('EACCES', { port: 80 }), false)).toContain('Port 80 interdit')
    expect(listenErrorMessage(listenError('EADDRNOTAVAIL', { address: '192.0.2.1' }), false))
      .toContain('192.0.2.1:3000 (EADDRNOTAVAIL)')
  })

  it('ignore ce qui n\'est pas une erreur d\'écoute', () => {
    expect(listenErrorMessage(new Error('boom'), false)).toBeUndefined()
    expect(listenErrorMessage(Object.assign(new Error('x'), { code: 'EADDRINUSE', syscall: 'connect' }), false)).toBeUndefined()
    expect(listenErrorMessage(null, false)).toBeUndefined()
    expect(listenErrorMessage('EADDRINUSE', false)).toBeUndefined()
  })
})
