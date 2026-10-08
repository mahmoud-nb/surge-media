import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CliContext } from './database'

/**
 * `surge-media worker [--port 3001]` : processus de travail du traitement des vidéos (phase D3, § 30.2).
 * C'est le même serveur construit (`.output/server/index.mjs`, même code, mêmes réglages) lancé avec
 * NUXT_SERVER_ROLE=worker : il exécute les tâches de la file et ne sert que /api/health (sonde des
 * conteneurs). Le code des médias dépend des imports automatiques de Nitro : il n'existe qu'une seule
 * construction, la CLI ne fait que la lancer.
 *
 *   - processus enfant `node --env-file-if-exists=.env <entrée>` lancé depuis le dossier du core (chemins
 *     relatifs de la base SQLite et du stockage local, comme `pnpm start`) ; les variables du shell
 *     restent prioritaires sur le fichier .env ;
 *   - port propre (3001 par défaut) : il ne doit pas entrer en conflit avec le serveur web ;
 *   - SIGINT et SIGTERM transmis (POSIX) : arrêt propre (ffmpeg tué, tâche rendue à la file) ; code de
 *     sortie repris. Sous Windows, `child.kill` termine le processus brutalement (sans crochet `close` :
 *     tâche non rendue, essai compté) : rien n'est transmis. Le Ctrl+C de la console parvient de lui-même
 *     au processus de travail (même console), qui s'arrête proprement ; la CLI attend seulement sa fin.
 * Pas de `VAR=x commande` dans les scripts : la syntaxe n'existe pas sous Windows.
 */

/** Entrée du serveur construit (`pnpm build`). */
export const SERVER_ENTRY = '.output/server/index.mjs'
export const DEFAULT_WORKER_PORT = '3001'

export async function runWorker(ctx: CliContext, args: { port?: string }): Promise<void> {
  const { t } = ctx
  const entry = join(ctx.root, SERVER_ENTRY)
  if (!existsSync(entry)) {
    console.error(t('error.buildMissing', { path: entry }))
    process.exit(1)
  }
  const port = args.port?.trim() || DEFAULT_WORKER_PORT
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    console.error(t('error.invalidPort', { value: port }))
    process.exit(1)
  }

  console.info(t('step.workerStarting', { port }))
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', entry], {
    cwd: ctx.root,
    stdio: 'inherit',
    env: { ...process.env, NUXT_SERVER_ROLE: 'worker', PORT: port, NITRO_PORT: port },
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
      console.error(t('error.workerFailed', { message: error.message }))
      resolve(1)
    })
    child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)))
  })
  process.off('SIGINT', forward)
  process.off('SIGTERM', forward)
  process.exit(code)
}
