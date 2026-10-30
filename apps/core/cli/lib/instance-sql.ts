import { join } from 'node:path'
import { DEFAULT_SQLITE_URL, isDatabaseProvider } from '../../shared/database'
import type { CliContext } from '../database'
import { SERVER_ENTRY } from '../server'
import { readEnvFile } from './env-file'
import { ENV_FILE } from './project'
import { openSqlClient, type SqlClient } from './sql-client'

/**
 * Base de l'installation pour les commandes d'administration (`user mfa-reset`, `license clock-reset`) :
 * DATABASE_PROVIDER et DATABASE_URL de l'environnement, sinon du .env de l'installation. Erreur au message
 * traduit si le fournisseur est inconnu ou la connexion impossible.
 */
export async function openInstanceSqlClient(ctx: CliContext): Promise<SqlClient> {
  const env = readEnvFile(join(ctx.instanceDir, ENV_FILE))
  const provider = process.env.DATABASE_PROVIDER || env.DATABASE_PROVIDER || 'sqlite'
  if (!isDatabaseProvider(provider)) throw new Error(ctx.t('sql.provider', { provider }))
  const url = process.env.DATABASE_URL || env.DATABASE_URL || DEFAULT_SQLITE_URL
  try {
    return await openSqlClient({ provider, url, packageDir: ctx.packageDir, instanceDir: ctx.instanceDir, serverEntry: SERVER_ENTRY })
  }
  catch (error) {
    throw new Error(ctx.t('sql.connection', { message: error instanceof Error ? error.message : String(error) }), { cause: error })
  }
}
