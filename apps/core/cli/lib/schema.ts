import { readFileSync, writeFileSync } from 'node:fs'
import type { DatabaseProvider } from '../../shared/database'

/** Capture la valeur `provider` du bloc `datasource` (et non celle du `generator`). */
const DATASOURCE_PROVIDER = /(datasource\s+\w+\s*\{[^}]*?\bprovider\s*=\s*")([^"]*)(")/

export function readSchemaProvider(schema: string): string | undefined {
  return DATASOURCE_PROVIDER.exec(schema)?.[2]
}

export function setSchemaProvider(schema: string, provider: DatabaseProvider): string {
  if (!DATASOURCE_PROVIDER.test(schema)) {
    throw new Error('Bloc `datasource` introuvable dans le schéma Prisma.')
  }
  return schema.replace(DATASOURCE_PROVIDER, (_, before: string, _current: string, after: string) => `${before}${provider}${after}`)
}

/** Réécrit le fournisseur du schéma ; renvoie `true` si le fichier a changé. */
export function writeSchemaProvider(path: string, provider: DatabaseProvider): boolean {
  const schema = readFileSync(path, 'utf8')
  const updated = setSchemaProvider(schema, provider)
  if (updated === schema) return false
  writeFileSync(path, updated)
  return true
}
