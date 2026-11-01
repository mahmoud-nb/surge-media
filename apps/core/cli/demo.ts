import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { cancel, confirm, intro, isCancel, log, outro } from '@clack/prompts'
import { DEFAULT_SQLITE_URL, isDatabaseProvider } from '../shared/database'
import {
  DEMO_REFERENCE_SETTING_KEY,
  DEMO_SNAPSHOT_DATABASE,
  DEMO_SNAPSHOT_FORMAT,
  DEMO_SNAPSHOT_MANIFEST,
  parseDemoReference,
} from '../shared/utils/demo'
import type { CliContext } from './database'
import { type DemoManifest, move, parseDemoManifest, runTar, safeArchiveName } from './lib/demo-archive'
import { readEnvFile } from './lib/env-file'
import { ENV_FILE, packageVersion } from './lib/project'
import { openSqlClient, type SqlClient } from './lib/sql-client'
import { SERVER_ENTRY } from './server'

/**
 * Mode démo (architecture : .claude/architecture-demo.md, § 4 et § 5), base SQLite et stockage local seulement :
 *   - `surge-media demo snapshot --out <archive.tar.gz>` capture le contenu de référence, serveur en marche ou non :
 *     copie cohérente de la base (`VACUUM INTO`), réglage `demoReferenceAt`, sessions, appareils de confiance,
 *     liens de mot de passe et journal d'audit retirés de la copie, puis archive avec le dossier des médias ;
 *   - `surge-media demo restore --from <archive.tar.gz>` remplace la base et les médias par ceux de l'archive,
 *     serveur arrêté (l'image Docker le fait à chaque démarrage). Refus si NUXT_DEMO_MODE n'est pas `true`, ou si
 *     la base actuelle ne vient pas d'un instantané de démo : une base de production n'est jamais effacée.
 */

interface DemoTarget {
  /** Fichier de la base SQLite. */
  database: string
  /** Dossier des médias (stockage local). */
  media: string
  /** NUXT_DEMO_MODE vaut `true`. */
  demoMode: boolean
}

/** Erreur déjà traduite, affichée telle quelle. */
class DemoCliError extends Error {}

/** Variable de l'environnement, sinon du .env de l'installation. */
function setting(env: Record<string, string | undefined>, name: string): string | undefined {
  return process.env[name] || env[name] || undefined
}

/** Base et médias de l'installation ; erreur traduite si ce n'est pas SQLite avec un stockage local. */
function demoTarget(ctx: CliContext): DemoTarget {
  const { t, instanceDir } = ctx
  const env = readEnvFile(join(instanceDir, ENV_FILE))
  const provider = setting(env, 'DATABASE_PROVIDER') ?? 'sqlite'
  if (!isDatabaseProvider(provider)) throw new Error(t('sql.provider', { provider }))
  if (provider !== 'sqlite') throw new Error(t('demo.sqliteOnly', { provider }))
  const driver = setting(env, 'NUXT_MEDIA_STORAGE_DRIVER') ?? 'local'
  if (driver !== 'local') throw new Error(t('demo.localOnly', { driver }))

  const url = setting(env, 'DATABASE_URL') ?? DEFAULT_SQLITE_URL
  const path = url.replace(/^file:/, '').split('?')[0]!
  const root = setting(env, 'NUXT_MEDIA_STORAGE_ROOT') ?? './data/media'
  return {
    database: isAbsolute(path) ? path : resolve(instanceDir, path),
    media: isAbsolute(root) ? root : resolve(instanceDir, root),
    demoMode: setting(env, 'NUXT_DEMO_MODE') === 'true',
  }
}

function openSqlite(ctx: CliContext, file: string): Promise<SqlClient> {
  return openSqlClient({ provider: 'sqlite', url: `file:${file}`, packageDir: ctx.packageDir, instanceDir: ctx.instanceDir, serverEntry: SERVER_ENTRY })
}

/** Réglage `demoReferenceAt` d'une base, ou null (absent, base illisible ou sans table `Setting`). */
async function demoReferenceOf(ctx: CliContext, file: string): Promise<number | null> {
  try {
    const db = await openSqlite(ctx, file)
    try {
      const q = db.quote
      const rows = await db.query<{ value: unknown }>(`SELECT ${q('value')} FROM ${q('Setting')} WHERE ${q('key')} = ?`, [DEMO_REFERENCE_SETTING_KEY])
      return parseDemoReference(rows[0]?.value)
    }
    finally {
      await db.close()
    }
  }
  catch {
    return null
  }
}

/** `child` est-il `parent` ou un chemin sous lui ? */
function inside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export async function runDemoSnapshot(ctx: CliContext, args: { out?: string, yes?: boolean }): Promise<void> {
  const { t } = ctx
  intro(t('intro.demoSnapshot'))
  if (!args.out) fail(t('demo.outRequired'))

  let target: DemoTarget
  try {
    target = demoTarget(ctx)
  }
  catch (error) {
    fail((error as Error).message)
  }
  if (!existsSync(target.database)) fail(t('demo.databaseMissing', { path: target.database }))
  const out = resolve(args.out)
  if (inside(target.media, out) || out === target.database) fail(t('demo.outInside', { path: out }))
  const mediaName = basename(target.media)
  if (!safeArchiveName(mediaName)) fail(t('demo.mediaName', { name: mediaName }))

  if (existsSync(out) && !args.yes) {
    const confirmed = await confirm({ message: t('demo.overwrite', { path: out }), initialValue: false })
    if (isCancel(confirmed) || !confirmed) {
      cancel(t('cancelled'))
      return
    }
  }

  await mkdir(dirname(out), { recursive: true })
  const work = await mkdtemp(join(dirname(out), '.surge-media-snapshot-'))
  let failure: string | null = null
  try {
    // 1. Copie cohérente de la base, même pendant que le serveur écrit.
    const copy = join(work, DEMO_SNAPSHOT_DATABASE)
    const source = await openSqlite(ctx, target.database)
    try {
      await source.run('VACUUM INTO ?', [copy])
    }
    finally {
      await source.close()
    }

    // 2. Copie préparée : date de référence, rien de propre à une session ou à la préparation.
    const referenceAt = Date.now()
    const db = await openSqlite(ctx, copy)
    try {
      const q = db.quote
      const pending = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${q('MediaJob')} WHERE ${q('status')} IN ('QUEUED', 'RUNNING')`)
      if (Number(pending[0]?.n) > 0) log.warn(t('demo.pendingJobs', { count: Number(pending[0]!.n) }))
      await db.transaction(async () => {
        await db.run(`DELETE FROM ${q('Setting')} WHERE ${q('key')} = ?`, [DEMO_REFERENCE_SETTING_KEY])
        await db.run(`INSERT INTO ${q('Setting')} (${q('key')}, ${q('value')}, ${q('updatedAt')}) VALUES (?, ?, ?)`, [DEMO_REFERENCE_SETTING_KEY, JSON.stringify(referenceAt), db.date(new Date(referenceAt))])
        for (const table of ['Session', 'TrustedDevice', 'PasswordToken', 'AuditEvent']) await db.run(`DELETE FROM ${q(table)}`)
      })
      await db.run('VACUUM')
    }
    finally {
      await db.close()
    }

    // 3. Descriptif et archive (écrite à côté, puis renommée : jamais d'archive à moitié écrite).
    const manifest: DemoManifest = { format: DEMO_SNAPSHOT_FORMAT, createdAt: new Date(referenceAt).toISOString(), referenceAt, coreVersion: packageVersion(), media: mediaName }
    await writeFile(join(work, DEMO_SNAPSHOT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
    if (!existsSync(target.media)) await mkdir(join(work, mediaName))
    const mediaArgs = existsSync(target.media) ? ['-C', dirname(target.media), mediaName] : [mediaName]
    const partial = `${out}.partial`
    await runTar(['-czf', partial, '-C', work, DEMO_SNAPSHOT_MANIFEST, DEMO_SNAPSHOT_DATABASE, ...mediaArgs])
    await move(partial, out)
  }
  catch (error) {
    await rm(`${out}.partial`, { force: true })
    failure = t('demo.failed', { message: (error as Error).message })
  }
  finally {
    await rm(work, { recursive: true, force: true })
  }
  if (failure) fail(failure)
  const bytes = statSync(out).size
  const size = bytes < 1024 * 1024 ? t('demo.sizeKib', { size: Math.max(1, Math.round(bytes / 1024)) }) : t('demo.sizeMib', { size: (bytes / 1024 / 1024).toFixed(1) })
  outro(t('demo.snapshotDone', { path: out, size }))
}

export async function runDemoRestore(ctx: CliContext, args: { from?: string, yes?: boolean }): Promise<void> {
  const { t } = ctx
  intro(t('intro.demoRestore'))
  if (!args.from) fail(t('demo.fromRequired'))

  let target: DemoTarget
  try {
    target = demoTarget(ctx)
  }
  catch (error) {
    fail((error as Error).message)
  }
  if (!target.demoMode) fail(t('demo.modeOff'))
  const archive = resolve(args.from)
  if (!existsSync(archive)) fail(t('demo.archiveMissing', { path: archive }))

  // Garde-fou : une base qui ne vient pas d'un instantané de démo n'est jamais remplacée.
  if (existsSync(target.database) && statSync(target.database).size > 0) {
    if (await demoReferenceOf(ctx, target.database) === null) fail(t('demo.notDemoDatabase', { path: target.database }))
  }

  if (!args.yes) {
    const confirmed = await confirm({ message: t('demo.restoreConfirm', { database: target.database, media: target.media }), initialValue: false })
    if (isCancel(confirmed) || !confirmed) {
      cancel(t('cancelled'))
      return
    }
  }

  await mkdir(dirname(target.database), { recursive: true })
  const work = await mkdtemp(join(dirname(target.database), '.surge-media-restore-'))
  let failure: string | null = null
  let restored: DemoManifest | null = null
  try {
    await runTar(['-xzf', archive, '-C', work])
    const manifest = parseDemoManifest(await readFile(join(work, DEMO_SNAPSHOT_MANIFEST), 'utf8').catch(() => ''))
    const database = join(work, DEMO_SNAPSHOT_DATABASE)
    if (!manifest || !existsSync(database)) throw new DemoCliError(t('demo.archiveInvalid', { path: archive }))

    for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(`${target.database}${suffix}`, { force: true })
    await move(database, target.database)
    await rm(target.media, { recursive: true, force: true })
    await mkdir(dirname(target.media), { recursive: true })
    const media = join(work, manifest.media)
    if (existsSync(media)) await move(media, target.media)
    else await mkdir(target.media, { recursive: true })
    restored = manifest
  }
  catch (error) {
    failure = error instanceof DemoCliError ? error.message : t('demo.failed', { message: (error as Error).message })
  }
  finally {
    await rm(work, { recursive: true, force: true })
  }
  if (failure || !restored) fail(failure ?? t('demo.archiveInvalid', { path: archive }))
  outro(t('demo.restoreDone', { date: restored.createdAt }))
}

function fail(message: string): never {
  cancel(message)
  process.exit(1)
}
