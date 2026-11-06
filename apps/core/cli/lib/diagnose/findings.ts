import type { DiagnoseReport, Finding, FindingLevel } from './report'
import { type ResolvedVariable, variableValue } from './variables'

/**
 * Points d'attention de `surge-media diagnose` (.claude/architecture-diagnose.md, DG8), déduits du rapport :
 * fonction pure, testée. Ordre : erreurs, avertissements, informations (ordre de découverte dans chaque gravité).
 */

/** En deçà, l'espace libre d'un dossier de l'installation est signalé. */
export const LOW_DISK_BYTES = 1024 ** 3
/** nuxt-auth-utils refuse un secret de session plus court. */
export const SESSION_PASSWORD_MIN_LENGTH = 32
const DAY_MS = 86_400_000

const ORDER: Record<FindingLevel, number> = { error: 0, warning: 1, info: 2 }

/** `variables` : valeurs effectives (avant masquage), pour juger des secrets sans jamais les rendre. */
export function computeFindings(report: Omit<DiagnoseReport, 'findings'>, variables: readonly ResolvedVariable[], now = Date.now()): Finding[] {
  const findings: Finding[] = []
  const add = (level: FindingLevel, code: string, params?: Finding['params']) => findings.push({ level, code, ...(params ? { params } : {}) })
  const value = (name: string) => variableValue(variables, name)

  // ─── Système ──────────────────────────────────────────────────────────────
  const major = Number.parseInt(report.system.node.replace(/^v/, ''), 10)
  if (Number.isFinite(major) && major < report.system.nodeRequired) {
    add('error', 'nodeVersion', { version: report.system.node, required: report.system.nodeRequired })
  }
  for (const disk of report.system.disks) {
    if (disk.free !== null && disk.free < LOW_DISK_BYTES) add('warning', 'lowDiskSpace', { role: disk.role, path: disk.path, free: disk.free })
  }

  // ─── Configuration ────────────────────────────────────────────────────────
  for (const name of ['NUXT_SESSION_PASSWORD', 'NUXT_MEDIA_SIGNING_SECRET']) {
    if (!value(name)) add('error', 'secretMissing', { name })
  }
  const session = value('NUXT_SESSION_PASSWORD')
  if (session && session.length < SESSION_PASSWORD_MIN_LENGTH) {
    add('error', 'sessionPasswordShort', { length: session.length, min: SESSION_PASSWORD_MIN_LENGTH })
  }
  if (!value('NUXT_MFA_ENCRYPTION_KEY')) add('warning', 'mfaKeyMissing')
  if (!value('NUXT_SITE_URL') && report.system.install !== 'source') add('warning', 'siteUrlMissing')
  const users = report.database.ok ? report.database.data.counts?.users ?? 0 : 0
  if ((value('NUXT_BOOTSTRAP_ADMIN_EMAIL') || value('NUXT_BOOTSTRAP_ADMIN_PASSWORD')) && users > 0) add('warning', 'bootstrapSet')
  for (const unknown of report.configuration.unknown) {
    add('warning', unknown.suggestion ? 'unknownVariableSuggestion' : 'unknownVariable', { name: unknown.name, ...(unknown.suggestion ? { suggestion: unknown.suggestion } : {}) })
  }

  // ─── Base de données ──────────────────────────────────────────────────────
  if (!report.database.ok) {
    add('error', 'databaseUnreachable', { message: report.database.error })
  }
  else if (report.database.data.migrations) {
    const { pending, failed, unknown } = report.database.data.migrations
    if (failed.length) add('error', 'migrationsFailed', { count: failed.length })
    if (pending.length) add('error', 'migrationsPending', { count: pending.length })
    if (unknown.length) add('warning', 'migrationsUnknown', { count: unknown.length })
  }

  // ─── Stockage ─────────────────────────────────────────────────────────────
  const { storage } = report
  if (storage.local) {
    if (!storage.local.exists) add(storage.local.creatable ? 'info' : 'error', storage.local.creatable ? 'storageNotCreated' : 'storageMissing', { path: storage.local.path })
    else if (!storage.local.writable) add('error', 'storageReadOnly', { path: storage.local.path })
  }
  if (storage.s3) {
    // Le serveur refuse de démarrer sans ces quatre réglages (server/lib/storage/index.ts).
    const missing = [
      storage.s3.bucket ? null : 'NUXT_MEDIA_STORAGE_S3_BUCKET',
      storage.s3.region ? null : 'NUXT_MEDIA_STORAGE_S3_REGION',
      storage.s3.accessKey ? null : 'NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID',
      storage.s3.secretKey ? null : 'NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY',
    ].filter(Boolean)
    if (missing.length) add('error', 's3Incomplete', { names: missing.join(', ') })
  }
  if (storage.driver !== 'local' && storage.driver !== 's3') add('error', 'storageDriverUnknown', { driver: storage.driver })

  // ─── Traitement des médias ────────────────────────────────────────────────
  const { processing } = report
  if (processing.sharp.error) add('error', 'sharpUnavailable')
  if (processing.videoMode !== 'off') {
    if (processing.ffmpeg.error) add('error', 'toolMissing', { tool: 'ffmpeg', path: processing.ffmpeg.path })
    if (processing.ffprobe.error) add('error', 'toolMissing', { tool: 'ffprobe', path: processing.ffprobe.path })
    if (processing.videoMode === 'external' && processing.workers === 0) add('warning', 'noWorker')
  }

  // ─── E-mail ───────────────────────────────────────────────────────────────
  const { mail } = report
  if (Boolean(mail.host) !== mail.from) add('info', 'smtpIncomplete')

  // ─── Licence ──────────────────────────────────────────────────────────────
  if (report.license.ok) {
    const license = report.license.data
    if (license.state === 'invalid') add('error', 'licenseInvalid', { reason: license.reason ?? '' })
    else if (license.state === 'expiring' || license.state === 'grace' || license.state === 'expired' || license.state === 'pending') {
      add('warning', `license_${license.state}`, { date: (license.state === 'pending' ? license.startsAt : license.expiresAt)?.slice(0, 10) ?? '' })
    }
    const active = license.state === 'valid' || license.state === 'expiring' || license.state === 'grace'
    if (!report.demo) {
      if (!license.usage) add('info', 'usageUndeclared')
      else if (license.usage.usage === 'commercial' && !active) add('warning', 'usageCommercial')
    }
  }
  if (report.demo) add('info', 'demoMode')

  // ─── Serveur et journaux ──────────────────────────────────────────────────
  if (report.server) {
    if (!report.server.reachable) add('info', 'serverUnreachable', { url: report.server.url })
    else if (report.server.status !== 'ok') {
      const failing = Object.entries(report.server.checks ?? {}).filter(([, status]) => status !== 'ok').map(([name]) => name)
      add('error', 'serverUnhealthy', { checks: failing.join(', ') || String(report.server.httpStatus ?? '') })
    }
  }
  if (report.logs.failedLastDay) add('warning', 'failedJobs', { count: report.logs.failedLastDay })
  if (report.logs.pressure && now - Date.parse(report.logs.pressure.at) <= DAY_MS) {
    add(report.logs.pressure.level === 'warning' ? 'warning' : 'info', 'databasePressure')
  }

  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => ORDER[a.finding.level] - ORDER[b.finding.level] || a.index - b.index)
    .map(({ finding }) => finding)
}
