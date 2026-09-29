import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { cancel, confirm, intro, isCancel, log, note, outro, select, spinner, text } from '@clack/prompts'
import {
  DATABASE_PROVIDERS,
  DATABASE_URL_EXAMPLES,
  DATABASE_URL_SCHEMES,
  DEFAULT_DATABASE_PROVIDER,
  DEFAULT_SQLITE_URL,
  detectDatabaseProvider,
  isDatabaseProvider,
  sqliteFilePath,
  type DatabaseProvider,
} from '../shared/database'
import type { Translate } from './i18n'
import { readEnvFile, updateEnvFile } from './lib/env-file'
import { runPrisma } from './lib/prisma'
import { ENV_EXAMPLE_FILE, ENV_FILE, SCHEMA_FILE } from './lib/project'
import { readSchemaProvider, writeSchemaProvider } from './lib/schema'

export interface CliContext {
  t: Translate
  /** Dossier du core (contient prisma/schema.prisma, .env, prisma.config.ts). */
  root: string
}

export interface TargetArgs {
  provider?: string
  url?: string
  yes?: boolean
}

interface DatabaseTarget {
  provider: DatabaseProvider
  url: string
}

type MigrationMode = 'deploy' | 'reset' | 'skip'

const DATABASE_ENV_KEYS = ['DATABASE_PROVIDER', 'DATABASE_URL'] as const

/** Secrets aléatoires ajoutés au .env s'ils sont absents : sessions (nuxt-auth-utils), liens signés des médias. */
const GENERATED_SECRETS = ['NUXT_SESSION_PASSWORD', 'NUXT_MEDIA_SIGNING_SECRET'] as const

// ─── Commandes ───────────────────────────────────────────────────────────────

/**
 * `surge-media init` : choisit le fournisseur et l'URL de la base, l'URL publique de
 * l'installation (NUXT_SITE_URL), puis applique les migrations.
 */
export async function runInit(ctx: CliContext, args: TargetArgs & { skipMigrate?: boolean, siteUrl?: string }): Promise<void> {
  const { t } = ctx
  intro(t('intro.init'))

  const current = readCurrentTarget(ctx)
  const target = await resolveTarget(ctx, args, current)
  const siteUrl = await resolveSiteUrl(ctx, args)
  warnProviderChange(ctx, current, target)
  showSummary(ctx, target, siteUrl)

  if (!args.yes) {
    const apply = unwrap(ctx, await confirm({ message: t('confirm.apply'), initialValue: true }))
    if (!apply) return abort(ctx)
  }

  await applyTarget(ctx, target, args.skipMigrate ? 'skip' : 'deploy', { NUXT_SITE_URL: siteUrl })
  if (current.provider && current.provider !== target.provider) note(t('note.rebuild'))
  outro(t('outro.init'))
}

/**
 * `surge-media db migrate` : après une mise à jour, régénère le client Prisma et
 * applique les migrations en attente, sans toucher à la configuration.
 */
export async function runMigrate(ctx: CliContext): Promise<void> {
  const { t } = ctx
  intro(t('intro.migrate'))

  const current = readCurrentTarget(ctx)
  if (!current.provider || !current.url) fail(t('error.notConfigured'))
  const target = current as DatabaseTarget

  const schemaProvider = readSchemaProvider(readFileSync(join(ctx.root, SCHEMA_FILE), 'utf8'))
  if (schemaProvider !== target.provider) {
    fail(t('error.providerMismatch', { schema: schemaProvider ?? '?', env: target.provider }))
  }

  await prismaStep(ctx, ['generate'], t('step.generate'), t('step.generateDone'), target)
  await prismaStep(ctx, ['migrate', 'deploy'], t('step.migrate'), t('step.migrateDone'), target)
  outro(t('outro.migrate'))
}

/** `surge-media db reset` : recrée la base (données perdues), avec un nouveau fournisseur si demandé. */
export async function runReset(ctx: CliContext, args: TargetArgs): Promise<void> {
  const { t } = ctx
  intro(t('intro.reset'))

  const current = readCurrentTarget(ctx)
  const target = await resolveTarget(ctx, args, current)
  warnProviderChange(ctx, current, target)
  showSummary(ctx, target)
  log.warn(t('warn.reset', { url: maskUrl(target.url) }))

  if (!args.yes) {
    const confirmed = unwrap(ctx, await confirm({ message: t('confirm.reset'), initialValue: false }))
    if (!confirmed) return abort(ctx)
  }

  await applyTarget(ctx, target, 'reset')
  if (current.provider !== target.provider) note(t('note.rebuild'))
  outro(t('outro.reset'))
}

// ─── Étapes ──────────────────────────────────────────────────────────────────

/** Configuration courante lue dans le .env du core. */
function readCurrentTarget(ctx: CliContext): Partial<DatabaseTarget> {
  const env = readEnvFile(join(ctx.root, ENV_FILE))
  const provider = isDatabaseProvider(env.DATABASE_PROVIDER) ? env.DATABASE_PROVIDER : undefined
  const url = env.DATABASE_URL || (provider === 'sqlite' ? DEFAULT_SQLITE_URL : undefined)
  if (provider && url) {
    log.info(ctx.t('config.current', { provider, url: maskUrl(url) }))
  }
  return { provider, url }
}

/** Fournisseur et URL cibles : arguments, sinon questions interactives, sinon valeurs par défaut (--yes). */
async function resolveTarget(
  ctx: CliContext,
  args: TargetArgs,
  current: Partial<DatabaseTarget>,
): Promise<DatabaseTarget> {
  const { t } = ctx

  let provider: DatabaseProvider
  if (args.provider) {
    if (!isDatabaseProvider(args.provider)) {
      fail(t('error.invalidProvider', { value: args.provider, providers: DATABASE_PROVIDERS.join(', ') }))
    }
    provider = args.provider
  }
  else if (args.yes) {
    provider = current.provider ?? DEFAULT_DATABASE_PROVIDER
  }
  else {
    provider = unwrap(ctx, await select<DatabaseProvider>({
      message: t('prompt.provider'),
      initialValue: current.provider ?? DEFAULT_DATABASE_PROVIDER,
      options: DATABASE_PROVIDERS.map(value => ({
        value,
        label: t(`provider.${value}.label`),
        hint: t(`provider.${value}.hint`),
      })),
    }))
  }

  const defaultUrl = current.provider === provider && current.url
    ? current.url
    : provider === 'sqlite' ? DEFAULT_SQLITE_URL : undefined

  let url: string
  if (args.url) {
    url = args.url.trim()
  }
  else if (args.yes) {
    if (!defaultUrl) fail(t('error.urlMissingNonInteractive', { provider }))
    url = defaultUrl
  }
  else {
    url = unwrap(ctx, await text({
      message: t('prompt.url'),
      placeholder: DATABASE_URL_EXAMPLES[provider],
      initialValue: defaultUrl,
      validate: value => validateUrl(ctx, provider, value),
    })).trim()
  }

  const error = validateUrl(ctx, provider, url)
  if (error) fail(error)

  return { provider, url }
}

function validateUrl(ctx: CliContext, provider: DatabaseProvider, value: string | undefined): string | undefined {
  const url = value?.trim()
  if (!url) return ctx.t('error.urlRequired')
  if (/["\r\n]/.test(url)) return ctx.t('error.urlChars')
  if (detectDatabaseProvider(url) !== provider) {
    return ctx.t('error.urlScheme', { provider, schemes: DATABASE_URL_SCHEMES[provider].join(' | ') })
  }
  return undefined
}

const DEFAULT_SITE_URL = 'http://localhost:3000'

/**
 * URL publique de l'installation (base des liens vers les médias) : argument, sinon question
 * (valeur actuelle du .env proposée), sinon valeur actuelle ou http://localhost:3000 (--yes).
 */
async function resolveSiteUrl(ctx: CliContext, args: { siteUrl?: string, yes?: boolean }): Promise<string> {
  const current = readEnvFile(join(ctx.root, ENV_FILE)).NUXT_SITE_URL || DEFAULT_SITE_URL
  let value: string
  if (args.siteUrl) value = args.siteUrl.trim()
  else if (args.yes) value = current
  else {
    value = unwrap(ctx, await text({
      message: ctx.t('prompt.siteUrl'),
      placeholder: 'https://media.example.com',
      initialValue: current,
      validate: input => validateSiteUrl(ctx, input),
    })).trim()
  }
  const error = validateSiteUrl(ctx, value)
  if (error) fail(error)
  return value.replace(/\/+$/, '')
}

/** http(s), sans identifiants, paramètres ni ancre ; un chemin est permis (installation sous un préfixe). */
function validateSiteUrl(ctx: CliContext, value: string | undefined): string | undefined {
  try {
    const url = new URL(value?.trim() ?? '')
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash) {
      return undefined
    }
  }
  catch {
    // URL invalide : message ci-dessous.
  }
  return ctx.t('error.siteUrl')
}

function warnProviderChange(ctx: CliContext, current: Partial<DatabaseTarget>, target: DatabaseTarget): void {
  if (current.provider && current.provider !== target.provider) {
    log.warn(ctx.t('warn.providerChange', { from: current.provider, to: target.provider }))
  }
}

function showSummary(ctx: CliContext, target: DatabaseTarget, siteUrl?: string): void {
  const { t } = ctx
  note(
    [
      `${t('summary.provider')} : ${t(`provider.${target.provider}.label`)}`,
      `${t('summary.url')} : ${maskUrl(target.url)}`,
      ...(siteUrl ? [`${t('summary.siteUrl')} : ${siteUrl}`] : []),
      `${t('summary.root')} : ${ctx.root}`,
    ].join('\n'),
    t('summary.title'),
  )
}

/** Écrit la configuration (.env + schéma), génère le client Prisma puis migre la base. */
async function applyTarget(ctx: CliContext, target: DatabaseTarget, mode: MigrationMode, extra: Record<string, string> = {}): Promise<void> {
  const { t, root } = ctx

  const envPath = join(root, ENV_FILE)
  const values: Record<string, string> = { ...extra, DATABASE_PROVIDER: target.provider, DATABASE_URL: target.url }
  // Secrets générés une seule fois (jamais remplacés : cela déconnecterait tout le monde ou
  // invaliderait les liens signés déjà partagés).
  const existing = readEnvFile(envPath)
  const newSecrets = GENERATED_SECRETS.filter(name => !existing[name])
  for (const name of newSecrets) values[name] = randomBytes(32).toString('base64url')

  updateEnvFile(envPath, values, join(root, ENV_EXAMPLE_FILE))
  log.success(t('step.env'))
  for (const name of newSecrets) log.success(t('step.secretGenerated', { name }))
  for (const name of DATABASE_ENV_KEYS) {
    if (process.env[name] !== undefined) log.warn(t('config.shellOverride', { name }))
  }

  writeSchemaProvider(join(root, SCHEMA_FILE), target.provider)
  log.success(t('step.schema', { provider: target.provider }))

  if (target.provider === 'sqlite') {
    // SQLite crée le fichier mais pas les dossiers parents.
    mkdirSync(dirname(resolve(root, sqliteFilePath(target.url))), { recursive: true })
  }

  await prismaStep(ctx, ['generate'], t('step.generate'), t('step.generateDone'), target)

  if (mode === 'deploy') {
    await prismaStep(ctx, ['migrate', 'deploy'], t('step.migrate'), t('step.migrateDone'), target)
  }
  else if (mode === 'reset') {
    await prismaStep(ctx, ['migrate', 'reset', '--force'], t('step.reset'), t('step.resetDone'), target)
  }
  else {
    log.info(t('step.migrateSkipped'))
  }
}

async function prismaStep(
  ctx: CliContext,
  args: string[],
  pending: string,
  done: string,
  target: DatabaseTarget,
): Promise<void> {
  const progress = spinner()
  progress.start(pending)
  // La cible est passée explicitement : elle prime sur le .env et sur l'environnement du shell.
  const { code, output } = await runPrisma(args, {
    cwd: ctx.root,
    env: { DATABASE_PROVIDER: target.provider, DATABASE_URL: target.url },
  })
  if (code !== 0) {
    progress.error(ctx.t('error.command', { command: `prisma ${args.join(' ')}` }))
    log.message(output.trim())
    process.exit(1)
  }
  progress.stop(done)
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/** Masque le mot de passe d'une URL de connexion avant affichage. */
export function maskUrl(url: string): string {
  if (url.startsWith('file:')) return url
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '****'
    return parsed.toString()
  }
  catch {
    return url
  }
}

function unwrap<T>(ctx: CliContext, value: T): Exclude<T, symbol> {
  if (isCancel(value)) {
    abort(ctx)
    process.exit(0)
  }
  return value as Exclude<T, symbol>
}

function abort(ctx: CliContext): void {
  cancel(ctx.t('cancelled'))
}

function fail(message: string): never {
  cancel(message)
  process.exit(1)
}
