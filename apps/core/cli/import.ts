import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { cancel, intro, log, outro, spinner } from '@clack/prompts'
import type { CliContext } from './database'
import { detectLocale, langFromArgv } from './i18n'
import type { MessageKey } from './i18n/fr'
import { healthUrl } from './lib/diagnose/collect'
import { formatBytes } from './lib/diagnose/render'
import { readEnvFile } from './lib/env-file'
import { ApiError, type ApiClient, type ApiMe, type ApiProject, apiRoot, createApiClient, RATE_LIMIT_VARIABLES } from './lib/import/api'
import { csvLine } from './lib/import/csv'
import { manifestHeader, manifestLine, type ManifestIssue, type ManifestRow, parseManifest } from './lib/import/manifest'
import { estimatedMinutes, planDraft, scanBucket, scanDirectory } from './lib/import/plan'
import { createProgressLine } from './lib/import/progress'
import { buildRedirects, parseMapping, REDIRECT_FORMATS, type RedirectFormat, redirectOrigin, type RedirectSkip, renderRedirects } from './lib/import/redirects'
import { pendingRows, prepareFolders, prepareTags, runImport } from './lib/import/run'
import { createS3Reader, parseS3Url, S3_ACCESS_KEY_VARIABLE, S3_SECRET_KEY_VARIABLE, s3BucketRegion, s3Hint, type S3Reader, type S3Sdk, s3SettingsFrom, s3Url } from './lib/import/s3'
import { SourceError } from './lib/import/sources'
import { appendState, countByStatus, type ImportEntry, type ImportStatus, loadState, startState, writeMapping } from './lib/import/state'
import { ENV_FILE, packageVersion } from './lib/project'
import { loadServerModule } from './lib/sql-client'
import { SERVER_ENTRY } from './server'

/**
 * `surge-media import` : reprise des médias qu'un client possède déjà (.claude/architecture-import.md).
 *
 *   import plan --from <dossier>     parcourt un dossier et écrit un manifeste CSV (aucun serveur requis)
 *   import run <manifeste.csv>       envoie les fichiers du manifeste par l'API v1, reprise possible
 *
 * L'outil est un client de l'API : il lui faut l'adresse du serveur et une clé secrète (ou un jeton
 * personnel) avec `media:upload`, lue dans `SURGE_MEDIA_API_KEY` ou dans un fichier — jamais en argument,
 * qui resterait dans l'historique du shell. Code de sortie de `run` : 0 = tout le manifeste est traité
 * (des refus définitifs compris), 2 = il reste des lignes à reprendre (relancer la même commande), 1 = la
 * commande n'a pas pu tourner.
 */

export const API_KEY_VARIABLE = 'SURGE_MEDIA_API_KEY'
export const DEFAULT_CONCURRENCY = 2
export const MAX_CONCURRENCY = 8
/** Hors terminal, écart minimal entre deux rappels d'attente (débit atteint, serveur occupé). */
const WAIT_NOTICE_INTERVAL_MS = 30_000
/** Problèmes du manifeste et lignes en échec détaillés au plus ; le reste est compté. */
const SHOWN_LIMIT = 20

/**
 * Écrit un fichier produit par la commande. Sans `force`, création exclusive (`wx`) : un fichier apparu
 * depuis la vérification du début n'est jamais écrasé (false si le fichier existe déjà).
 */
export function writeOutputFile(path: string, content: string, force: boolean, mode?: number): boolean {
  try {
    writeFileSync(path, content, { flag: force ? 'w' : 'wx', ...(mode === undefined ? {} : { mode }) })
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

function fail(message: string): never {
  cancel(message)
  process.exit(1)
}

// ─── import plan ─────────────────────────────────────────────────────────────

/** Options du compartiment S3 d'où viennent les fichiers (`--from s3://…`, sources `s3://` d'un manifeste). */
export interface S3Args {
  s3Endpoint?: string
  s3Region?: string
  s3PathStyle?: boolean
}

/**
 * Lecteur du compartiment source : identifiants dans l'environnement seulement, SDK du serveur construit
 * (ou de `node_modules` dans le dépôt des sources). `stop` arrête la commande avec le message donné.
 */
async function openS3(ctx: CliContext, args: S3Args, stop: (message: string) => never): Promise<S3Reader> {
  const { t } = ctx
  if (args.s3Endpoint && !/^https?:\/\/[^\s]+$/i.test(args.s3Endpoint)) stop(t('import.error.s3Endpoint'))
  const settings = s3SettingsFrom(process.env, { endpoint: args.s3Endpoint, region: args.s3Region, pathStyle: args.s3PathStyle })
  if (!settings) return stop(t('import.error.s3Credentials', { id: S3_ACCESS_KEY_VARIABLE, secret: S3_SECRET_KEY_VARIABLE })) // gitleaks:allow (nom de variable, pas une valeur)
  const sdk = await loadServerModule<S3Sdk>(ctx.packageDir, SERVER_ENTRY, '@aws-sdk/client-s3').catch(() => stop(t('import.error.s3Sdk')))
  return createS3Reader(sdk, settings)
}

export interface ImportPlanArgs extends S3Args {
  from?: string
  out?: string
  foldersFromPath?: boolean
  force?: boolean
}

export async function runImportPlan(ctx: CliContext, args: ImportPlanArgs): Promise<void> {
  const { t } = ctx
  const locale = detectLocale(langFromArgv(process.argv))
  intro(t('intro.importPlan'))
  if (!args.from) fail(t('import.error.fromRequired'))
  const bucket = /^s3:\/\//i.test(args.from) ? parseS3Url(args.from) : null
  if (/^s3:\/\//i.test(args.from) && !bucket) fail(t('import.error.fromS3'))
  if (!bucket && /^[a-z][a-z0-9+.-]+:\/\//i.test(args.from)) fail(t('import.error.fromScheme'))
  const root = bucket ? s3Url(bucket.bucket, bucket.key) : resolve(args.from)
  if (!bucket && (!existsSync(root) || !statSync(root).isDirectory())) fail(t('import.error.fromNotDirectory', { path: root }))
  const out = resolve(args.out ?? 'manifest.csv')
  const rejectedPath = out.replace(/\.csv$/i, '') + '.rejected.csv'
  if (existsSync(out) && !args.force) fail(t('import.error.outExists', { path: out }))
  const reader = bucket ? await openS3(ctx, args, fail) : null

  const progress = spinner()
  progress.start(t('import.plan.scanning'))
  const scanOptions = {
    foldersFromPath: Boolean(args.foldersFromPath),
    onFile: (count: number) => {
      if (count % 200 === 0) progress.message(t('import.plan.scanned', { count }))
    },
  }
  const report = await (reader && bucket ? scanBucket(reader, bucket.bucket, bucket.key, scanOptions) : scanDirectory(root, scanOptions)).catch((error: unknown) => {
    progress.stop(t('import.plan.scanFailed'))
    const message = error instanceof SourceError ? [error.code, error.detail].filter(Boolean).join(' — ') : (error as Error).message
    const hint = error instanceof SourceError ? s3Hint(error.detail) : null
    const region = error instanceof SourceError ? s3BucketRegion(error.detail) ?? '' : ''
    fail(`${t('import.error.read', { path: root, message })}${hint ? `\n${t(`import.hint.s3.${hint}`, { region })}` : ''}`)
  })
  progress.stop(t('import.plan.scanDone', { count: report.files.length, size: formatBytes(report.totalBytes, locale) }))

  if (report.files.length === 0) fail(t('import.plan.nothing', { path: root }))
  if (!writeOutputFile(out, manifestHeader() + report.files.map(file => manifestLine(planDraft(file))).join(''), Boolean(args.force), 0o600)) {
    fail(t('import.error.outExists', { path: out }))
  }
  if (report.rejected.length > 0) {
    writeFileSync(rejectedPath, csvLine(['source', 'reason', 'detail']) + report.rejected.map(item => csvLine([item.source, item.reason, item.detail])).join(''), { mode: 0o600 })
  }

  const byType = new Map<string, number>()
  for (const file of report.files) byType.set(file.mimeType, (byType.get(file.mimeType) ?? 0) + 1)
  log.info(t('import.plan.types', { types: [...byType].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${type} × ${count}`).join(', ') }))
  if (report.rejected.length > 0) log.warn(t('import.plan.rejected', { count: report.rejected.length, path: rejectedPath }))
  const overLimit = report.files.filter(file => file.overDefaultLimit).length
  if (overLimit > 0) log.warn(t('import.plan.overLimit', { count: overLimit }))
  const converted = report.files.filter(file => file.converted).length
  if (converted > 0) log.warn(t('import.plan.converted', { count: converted }))
  if (report.foldersDropped > 0) log.warn(t('import.plan.foldersDropped', { count: report.foldersDropped }))
  const { symlinks, hidden, special } = report.skipped
  if (symlinks + hidden + special > 0) log.info(t('import.plan.skipped', { symlinks, hidden, special }))
  log.info(t('import.plan.duration', { minutes: estimatedMinutes(report.files.length) }))
  // Un manifeste d'adresses `s3://` ne dépend d'aucun dossier : rien à dire de la racine.
  if (!bucket) log.info(t('import.plan.root', { path: root }))
  outro(t('import.plan.written', { path: out }))
}

// ─── import run ──────────────────────────────────────────────────────────────

export interface ImportRunArgs extends S3Args {
  manifest?: string
  project?: string
  root?: string
  url?: string
  keyFile?: string
  publicUrl?: string
  visibility?: string
  concurrency?: string
  dryRun?: boolean
  createFolders?: boolean
  createTags?: boolean
  dedupe?: boolean
  retryRejected?: boolean
  resetState?: boolean
  json?: boolean
}

/**
 * Adresse du serveur : `--url`, sinon le serveur local d'après `PORT` et `HOST` (environnement puis `.env`).
 * Sans adresse d'écoute précise : `localhost`, que Node résout en IPv4 comme en IPv6 (`nuxt dev` n'écoute
 * que sur `::1`, le serveur construit sur toutes les interfaces).
 */
export function serverUrl(explicit: string | undefined, env: Record<string, string | undefined>): string {
  if (explicit) return explicit
  const url = new URL(healthUrl(env.PORT ?? null, env.HOST ?? env.NITRO_HOST ?? null))
  if (url.hostname === '127.0.0.1') url.hostname = 'localhost'
  return url.origin
}

/** Clé de l'API : variable d'environnement, sinon première ligne non vide du fichier ; null si absente. */
export function readApiKey(env: Record<string, string | undefined>, keyFile: string | undefined): string | null {
  const fromEnv = env[API_KEY_VARIABLE]?.trim()
  if (fromEnv) return fromEnv
  if (!keyFile) return null
  const line = readFileSync(resolve(keyFile), 'utf8').split(/\r?\n/).map(value => value.trim()).find(Boolean)
  return line ?? null
}

/** Chemins de l'état et de la table de correspondance d'un manifeste (`a.csv` → `a.state.jsonl`, `a.mapping.csv`). */
export function importFiles(manifestPath: string): { state: string, mapping: string } {
  const base = manifestPath.replace(/\.csv$/i, '')
  return { state: `${base}.state.jsonl`, mapping: `${base}.mapping.csv` }
}

/** Projet visé : celui de la clé, ou celui désigné par `--project` (identifiant ou slug) ; null s'il est introuvable. */
export async function resolveProject(client: Pick<ApiClient, 'projects'>, me: ApiMe, wanted: string | undefined): Promise<{ id: string } | 'ambiguous' | null> {
  const matches = (project: { id: string, slug: string }) => project.id === wanted || project.slug === wanted
  if (me.project) return !wanted || matches(me.project) ? { id: me.project.id } : null
  if (!wanted) return 'ambiguous'
  return (await client.projects()).find(matches) ?? null
}

const TOOL_CODES = new Set([
  'SOURCE_NOT_FOUND',
  'SOURCE_OUTSIDE_ROOT',
  'SOURCE_NOT_A_FILE',
  'SOURCE_UNREADABLE',
  'SOURCE_EMPTY',
  'DOWNLOAD_FAILED',
  'DOWNLOAD_TOO_LARGE',
  'DOWNLOAD_TIMEOUT',
  'DOWNLOAD_REDIRECTS',
  'UNSUPPORTED_TYPE',
  'FILE_TOO_LARGE',
  'UNREADABLE_FILE',
  'DIMENSIONS_TOO_LARGE',
  'NETWORK',
  'RATE_LIMITED',
  'SERVER_BUSY',
])

export async function runImportRun(ctx: CliContext, args: ImportRunArgs): Promise<void> {
  const { t } = ctx
  const json = Boolean(args.json)
  const dryRun = Boolean(args.dryRun)
  const say = {
    info: (message: string) => json ? undefined : log.info(message),
    warn: (message: string) => json ? undefined : log.warn(message),
    step: (message: string) => json ? undefined : log.step(message),
  }
  const stop = (message: string): never => {
    if (!json) fail(message)
    process.stdout.write(`${JSON.stringify({ type: 'error', message })}\n`)
    process.exit(1)
  }
  /** Explication d'un code : traduite pour ceux de l'outil et les refus courants, suivie du détail brut (octets, type, message de l'API). */
  const explain = (code: string | null, detail: string | null): string => {
    if (!code) return ''
    if (!TOOL_CODES.has(code)) return detail ? `${code} — ${detail}` : code
    const text = t(`import.code.${code}` as MessageKey)
    return `${code} — ${detail ? `${text.endsWith('.') ? text.slice(0, -1) : text} (${detail}).` : text}`
  }
  const apiFailure = (error: unknown, url: string): never => {
    if (!(error instanceof ApiError)) throw error
    if (error.code === 'NETWORK') return stop(t('import.error.unreachable', { url, detail: error.detail ?? '' }))
    if (error.code === 'INVALID_RESPONSE') return stop(t('import.error.notApi', { url }))
    return stop(t('import.error.api', { code: error.code, detail: error.detail ?? '' }))
  }

  if (!json) intro(t(dryRun ? 'intro.importDryRun' : 'intro.importRun'))

  // 1. Manifeste : tout est validé avant le premier appel au serveur.
  if (!args.manifest) stop(t('import.error.manifestRequired'))
  const manifestPath = resolve(args.manifest!)
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) stop(t('import.error.manifestMissing', { path: manifestPath }))
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'))
  if (manifest.issues.length > 0) {
    const lines = manifest.issues.slice(0, SHOWN_LIMIT).map(issue => `  ${t('import.manifest.line', { line: issue.line })} ${manifestIssueText(t, issue)}`)
    const more = manifest.issues.length > SHOWN_LIMIT ? `\n  ${t('import.more', { count: manifest.issues.length - SHOWN_LIMIT })}` : ''
    stop(`${t('import.error.manifestInvalid', { count: manifest.issues.length, path: manifestPath })}\n${lines.join('\n')}${more}`)
  }
  const rows = manifest.rows
  const root = resolve(args.root ?? dirname(manifestPath))
  if (rows.some(row => row.kind === 'file') && (!existsSync(root) || !statSync(root).isDirectory())) stop(t('import.error.rootMissing', { path: root }))

  // 2. Options.
  const concurrency = args.concurrency === undefined ? DEFAULT_CONCURRENCY : Number(args.concurrency)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) stop(t('import.error.concurrency', { max: MAX_CONCURRENCY }))
  const visibility = args.visibility?.toLowerCase()
  if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') stop(t('import.error.visibility'))
  const publicUrl = args.publicUrl ?? null
  if (publicUrl !== null && !/^https?:\/\/[^\s?#]+$/i.test(publicUrl)) stop(t('import.error.publicUrl'))
  // Sources `s3://` : le compartiment du client, avec ses propres identifiants (jamais ceux du serveur).
  const s3Reader = rows.some(row => row.kind === 's3') ? await openS3(ctx, args, stop) : null
  const s3Download = s3Reader
    ? (source: string, path: string, options: { maxBytes: number, signal?: AbortSignal }) => {
        const location = parseS3Url(source)!
        return s3Reader.download(location.bucket, location.key, path, options)
      }
    : undefined

  // 3. Serveur et identifiant.
  const env = { ...readEnvFile(join(ctx.instanceDir, ENV_FILE)), ...process.env }
  const url = serverUrl(args.url, env)
  if (!apiRoot(url)) stop(t('import.error.url'))
  let key: string | null = null
  try {
    key = readApiKey(process.env, args.keyFile)
  }
  catch (error) {
    stop(t('import.error.keyFile', { path: resolve(args.keyFile!), message: (error as Error).message }))
  }
  if (!key) stop(t('import.error.keyMissing', { variable: API_KEY_VARIABLE }))

  const hardStop = new AbortController()
  let waitNotice: ((message: string) => void) | null = null
  /** Variables des limites qui ont freiné l'import : rappelées dans le bilan. */
  const limitedBy = new Set<string>()
  const client = createApiClient({
    baseUrl: url,
    key: key!,
    userAgent: `surge-media-cli/${packageVersion()}`,
    signal: hardStop.signal,
    onWait: ({ seconds, reason, policy }) => {
      const variable = policy ? RATE_LIMIT_VARIABLES[policy] : undefined
      if (variable) limitedBy.add(variable)
      waitNotice?.(variable ? t('import.wait.rateLimitedBy', { seconds, variable }) : t(`import.wait.${reason}`, { seconds }))
    },
  })

  const me = await client.me().catch(error => apiFailure(error, url))
  if (me.credential.type !== 'secret' && me.credential.type !== 'personal') stop(t('import.error.credentialType', { type: me.credential.type }))
  if (!me.upload) stop(t('import.error.scope', { scope: 'media:upload' }))
  const rules = me.upload!.types

  const target = await resolveProject(client, me, args.project).catch(error => apiFailure(error, url))
  if (target === 'ambiguous') stop(t('import.error.projectRequired'))
  if (target === null) stop(t('import.error.projectUnknown', { value: args.project ?? '' }))
  const project: ApiProject = await client.project((target as { id: string }).id).catch(error => apiFailure(error, url))
  if (!project.scopes.includes('media:upload')) stop(t('import.error.scope', { scope: 'media:upload' }))
  say.info(t('import.run.target', { project: project.name, slug: project.slug, url: client.root, credential: me.credential.name }))

  // 4. État : il ne vaut que pour ce serveur et ce projet.
  const files = importFiles(manifestPath)
  const state = args.resetState ? { header: null, entries: new Map<string, ImportEntry>() } : loadState(files.state)
  if (state.header && (state.header.server !== client.root || state.header.projectId !== project.id)) {
    stop(t('import.error.stateMismatch', { path: files.state, server: state.header.server, project: state.header.projectId }))
  }
  const entries = state.entries
  const todo = pendingRows(rows, entries, Boolean(args.retryRejected))
  const before = countByStatus(rows, entries)
  if (entries.size > 0) say.info(t('import.run.resumed', { done: rows.length - todo.length, total: rows.length }))

  // 5. Dossiers et étiquettes du manifeste.
  const createFolders = Boolean(args.createFolders)
  const createTags = Boolean(args.createTags)
  let folders = await prepareFolders(client, project.id, todo, false).catch(error => apiFailure(error, url))
  if (folders.missing.length > 0) {
    if (!createFolders) stop(`${t('import.error.foldersMissing', { count: folders.missing.length })}\n${listed(t, folders.missing)}`)
    if (!project.scopes.includes('media:write')) stop(t('import.error.scope', { scope: 'media:write' }))
    if (dryRun) say.info(t('import.run.foldersToCreate', { count: folders.toCreate }))
    else {
      folders = await prepareFolders(client, project.id, todo, true).catch(error => apiFailure(error, url))
      say.info(t('import.run.foldersCreated', { count: folders.created }))
    }
  }
  let tags = await prepareTags(client, project.id, todo, false).catch(error => apiFailure(error, url))
  if (tags.missing.length > 0) {
    if (!createTags) stop(`${t('import.error.tagsMissing', { count: tags.missing.length })}\n${listed(t, tags.missing)}`)
    if (!project.scopes.includes('tags:manage')) stop(t('import.error.scope', { scope: 'tags:manage' }))
    if (dryRun) say.info(t('import.run.tagsToCreate', { count: tags.missing.length }))
    else {
      tags = await prepareTags(client, project.id, todo, true).catch(error => apiFailure(error, url))
      say.info(t('import.run.tagsCreated', { count: tags.created }))
    }
  }

  if (!dryRun && !state.header) {
    // Nouvel état, ou fichier sans en-tête : l'en-tête d'abord, puis les entrées déjà lues.
    startState(files.state, { server: client.root, projectId: project.id, startedAt: new Date().toISOString() })
    for (const entry of entries.values()) appendState(files.state, entry)
  }

  // 6. Envois. Premier Ctrl+C : les envois en cours se terminent ; second : arrêt immédiat.
  // Progression : notre ligne, pas le `spinner` de @clack/prompts, qui met le terminal en mode brut et
  // termine le processus (code 0) sur Ctrl+C avant tout arrêt propre (lib/import/progress.ts).
  const interactive = !json && Boolean(process.stdout.isTTY)
  const progress = interactive ? createProgressLine(process.stdout) : null
  let stopRequested = false
  const onSigint = () => {
    if (stopRequested) return hardStop.abort(new Error('interrupted'))
    stopRequested = true
    if (progress) progress.interrupt(() => log.warn(t('import.run.stopping')))
    else say.warn(t('import.run.stopping'))
  }
  process.on('SIGINT', onSigint)

  const tally: Record<ImportStatus, number> = { created: 0, exists: 0, deduplicated: 0, rejected: 0, failed: 0 }
  let done = 0
  const progressText = () => t('import.run.progress', { done, total: todo.length, created: tally.created, skipped: tally.exists + tally.deduplicated, problems: tally.rejected + tally.failed })
  // Hors terminal, une attente par ligne noierait le journal : au plus un rappel toutes les 30 s.
  let lastNotice = 0
  waitNotice = (message) => {
    if (progress) return progress.message(`${progressText()} · ${message}`)
    if (Date.now() - lastNotice < WAIT_NOTICE_INTERVAL_MS) return
    lastNotice = Date.now()
    say.info(message)
  }
  progress?.start(progressText())

  const outcome = await runImport({
    rows,
    entries,
    client,
    projectId: project.id,
    rules,
    root,
    folderIds: folders.ids,
    concurrency,
    dedupe: args.dedupe !== false,
    dryRun,
    retryRejected: Boolean(args.retryRejected),
    defaultVisibility: visibility as 'public' | 'private' | undefined ?? null,
    publicUrl,
    s3: s3Download,
    signal: hardStop.signal,
    shouldStop: () => stopRequested,
    onResult: (row, entry) => {
      if (!dryRun) appendState(files.state, entry)
      tally[entry.status]++
      done++
      if (json) process.stdout.write(`${JSON.stringify({ type: 'result', line: row.line, ...entry })}\n`)
      else if (progress) progress.message(progressText())
      else process.stdout.write(`${resultLine(t, row, entry, dryRun)}\n`)
    },
  })
  process.off('SIGINT', onSigint)
  progress?.stop(progressText())

  // 7. Table de correspondance et bilan.
  if (!dryRun) writeMapping(files.mapping, rows, entries)
  const counts = countByStatus(rows, entries)
  const remaining = counts.failed + counts.pending
  if (json) {
    process.stdout.write(`${JSON.stringify({ type: 'summary', dryRun, total: rows.length, ...counts, interrupted: outcome.interrupted, fatal: outcome.fatal?.code ?? null, rateLimitedBy: [...limitedBy], mapping: dryRun ? null : files.mapping, state: dryRun ? null : files.state })}\n`)
  }
  else {
    log.info(t(dryRun ? 'import.run.summaryDryRun' : 'import.run.summary', { total: rows.length, ...counts, already: before.created + before.exists + before.deduplicated }))
    const problems = rows.map(row => ({ row, entry: entries.get(row.ref) })).filter(item => item.entry?.status === 'failed' || item.entry?.status === 'rejected')
    for (const { row, entry } of problems.slice(0, SHOWN_LIMIT)) log.warn(`${t('import.manifest.line', { line: row.line })} ${row.source} : ${explain(entry!.code, entry!.detail)}`)
    if (problems.length > SHOWN_LIMIT) log.warn(t('import.more', { count: problems.length - SHOWN_LIMIT }))
    // Compartiment source mal réglé : la même cause pour toutes ses lignes, dite une fois.
    for (const detail of new Set(problems.map(item => item.row.kind === 's3' ? item.entry!.detail : null))) {
      const hint = s3Hint(detail)
      if (hint) log.warn(t(`import.hint.s3.${hint}`, { region: s3BucketRegion(detail) ?? '' }))
    }
    if (outcome.fatal) log.error(t('import.error.api', { code: outcome.fatal.code, detail: outcome.fatal.detail ?? '' }))
    if (limitedBy.size > 0) log.info(t('import.run.rateLimited', { variables: [...limitedBy].join(', ') }))
    if (!dryRun) log.info(t('import.run.files', { mapping: files.mapping, state: files.state }))
  }

  if (outcome.fatal) {
    if (!json) cancel(t('import.run.aborted'))
    process.exit(1)
  }
  if (remaining > 0) {
    if (!json) outro(t(dryRun ? 'import.run.doneDryRunProblems' : 'import.run.rerun', { count: remaining }))
    process.exit(2)
  }
  if (!json) outro(t(dryRun ? 'import.run.doneDryRun' : 'import.run.done'))
}

// ─── import redirects ────────────────────────────────────────────────────────

export interface ImportRedirectsArgs {
  mapping?: string
  format?: string
  out?: string
  prefix?: string
  origin?: string
  force?: boolean
}

/**
 * `surge-media import redirects <table.csv> --format nginx|caddy|apache|cloudflare|json` : règles de
 * redirection 301 des anciennes adresses vers les URL des médias importés. Le fichier va sur la sortie
 * standard (ou dans `--out`), le bilan sur la sortie d'erreur : `… > redirections.conf` reste propre.
 */
export function runImportRedirects(ctx: CliContext, args: ImportRedirectsArgs): void {
  const { t } = ctx
  const stop = (message: string): never => {
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
  if (!args.mapping) stop(t('import.error.mappingRequired'))
  const mappingPath = resolve(args.mapping!)
  if (!existsSync(mappingPath) || !statSync(mappingPath).isFile()) stop(t('import.error.mappingMissing', { path: mappingPath }))
  if (!args.format || !(REDIRECT_FORMATS as readonly string[]).includes(args.format)) stop(t('import.error.redirectFormat', { formats: REDIRECT_FORMATS.join(', ') }))
  const format = args.format as RedirectFormat
  const origin = args.origin === undefined ? null : redirectOrigin(args.origin)
  if (args.origin !== undefined && origin === null) stop(t('import.error.redirectOrigin'))
  const prefix = args.prefix ?? ''
  if (/[\s"\\$`{};?#]/.test(prefix)) stop(t('import.error.redirectPrefix'))
  const out = args.out ? resolve(args.out) : null
  if (out && existsSync(out) && !args.force) stop(t('import.error.outExists', { path: out }))

  let rows
  try {
    rows = parseMapping(readFileSync(mappingPath, 'utf8'))
  }
  catch (error) {
    return stop(t('import.error.read', { path: mappingPath, message: (error as Error).message }))
  }
  if (typeof rows === 'string') return stop(t('import.error.mappingInvalid', { path: mappingPath }))

  const plan = buildRedirects(rows, { format, prefix, origin })
  const note = (message: string) => process.stderr.write(`${message}\n`)
  /** Adresses écartées, raison par raison : dites même quand aucune règle n'en sort (ex. `--origin` oublié). */
  const explainSkipped = () => {
    const reasons = new Map<RedirectSkip, string[]>()
    for (const item of plan.skipped) reasons.set(item.reason, [...(reasons.get(item.reason) ?? []), item.source])
    for (const [reason, sources] of reasons) {
      note(t(`import.redirects.skipped.${reason}`, { count: sources.length }))
      note(listed(t, sources))
    }
  }
  if (plan.rules.length === 0) {
    explainSkipped()
    stop(t('import.redirects.none'))
  }
  const content = renderRedirects(format, plan.rules, {
    title: t('import.redirects.title', { count: plan.rules.length }),
    usage: redirectUsage(t, format),
  })
  // Avec --out, le fichier seul : rien sur la sortie standard (sinon `… > fichier` en recevrait une copie).
  if (out) {
    if (!writeOutputFile(out, content, Boolean(args.force))) stop(t('import.error.outExists', { path: out }))
  }
  else process.stdout.write(content)

  note(t('import.redirects.summary', { count: plan.rules.length, notImported: plan.notImported }))
  explainSkipped()
  if (out) note(t('import.redirects.written', { path: out }))
}

/** Où installer le fichier produit, format par format (commentaires de tête ; rien pour le CSV et le JSON). */
function redirectUsage(t: T, format: RedirectFormat): string[] {
  if (format === 'nginx') return [t('import.redirects.usage.nginx1'), t('import.redirects.usage.nginx2'), t('import.redirects.usage.nginx3')]
  if (format === 'caddy') return [t('import.redirects.usage.caddy')]
  if (format === 'apache') return [t('import.redirects.usage.apache')]
  return []
}

type T = CliContext['t']

function listed(t: T, values: readonly string[]): string {
  const shown = values.slice(0, SHOWN_LIMIT).map(value => `  ${value}`).join('\n')
  return values.length > SHOWN_LIMIT ? `${shown}\n  ${t('import.more', { count: values.length - SHOWN_LIMIT })}` : shown
}

function manifestIssueText(t: T, issue: ManifestIssue): string {
  return t(`import.manifest.${issue.code}`, issue.params)
}

/** Une ligne par fichier quand la sortie n'est pas un terminal (journal d'un import lancé par un script). */
function resultLine(t: T, row: ManifestRow, entry: ImportEntry, dryRun: boolean): string {
  const status = t(dryRun && entry.status === 'created' ? 'import.status.wouldCreate' : `import.status.${entry.status}`)
  const tail = entry.mediaId ?? [entry.code, entry.detail].filter(Boolean).join(' ')
  return `${status}\t${row.source}${tail ? `\t${tail}` : ''}`
}
