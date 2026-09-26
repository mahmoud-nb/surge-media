import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

export function readEnvFile(path: string): Record<string, string | undefined> {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
}

/**
 * Met à jour ou ajoute des variables dans un fichier .env en conservant le reste
 * (commentaires, ordre, autres variables). S'il n'existe pas, il est créé à partir
 * du modèle `template` (ex. `.env.example`).
 */
export function updateEnvFile(path: string, values: Record<string, string>, template?: string): void {
  let content = existsSync(path)
    ? readFileSync(path, 'utf8')
    : template && existsSync(template) ? readFileSync(template, 'utf8') : ''

  for (const [key, value] of Object.entries(values)) {
    if (/["\r\n]/.test(value)) {
      throw new Error(`Valeur invalide pour ${key} : guillemets et retours à la ligne interdits.`)
    }
    const line = `${key}="${value}"`
    const pattern = new RegExp(`^[ \t]*(?:export[ \t]+)?${key}[ \t]*=.*$`, 'm')
    // Remplacement par fonction : un `$` dans la valeur ne doit pas être interprété.
    content = pattern.test(content)
      ? content.replace(pattern, () => line)
      : `${content.replace(/\n*$/, content ? '\n' : '')}${line}\n`
  }

  writeFileSync(path, content)
}
