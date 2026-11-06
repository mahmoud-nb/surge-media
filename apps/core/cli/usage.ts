import { randomBytes } from 'node:crypto'
import { cancel, intro, isCancel, log, note, outro, select } from '@clack/prompts'
import {
  isLicenseUsage,
  LICENSE_USAGE_SETTING_KEY,
  LICENSE_USAGES,
  LICENSING_EMAIL,
  licenseUsageStale,
  parseLicenseUsage,
  type LicenseUsage,
  type LicenseUsageDeclaration,
} from '../shared/utils/license'
import type { CliContext } from './database'
import { openInstanceSqlClient } from './lib/instance-sql'
import type { SqlClient } from './lib/sql-client'

/**
 * Usage déclaré de l'instance (architecture : .claude/architecture-usage.md) : question de `surge-media init`
 * (après les migrations) et `surge-media license usage [evaluation|community|commercial]`. Une déclaration, rien de
 * vérifié ni d'envoyé ; elle est écrite dans `Setting` `licenseUsage` (comme depuis Réglages › Licence) avec une
 * ligne d'audit `settings.license_usage_declared` (`by: cli`). `init` n'échoue jamais à cause d'elle.
 */

/** `--usage` ou argument : valeur connue, sinon message d'erreur traduit. */
export function parseUsageArg(ctx: CliContext, value: string | undefined): { usage?: LicenseUsage, error?: string } {
  if (value === undefined || value === '') return {}
  const usage = value.trim().toLowerCase()
  return isLicenseUsage(usage) ? { usage } : { error: ctx.t('usage.invalid', { value, usages: LICENSE_USAGES.join(', ') }) }
}

/**
 * Étape de `init`, après les migrations : `--usage` l'écrit ; en mode interactif, rappel des conditions puis
 * question (« Plus tard » ou Ctrl+C : rien d'écrit) ; `--yes` sans `--usage` ou `--skip-migrate` : rien.
 */
export async function initUsageStep(ctx: CliContext, args: { usage?: LicenseUsage, yes?: boolean, skipMigrate?: boolean }): Promise<void> {
  const { t } = ctx
  if (args.skipMigrate) {
    if (args.usage) log.warn(t('usage.skipped'))
    return
  }
  if (!args.usage && args.yes) return

  let db: SqlClient
  try {
    db = await openInstanceSqlClient(ctx)
  }
  catch (error) {
    log.warn(t('usage.writeFailed', { message: (error as Error).message }))
    return
  }
  try {
    const current = await readUsage(db)
    let usage = args.usage
    if (!usage) {
      note(t('usage.terms', { email: LICENSING_EMAIL }), t('usage.termsTitle'))
      const answer = await select<LicenseUsage | 'later'>({
        message: t('usage.prompt'),
        options: [
          ...LICENSE_USAGES.map(value => ({ value, label: t(`usage.option.${value}`) })),
          { value: 'later' as const, label: t('usage.option.later') },
        ],
        initialValue: current?.usage ?? 'later',
      })
      if (isCancel(answer) || answer === 'later') {
        log.info(t('usage.later'))
        return
      }
      usage = answer
    }
    await writeUsage(db, usage, current)
    log.success(t('usage.saved', { usage: t(`usage.option.${usage}`) }))
    if (usage === 'commercial') log.info(t('usage.commercial', { email: LICENSING_EMAIL }))
  }
  catch (error) {
    log.warn(t('usage.writeFailed', { message: (error as Error).message }))
  }
  finally {
    await db.close()
  }
}

/** `surge-media license usage [valeur]` : affiche la déclaration, ou l'écrit (redéclarer la même valeur la confirme). */
export async function runLicenseUsage(ctx: CliContext, args: { usage?: string }): Promise<void> {
  const { t } = ctx
  intro(t('intro.licenseUsage'))
  const parsed = parseUsageArg(ctx, args.usage)
  if (parsed.error) fail(parsed.error)

  let db: SqlClient
  try {
    db = await openInstanceSqlClient(ctx)
  }
  catch (error) {
    fail((error as Error).message)
  }
  try {
    const current = await readUsage(db)
    if (!parsed.usage) {
      if (current) {
        const params = { usage: t(`usage.option.${current.usage}`), date: current.declaredAt.slice(0, 10) }
        log.info(licenseUsageStale(current, Date.now()) ? t('usage.currentStale', params) : t('usage.current', params))
      }
      else {
        log.info(t('usage.none'))
      }
      outro(t('usage.hint', { usages: LICENSE_USAGES.join('|') }))
      return
    }
    await writeUsage(db, parsed.usage, current)
    if (parsed.usage === 'commercial') log.info(t('usage.commercial', { email: LICENSING_EMAIL }))
    outro(t('usage.done', { usage: t(`usage.option.${parsed.usage}`) }))
  }
  catch (error) {
    fail((error as Error).message)
  }
  finally {
    await db.close()
  }
}

async function readUsage(db: SqlClient): Promise<LicenseUsageDeclaration | null> {
  const q = db.quote
  const rows = await db.query<{ value: unknown }>(`SELECT ${q('value')} FROM ${q('Setting')} WHERE ${q('key')} = ?`, [LICENSE_USAGE_SETTING_KEY])
  return parseLicenseUsage(rows[0]?.value)
}

/** Écrit la déclaration et la ligne d'audit dans une même transaction. */
async function writeUsage(db: SqlClient, usage: LicenseUsage, previous: LicenseUsageDeclaration | null): Promise<void> {
  const q = db.quote
  const now = new Date()
  const value = JSON.stringify({ usage, declaredAt: now.toISOString() } satisfies LicenseUsageDeclaration)
  await db.transaction(async () => {
    const updated = await db.run(`UPDATE ${q('Setting')} SET ${q('value')} = ?, ${q('updatedAt')} = ? WHERE ${q('key')} = ?`, [value, db.date(now), LICENSE_USAGE_SETTING_KEY])
    if (!updated) {
      await db.run(`INSERT INTO ${q('Setting')} (${q('key')}, ${q('value')}, ${q('updatedAt')}) VALUES (?, ?, ?)`, [LICENSE_USAGE_SETTING_KEY, value, db.date(now)])
    }
    await db.run(
      `INSERT INTO ${q('AuditEvent')} (${q('id')}, ${q('at')}, ${q('action')}, ${q('data')}) VALUES (?, ?, ?, ?)`,
      [`cli${randomBytes(11).toString('hex')}`, db.date(now), 'settings.license_usage_declared', JSON.stringify({ from: previous?.usage ?? null, to: usage, by: 'cli' })],
    )
  })
}

function fail(message: string): never {
  cancel(message)
  process.exit(1)
}
