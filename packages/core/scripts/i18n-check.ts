/**
 * Vérifie les traductions de l'interface :
 *  - cohérence de chaque i18n/locales/*.json avec la langue de référence (fr.json) :
 *    clés manquantes ou en trop, valeurs vides, paramètres ({name}, {max}…) différents ;
 *  - clés utilisées dans le code (app/, shared/) : t('…') littéral et préfixe des
 *    clés dynamiques t(`roles.${…}`) doivent exister dans fr.json.
 *
 *   pnpm i18n:check
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REFERENCE = 'fr'
const root = resolve(import.meta.dirname, '..')
const dir = join(root, 'i18n/locales')
const SOURCE_DIRS = ['app', 'shared']

type Messages = { [key: string]: string | Messages }

function flatten(messages: Messages, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>()
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') entries.set(path, value)
    else for (const [k, v] of flatten(value, path)) entries.set(k, v)
  }
  return entries
}

/** Paramètres nommés d'un message, hors interpolations littérales comme {'@'}. */
function params(message: string): string {
  return [...message.matchAll(/\{\s*(\w+)\s*\}/g)].map(match => match[1]).sort().join(',')
}

function load(code: string): Map<string, string> {
  return flatten(JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as Messages)
}

const reference = load(REFERENCE)
const locales = readdirSync(dir).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5))
const problems: string[] = []

for (const [key, value] of reference) {
  if (!value.trim()) problems.push(`${REFERENCE} : valeur vide pour « ${key} »`)
}

for (const code of locales.filter(code => code !== REFERENCE)) {
  const messages = load(code)
  for (const [key, value] of reference) {
    const translated = messages.get(key)
    if (translated === undefined) problems.push(`${code} : clé manquante « ${key} »`)
    else if (!translated.trim()) problems.push(`${code} : valeur vide pour « ${key} »`)
    else if (params(translated) !== params(value)) {
      problems.push(`${code} : paramètres différents pour « ${key} » ({${params(translated)}} au lieu de {${params(value)}})`)
    }
  }
  for (const key of messages.keys()) {
    if (!reference.has(key)) problems.push(`${code} : clé absente de ${REFERENCE}.json « ${key} »`)
  }
}

function sourceFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(vue|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
}

const referenceKeys = [...reference.keys()]
let usages = 0
for (const file of SOURCE_DIRS.flatMap(name => sourceFiles(join(root, name)))) {
  const code = readFileSync(file, 'utf8')
  const where = relative(root, file).replaceAll('\\', '/')
  // t('clé') / t("clé")
  for (const [, key] of code.matchAll(/\bt\(\s*['"]([\w.-]+)['"]/g)) {
    usages++
    if (!reference.has(key!)) problems.push(`${where} : clé inconnue « ${key} »`)
  }
  // t(`préfixe.${…}…`) : au moins une clé doit commencer par le préfixe statique
  for (const [, prefix] of code.matchAll(/\bt\(\s*`([\w.-]*)\$\{/g)) {
    usages++
    if (!referenceKeys.some(key => key.startsWith(prefix!))) problems.push(`${where} : aucune clé ne commence par « ${prefix} »`)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`)
  process.exit(1)
}
console.log(`✔ ${locales.length} langues (${locales.join(', ')}), ${reference.size} clés cohérentes avec ${REFERENCE}.json, ${usages} appels t() vérifiés.`)
