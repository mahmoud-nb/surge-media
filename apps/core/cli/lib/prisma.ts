import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export interface CommandResult {
  code: number
  output: string
}

/**
 * Exécute la CLI Prisma installée avec SurgeMedia (indépendamment du gestionnaire
 * de paquets et du PATH). La sortie est capturée pour n'être affichée qu'en cas d'erreur.
 */
export function runPrisma(
  args: string[],
  options: { cwd: string, env?: Record<string, string> },
): Promise<CommandResult> {
  const bin = join(dirname(require.resolve('prisma/package.json')), 'build/index.js')

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: options.cwd,
      env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1', ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1, output }))
  })
}
