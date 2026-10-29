import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DatabaseProvider } from '../../shared/database'

/**
 * Accès direct et minimal à la base pour les commandes d'administration de la CLI (`user mfa-reset`) :
 * même fournisseur et même URL que le serveur, sans passer par lui ni par le client Prisma (absent du paquet,
 * intégré au serveur construit). Pilotes : better-sqlite3 (dépendance du paquet), pg et mariadb (ceux du
 * serveur construit, `.output/server/node_modules`). Requêtes paramétrées, `?` partout (converti pour pg).
 */

export interface SqlClient {
  provider: DatabaseProvider
  /** Nom de table ou de colonne entre guillemets du fournisseur. */
  quote: (name: string) => string
  /** Date dans le format que Prisma écrit pour ce fournisseur. */
  date: (value: Date) => unknown
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
  run: (sql: string, params?: unknown[]) => Promise<number>
  transaction: (work: () => Promise<void>) => Promise<void>
  close: () => Promise<void>
}

/** URL SQLite (`file:…`) → chemin du fichier, relatif au dossier de l'installation. */
function sqlitePath(url: string, instanceDir: string): string {
  const path = url.replace(/^file:/, '').split('?')[0]!
  return isAbsolute(path) ? path : resolve(instanceDir, path)
}

/**
 * Pilote copié dans le serveur construit (`.output/server/node_modules`). Nitro n'y copie parfois que la
 * version ESM d'un paquet (mariadb : `promise.js`, sans `dist/promise.cjs`) : `require` échoue alors, et
 * l'entrée `import` de son package.json est chargée par `import()`.
 */
async function loadServerModule<T>(packageDir: string, serverEntry: string, name: string): Promise<T> {
  try {
    return createRequire(join(packageDir, serverEntry))(name) as T
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error
    const dir = join(packageDir, dirname(serverEntry), 'node_modules', name)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { exports?: Record<string, { import?: string | { default?: string } }>, module?: string }
    const entry = manifest.exports?.['.']?.import
    const file = (typeof entry === 'string' ? entry : entry?.default) ?? manifest.module
    if (!file) throw error
    const loaded = await import(pathToFileURL(join(dir, file)).href) as T & { default?: T }
    return loaded.default ?? loaded
  }
}

export async function openSqlClient(options: { provider: DatabaseProvider, url: string, packageDir: string, instanceDir: string, serverEntry: string }): Promise<SqlClient> {
  const fromPackage = createRequire(join(options.packageDir, 'package.json'))

  if (options.provider === 'sqlite') {
    const Database = fromPackage('better-sqlite3') as new (path: string, options?: { fileMustExist?: boolean, timeout?: number }) => {
      prepare: (sql: string) => { all: (...params: unknown[]) => unknown[], run: (...params: unknown[]) => { changes: number } }
      exec: (sql: string) => void
      close: () => void
    }
    const db = new Database(sqlitePath(options.url, options.instanceDir), { fileMustExist: true, timeout: 10_000 })
    return {
      provider: 'sqlite',
      quote: name => `"${name}"`,
      // Prisma (adaptateur better-sqlite3) écrit les dates en texte ISO avec un décalage explicite.
      date: value => value.toISOString().replace('Z', '+00:00'),
      query: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[],
      run: async (sql, params = []) => db.prepare(sql).run(...params).changes,
      transaction: async (work) => {
        db.exec('BEGIN IMMEDIATE')
        try {
          await work()
          db.exec('COMMIT')
        }
        catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
      close: async () => db.close(),
    }
  }

  if (options.provider === 'postgresql') {
    const pg = await loadServerModule<{ Client: new (config: { connectionString: string }) => {
      connect: () => Promise<void>
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[], rowCount: number | null }>
      end: () => Promise<void>
    } }>(options.packageDir, options.serverEntry, 'pg')
    const client = new pg.Client({ connectionString: options.url })
    await client.connect()
    const numbered = (sql: string) => {
      let index = 0
      return sql.replace(/\?/g, () => `$${++index}`)
    }
    return {
      provider: 'postgresql',
      quote: name => `"${name}"`,
      date: value => value,
      query: async <T>(sql: string, params: unknown[] = []) => (await client.query(numbered(sql), params)).rows as T[],
      run: async (sql, params = []) => (await client.query(numbered(sql), params)).rowCount ?? 0,
      transaction: async (work) => {
        await client.query('BEGIN')
        try {
          await work()
          await client.query('COMMIT')
        }
        catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      },
      close: () => client.end(),
    }
  }

  const mariadb = await loadServerModule<{ createConnection: (uri: string) => Promise<{
    query: (sql: string, params?: unknown[]) => Promise<unknown>
    beginTransaction: () => Promise<void>
    commit: () => Promise<void>
    rollback: () => Promise<void>
    end: () => Promise<void>
  }> }>(options.packageDir, options.serverEntry, 'mariadb')
  const connection = await mariadb.createConnection(options.url.replace(/^mysql:/, 'mariadb:'))
  return {
    provider: 'mysql',
    quote: name => `\`${name}\``,
    date: value => value,
    query: async <T>(sql: string, params: unknown[] = []) => [...(await connection.query(sql, params) as T[])],
    run: async (sql, params = []) => Number((await connection.query(sql, params) as { affectedRows: number }).affectedRows),
    transaction: async (work) => {
      await connection.beginTransaction()
      try {
        await work()
        await connection.commit()
      }
      catch (error) {
        await connection.rollback()
        throw error
      }
    },
    close: () => connection.end(),
  }
}
