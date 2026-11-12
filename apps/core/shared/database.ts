/**
 * Fournisseurs de base de données supportés par SurgeMedia.
 *
 * Module partagé (sans dépendance) entre le serveur Nitro, `prisma.config.ts`,
 * la CLI `surge-media` et les scripts de maintenance : c'est la source de vérité
 * unique pour la liste des fournisseurs et leurs URLs.
 */

export const DATABASE_PROVIDERS = ['sqlite', 'postgresql', 'mysql'] as const

export type DatabaseProvider = (typeof DATABASE_PROVIDERS)[number]

export const DEFAULT_DATABASE_PROVIDER: DatabaseProvider = 'sqlite'

/** Base SQLite par défaut, relative au dossier du package core. */
export const DEFAULT_SQLITE_URL = 'file:./data/surge-media.db'

/** Schémas d'URL acceptés pour chaque fournisseur (MariaDB utilise le fournisseur `mysql` et une URL mysql://). */
export const DATABASE_URL_SCHEMES: Record<DatabaseProvider, readonly string[]> = {
  sqlite: ['file:'],
  postgresql: ['postgresql:', 'postgres:'],
  mysql: ['mysql:'],
}

/** Exemples d'URL proposés par la CLI. */
export const DATABASE_URL_EXAMPLES: Record<DatabaseProvider, string> = {
  sqlite: DEFAULT_SQLITE_URL,
  postgresql: 'postgresql://surge:password@localhost:5432/surge_media',
  mysql: 'mysql://surge:password@localhost:3306/surge_media',
}

export function isDatabaseProvider(value: unknown): value is DatabaseProvider {
  return typeof value === 'string' && (DATABASE_PROVIDERS as readonly string[]).includes(value)
}

/** Déduit le fournisseur à partir du schéma de l'URL (`undefined` si inconnu). */
export function detectDatabaseProvider(url: string): DatabaseProvider | undefined {
  const scheme = url.trim().toLowerCase()
  return DATABASE_PROVIDERS.find(provider =>
    DATABASE_URL_SCHEMES[provider].some(prefix => scheme.startsWith(prefix)),
  )
}

/**
 * Lit la configuration base de données depuis l'environnement
 * (`DATABASE_PROVIDER`, `DATABASE_URL`) en appliquant les valeurs par défaut SQLite.
 */
export function readDatabaseEnv(env: Record<string, string | undefined> = process.env): {
  provider: DatabaseProvider
  url: string
} {
  const provider = env.DATABASE_PROVIDER?.trim() || DEFAULT_DATABASE_PROVIDER
  if (!isDatabaseProvider(provider)) {
    throw new Error(
      `DATABASE_PROVIDER="${provider}" n'est pas supporté (valeurs possibles : ${DATABASE_PROVIDERS.join(', ')}).`,
    )
  }
  const url = env.DATABASE_URL?.trim() || (provider === 'sqlite' ? DEFAULT_SQLITE_URL : '')
  if (!url) {
    throw new Error(`DATABASE_URL est requis pour le fournisseur "${provider}".`)
  }
  const detected = detectDatabaseProvider(url)
  if (detected !== provider) {
    throw new Error(
      `DATABASE_URL ne correspond pas à DATABASE_PROVIDER="${provider}" `
      + `(schéma attendu : ${DATABASE_URL_SCHEMES[provider].join(' ou ')}).`,
    )
  }
  return { provider, url }
}

/** Chemin du fichier SQLite d'une URL `file:` (relatif ou absolu, sans paramètres). */
export function sqliteFilePath(url: string): string {
  return url.trim().replace(/^file:(\/\/)?/, '').split('?')[0]!
}
