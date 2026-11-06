#!/usr/bin/env node
/**
 * Audit des dépendances npm (.claude/architecture-ci-security.md, SC1 et SC2) : lance `pnpm audit --json` sur tout
 * l'espace de travail, classe chaque alerte selon le projet qui la tire, applique les exceptions écrites
 * (security/audit-exceptions.json) et échoue (code 1) s'il reste une alerte élevée ou critique dans ce qui est livré.
 *
 *   - livrés : le core (toutes ses dépendances : la build Nuxt embarque aussi des dépendances de développement),
 *     @surge-media/client et @surge-media/vue (dépendances de production seulement) ;
 *   - non livrés (signalés sans bloquer) : la racine (outils de publication), le site, le bac à sable.
 *
 * Usage : node security/audit.mjs [--input audit.json]   (sans --input : lance pnpm audit)
 * Code de sortie : 0 conforme · 1 alerte bloquante ou exception invalide · 2 audit impossible (registre injoignable).
 * Résumé Markdown dans $GITHUB_STEP_SUMMARY quand la variable existe (GitHub Actions).
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const BLOCKING_SEVERITIES = ['high', 'critical']
/** Une exception dure 90 jours au plus : passé ce délai, l'alerte redevient bloquante et doit être revue. */
export const EXCEPTION_MAX_DAYS = 90
const DAY_MS = 86_400_000

/** Projets livrés : `all` = toutes les dépendances, `prod` = dépendances de production (et pairs). */
export const SHIPPED_PROJECTS = {
  'apps/core': 'all',
  'packages/client': 'prod',
  'packages/vue': 'prod',
}

/** `apps__core>nuxt>…` → projet `apps/core` et dépendance directe `nuxt` ; `.>release-it>…` → racine. */
export function parsePath(path) {
  const [importer = '.', direct = ''] = path.split('>')
  return { project: importer === '.' ? '.' : importer.replaceAll('__', '/'), direct }
}

function readManifest(project) {
  try {
    return JSON.parse(readFileSync(join(ROOT, project, 'package.json'), 'utf8'))
  }
  catch {
    return {}
  }
}

/** Dépendances de production directes de chaque projet livré en `prod`. */
export function productionDependencies(read = readManifest) {
  return Object.fromEntries(Object.entries(SHIPPED_PROJECTS).filter(([, scope]) => scope === 'prod').map(([project]) => {
    const manifest = read(project)
    return [project, new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])]
  }))
}

/** Une alerte vient-elle d'un projet livré, par l'un des chemins de dépendance qui le concerne ? */
export function isShipped(paths, production) {
  return paths.some((path) => {
    const { project, direct } = parsePath(path)
    const scope = SHIPPED_PROJECTS[project]
    if (scope === 'all') return true
    return scope === 'prod' && Boolean(production[project]?.has(direct))
  })
}

/**
 * Exceptions écrites : `{ id, package, reason, added, expires }`, dates AAAA-MM-JJ. Rend les exceptions valables à
 * cette date, et les erreurs (champ manquant, durée de plus de 90 jours, exception échue).
 */
export function checkExceptions(entries, now = Date.now()) {
  const valid = []
  const errors = []
  for (const entry of entries) {
    const label = `${entry.id ?? '?'} (${entry.package ?? '?'})`
    if (!entry.id || !entry.package || !entry.reason || !entry.added || !entry.expires) {
      errors.push(`${label} : id, package, reason, added et expires sont obligatoires.`)
      continue
    }
    const added = Date.parse(`${entry.added}T00:00:00Z`)
    const expires = Date.parse(`${entry.expires}T23:59:59Z`)
    if (!Number.isFinite(added) || !Number.isFinite(expires)) errors.push(`${label} : dates illisibles (AAAA-MM-JJ).`)
    else if (expires - added > EXCEPTION_MAX_DAYS * DAY_MS + DAY_MS) errors.push(`${label} : ${EXCEPTION_MAX_DAYS} jours au plus entre added et expires.`)
    else if (expires < now) errors.push(`${label} : exception échue le ${entry.expires}, à revoir (corriger, ou la renouveler en la motivant).`)
    else valid.push(entry)
  }
  return { valid, errors }
}

/** Classe les alertes de `pnpm audit --json`. */
export function classify(report, { exceptions = [], production = productionDependencies() } = {}) {
  const findings = Object.values(report.advisories ?? {}).map((advisory) => {
    const paths = [...new Set((advisory.findings ?? []).flatMap(finding => finding.paths ?? []))]
    const id = advisory.github_advisory_id ?? String(advisory.id)
    const exception = exceptions.find(entry => entry.id === id && entry.package === advisory.module_name) ?? null
    const shipped = isShipped(paths, production)
    return {
      id,
      package: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title,
      patched: advisory.patched_versions || null,
      url: advisory.url,
      versions: [...new Set((advisory.findings ?? []).map(finding => finding.version))],
      projects: [...new Set(paths.map(path => parsePath(path).project))],
      shipped,
      exception,
      blocking: shipped && BLOCKING_SEVERITIES.includes(advisory.severity) && !exception,
    }
  })
  const used = new Set(findings.filter(finding => finding.exception).map(finding => `${finding.id}|${finding.package}`))
  const unused = exceptions.filter(entry => !used.has(`${entry.id}|${entry.package}`))
  return { findings, unused }
}

const ORDER = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 }

export function summary({ findings, unused }, errors) {
  const blocking = findings.filter(finding => finding.blocking)
  const lines = ['## Audit des dépendances npm', '']
  lines.push(blocking.length || errors.length
    ? `**Échec** : ${blocking.length} alerte(s) bloquante(s), ${errors.length} exception(s) invalide(s).`
    : `**Conforme** : aucune alerte élevée ou critique sans exception dans ce qui est livré (${findings.length} alerte(s) au total).`)
  if (errors.length) lines.push('', ...errors.map(error => `- ${error}`))
  if (findings.length) {
    lines.push('', '| Gravité | Paquet | Versions | Corrigé en | Projets | Livré | État | Alerte |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const finding of [...findings].sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9) || a.package.localeCompare(b.package))) {
      const state = finding.blocking ? '**bloquant**' : finding.exception ? `exception jusqu'au ${finding.exception.expires}` : finding.shipped ? 'signalé' : 'non livré'
      lines.push(`| ${finding.severity} | \`${finding.package}\` | ${finding.versions.join(', ')} | ${finding.patched ?? '—'} | ${finding.projects.join(', ')} | ${finding.shipped ? 'oui' : 'non'} | ${state} | [${finding.id}](${finding.url}) |`)
    }
  }
  if (unused.length) lines.push('', `Exceptions sans objet, à retirer de security/audit-exceptions.json : ${unused.map(entry => `${entry.id} (${entry.package})`).join(', ')}.`)
  return `${lines.join('\n')}\n`
}

function runAudit() {
  try {
    return execFileSync('pnpm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
  }
  catch (error) {
    // pnpm audit sort en erreur dès qu'il trouve une alerte : sa sortie reste le rapport.
    if (typeof error.stdout === 'string' && error.stdout.trim().startsWith('{')) return error.stdout
    throw error
  }
}

async function main() {
  const index = process.argv.indexOf('--input')
  let report
  try {
    report = JSON.parse(index === -1 ? runAudit() : readFileSync(process.argv[index + 1], 'utf8'))
    if (!report || typeof report !== 'object' || !('advisories' in report)) throw new Error(report?.error?.summary ?? 'réponse inattendue')
  }
  catch (error) {
    console.error(`Audit impossible : ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    process.exit(2)
  }
  const file = join(ROOT, 'security', 'audit-exceptions.json')
  const { valid, errors } = checkExceptions(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [])
  const result = classify(report, { exceptions: valid })
  const text = summary(result, errors)
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  process.exit(result.findings.some(finding => finding.blocking) || errors.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
