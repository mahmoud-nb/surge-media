import { randomBytes } from 'node:crypto'
import { cancel, confirm, intro, isCancel, log, outro } from '@clack/prompts'
import type { CliContext } from './database'
import { openInstanceSqlClient } from './lib/instance-sql'
import type { SqlClient } from './lib/sql-client'

/**
 * `surge-media user mfa-reset <e-mail> | --all` : réinitialise la double authentification d'un compte (ou de
 * tous) directement en base, pour l'exploitant du serveur — dernier administrateur qui a perdu son
 * téléphone et ses codes de secours, ou clé NUXT_MFA_ENCRYPTION_KEY perdue. Secret, codes de secours et
 * appareils de confiance sont retirés ; l'action est inscrite au journal d'audit (`user.mfa_reset`,
 * `by: cli`, sans auteur). Architecture : .claude/architecture-mfa.md § 8.
 */
export async function runMfaReset(ctx: CliContext, args: { email?: string, all?: boolean, yes?: boolean }): Promise<void> {
  const { t } = ctx
  intro(t('intro.mfaReset'))
  const email = args.email?.trim().toLowerCase()
  if (!email === !args.all) fail(t('mfaReset.target'))

  let db: SqlClient
  try {
    db = await openInstanceSqlClient(ctx)
  }
  catch (error) {
    fail((error as Error).message)
  }

  try {
    const q = db.quote
    const users = email
      ? await db.query<{ id: string, email: string, mfaSecret: string | null }>(`SELECT ${q('id')}, ${q('email')}, ${q('mfaSecret')} FROM ${q('User')} WHERE ${q('email')} = ?`, [email])
      : await db.query<{ id: string, email: string, mfaSecret: string | null }>(`SELECT ${q('id')}, ${q('email')}, ${q('mfaSecret')} FROM ${q('User')} WHERE ${q('mfaSecret')} IS NOT NULL`)
    if (email && !users.length) fail(t('mfaReset.unknown', { email }))
    const targets = users.filter(user => user.mfaSecret)
    if (!targets.length) {
      outro(email ? t('mfaReset.notEnabled', { email }) : t('mfaReset.none'))
      return
    }

    log.info(targets.map(user => `• ${user.email}`).join('\n'))
    if (!args.yes) {
      const confirmed = await confirm({ message: t('mfaReset.confirm', { count: targets.length }), initialValue: false })
      if (isCancel(confirmed) || !confirmed) {
        cancel(t('cancelled'))
        return
      }
    }

    const now = new Date()
    await db.transaction(async () => {
      for (const user of targets) {
        await db.run(`UPDATE ${q('User')} SET ${q('mfaSecret')} = NULL, ${q('mfaEnabledAt')} = NULL, ${q('mfaLastStep')} = NULL, ${q('updatedAt')} = ? WHERE ${q('id')} = ?`, [db.date(now), user.id])
        await db.run(`DELETE FROM ${q('MfaRecoveryCode')} WHERE ${q('userId')} = ?`, [user.id])
        await db.run(`DELETE FROM ${q('TrustedDevice')} WHERE ${q('userId')} = ?`, [user.id])
        await db.run(
          `INSERT INTO ${q('AuditEvent')} (${q('id')}, ${q('at')}, ${q('action')}, ${q('targetType')}, ${q('targetId')}, ${q('data')}) VALUES (?, ?, ?, ?, ?, ?)`,
          [`cli${randomBytes(11).toString('hex')}`, db.date(now), 'user.mfa_reset', 'user', user.id, JSON.stringify({ label: user.email, by: 'cli' })],
        )
      }
    })
    outro(t('mfaReset.done', { count: targets.length }))
  }
  finally {
    await db.close()
  }
}

function fail(message: string): never {
  cancel(message)
  process.exit(1)
}
