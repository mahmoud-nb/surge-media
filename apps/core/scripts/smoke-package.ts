/**
 * Essai du paquet npm construit, comme l'installerait un utilisateur (CI avant publication, ou à la main) :
 * installation dans un dossier vide, `surge-media init` (SQLite), `surge-media start`, puis /api/health ; le
 * dossier est supprimé ensuite.
 *
 *   pnpm --filter @surge-media/core smoke:package <archive .tgz> [--port 3300]
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { port: { type: 'string', default: '3300' } },
})
if (!positionals[0]) {
  console.error('Usage : pnpm --filter @surge-media/core smoke:package <archive .tgz> [--port 3300]')
  process.exit(1)
}
const tarball = resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0])
const port = values.port
const dir = mkdtempSync(join(tmpdir(), 'surge-media-smoke-'))
const cli = join(dir, 'node_modules/@surge-media/core/dist/cli/index.mjs')
const windows = process.platform === 'win32'

function run(label: string, command: string, args: string[] = []): void {
  console.log(`▸ ${label}`)
  // Sans arguments séparés : commande passée au shell (npm est un script .cmd sous Windows).
  const result = args.length
    ? spawnSync(command, args, { cwd: dir, stdio: 'inherit' })
    : spawnSync(command, { cwd: dir, stdio: 'inherit', shell: true })
  if (result.status !== 0) throw new Error(`${label} : échec (code ${result.status})`)
}

async function health(): Promise<unknown> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      const body = await response.json() as { status?: string }
      if (response.ok && body.status === 'ok') return body
      throw new Error(`/api/health : ${response.status} ${JSON.stringify(body)}`)
    }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('/api/health')) throw error
      await new Promise(done => setTimeout(done, 1000))
    }
  }
  throw new Error('/api/health : aucune réponse en 90 s')
}

function stop(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  // La CLI relaie SIGTERM au serveur (POSIX) ; sous Windows, arrêt de l'arbre de processus.
  if (windows) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}

let server: ChildProcess | undefined
try {
  // npm 12 et plus n'exécutent les scripts d'installation des dépendances qu'une fois approuvés.
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    private: true,
    allowScripts: { 'better-sqlite3': true, '@prisma/engines': true, 'prisma': true },
  }, null, 2)}\n`)
  run(`npm install ${tarball}`, `npm install --no-audit --no-fund "${tarball}"`)
  run('surge-media init', process.execPath, [cli, 'init', '--provider', 'sqlite', '--yes', '--site-url', `http://127.0.0.1:${port}`, '--lang', 'en'])

  console.log('▸ surge-media start')
  server = spawn(process.execPath, [cli, 'start', '--port', port, '--lang', 'en'], { cwd: dir, stdio: 'inherit' })
  console.log(`✔ Paquet fonctionnel : ${JSON.stringify(await health())}`)
}
catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
finally {
  if (server) {
    stop(server)
    await new Promise(done => setTimeout(done, 1000))
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
