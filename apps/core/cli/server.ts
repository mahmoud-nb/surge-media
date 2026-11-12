import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CliContext } from './database'
import { readEnvFile } from './lib/env-file'
import { sqliteDriverError } from './lib/native'
import { checkPort, findFreePort, listenHost, parsePort } from './lib/port'
import { ENV_FILE } from './lib/project'

/**
 * `surge-media start [--port]` : serveur web ; `surge-media worker [--port 3001]` : processus de travail du
 * traitement des vidéos (phase D3). Les deux lancent le même serveur construit (`.output/server/index.mjs` du
 * paquet), le second avec NUXT_SERVER_ROLE=worker : il exécute les tâches de la file et ne sert que /api/health
 * (sonde des conteneurs). Le code des médias dépend des imports automatiques de Nitro : il n'existe qu'une
 * seule construction, la CLI ne fait que la lancer.
 *
 *   - processus enfant `node --env-file-if-exists=<installation>/.env <entrée>` lancé depuis le dossier de
 *     l'installation (chemins relatifs de la base SQLite et du stockage local) ; les variables du shell
 *     restent prioritaires sur le fichier .env ;
 *   - port : `--port`, sinon PORT (environnement, puis .env), sinon 3000 pour le serveur web ; `--port`,
 *     sinon WORKER_PORT, sinon 3001 pour un processus de travail, qui ne doit pas entrer en conflit avec le
 *     serveur web. Le port est essayé avant le lancement : déjà utilisé ou interdit, message clair et code 1
 *     (le serveur seul ne laisserait qu'une trace brute et le code 0 ; server/plugins/listen-error.ts) ;
 *   - SIGINT et SIGTERM transmis (POSIX) : arrêt propre (ffmpeg tué, tâche rendue à la file) ; code de
 *     sortie repris. Sous Windows, `child.kill` termine le processus brutalement (sans crochet `close` :
 *     tâche non rendue, essai compté) : rien n'est transmis. Le Ctrl+C de la console parvient de lui-même
 *     au processus enfant (même console), qui s'arrête proprement ; la CLI attend seulement sa fin.
 * Pas de `VAR=x commande` dans les scripts : la syntaxe n'existe pas sous Windows.
 */

/** Entrée du serveur construit (`pnpm build` dans le dépôt, présente dans le paquet publié). */
export const SERVER_ENTRY = '.output/server/index.mjs'
export const DEFAULT_WEB_PORT = '3000'
export const DEFAULT_WORKER_PORT = '3001'

export type ServerRole = 'web' | 'worker'

export async function runServer(ctx: CliContext, role: ServerRole, args: { port?: string }): Promise<void> {
  const { t } = ctx
  const entry = join(ctx.packageDir, SERVER_ENTRY)
  if (!existsSync(entry)) {
    console.error(t('error.buildMissing', { path: entry }))
    process.exit(1)
  }
  const envFile = join(ctx.instanceDir, ENV_FILE)
  const env = readEnvFile(envFile)
  const variable = role === 'web' ? 'PORT' : 'WORKER_PORT'
  const value = args.port?.trim()
    || process.env[variable] || env[variable] || (role === 'web' ? DEFAULT_WEB_PORT : DEFAULT_WORKER_PORT)
  const port = parsePort(value)
  if (!port) {
    console.error(t('error.invalidPort', { value }))
    process.exit(1)
  }
  await ensurePortAvailable(ctx, role, port, variable, env)

  // Sans pilote SQLite, le serveur démarrerait mais chaque accès à la base échouerait.
  const provider = process.env.DATABASE_PROVIDER || env.DATABASE_PROVIDER || 'sqlite'
  const driverError = provider === 'sqlite' ? sqliteDriverError(ctx.packageDir) : undefined
  if (driverError) {
    console.error(t('error.sqliteDriver', { message: driverError }))
    process.exit(1)
  }

  console.info(t(role === 'web' ? 'step.serverStarting' : 'step.workerStarting', { port }))
  const child = spawn(process.execPath, [`--env-file-if-exists=${envFile}`, entry], {
    cwd: ctx.instanceDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
      NITRO_PORT: String(port),
      ...(role === 'worker' ? { NUXT_SERVER_ROLE: 'worker' } : {}),
    },
  })
  const forward = (signal: NodeJS.Signals) => {
    // Windows : voir l'en-tête (le gestionnaire évite seulement que la CLI se termine avant l'enfant).
    if (process.platform === 'win32') return
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)

  const code = await new Promise<number>((resolve) => {
    child.on('error', (error) => {
      console.error(t('error.processFailed', { message: error.message }))
      resolve(1)
    })
    child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)))
  })
  process.off('SIGINT', forward)
  process.off('SIGTERM', forward)
  process.exit(code)
}

/**
 * Port déjà utilisé (autre application, ou SurgeMedia déjà lancé) ou interdit : message et code 1, avec le
 * prochain port libre et, pour le serveur web, un rappel si NUXT_SITE_URL contient ce port.
 */
async function ensurePortAvailable(
  ctx: CliContext,
  role: ServerRole,
  port: number,
  variable: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const { t } = ctx
  const host = listenHost(env)
  const state = await checkPort(port, host)
  if (state === 'free' || state === 'unknown') return
  if (state === 'denied') {
    console.error(t('error.portDenied', { port }))
    process.exit(1)
  }
  console.error(t('error.portBusy', { port, variable }))
  const free = await findFreePort(port + 1, host)
  if (free) console.error(t('error.portFree', { port: free }))
  const siteUrl = process.env.NUXT_SITE_URL || env.NUXT_SITE_URL
  if (role === 'web' && siteUrl && urlPort(siteUrl) === port) console.error(t('error.portSiteUrl', { url: siteUrl }))
  process.exit(1)
}

function urlPort(url: string): number | undefined {
  try {
    return parsePort(new URL(url).port)
  }
  catch {
    return undefined
  }
}
