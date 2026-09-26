import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'prisma/config'
import { readDatabaseEnv } from './shared/database'

// Prisma 7 ne charge plus le fichier .env automatiquement. Les variables déjà
// définies dans l'environnement (CI, Docker, CLI surge-media) restent prioritaires.
const envFile = fileURLToPath(new URL('.env', import.meta.url))
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

const { provider, url } = readDatabaseEnv()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // Un historique de migrations par fournisseur : le SQL généré n'est pas portable.
    path: `prisma/migrations/${provider}`,
  },
  datasource: {
    url,
  },
})
