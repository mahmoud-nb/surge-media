import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { DATABASE_PROVIDERS, type DatabaseProvider } from '../../shared/database'
import { runPrisma } from './prisma'
import { SCHEMA_FILE } from './project'
import { setSchemaProvider } from './schema'

const require = createRequire(import.meta.url)

/** Clients générés, un dossier par fournisseur (ignoré par git). */
export const CLIENTS_DIR = 'server/generated/prisma'
const SCHEMAS_DIR = 'server/generated/schemas'
const STAMP_FILE = `${CLIENTS_DIR}/.stamp.json`

/** Fournisseur dont le client donne ses types au code : les trois exposent la même interface (schéma portable). */
export const TYPES_PROVIDER: DatabaseProvider = 'sqlite'

/** Copie du schéma propre à un fournisseur : génération de son client, migrations de l'image Docker. */
export function providerSchemaFile(provider: DatabaseProvider): string {
  return `${SCHEMAS_DIR}/${provider}.prisma`
}

/** Capture la valeur `output` du générateur `client`. */
const GENERATOR_OUTPUT = /(generator\s+client\s*\{[^}]*?\boutput\s*=\s*")([^"]*)(")/

export function setGeneratorOutput(schema: string, output: string): string {
  if (!GENERATOR_OUTPUT.test(schema)) {
    throw new Error('Champ `output` du générateur `client` introuvable dans le schéma Prisma.')
  }
  return schema.replace(GENERATOR_OUTPUT, (_, before: string, _current: string, after: string) => `${before}${output}${after}`)
}

const TYPES_ENTRY = `// Généré par surgeMedia (cli/lib/generate.ts) : ne pas modifier.
// Types du client Prisma, communs aux trois fournisseurs. Le client exécuté est celui de
// DATABASE_PROVIDER, chargé au démarrage par server/utils/prisma.ts.
export type * from './${TYPES_PROVIDER}/client'
`

/**
 * Génère un client Prisma par fournisseur (`server/generated/prisma/<fournisseur>/`). Le serveur charge au
 * démarrage celui de `DATABASE_PROVIDER` : une même build, l'image Docker comprise, sert SQLite, PostgreSQL et
 * MySQL/MariaDB, et changer de fournisseur ne demande plus de la reconstruire. Chaque client part d'une copie de
 * `prisma/schema.prisma` dont seuls le fournisseur et le dossier de sortie changent. Rien n'est régénéré si ces
 * copies et la version de Prisma sont inchangées (sauf `force`).
 */
export async function generateClients(
  root: string,
  options: { force?: boolean, env?: Record<string, string> } = {},
): Promise<{ generated: boolean }> {
  const base = readFileSync(join(root, SCHEMA_FILE), 'utf8')
  const schemas = DATABASE_PROVIDERS.map(provider => ({
    provider,
    // Sortie relative au fichier du schéma : server/generated/schemas/ → server/generated/prisma/<fournisseur>.
    text: setGeneratorOutput(setSchemaProvider(base, provider), `../prisma/${provider}`),
  }))

  const stamp = JSON.stringify({
    prisma: prismaVersion(),
    schemas: createHash('sha256').update(schemas.map(schema => schema.text).join('\0')).digest('hex'),
  })
  const stampPath = join(root, STAMP_FILE)
  const upToDate = existsSync(stampPath)
    && readFileSync(stampPath, 'utf8') === stamp
    && schemas.every(({ provider }) => existsSync(join(root, CLIENTS_DIR, provider, 'client.ts')))
  if (upToDate && !options.force) return { generated: false }

  // Dossiers repartis de zéro : aucun fichier d'une génération précédente (ou de l'ancien client unique).
  rmSync(join(root, CLIENTS_DIR), { recursive: true, force: true })
  rmSync(join(root, SCHEMAS_DIR), { recursive: true, force: true })
  mkdirSync(join(root, SCHEMAS_DIR), { recursive: true })
  for (const { provider, text } of schemas) writeFileSync(join(root, providerSchemaFile(provider)), text)

  const results = await Promise.all(schemas.map(({ provider }) =>
    runPrisma(['generate', '--schema', providerSchemaFile(provider)], { cwd: root, env: options.env }),
  ))
  const failed = results.findIndex(result => result.code !== 0)
  if (failed !== -1) {
    throw new Error(`prisma generate (${schemas[failed]!.provider}) :\n${results[failed]!.output.trim()}`)
  }

  writeFileSync(join(root, CLIENTS_DIR, 'client.ts'), TYPES_ENTRY)
  writeFileSync(stampPath, stamp)
  return { generated: true }
}

function prismaVersion(): string {
  const pkg = JSON.parse(readFileSync(require.resolve('prisma/package.json'), 'utf8')) as { version?: string }
  return pkg.version ?? '?'
}
