import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA_FILE = 'prisma/schema.prisma'
export const ENV_FILE = '.env'
export const ENV_EXAMPLE_FILE = '.env.example'

/** Racine du package qui embarque la CLI (sources `cli/` ou build `dist/cli/`). */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dir
}

export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version?: string }
  return pkg.version ?? '0.0.0'
}

/**
 * Dossier du core surgeMedia sur lequel agir : `--cwd` s'il est fourni, sinon le
 * dossier courant, sinon le package installé. Il doit contenir `prisma/schema.prisma`.
 */
export function resolveCoreRoot(cwd?: string): string | undefined {
  const candidates = cwd ? [resolve(cwd)] : [process.cwd(), packageRoot()]
  return candidates.find(dir => existsSync(join(dir, SCHEMA_FILE)))
}
