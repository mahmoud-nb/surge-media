/**
 * Génère les clients Prisma des trois fournisseurs (cli/lib/generate.ts), avant `dev`, `build` et `typecheck`
 * et à l'installation ; rien n'est refait si le schéma et la version de Prisma n'ont pas changé.
 *
 *   pnpm db:generate     régénère dans tous les cas (--force)
 */
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { generateClients } from '../cli/lib/generate'
import { DATABASE_PROVIDERS } from '../shared/database'

const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } })
const root = resolve(import.meta.dirname, '..')
const started = performance.now()

try {
  const { generated } = await generateClients(root, { force: values.force })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(generated
    ? `✔ Clients Prisma générés (${DATABASE_PROVIDERS.join(', ')}) en ${seconds} s`
    : '✔ Clients Prisma à jour')
}
catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
