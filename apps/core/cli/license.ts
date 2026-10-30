import { randomBytes } from 'node:crypto'
import { cancel, confirm, intro, isCancel, log, outro } from '@clack/prompts'
import { LICENSE_CLOCK_SETTING_KEY, parseLicenseClock } from '../shared/utils/license'
import type { CliContext } from './database'
import { openInstanceSqlClient } from './lib/instance-sql'
import type { SqlClient } from './lib/sql-client'

/**
 * `surge-media license clock-reset` : ramène le repère de la date de référence des licences (`Setting`
 * `licenseClock`) à l'horloge de cette machine. Sert après une avance accidentelle de l'horloge du serveur,
 * qui a avancé le repère et donc l'échéance apparente de la licence (le repère ne recule jamais seul).
 * Inscrit au journal d'audit (`settings.license_clock_reset`, ancien et nouveau repère, `by: cli`).
 * Architecture : .claude/architecture-licence.md § 5.
 */
export async function runLicenseClockReset(ctx: CliContext, args: { yes?: boolean }): Promise<void> {
  const { t } = ctx
  intro(t('intro.licenseClockReset'))

  let db: SqlClient
  try {
    db = await openInstanceSqlClient(ctx)
  }
  catch (error) {
    fail((error as Error).message)
  }

  try {
    const q = db.quote
    const rows = await db.query<{ value: unknown }>(`SELECT ${q('value')} FROM ${q('Setting')} WHERE ${q('key')} = ?`, [LICENSE_CLOCK_SETTING_KEY])
    const mark = parseLicenseClock(rows[0]?.value)
    const now = new Date()
    if (mark === null) {
      outro(t('licenseClock.none'))
      return
    }
    const markIso = new Date(mark).toISOString()
    if (mark <= now.getTime()) {
      outro(t('licenseClock.notAhead', { mark: markIso, now: now.toISOString() }))
      return
    }

    log.info(t('licenseClock.ahead', { mark: markIso, now: now.toISOString() }))
    if (!args.yes) {
      const confirmed = await confirm({ message: t('licenseClock.confirm', { now: now.toISOString() }), initialValue: false })
      if (isCancel(confirmed) || !confirmed) {
        cancel(t('cancelled'))
        return
      }
    }

    await db.transaction(async () => {
      await db.run(`UPDATE ${q('Setting')} SET ${q('value')} = ?, ${q('updatedAt')} = ? WHERE ${q('key')} = ?`, [JSON.stringify(now.getTime()), db.date(now), LICENSE_CLOCK_SETTING_KEY])
      await db.run(
        `INSERT INTO ${q('AuditEvent')} (${q('id')}, ${q('at')}, ${q('action')}, ${q('data')}) VALUES (?, ?, ?, ?)`,
        [`cli${randomBytes(11).toString('hex')}`, db.date(now), 'settings.license_clock_reset', JSON.stringify({ from: markIso, to: now.toISOString(), by: 'cli' })],
      )
    })
    outro(t('licenseClock.done', { now: now.toISOString() }))
  }
  finally {
    await db.close()
  }
}

function fail(message: string): never {
  cancel(message)
  process.exit(1)
}
