import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA_FILE = 'prisma/schema.prisma'
export const ENV_FILE = '.env'
export const ENV_EXAMPLE_FILE = '.env.example'
/** Présent dans le dépôt des sources, absent du paquet publié (champ `files` du package.json). */
const SOURCE_MARKER = 'nuxt.config.ts'

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

export interface CoreLocation {
  /** Paquet surgeMedia : serveur construit, migrations, schémas par fournisseur, prisma.config.ts, .env.example. */
  packageDir: string
  /** Installation : fichier .env et données (base SQLite, médias en stockage local). */
  instanceDir: string
  /** Dépôt des sources (packages/core) : génération des clients Prisma, schéma de développement. */
  isSource: boolean
}

/**
 * Le paquet est celui qui embarque la CLI. L'installation est `--cwd` s'il est fourni ; sinon le dossier du core
 * dans le dépôt des sources (développement : .env et data/ dans packages/core), et le dossier courant pour le
 * paquet publié (`npx @surge-media/core init` depuis le dossier de l'installation, hors de node_modules).
 */
export function resolveLocation(cwd?: string): CoreLocation {
  const packageDir = packageRoot()
  const isSource = existsSync(join(packageDir, SOURCE_MARKER))
  const instanceDir = cwd ? resolve(cwd) : isSource ? packageDir : process.cwd()
  return { packageDir, instanceDir, isSource }
}

/** Dossier situé dans un node_modules : ses fichiers disparaîtraient à la prochaine installation. */
export function isInsideNodeModules(dir: string): boolean {
  return resolve(dir).split(sep).includes('node_modules')
}
