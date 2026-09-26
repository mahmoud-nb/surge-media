import { resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaPg } from '@prisma/adapter-pg'
import { readDatabaseEnv, sqliteFilePath, type DatabaseProvider } from '#shared/database'
import type { PrismaClient } from '../generated/prisma/client'

/**
 * Prisma 7 se connecte via un « driver adapter » propre à chaque fournisseur.
 * Le fournisseur doit correspondre à celui du client généré (voir `surge-media init`).
 */
function createAdapter(provider: DatabaseProvider, url: string) {
  switch (provider) {
    case 'sqlite':
      // Chemin relatif résolu depuis le dossier de lancement (packages/core), comme la CLI Prisma.
      return new PrismaBetterSqlite3({ url: `file:${resolve(sqliteFilePath(url))}` })
    case 'postgresql':
      return new PrismaPg({ connectionString: url })
    case 'mysql':
      return new PrismaMariaDb(url)
  }
}

async function createClient(): Promise<PrismaClient> {
  const { provider, url } = readDatabaseEnv()
  // Import différé : le client généré évalue `import.meta.url` au chargement. Embarqué
  // dans le chunk principal, il serait évalué avant l'entrée Nitro et recevrait une URL
  // factice (« File URL path must be absolute » sous Windows).
  const { PrismaClient } = await import('../generated/prisma/client')
  return new PrismaClient({ adapter: createAdapter(provider, url) })
}

let client: Promise<PrismaClient> | undefined

/** Client Prisma partagé, créé au premier appel (DATABASE_PROVIDER, DATABASE_URL). */
export function usePrisma(): Promise<PrismaClient> {
  client ??= createClient()
  return client
}

export async function disconnectPrisma(): Promise<void> {
  const pending = client
  client = undefined
  await (await pending?.catch(() => undefined))?.$disconnect()
}
