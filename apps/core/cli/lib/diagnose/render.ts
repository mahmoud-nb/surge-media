import type { Locale, Translate } from '../../i18n'
import type { MessageKey } from '../../i18n/fr'
import type { DiagnoseReport, DisplayVariable, Finding } from './report'
import { VARIABLE_GROUPS } from './variables'

/**
 * Rendu du rapport de `surge-media diagnose` : Markdown (à coller dans un ticket ou un e-mail) ou JSON. Les deux
 * partent du même rapport, déjà sans secret (report.ts) : le rendu n'a rien à masquer.
 */

export function renderJson(report: DiagnoseReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

type Params = Record<string, string | number>

export function renderMarkdown(report: DiagnoseReport, t: Translate, locale: Locale): string {
  const tk = (key: string, params?: Params) => t(key as MessageKey, params)
  const number = (value: number) => new Intl.NumberFormat(locale).format(value)
  const bytes = (value: number | null) => value === null ? '—' : formatBytes(value, locale)
  const yesNo = (value: boolean) => t(value ? 'diagnose.yes' : 'diagnose.no')
  const lines: string[] = []
  const heading = (key: MessageKey) => lines.push('', `## ${t(key)}`, '')
  const table = (rows: Array<[string, string]>) => {
    lines.push(`| ${t('diagnose.table.item')} | ${t('diagnose.table.value')} |`, '| --- | --- |')
    for (const [label, value] of rows) lines.push(`| ${cell(label)} | ${cell(value)} |`)
  }

  // ─── En-tête ──────────────────────────────────────────────────────────────
  lines.push(`# ${t('diagnose.title')}`, '')
  lines.push(`- ${t('diagnose.header.generatedAt', { value: report.generatedAt })}`)
  lines.push(`- ${t('diagnose.header.version', { value: report.version })}`)
  lines.push(`- ${t('diagnose.header.instanceId', { value: report.instanceId ? code(report.instanceId) : t('diagnose.header.noInstanceId') })}`)
  const options = [
    report.options.anonymize ? t('diagnose.header.anonymized') : null,
    report.options.server ? null : t('diagnose.header.noServer'),
    report.options.log ? t('diagnose.header.withLog') : null,
  ].filter(Boolean)
  if (options.length) lines.push(`- ${t('diagnose.header.options', { value: options.join(', ') })}`)
  lines.push('', `> ${t('diagnose.header.notice')}`)

  // ─── Points d'attention ───────────────────────────────────────────────────
  heading('diagnose.section.findings')
  if (!report.findings.length) lines.push(t('diagnose.findings.none'))
  for (const finding of report.findings) lines.push(`- **${t(`diagnose.level.${finding.level}`)}** — ${findingText(finding, tk, bytes)}`)

  // ─── Système ──────────────────────────────────────────────────────────────
  const { system } = report
  heading('diagnose.section.system')
  table([
    [t('diagnose.system.install'), t(`diagnose.install.${system.install}`)],
    [t('diagnose.system.node'), `${system.node} (${t('diagnose.system.nodeRequired', { major: system.nodeRequired })})`],
    [t('diagnose.system.os'), `${system.platform} ${system.release} (${system.arch})`],
    [t('diagnose.system.cpus'), number(system.cpus)],
    [t('diagnose.system.memory'), t('diagnose.system.memoryValue', { free: bytes(system.memory.free), total: bytes(system.memory.total) })],
    [t('diagnose.system.container'), yesNo(system.container)],
    ...system.disks.map((disk): [string, string] => [
      t(`diagnose.disk.${disk.role}`),
      `${code(disk.path)} — ${disk.free === null ? t('diagnose.unreadable') : t('diagnose.system.diskValue', { free: bytes(disk.free), total: bytes(disk.total) })}`,
    ]),
  ])

  // ─── Configuration ────────────────────────────────────────────────────────
  heading('diagnose.section.configuration')
  const set = report.configuration.variables.filter(variable => variable.set)
  if (!set.length) lines.push(t('diagnose.configuration.none'))
  else {
    lines.push(`| ${t('diagnose.configuration.variable')} | ${t('diagnose.table.value')} | ${t('diagnose.configuration.source')} |`, '| --- | --- | --- |')
    for (const group of VARIABLE_GROUPS) {
      for (const variable of set.filter(item => item.group === group)) {
        lines.push(`| ${code(variable.name)} | ${cell(variableText(variable, t))} | ${t(`diagnose.source.${variable.source}`)} |`)
      }
    }
  }
  const unset = report.configuration.variables.length - set.length
  lines.push('', t('diagnose.configuration.defaults', { count: number(unset) }))
  if (report.configuration.unknown.length) {
    lines.push('', `**${t('diagnose.configuration.unknown')}**`, '')
    for (const unknown of report.configuration.unknown) {
      lines.push(`- ${code(unknown.name)} (${t(`diagnose.source.${unknown.source}`)})${unknown.suggestion ? ` — ${t('diagnose.configuration.suggestion', { name: unknown.suggestion })}` : ''}`)
    }
  }

  // ─── Base de données ──────────────────────────────────────────────────────
  heading('diagnose.section.database')
  if (!report.database.ok) lines.push(t('diagnose.database.unreachable', { error: code(report.database.error) }))
  else {
    const db = report.database.data
    const rows: Array<[string, string]> = [
      [t('diagnose.database.provider'), db.provider],
      [t('diagnose.database.url'), code(db.url)],
      [t('diagnose.database.server'), db.serverVersion ?? '—'],
      [t('diagnose.database.latency'), `${number(db.latencyMs)} ms`],
    ]
    if (db.migrations) {
      const { applied, available, pending, failed, unknown } = db.migrations
      rows.push([t('diagnose.database.migrations'), t('diagnose.database.migrationsValue', { applied: number(applied), available: number(available), pending: number(pending.length), failed: number(failed.length), unknown: number(unknown.length) })])
    }
    if (db.sqlite) rows.push([t('diagnose.database.sqlite'), t('diagnose.database.sqliteValue', { size: bytes(db.sqlite.size), mode: db.sqlite.journalMode ?? '—' })])
    if (db.counts) {
      const c = db.counts
      rows.push(
        [t('diagnose.database.users'), t('diagnose.database.usersValue', { total: number(c.users), active: number(c.activeUsers), admins: number(c.admins) })],
        [t('diagnose.database.projects'), t('diagnose.database.projectsValue', { total: number(c.projects), archived: number(c.archivedProjects) })],
        [t('diagnose.database.media'), `${Object.entries(c.media).map(([kind, count]) => `${kind.toLowerCase()} ${number(count)}`).join(', ') || '0'} — ${bytes(c.mediaSize)}`],
        [t('diagnose.database.trash'), number(c.trash)],
        [t('diagnose.database.variants'), `${number(c.variants)} — ${bytes(c.variantsSize)}`],
        [t('diagnose.database.renditions'), `${number(c.renditions)} — ${bytes(c.renditionsSize)}`],
        [t('diagnose.database.audit'), number(c.auditEvents)],
      )
    }
    table(rows)
    const pending = db.migrations ? [...db.migrations.failed.map(name => `${name} (${t('diagnose.database.failedMigration')})`), ...db.migrations.pending, ...db.migrations.unknown.map(name => `${name} (${t('diagnose.database.unknownMigration')})`)] : []
    if (pending.length) {
      lines.push('', `**${t('diagnose.database.migrationList')}**`, '')
      for (const name of pending) lines.push(`- ${code(name)}`)
    }
  }

  // ─── Stockage ─────────────────────────────────────────────────────────────
  const { storage } = report
  heading('diagnose.section.storage')
  const storageRows: Array<[string, string]> = [[t('diagnose.storage.driver'), storage.driver]]
  if (storage.prefix) storageRows.push([t('diagnose.storage.prefix'), code(storage.prefix)])
  if (storage.local) {
    storageRows.push([t('diagnose.storage.root'), `${code(storage.local.path)} — ${storage.local.exists ? (storage.local.writable ? t('diagnose.storage.writable') : t('diagnose.storage.readOnly')) : t('diagnose.storage.missing')}`])
  }
  if (storage.s3) {
    storageRows.push(
      [t('diagnose.storage.endpoint'), storage.s3.endpoint ? code(storage.s3.endpoint) : t('diagnose.storage.awsDefault')],
      [t('diagnose.storage.region'), storage.s3.region ?? '—'],
      [t('diagnose.storage.bucket'), storage.s3.bucket ? code(storage.s3.bucket) : '—'],
      [t('diagnose.storage.pathStyle'), yesNo(storage.s3.forcePathStyle)],
      [t('diagnose.storage.keys'), t('diagnose.storage.keysValue', { access: yesNo(storage.s3.accessKey), secret: yesNo(storage.s3.secretKey) })],
    )
  }
  table(storageRows)

  // ─── Traitement des médias ────────────────────────────────────────────────
  const { processing } = report
  heading('diagnose.section.processing')
  const tool = (info: typeof processing.ffmpeg) => `${code(info.path)} — ${info.version ?? `${t('diagnose.processing.unavailable')} (${info.error ?? '—'})`}`
  table([
    [t('diagnose.processing.sharp'), processing.sharp.error ? `${t('diagnose.processing.unavailable')} (${processing.sharp.error})` : `sharp ${processing.sharp.version ?? '—'}, libvips ${processing.sharp.vips ?? '—'}`],
    [t('diagnose.processing.videoMode'), processing.videoMode],
    ['ffmpeg', tool(processing.ffmpeg)],
    ['ffprobe', tool(processing.ffprobe)],
    [t('diagnose.processing.workers'), processing.workers === null ? '—' : number(processing.workers)],
  ])

  // ─── E-mail ───────────────────────────────────────────────────────────────
  const { mail } = report
  heading('diagnose.section.mail')
  table([
    [t('diagnose.mail.configured'), yesNo(mail.configured)],
    [t('diagnose.mail.host'), mail.host ? `${code(mail.host)}:${mail.port}` : '—'],
    [t('diagnose.mail.secure'), yesNo(mail.secure)],
    [t('diagnose.mail.auth'), t('diagnose.mail.authValue', { user: yesNo(mail.user), password: yesNo(mail.password) })],
    [t('diagnose.mail.from'), yesNo(mail.from)],
  ])

  // ─── Licence ──────────────────────────────────────────────────────────────
  heading('diagnose.section.license')
  if (!report.license.ok) lines.push(t('diagnose.license.unreadable', { error: report.license.error }))
  else {
    const license = report.license.data
    const rows: Array<[string, string]> = [
      [t('diagnose.license.state'), `${license.state}${license.reason ? ` (${license.reason})` : ''}`],
      [t('diagnose.license.source'), license.source ? t(`diagnose.license.from.${license.source}`) : '—'],
    ]
    if (license.id) {
      rows.push(
        [t('diagnose.license.number'), code(license.id)],
        [t('diagnose.license.licensee'), license.licensee ?? '…'],
        [t('diagnose.license.plan'), license.plan ?? '—'],
        [t('diagnose.license.features'), license.features.join(', ') || '—'],
        [t('diagnose.license.instances'), license.instances === null ? t('diagnose.license.unlimited') : number(license.instances)],
        [t('diagnose.license.period'), `${license.startsAt?.slice(0, 10) ?? '—'} → ${license.expiresAt?.slice(0, 10) ?? '—'}`],
        [t('diagnose.license.support'), license.supportEndsAt?.slice(0, 10) ?? '—'],
      )
    }
    rows.push([t('diagnose.license.usage'), license.usage ? `${license.usage.usage} (${license.usage.declaredAt.slice(0, 10)})` : t('diagnose.license.usageNone')])
    table(rows)
  }

  // ─── Serveur en cours ─────────────────────────────────────────────────────
  heading('diagnose.section.server')
  const { server } = report
  if (!server) lines.push(t('diagnose.server.skipped'))
  else if (!server.reachable) lines.push(t('diagnose.server.unreachable', { url: code(server.url), error: server.error ?? '—' }))
  else {
    const rows: Array<[string, string]> = [
      [t('diagnose.server.url'), code(server.url)],
      [t('diagnose.server.status'), `${server.status ?? '—'} (HTTP ${String(server.httpStatus ?? '—')})`],
      ...Object.entries(server.checks ?? {}).map(([name, status]): [string, string] => [t('diagnose.server.check', { name }), status]),
    ]
    if (server.videoProcessing) {
      rows.push([t('diagnose.server.video'), t('diagnose.server.videoValue', { mode: server.videoProcessing.mode ?? '—', workers: server.videoProcessing.workers ?? '—', queued: server.videoProcessing.queued ?? '—' })])
    }
    table(rows)
  }

  // ─── Journaux ─────────────────────────────────────────────────────────────
  const { logs } = report
  heading('diagnose.section.logs')
  lines.push(logs.jobs
    ? t('diagnose.logs.jobs', { list: Object.entries(logs.jobs).map(([status, count]) => `${status} ${number(count)}`).join(', ') || '0', failed: number(logs.failedLastDay ?? 0) })
    : t('diagnose.logs.noJobs'))
  if (logs.failed.length) {
    lines.push('', `**${t('diagnose.logs.failedTitle')}**`, '', `| ${t('diagnose.logs.date')} | ${t('diagnose.logs.code')} | ${t('diagnose.logs.attempts')} | ${t('diagnose.logs.detail')} |`, '| --- | --- | --- | --- |')
    for (const job of logs.failed) lines.push(`| ${job.at ?? '—'} | ${cell(job.code ?? '—')} | ${number(job.attempts)} | ${cell(job.detail ?? '—')} |`)
  }
  lines.push('', logs.pressure
    ? t('diagnose.logs.pressure', { level: logs.pressure.level, at: logs.pressure.at, busy: number(logs.pressure.busy), slow: number(logs.pressure.slow), loaded: number(logs.pressure.loadedMinutes) })
    : t('diagnose.logs.noPressure'))
  if (logs.file) {
    lines.push('', `**${t('diagnose.logs.fileTitle', { path: logs.file.path, count: number(logs.file.lines.length), total: number(logs.file.total), redactions: number(logs.file.redactions) })}**`, '', '```text', ...logs.file.lines.map(line => line.replaceAll('```', '\'\'\'')), '```')
  }

  lines.push('', '---', '', t('diagnose.footer'))
  return `${lines.join('\n')}\n`
}

function findingText(finding: Finding, tk: (key: string, params?: Params) => string, bytes: (value: number | null) => string): string {
  const params: Params = { ...finding.params }
  if (typeof params.free === 'number') params.free = bytes(params.free)
  if (typeof params.role === 'string') params.role = tk(`diagnose.disk.${params.role}`)
  for (const key of ['name', 'suggestion', 'path', 'url', 'tool']) {
    if (typeof params[key] === 'string') params[key] = code(params[key])
  }
  return tk(`diagnose.finding.${finding.code}`, params)
}

function variableText(variable: DisplayVariable, t: Translate): string {
  switch (variable.kind) {
    case 'shown':
    case 'host':
      return code(variable.value ?? '')
    case 'secret':
      return t('diagnose.configuration.secret', { length: variable.length ?? 0 })
    case 'count':
      return variable.count === null ? t('diagnose.configuration.invalidList') : t('diagnose.configuration.count', { count: variable.count })
    default:
      return t('diagnose.configuration.personal')
  }
}

/** Valeur entre accents graves, sans en casser la mise en forme. */
function code(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ')
  return clean.includes('`') ? `\`\` ${clean} \`\`` : `\`${clean}\``
}

/** Cellule de tableau Markdown : barres verticales et retours à la ligne neutralisés. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
}

export function formatBytes(value: number, locale: Locale): string {
  const units = locale === 'fr' ? ['o', 'Kio', 'Mio', 'Gio', 'Tio'] : ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(size)} ${units[unit]}`
}
