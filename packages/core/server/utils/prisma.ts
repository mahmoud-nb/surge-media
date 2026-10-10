import { resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaPg } from '@prisma/adapter-pg'
import { readDatabaseEnv, sqliteFilePath, type DatabaseProvider } from '#shared/database'
import type { PrismaClient } from '../generated/prisma/client'
import { useDatabasePressureMonitor } from '../lib/database/pressure'

/**
 * SQLite : attente maximale d'un verrou d'écriture tenu par un autre processus (ms). Explicite depuis la
 * phase D3 : un processus de travail (`surge-media worker`) peut partager le fichier avec le serveur web ;
 * leurs écritures sont courtes (une tâche, un état), mais se succèdent. better-sqlite3 attend de façon
 * synchrone : une attente longue bloque le processus, d'où un délai borné plutôt qu'infini. Seules les
 * instructions isolées et les transactions qui commencent par une écriture profitent de ce délai
 * (video-processing/jobs.ts) ; une transaction qui lit puis écrit peut échouer aussitôt.
 */
const SQLITE_BUSY_TIMEOUT_MS = 10_000

/**
 * Prisma 7 se connecte via un « driver adapter » propre à chaque fournisseur.
 * Le fournisseur doit correspondre à celui du client généré (voir `surge-media init`).
 */
function createAdapter(provider: DatabaseProvider, url: string) {
  switch (provider) {
    case 'sqlite':
      // Chemin relatif résolu depuis le dossier de lancement (packages/core), comme la CLI Prisma.
      return new PrismaBetterSqlite3({ url: `file:${resolve(sqliteFilePath(url))}`, timeout: SQLITE_BUSY_TIMEOUT_MS })
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
  const client = new PrismaClient({ adapter: createAdapter(provider, url) })
  if (provider !== 'sqlite') return client
  await enableWal(client)
  return withPressureMonitor(client)
}

/**
 * SQLite : chaque opération est chronométrée pour l'alerte « base sous pression » du tableau de bord
 * (server/lib/database/pressure.ts). better-sqlite3 étant synchrone, la durée d'une opération est le temps
 * pendant lequel le processus est bloqué (requête, attente du verrou d'un autre processus). Coût : une
 * fonction asynchrone de plus par opération. Le client étendu garde le comportement et l'interface du
 * client (transactions comprises, où l'extension s'applique aussi) ; seul son type diffère, d'où la
 * conversion.
 */
function withPressureMonitor(client: PrismaClient): PrismaClient {
  const monitor = useDatabasePressureMonitor()
  if (!monitor) return client
  return client.$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        const started = performance.now()
        try {
          const result = await query(args)
          monitor.operation(operation, performance.now() - started)
          return result
        }
        catch (error) {
          monitor.operation(operation, performance.now() - started, error)
          throw error
        }
      },
    },
  }) as unknown as PrismaClient
}

/**
 * SQLite en mode WAL (persistant dans le fichier) : les lectures ne sont plus bloquées pendant
 * une écriture (diffusion et API pendant un envoi). Crée les fichiers `-wal` et `-shm` à côté de
 * la base : les sauvegarder avec elle (ou `sqlite3 base.db ".backup copie.db"`).
 */
async function enableWal(client: PrismaClient): Promise<void> {
  try {
    await client.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  }
  catch (error) {
    console.warn('[surge-media] SQLite : mode WAL non activé (base occupée ?), le mode par défaut reste utilisé.', error)
  }
}

let client: Promise<PrismaClient> | undefined

/** Client Prisma partagé, créé au premier appel (DATABASE_PROVIDER, DATABASE_URL). */
export function usePrisma(): Promise<PrismaClient> {
  client ??= createClient()
  return client
}

/**
 * Filtre « contient » insensible à la casse sur tous les fournisseurs : SQLite (LIKE) et
 * MySQL (collation *_ci) le sont déjà ; PostgreSQL exige `mode: 'insensitive'`, option
 * refusée par les autres fournisseurs (d'où l'ajout conditionnel).
 */
export function textContains(value: string): { contains: string } {
  const filter: { contains: string, mode?: 'insensitive' } = { contains: value }
  if (readDatabaseEnv().provider === 'postgresql') filter.mode = 'insensitive'
  return filter
}

/**
 * Recherche « contient » sur plusieurs champs. SQLite ne compare sans tenir compte de la casse
 * que les lettres non accentuées (« ÉTÉ » ne trouve pas « été ») : la saisie est donc aussi
 * cherchée en minuscules, cas le plus courant.
 */
export function textSearch<F extends string>(fields: readonly F[], query: string): Record<F, { contains: string }>[] {
  const terms = [...new Set([query, query.toLowerCase()])]
  return fields.flatMap(field => terms.map(term => ({ [field]: textContains(term) }) as Record<F, { contains: string }>))
}

/**
 * Violation de contrainte d'unicité (P2002). Test par le code d'erreur plutôt que par
 * `instanceof Prisma.PrismaClientKnownRequestError`, qui imposerait un import statique
 * du client généré (voir createClient).
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}

export async function disconnectPrisma(): Promise<void> {
  const pending = client
  client = undefined
  await (await pending?.catch(() => undefined))?.$disconnect()
}
