import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CliContext } from './database'
import { readEnvFile } from './lib/env-file'
import { sqliteDriverError } from './lib/native'
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
 *   - port : `--port`, sinon PORT (environnement, puis .env), sinon 3000 pour le serveur web ; 3001 par défaut
 *     pour un processus de travail, qui ne doit pas entrer en conflit avec le serveur web ;
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
  const port = args.port?.trim()
    || (role === 'web' ? process.env.PORT || env.PORT || DEFAULT_WEB_PORT : DEFAULT_WORKER_PORT)
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    console.error(t('error.invalidPort', { value: port }))
    process.exit(1)
  }

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
      PORT: port,
      NITRO_PORT: port,
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
