import { chmodSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cancel, intro, log, outro, spinner } from '@clack/prompts'
import type { CliContext } from './database'
import { detectLocale, langFromArgv } from './i18n'
import { collectReport, DEFAULT_LOG_LINES, MAX_LOG_LINES } from './lib/diagnose/collect'
import { renderJson, renderMarkdown } from './lib/diagnose/render'

/**
 * `surge-media diagnose` : rapport sans secret pour le support (.claude/architecture-diagnose.md). Lecture seule ;
 * Markdown (ou JSON avec `--json`) sur la sortie standard, ou dans un fichier (`--out`, droits 0600). Code de
 * sortie 0 dès que le rapport est produit, même avec des points d'attention.
 */
export interface DiagnoseArgs {
  out?: string
  json?: boolean
  anonymize?: boolean
  log?: string
  lines?: string
  url?: string
  server?: boolean
}

export async function runDiagnose(ctx: CliContext, args: DiagnoseArgs): Promise<void> {
  const { t } = ctx
  const lines = args.lines === undefined ? DEFAULT_LOG_LINES : Number(args.lines)
  if (!Number.isInteger(lines) || lines < 1 || lines > MAX_LOG_LINES) fail(t('diagnose.error.lines', { max: MAX_LOG_LINES }))
  const logFile = args.log ? resolve(args.log) : null
  if (logFile && (!existsSync(logFile) || !statSync(logFile).isFile())) fail(t('diagnose.error.log', { path: logFile }))
  if (args.url && !/^https?:\/\//i.test(args.url)) fail(t('diagnose.error.url'))

  const toFile = Boolean(args.out)
  const progress = toFile ? spinner() : null
  if (toFile) {
    intro(t('intro.diagnose'))
    progress!.start(t('diagnose.progress'))
  }
  const report = await collectReport(ctx, {
    anonymize: Boolean(args.anonymize),
    server: args.server === false ? false : args.url ?? true,
    log: logFile,
    lines,
  })
  const locale = detectLocale(langFromArgv(process.argv))
  const content = args.json ? renderJson(report) : renderMarkdown(report, t, locale)

  if (!toFile) {
    process.stdout.write(content)
    return
  }
  const target = resolve(args.out!)
  try {
    writeFileSync(target, content, { mode: 0o600 })
    // Fichier déjà présent : `mode` ne s'applique qu'à la création.
    if (process.platform !== 'win32') chmodSync(target, 0o600)
  }
  catch (error) {
    progress!.stop(t('diagnose.progressFailed'))
    fail(t('diagnose.error.write', { path: target, message: (error as Error).message }))
  }
  progress!.stop(t('diagnose.progressDone'))
  const errors = report.findings.filter(finding => finding.level === 'error').length
  const warnings = report.findings.filter(finding => finding.level === 'warning').length
  if (errors || warnings) log.warn(t('diagnose.summary', { errors, warnings }))
  else log.success(t('diagnose.summaryNone'))
  outro(t('diagnose.written', { path: target }))
}

function fail(message: string): never {
  cancel(message)
  process.exit(1)
}
