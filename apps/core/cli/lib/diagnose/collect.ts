import { spawnSync } from 'node:child_process'
import { accessSync, closeSync, constants, existsSync, openSync, readdirSync, readFileSync, readSync, statfsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, freemem, platform, release, tmpdir, totalmem, arch } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_SQLITE_URL, detectDatabaseProvider, isDatabaseProvider, sqliteFilePath, type DatabaseProvider } from '../../../shared/database'
import { readPressureReport, PRESSURE_SETTING_KEY } from '../../../shared/utils/database-pressure'
import {
  LICENSE_CLOCK_SETTING_KEY,
  LICENSE_USAGE_SETTING_KEY,
  licenseReferenceTime,
  licenseTermState,
  parseLicenseClock,
  parseLicenseUsage,
  type LicenseUsageDeclaration,
} from '../../../shared/utils/license'
import { WORKER_PRESENCE_PREFIX, WORKER_SEEN_WINDOW_MS } from '../../../shared/utils/video-processing'
import { LICENSE_PUBLIC_KEYS } from '../../../server/lib/license/keys'
import { licenseDetails, licensePeriod, verifyLicense } from '../../../server/lib/license/token'
import type { CliContext } from '../../database'
import { SERVER_ENTRY } from '../../server'
import { readEnvFile } from '../env-file'
import { ENV_FILE, packageVersion } from '../project'
import { openSqlClient, type SqlClient } from '../sql-client'
import { computeFindings } from './findings'
import { anonymizeHost, maskConnectionUrl, redactLines, type KnownValue } from './redact'
import {
  REPORT_FORMAT,
  type DatabaseInfo,
  type DiagnoseReport,
  type DiskSpace,
  type DisplayVariable,
  type FailedJob,
  type LicenseInfo,
  type LogsInfo,
  type MigrationsInfo,
  type ProcessingInfo,
  type Section,
  type ServerInfo,
  type StorageInfo,
  type SystemInfo,
  type ToolInfo,
} from './report'
import { resolveVariables, unknownVariables, variableValue, type ResolvedVariable } from './variables'

/**
 * Collecte du rapport de `surge-media diagnose` (.claude/architecture-diagnose.md) : lecture seule, contrôles
 * locaux (base, dossiers, outils, licence, sonde du serveur en local). Chaque étape attrape ses propres erreurs.
 */

export interface DiagnoseOptions {
  anonymize: boolean
  /** false : pas de sonde ; une URL : celle-ci ; true : http://127.0.0.1:<PORT>/api/health. */
  server: boolean | string
  log: string | null
  lines: number
}

export const DEFAULT_LOG_LINES = 200
export const MAX_LOG_LINES = 2000
const SERVER_TIMEOUT_MS = 2000
const TOOL_TIMEOUT_MS = 5000
/** Au plus 4 Mio lus à la fin d'un journal exporté. */
const LOG_TAIL_BYTES = 4 * 1024 * 1024

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // Une erreur de connexion peut citer l'URL : ses identifiants sont masqués.
  return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1****@').split('\n')[0]!.slice(0, 300)
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const time = typeof value === 'number' ? value : Date.parse(value)
    return Number.isFinite(time) ? new Date(time).toISOString() : null
  }
  return null
}

const toNumber = (value: unknown): number => {
  const number = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

/** Valeur d'un réglage `Setting` : objet JSON (PostgreSQL), ou texte JSON (SQLite, MariaDB selon le pilote). */
function settingJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  }
  catch {
    return value
  }
}

// ─── Variables ──────────────────────────────────────────────────────────────────

/** Nombre d'éléments d'une liste JSON, null si la valeur n'en est pas une. */
function listLength(value: string): number | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.length : null
  }
  catch {
    return null
  }
}

/** Le serveur crée le dossier de stockage au démarrage : possible si son plus proche parent existant est accessible en écriture. */
function isCreatable(path: string): boolean {
  let current = resolve(path)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
  return isWritable(current)
}

function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    return true
  }
  catch {
    return false
  }
}

export function displayVariable(variable: ResolvedVariable, anonymize: boolean): DisplayVariable {
  const { name, group, kind, source, value } = variable
  const base = { name, group, kind, source, set: value !== null, value: null, length: null, count: null }
  if (value === null) return base
  switch (kind) {
    case 'shown':
      return { ...base, value }
    case 'host':
      if (value === 'true' || value === 'false') return { ...base, value }
      return { ...base, value: anonymize ? anonymizeHost(value) : maskConnectionUrl(value) }
    case 'secret':
      return { ...base, length: value.length }
    case 'count':
      return { ...base, count: listLength(value) }
    default:
      return base
  }
}

// ─── Système ────────────────────────────────────────────────────────────────────

function inContainer(): boolean {
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) return true
  try {
    return /docker|containerd|kubepods|podman|lxc/.test(readFileSync('/proc/1/cgroup', 'utf8'))
  }
  catch {
    return false
  }
}

function requiredNode(packageDir: string): number {
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { engines?: { node?: string } }
    const match = /(\d+)/.exec(pkg.engines?.node ?? '')
    return match ? Number(match[1]) : 24
  }
  catch {
    return 24
  }
}

function diskSpace(role: DiskSpace['role'], path: string): DiskSpace {
  try {
    const stats = statfsSync(path)
    return { role, path, free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize }
  }
  catch {
    return { role, path, free: null, total: null }
  }
}

function collectSystem(ctx: CliContext, disks: Array<[DiskSpace['role'], string]>): SystemInfo {
  const seen = new Set<string>()
  return {
    install: ctx.isSource ? 'source' : existsSync('/usr/local/bin/surge-media-entrypoint') ? 'docker-image' : 'package',
    node: process.version,
    nodeRequired: requiredNode(ctx.packageDir),
    platform: platform(),
    release: release(),
    arch: arch(),
    cpus: cpus().length,
    memory: { total: totalmem(), free: freemem() },
    container: inContainer(),
    disks: disks
      .filter(([, path]) => {
        const key = resolve(path)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map(([role, path]) => diskSpace(role, path)),
  }
}

// ─── Base de données ────────────────────────────────────────────────────────────

interface DatabaseResult {
  info: Section<DatabaseInfo>
  settings: Map<string, { value: unknown, updatedAt: unknown }>
  jobs: Pick<LogsInfo, 'jobs' | 'failedLastDay' | 'failed'>
}

function migrationDirs(packageDir: string, provider: DatabaseProvider): string[] | null {
  const dir = join(packageDir, 'prisma', 'migrations', provider)
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(dir, entry.name, 'migration.sql')))
      .map(entry => entry.name)
      .sort()
  }
  catch {
    return null
  }
}

async function readMigrations(db: SqlClient, available: string[] | null): Promise<MigrationsInfo | null> {
  const q = db.quote
  let rows: Array<{ migration_name: string, finished_at: unknown, rolled_back_at: unknown }> = []
  try {
    rows = await db.query(`SELECT ${q('migration_name')}, ${q('finished_at')}, ${q('rolled_back_at')} FROM ${q('_prisma_migrations')}`)
  }
  catch {
    // Table absente : base neuve, aucune migration appliquée.
  }
  const applied = new Set(rows.filter(row => row.finished_at !== null && row.rolled_back_at === null).map(row => row.migration_name))
  const failed = rows.filter(row => row.finished_at === null && row.rolled_back_at === null).map(row => row.migration_name)
  if (!available) return { available: 0, applied: applied.size, pending: [], failed, unknown: [] }
  return {
    available: available.length,
    applied: applied.size,
    pending: available.filter(name => !applied.has(name) && !failed.includes(name)),
    failed,
    unknown: [...applied].filter(name => !available.includes(name)).sort(),
  }
}

async function serverVersion(db: SqlClient): Promise<string | null> {
  try {
    if (db.provider === 'sqlite') return `SQLite ${String((await db.query<{ v: string }>('SELECT sqlite_version() AS v'))[0]?.v ?? '')}`
    if (db.provider === 'postgresql') return `PostgreSQL ${String((await db.query<{ server_version: string }>('SHOW server_version'))[0]?.server_version ?? '')}`
    return String((await db.query<{ v: string }>('SELECT VERSION() AS v'))[0]?.v ?? '') || null
  }
  catch {
    return null
  }
}

async function readCounts(db: SqlClient): Promise<NonNullable<DatabaseInfo['counts']>> {
  const q = db.quote
  const one = async (sql: string, params: unknown[] = []) => {
    const row = (await db.query<Record<string, unknown>>(sql, params))[0] ?? {}
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toNumber(value)]))
  }
  const users = await one(`SELECT COUNT(*) AS ${q('total')}, SUM(CASE WHEN ${q('isActive')} = TRUE THEN 1 ELSE 0 END) AS ${q('active')}, SUM(CASE WHEN ${q('role')} = 'ADMIN' AND ${q('isActive')} = TRUE THEN 1 ELSE 0 END) AS ${q('admins')} FROM ${q('User')}`)
  const projects = await one(`SELECT COUNT(*) AS ${q('total')}, COUNT(${q('archivedAt')}) AS ${q('archived')} FROM ${q('Project')}`)
  const kinds = await db.query<{ kind: string, n: unknown, s: unknown }>(`SELECT ${q('kind')} AS ${q('kind')}, COUNT(*) AS ${q('n')}, SUM(${q('size')}) AS ${q('s')} FROM ${q('Media')} WHERE ${q('deletedAt')} IS NULL GROUP BY ${q('kind')}`)
  const trash = await one(`SELECT COUNT(*) AS ${q('total')} FROM ${q('Media')} WHERE ${q('deletedAt')} IS NOT NULL`)
  const variants = await one(`SELECT COUNT(*) AS ${q('n')}, SUM(${q('size')}) AS ${q('s')} FROM ${q('MediaVariant')}`)
  const renditions = await one(`SELECT COUNT(*) AS ${q('n')}, SUM(${q('size')}) AS ${q('s')} FROM ${q('MediaRendition')}`)
  const audit = await one(`SELECT COUNT(*) AS ${q('total')} FROM ${q('AuditEvent')}`)
  return {
    users: users.total ?? 0,
    activeUsers: users.active ?? 0,
    admins: users.admins ?? 0,
    projects: projects.total ?? 0,
    archivedProjects: projects.archived ?? 0,
    media: Object.fromEntries(kinds.map(row => [String(row.kind), toNumber(row.n)])),
    mediaSize: kinds.reduce((sum, row) => sum + toNumber(row.s), 0),
    trash: trash.total ?? 0,
    variants: variants.n ?? 0,
    variantsSize: variants.s ?? 0,
    renditions: renditions.n ?? 0,
    renditionsSize: renditions.s ?? 0,
    auditEvents: audit.total ?? 0,
  }
}

async function readJobs(db: SqlClient, now: Date): Promise<DatabaseResult['jobs']> {
  const q = db.quote
  const statuses = await db.query<{ status: string, n: unknown }>(`SELECT ${q('status')} AS ${q('status')}, COUNT(*) AS ${q('n')} FROM ${q('MediaJob')} GROUP BY ${q('status')}`)
  const since = new Date(now.getTime() - 86_400_000)
  const recent = await db.query<{ n: unknown }>(`SELECT COUNT(*) AS ${q('n')} FROM ${q('MediaJob')} WHERE ${q('status')} = 'FAILED' AND ${q('finishedAt')} >= ?`, [db.date(since)])
  const failed = await db.query<{ finishedAt: unknown, errorCode: string | null, errorDetail: string | null, attempts: unknown }>(
    `SELECT ${q('finishedAt')}, ${q('errorCode')}, ${q('errorDetail')}, ${q('attempts')} FROM ${q('MediaJob')} WHERE ${q('status')} = 'FAILED' ORDER BY ${q('finishedAt')} DESC LIMIT 10`,
  )
  return {
    jobs: Object.fromEntries(statuses.map(row => [String(row.status).toLowerCase(), toNumber(row.n)])),
    failedLastDay: toNumber(recent[0]?.n),
    failed: failed.map((row): FailedJob => ({ at: toIso(row.finishedAt), code: row.errorCode, detail: row.errorDetail, attempts: toNumber(row.attempts) })),
  }
}

async function collectDatabase(ctx: CliContext, provider: DatabaseProvider, url: string, anonymize: boolean, now: Date): Promise<DatabaseResult> {
  const empty: DatabaseResult['jobs'] = { jobs: null, failedLastDay: null, failed: [] }
  const shownUrl = anonymize ? anonymizeHost(url) : maskConnectionUrl(url)
  let db: SqlClient
  try {
    if (provider === 'sqlite') {
      const file = resolve(ctx.instanceDir, sqliteFilePath(url))
      if (!existsSync(file)) throw new Error(`SQLite file not found: ${anonymize ? sqliteFilePath(url) : file}`)
    }
    db = await openSqlClient({ provider, url, packageDir: ctx.packageDir, instanceDir: ctx.instanceDir, serverEntry: SERVER_ENTRY })
  }
  catch (error) {
    return { info: { ok: false, error: message(error) }, settings: new Map(), jobs: empty }
  }
  try {
    const started = performance.now()
    await db.query('SELECT 1')
    const latencyMs = Math.round((performance.now() - started) * 10) / 10
    const q = db.quote
    const settings = new Map<string, { value: unknown, updatedAt: unknown }>()
    try {
      const keys = ['instanceId', 'license', LICENSE_CLOCK_SETTING_KEY, LICENSE_USAGE_SETTING_KEY, PRESSURE_SETTING_KEY]
      const rows = await db.query<{ key: string, value: unknown, updatedAt: unknown }>(
        `SELECT ${q('key')}, ${q('value')}, ${q('updatedAt')} FROM ${q('Setting')} WHERE ${q('key')} IN (${keys.map(() => '?').join(', ')}) OR ${q('key')} LIKE ?`,
        [...keys, `${WORKER_PRESENCE_PREFIX}%`],
      )
      for (const row of rows) settings.set(row.key, { value: settingJson(row.value), updatedAt: row.updatedAt })
    }
    catch {
      // Table absente (migrations jamais appliquées) : rien à lire.
    }
    let counts: DatabaseInfo['counts'] = null
    let jobs = empty
    try {
      counts = await readCounts(db)
      jobs = await readJobs(db, now)
    }
    catch {
      // Schéma incomplet : les migrations le diront.
    }
    let sqlite: DatabaseInfo['sqlite'] = null
    if (provider === 'sqlite') {
      let size: number | null = null
      try {
        size = statSync(resolve(ctx.instanceDir, sqliteFilePath(url))).size
      }
      catch {
        size = null
      }
      const mode = await db.query<{ journal_mode: string }>('PRAGMA journal_mode').catch(() => [])
      sqlite = { size, journalMode: mode[0]?.journal_mode ?? null }
    }
    return {
      info: {
        ok: true,
        data: {
          provider,
          url: shownUrl,
          serverVersion: await serverVersion(db),
          latencyMs,
          migrations: await readMigrations(db, migrationDirs(ctx.packageDir, provider)),
          counts,
          sqlite,
        },
      },
      settings,
      jobs,
    }
  }
  catch (error) {
    return { info: { ok: false, error: message(error) }, settings: new Map(), jobs: empty }
  }
  finally {
    await db.close().catch(() => undefined)
  }
}

// ─── Licence ────────────────────────────────────────────────────────────────────

function collectLicense(envToken: string | null, settings: DatabaseResult['settings'], databaseOk: boolean, anonymize: boolean, now: Date): Section<LicenseInfo> {
  const stored = settings.get('license')?.value
  const token = envToken ?? (typeof stored === 'string' && stored ? stored : null)
  const usage: LicenseUsageDeclaration | null = parseLicenseUsage(settings.get(LICENSE_USAGE_SETTING_KEY)?.value)
  const base: LicenseInfo = {
    source: envToken ? 'env' : token ? 'database' : null,
    state: 'none',
    reason: null,
    id: null,
    licensee: null,
    plan: null,
    features: [],
    instances: null,
    startsAt: null,
    expiresAt: null,
    supportEndsAt: null,
    usage,
  }
  if (!token) return databaseOk || envToken ? { ok: true, data: base } : { ok: false, error: 'database unreachable' }
  const result = verifyLicense(token, LICENSE_PUBLIC_KEYS)
  if (!result.ok) return { ok: true, data: { ...base, state: 'invalid', reason: result.reason } }
  const reference = licenseReferenceTime(now.getTime(), parseLicenseClock(settings.get(LICENSE_CLOCK_SETTING_KEY)?.value))
  const details = licenseDetails(result.payload)
  return {
    ok: true,
    data: {
      ...base,
      state: licenseTermState(licensePeriod(result.payload), reference),
      id: details.id,
      licensee: anonymize ? null : details.licensee.name,
      plan: details.plan,
      features: details.features,
      instances: details.instances,
      startsAt: details.startsAt,
      expiresAt: details.expiresAt,
      supportEndsAt: details.supportEndsAt,
    },
  }
}

// ─── Outils ─────────────────────────────────────────────────────────────────────

function toolVersion(path: string): ToolInfo {
  const result = spawnSync(path, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, windowsHide: true })
  if (result.error || result.status !== 0) {
    return { path, version: null, error: result.error ? message(result.error) : `exit ${String(result.status)}` }
  }
  const first = result.stdout.split('\n')[0] ?? ''
  return { path, version: /version\s+(\S+)/.exec(first)?.[1] ?? (first.trim() || null), error: null }
}

function sharpVersions(packageDir: string): ProcessingInfo['sharp'] {
  try {
    const sharp = createRequire(join(packageDir, 'package.json'))('sharp') as { versions?: Record<string, string> }
    return { version: sharp.versions?.sharp ?? null, vips: sharp.versions?.vips ?? null, error: null }
  }
  catch (error) {
    return { version: null, vips: null, error: message(error) }
  }
}

// ─── Serveur en cours ───────────────────────────────────────────────────────────

const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]', 'localhost'])

/** Sonde locale : l'adresse d'écoute si elle est précise, la boucle locale sinon. */
export function healthUrl(port: string | null, host: string | null): string {
  const listen = (host ?? '').trim()
  const target = WILDCARD_HOSTS.has(listen) ? '127.0.0.1' : listen.includes(':') && !listen.startsWith('[') ? `[${listen}]` : listen
  return `http://${target}:${port || '3000'}/api/health`
}

async function collectServer(url: string, anonymize: boolean): Promise<ServerInfo> {
  let shown = url
  try {
    const parsed = new URL(url)
    if (anonymize && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) shown = anonymizeHost(url)
  }
  catch {
    return { url, reachable: false, httpStatus: null, status: null, checks: null, videoProcessing: null, error: 'invalid URL' }
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(SERVER_TIMEOUT_MS), headers: { accept: 'application/json' } })
    const body = await response.json().catch(() => null) as { status?: string, checks?: Record<string, string>, videoProcessing?: ServerInfo['videoProcessing'] } | null
    return {
      url: shown,
      reachable: true,
      httpStatus: response.status,
      status: typeof body?.status === 'string' ? body.status : null,
      checks: body?.checks && typeof body.checks === 'object' ? Object.fromEntries(Object.entries(body.checks).map(([key, value]) => [key, String(value)])) : null,
      videoProcessing: body?.videoProcessing ?? null,
      error: null,
    }
  }
  catch (error) {
    // fetch() rend « fetch failed » : la cause dit pourquoi (ECONNREFUSED, délai dépassé…).
    const cause = (error as { cause?: { code?: string } }).cause?.code
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : cause ?? message(error)
    return { url: shown, reachable: false, httpStatus: null, status: null, checks: null, videoProcessing: null, error: reason }
  }
}

// ─── Journal exporté ────────────────────────────────────────────────────────────

/** Dernières lignes d'un fichier (au plus LOG_TAIL_BYTES lus à la fin), sans la ligne coupée du début. */
export function tailLines(path: string, count: number): { lines: string[], total: number } {
  const size = statSync(path).size
  const length = Math.min(size, LOG_TAIL_BYTES)
  const buffer = Buffer.alloc(length)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, length, size - length)
  }
  finally {
    closeSync(fd)
  }
  const all = buffer.toString('utf8').split(/\r?\n/)
  if (length < size) all.shift()
  while (all.length && all.at(-1) === '') all.pop()
  return { lines: all.slice(-count), total: all.length }
}

// ─── Rapport ────────────────────────────────────────────────────────────────────

export async function collectReport(ctx: CliContext, options: DiagnoseOptions, now = new Date()): Promise<DiagnoseReport> {
  const env = process.env
  const dotenv = readEnvFile(join(ctx.instanceDir, ENV_FILE))
  const secretsDirCandidate = env.SURGE_MEDIA_SECRETS_DIR || join(ctx.instanceDir, 'data', 'secrets')
  const variables = resolveVariables({ env, dotenv, secretsDir: existsSync(secretsDirCandidate) ? secretsDirCandidate : null })
  const value = (name: string) => variableValue(variables, name)

  // Base
  const rawUrl = value('DATABASE_URL')
  const declared = value('DATABASE_PROVIDER')
  const provider: DatabaseProvider = declared && isDatabaseProvider(declared)
    ? declared
    : (rawUrl ? detectDatabaseProvider(rawUrl) : undefined) ?? 'sqlite'
  const url = rawUrl ?? (provider === 'sqlite' ? DEFAULT_SQLITE_URL : '')
  const database: DatabaseResult = url
    ? await collectDatabase(ctx, provider, url, options.anonymize, now)
    : { info: { ok: false, error: 'DATABASE_URL is not set' }, settings: new Map(), jobs: { jobs: null, failedLastDay: null, failed: [] } }

  // Stockage
  const driver = value('NUXT_MEDIA_STORAGE_DRIVER') ?? 'local'
  const root = resolve(ctx.instanceDir, value('NUXT_MEDIA_STORAGE_ROOT') ?? './data/media')
  const storage: StorageInfo = {
    driver,
    prefix: value('NUXT_MEDIA_STORAGE_PREFIX'),
    local: driver === 'local' ? { path: root, exists: existsSync(root), writable: isWritable(root), creatable: !existsSync(root) && isCreatable(root) } : null,
    s3: driver === 's3'
      ? {
          endpoint: (endpoint => endpoint && options.anonymize ? anonymizeHost(endpoint) : endpoint)(value('NUXT_MEDIA_STORAGE_S3_ENDPOINT')),
          region: value('NUXT_MEDIA_STORAGE_S3_REGION'),
          bucket: (bucket => bucket && options.anonymize ? '…' : bucket)(value('NUXT_MEDIA_STORAGE_S3_BUCKET')),
          forcePathStyle: value('NUXT_MEDIA_STORAGE_S3_FORCE_PATH_STYLE') === 'true',
          accessKey: Boolean(value('NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID')),
          secretKey: Boolean(value('NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY')),
        }
      : null,
  }

  const system = collectSystem(ctx, [
    ['instance', ctx.instanceDir],
    ...(storage.local?.exists ? [['storage', root] as ['storage', string]] : []),
    ['tmp', value('TMPDIR') ?? tmpdir()],
  ])

  // Traitement des médias
  const workers = database.info.ok
    ? [...database.settings].filter(([key, row]) => key.startsWith(WORKER_PRESENCE_PREFIX) && now.getTime() - Date.parse(toIso(row.updatedAt) ?? '') <= WORKER_SEEN_WINDOW_MS).length
    : null
  const processing: ProcessingInfo = {
    sharp: sharpVersions(ctx.packageDir),
    ffmpeg: toolVersion(value('NUXT_FFMPEG_PATH') ?? 'ffmpeg'),
    ffprobe: toolVersion(value('NUXT_FFPROBE_PATH') ?? 'ffprobe'),
    videoMode: value('NUXT_VIDEO_PROCESSING') ?? 'off',
    workers,
  }

  const smtpHost = value('NUXT_SMTP_HOST')
  const mail = {
    configured: Boolean(smtpHost && value('NUXT_SMTP_FROM')),
    host: smtpHost && options.anonymize ? '…' : smtpHost,
    port: value('NUXT_SMTP_PORT') ?? '587',
    secure: value('NUXT_SMTP_SECURE') === 'true',
    user: Boolean(value('NUXT_SMTP_USER')),
    password: Boolean(value('NUXT_SMTP_PASSWORD')),
    from: Boolean(value('NUXT_SMTP_FROM')),
  }

  const license = collectLicense(value('NUXT_LICENSE_KEY'), database.settings, database.info.ok, options.anonymize, now)
  const server = options.server === false
    ? null
    : await collectServer(typeof options.server === 'string' ? options.server : healthUrl(value('PORT'), value('HOST') ?? value('NITRO_HOST')), options.anonymize)

  // Journaux
  const pressure = readPressureReport(database.settings.get(PRESSURE_SETTING_KEY)?.value, now.getTime())
  const logs: LogsInfo = {
    ...database.jobs,
    pressure: pressure ? { level: pressure.level, at: pressure.at, busy: pressure.busy, slow: pressure.slow, loadedMinutes: pressure.loadedMinutes } : null,
    file: null,
  }
  if (options.log) {
    const known: KnownValue[] = variables
      .filter(item => item.value !== null && (item.kind === 'secret' || item.kind === 'personal' || item.kind === 'count' || (options.anonymize && item.kind === 'host')))
      .map(item => ({ name: item.name, value: item.value! }))
    const { lines, total } = tailLines(options.log, options.lines)
    const redacted = redactLines(lines, known)
    logs.file = { path: options.anonymize ? '…' : options.log, lines: redacted.lines, total, redactions: redacted.redactions }
  }

  const instanceId = database.settings.get('instanceId')?.value
  const partial: Omit<DiagnoseReport, 'findings'> = {
    format: REPORT_FORMAT,
    generatedAt: now.toISOString(),
    version: packageVersion(),
    options: { anonymize: options.anonymize, server: options.server !== false, log: Boolean(options.log) },
    instanceId: typeof instanceId === 'string' ? instanceId : null,
    demo: value('NUXT_DEMO_MODE') === 'true',
    system,
    configuration: { variables: variables.map(item => displayVariable(item, options.anonymize)), unknown: unknownVariables({ env, dotenv }) },
    database: database.info,
    storage,
    processing,
    mail,
    license,
    server,
    logs,
  }
  return { ...partial, findings: computeFindings(partial, variables, now.getTime()) }
}
