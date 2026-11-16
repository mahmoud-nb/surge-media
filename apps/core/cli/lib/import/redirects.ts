import { csvLine, parseCsv } from './csv'
import { parseS3Url } from './s3'
import { IMPORT_STATUSES, type ImportStatus } from './state'

/**
 * `surge-media import redirects` (.claude/architecture-import.md, IM12) : règles de redirection 301 des
 * anciennes adresses vers les URL de SurgeMedia, tirées de la table de correspondance d'un import. À installer
 * sur le serveur ou le CDN qui répond encore aux anciennes adresses — utile seulement si ce domaine appartient
 * au client. Fonctions pures : rien n'est lu ni écrit ici.
 *
 * Les formats de configuration (nginx, Caddy, Apache) comparent le **chemin décodé** de la requête : la règle
 * porte donc `/photos/été.jpg`, pas `/photos/%C3%A9t%C3%A9.jpg`. Une adresse qui contient un caractère que ces
 * syntaxes interprètent (guillemet, antislash, `$`, accolade, point-virgule…) est écartée et signalée, plutôt
 * que d'écrire une règle fausse ou une configuration qui ne se charge plus.
 */

export const REDIRECT_FORMATS = ['nginx', 'caddy', 'apache', 'cloudflare', 'json'] as const
export type RedirectFormat = (typeof REDIRECT_FORMATS)[number]

export interface MappingRow {
  source: string
  status: ImportStatus | 'pending'
  url: string
}

export type MappingError = 'empty' | 'columns'

/** Lignes d'une table de correspondance (`<manifeste>.mapping.csv`) ; les colonnes sont trouvées par leur nom. */
export function parseMapping(text: string): MappingRow[] | MappingError {
  const records = parseCsv(text)
  const header = records.shift()
  if (!header) return 'empty'
  const columns = header.fields.map(name => name.trim())
  const index = { source: columns.indexOf('source'), status: columns.indexOf('status'), url: columns.indexOf('url') }
  if (index.source === -1 || index.status === -1 || index.url === -1) return 'columns'
  return records.map((record) => {
    const status = record.fields[index.status] ?? ''
    return {
      source: record.fields[index.source] ?? '',
      status: (IMPORT_STATUSES as readonly string[]).includes(status) ? status as ImportStatus : 'pending',
      url: record.fields[index.url] ?? '',
    }
  })
}

export interface RedirectRule {
  /** Chemin décodé de l'ancienne adresse, toujours avec `/` initial. */
  path: string
  /** Origine de l'ancienne adresse (`https://www.exemple.fr`) quand elle est connue. */
  origin: string | null
  /** URL de diffusion du média. */
  to: string
}

/**
 * Pourquoi une ligne importée n'a pas de règle :
 * - `invalid` : la source ne donne pas d'adresse (chemin absolu d'un disque, URL illisible) ;
 * - `unsafe` : l'adresse contient un caractère que la syntaxe de ce format interprète ;
 * - `conflict` : un autre fichier a déjà une règle pour ce chemin, vers un autre média ;
 * - `noOrigin` : ce format exige le domaine de l'ancienne adresse (`--origin`).
 */
export type RedirectSkip = 'invalid' | 'unsafe' | 'conflict' | 'noOrigin'

export interface RedirectPlan {
  rules: RedirectRule[]
  skipped: { source: string, reason: RedirectSkip }[]
  /** Lignes de la table sans média (refusées, en échec, pas encore traitées). */
  notImported: number
}

export interface RedirectOptions {
  format: RedirectFormat
  /** Chemin sous lequel les fichiers étaient servis (`/uploads`), pour les sources du disque et de S3. */
  prefix: string
  /** Origine des anciennes adresses, pour les sources qui ne sont pas des URL. */
  origin: string | null
}

/** Caractères que nginx, Caddy ou Apache interprètent dans une valeur entre guillemets, et sauts de ligne. */
const UNSAFE = /["\\$`{};\p{Cc}]/u
const WITH_STATUS: readonly string[] = ['created', 'exists', 'deduplicated']

function joinPath(...parts: string[]): string {
  return `/${parts.flatMap(part => part.split('/')).filter(Boolean).join('/')}`
}

/** Origine (`https://hôte[:port]`) d'une option `--origin` ; null si ce n'est pas une URL `http(s)` sans chemin. */
export function redirectOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, '') !== '') return null
    return url.origin
  }
  catch {
    return null
  }
}

/** Ancienne adresse d'une source : chemin décodé et, pour une URL, son origine ; null si elle n'en donne pas. */
export function oldAddress(source: string, prefix: string): { path: string, origin: string | null } | null {
  if (/^https?:\/\//i.test(source)) {
    try {
      const url = new URL(source)
      // `decodeURI` laisse encodés les séparateurs (`%2F`, `%3F`, `%23`) : le chemin garde sa structure.
      return { path: decodeURI(url.pathname), origin: url.origin }
    }
    catch {
      return null
    }
  }
  const location = /^s3:\/\//i.test(source) ? parseS3Url(source) : null
  if (/^s3:\/\//i.test(source)) return location?.key ? { path: joinPath(prefix, location.key), origin: null } : null
  // Chemin absolu d'un disque (`C:\photos\a.jpg`, `/var/www/a.jpg` hors racine) : aucune adresse à en tirer.
  if (/^[a-z]:[\\/]/i.test(source) || /^[a-z][a-z0-9+.-]+:\/\//i.test(source)) return null
  const relative = source.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (relative === '' || relative.split('/').includes('..')) return null
  return { path: joinPath(prefix, relative), origin: null }
}

export function buildRedirects(rows: readonly MappingRow[], options: RedirectOptions): RedirectPlan {
  const plan: RedirectPlan = { rules: [], skipped: [], notImported: 0 }
  const config = options.format === 'nginx' || options.format === 'caddy' || options.format === 'apache'
  /** Clé d'une règle → cible : par chemin pour une configuration (un seul site), par adresse complète sinon. */
  const seen = new Map<string, string>()
  for (const row of rows) {
    if (!WITH_STATUS.includes(row.status) || row.url === '') {
      plan.notImported++
      continue
    }
    const address = oldAddress(row.source, options.prefix)
    if (!address) {
      plan.skipped.push({ source: row.source, reason: 'invalid' })
      continue
    }
    const origin = address.origin ?? options.origin
    if (options.format === 'cloudflare' && !origin) {
      plan.skipped.push({ source: row.source, reason: 'noOrigin' })
      continue
    }
    if (config && (UNSAFE.test(address.path) || UNSAFE.test(row.url) || /\s/.test(row.url))) {
      plan.skipped.push({ source: row.source, reason: 'unsafe' })
      continue
    }
    const key = config ? address.path : `${origin ?? ''}${address.path}`
    const known = seen.get(key)
    if (known !== undefined) {
      // Même fichier listé deux fois (doublon rattaché) : une seule règle suffit.
      if (known !== row.url) plan.skipped.push({ source: row.source, reason: 'conflict' })
      continue
    }
    seen.set(key, row.url)
    plan.rules.push({ path: address.path, origin, to: row.url })
  }
  return plan
}

/** Commentaires de tête du fichier produit, déjà traduits (jamais de saut de ligne). */
export interface RedirectLabels {
  title: string
  usage: string[]
}

const quoted = (value: string) => `"${value}"`
const regexEscaped = (value: string) => value.replace(/[.*+?^()|[\]]/g, '\\$&')
const comments = (labels: RedirectLabels) => [labels.title, ...labels.usage].map(line => `# ${line}\n`).join('')

/**
 * Fichier de redirections. nginx : une table `map` sur `$uri` (chemin décodé), à inclure dans `http { }`.
 * Caddy : `map` sur `{path}` puis `redir`. Apache : une ligne `RedirectMatch` par adresse (mod_alias, chemin
 * exact). Cloudflare : CSV des redirections en masse, sans en-tête (`hôte/chemin,cible,301`). JSON : la liste
 * brute, pour tout autre outil.
 */
export function renderRedirects(format: RedirectFormat, rules: readonly RedirectRule[], labels: RedirectLabels): string {
  switch (format) {
    case 'nginx':
      return `${comments(labels)}map $uri $surge_media_redirect {\n    default "";\n${rules.map(rule => `    ${quoted(rule.path)} ${quoted(rule.to)};\n`).join('')}}\n`
    case 'caddy':
      return `${comments(labels)}map {path} {surge_media_redirect} {\n${rules.map(rule => `\t${quoted(rule.path)} ${quoted(rule.to)}\n`).join('')}\tdefault ""\n}\n@surge_media_moved expression \`{surge_media_redirect} != ""\`\nredir @surge_media_moved {surge_media_redirect} 301\n`
    case 'apache':
      return `${comments(labels)}${rules.map(rule => `RedirectMatch 301 ${quoted(`^${regexEscaped(rule.path)}$`)} ${quoted(rule.to)}\n`).join('')}`
    case 'cloudflare':
      // Sans schéma : la règle vaut pour http et https. Chemin encodé, comme dans une URL.
      return rules.map(rule => csvLine([`${new URL(rule.origin!).host}${encodeURI(rule.path)}`, rule.to, 301])).join('')
    case 'json':
      return `${JSON.stringify(rules.map(rule => ({ from: rule.path, origin: rule.origin, to: rule.to, status: 301 })), null, 2)}\n`
  }
}
