import { createServer } from 'node:net'

export type PortState = 'free' | 'busy' | 'denied' | 'unknown'

const MAX_PORT = 65_535

/** Entier de 1 à 65535 écrit en chiffres seulement (pas de « 3e3 » ni d'espace). */
export function parsePort(value: string | undefined): number | undefined {
  const text = value?.trim() ?? ''
  if (!/^\d{1,5}$/.test(text)) return undefined
  const port = Number(text)
  return port >= 1 && port <= MAX_PORT ? port : undefined
}

/**
 * Essaie d'écouter sur le port comme le fera le serveur (même hôte : NITRO_HOST ou HOST, sinon toutes les
 * interfaces), puis le libère aussitôt. `busy` : déjà utilisé ; `denied` : droits insuffisants (ports
 * inférieurs à 1024 sous Linux et macOS) ; `unknown` : autre erreur (hôte invalide…), laissée au serveur.
 */
export function checkPort(port: number, host?: string): Promise<PortState> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'EADDRINUSE' ? 'busy' : error.code === 'EACCES' ? 'denied' : 'unknown')
    })
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve('free')))
  })
}

/** Premier port libre à partir de `from` (inclus), `attempts` essais au plus. */
export async function findFreePort(from: number, host?: string, attempts = 20): Promise<number | undefined> {
  for (let port = from; port < from + attempts && port <= MAX_PORT; port++) {
    if (await checkPort(port, host) === 'free') return port
  }
  return undefined
}

/** Hôte d'écoute du serveur construit (Nitro) : environnement, puis .env de l'installation. */
export function listenHost(env: Record<string, string | undefined>): string | undefined {
  return process.env.NITRO_HOST || process.env.HOST || env.NITRO_HOST || env.HOST || undefined
}
