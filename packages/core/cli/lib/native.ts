import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Pilote SQLite (better-sqlite3) utilisable depuis le paquet ? Son module natif est téléchargé ou compilé par
 * son script d'installation, que npm 12 et plus (comme pnpm) n'exécutent qu'une fois approuvé : sans lui, le
 * serveur démarre mais chaque accès à la base échoue (« Could not locate the bindings file »). Renvoie le
 * message d'erreur, ou `undefined` si une base en mémoire s'ouvre.
 */
export function sqliteDriverError(packageDir: string): string | undefined {
  try {
    const require = createRequire(join(packageDir, 'package.json'))
    const Database = require('better-sqlite3') as new (path: string) => { close: () => void }
    new Database(':memory:').close()
    return undefined
  }
  catch (error) {
    return error instanceof Error ? error.message.split('\n')[0] : String(error)
  }
}
