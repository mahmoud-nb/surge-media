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

/** Anciennes variables renommées : nuxt-auth-utils 0.6 ignore NUXT_SESSION_PASSWORD au profit de NUXT_APP_SECRET. */
export const RENAMED_SECRETS = [{ from: 'NUXT_SESSION_PASSWORD', to: 'NUXT_APP_SECRET' }] as const

/**
 * Renomme dans le texte d'un .env les variables de `RENAMED_SECRETS` quand la nouvelle est absente : la ligne
 * garde sa place et sa valeur (aucun secret perdu ni régénéré, les liens signés dérivés restent valables). Si les
 * deux existent, l'ancienne est retirée. Rend le texte modifié et les renommages faits.
 */
export function renameLegacySecrets(content: string): { content: string, renamed: { from: string, to: string }[] } {
  const renamed: { from: string, to: string }[] = []
  for (const { from, to } of RENAMED_SECRETS) {
    const oldLine = new RegExp(`^([ \t]*(?:export[ \t]+)?)${from}([ \t]*=.*)$`, 'm')
    if (!oldLine.test(content)) continue
    const hasNew = new RegExp(`^[ \t]*(?:export[ \t]+)?${to}[ \t]*=`, 'm').test(content)
    content = hasNew
      ? content.replace(new RegExp(`${oldLine.source}\r?\n?`, 'm'), '')
      : content.replace(oldLine, (_line, prefix: string, rest: string) => `${prefix}${to}${rest}`)
    renamed.push({ from, to })
  }
  return { content, renamed }
}

/**
 * Applique `renameLegacySecrets` à un fichier .env existant ; rend les renommages faits. Fichier absent : rien à
 * renommer. Lu directement, sans contrôle d'existence préalable (pas d'intervalle entre un contrôle et l'écriture,
 * CodeQL `js/file-system-race`) ; réécrit seulement si une variable a été renommée.
 */
export function renameLegacySecretsInFile(path: string): { from: string, to: string }[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const { content, renamed } = renameLegacySecrets(text)
  if (renamed.length) writeFileSync(path, content)
  return renamed
}
