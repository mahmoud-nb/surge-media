import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
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
import { generateClients, providerSchemaFile } from './lib/generate'
import { sqliteDriverError } from './lib/native'
import { runPrisma } from './lib/prisma'
import { checkPort, findFreePort, listenHost, parsePort } from './lib/port'
import { ENV_EXAMPLE_FILE, ENV_FILE, SCHEMA_FILE, type CoreLocation } from './lib/project'
import { writeSchemaProvider } from './lib/schema'
import { DEFAULT_WEB_PORT } from './server'

/** Paquet (code), installation (.env, données) et mode sources ou paquet publié : cli/lib/project.ts. */
export interface CliContext extends CoreLocation {
  t: Translate
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
 * `surge-media init` : choisit le fournisseur et l'URL de la base, le port du serveur web (PORT, paquet publié ;
 * dans le dépôt, `pnpm dev` garde celui de Nuxt, sauf `--port` explicite), l'URL publique de l'installation
 * (NUXT_SITE_URL), puis applique les migrations.
 */
export async function runInit(ctx: CliContext, args: TargetArgs & { skipMigrate?: boolean, siteUrl?: string, port?: string }): Promise<void> {
  const { t } = ctx
  intro(t('intro.init'))

  const current = readCurrentTarget(ctx)
  const target = await resolveTarget(ctx, args, current)
  const port = ctx.isSource && !args.port ? undefined : await resolvePort(ctx, args)
  const siteUrl = await resolveSiteUrl(ctx, args, port)
  warnProviderChange(ctx, current, target)
  showSummary(ctx, target, siteUrl, port)

  if (!args.yes) {
    const apply = unwrap(ctx, await confirm({ message: t('confirm.apply'), initialValue: true }))
    if (!apply) return abort(ctx)
  }

  await applyTarget(ctx, target, args.skipMigrate ? 'skip' : 'deploy', {
    ...(port ? { PORT: String(port) } : {}),
    NUXT_SITE_URL: siteUrl,
  })
  if (current.provider && current.provider !== target.provider) note(t('note.providerChanged'))
  outro(t(ctx.isSource ? 'outro.init' : 'outro.initPackage'))
}

/**
 * `surge-media db migrate` : après une mise à jour, régénère les clients Prisma s'il le faut et
 * applique les migrations en attente, sans toucher à la configuration.
 */
export async function runMigrate(ctx: CliContext): Promise<void> {
  const { t } = ctx
  intro(t('intro.migrate'))

  const current = readCurrentTarget(ctx)
  if (!current.provider || !current.url) fail(t('error.notConfigured'))
  const target = current as DatabaseTarget

  if (ctx.isSource) await generateStep(ctx, target)
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
  if (current.provider !== target.provider) note(t('note.providerChanged'))
  outro(t('outro.reset'))
}

// ─── Étapes ──────────────────────────────────────────────────────────────────

/** Configuration courante lue dans le .env de l'installation. */
function readCurrentTarget(ctx: CliContext): Partial<DatabaseTarget> {
  const env = readEnvFile(join(ctx.instanceDir, ENV_FILE))
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

const localSiteUrl = (port: number | string) => `http://localhost:${port}`

/**
 * Port du serveur web, écrit dans le .env (PORT) : argument, sinon question (--yes : valeur proposée). Proposé :
 * le port déjà configuré, sinon 3000 ou, s'il est pris, le prochain port libre. Un port déjà configuré n'est
 * jamais remplacé d'office : il peut être occupé par surgeMedia lui-même, lancé pendant que l'on change la base.
 */
async function resolvePort(ctx: CliContext, args: { port?: string, yes?: boolean }): Promise<number> {
  const { t } = ctx
  const env = readEnvFile(join(ctx.instanceDir, ENV_FILE))
  const host = listenHost(env)
  let port: number
  if (args.port) {
    const parsed = parsePort(args.port)
    if (!parsed) fail(t('error.invalidPort', { value: args.port }))
    port = parsed
  }
  else {
    let proposed = parsePort(env.PORT)
    if (!proposed) {
      proposed = Number(DEFAULT_WEB_PORT)
      const free = await checkPort(proposed, host) === 'busy' ? await findFreePort(proposed + 1, host) : undefined
      if (free) {
        log.warn(t('warn.portDefaultBusy', { busy: proposed, port: free }))
        proposed = free
      }
    }
    port = args.yes
      ? proposed
      : Number(unwrap(ctx, await text({
          message: t('prompt.port'),
          initialValue: String(proposed),
          validate: input => parsePort(input) ? undefined : t('error.invalidPort', { value: input ?? '' }),
        })).trim())
  }
  const state = await checkPort(port, host)
  if (state === 'busy') log.warn(t('warn.portBusy', { port }))
  else if (state === 'denied') log.warn(t('warn.portDenied', { port }))
  if (process.env.PORT !== undefined) log.warn(t('config.shellOverride', { name: 'PORT' }))
  return port
}

/**
 * URL publique de l'installation (base des liens vers les médias) : argument, sinon question
 * (valeur actuelle du .env proposée), sinon valeur actuelle ou http://localhost:<port> (--yes). L'adresse
 * locale par défaut suit le port choisi tant qu'elle n'a pas été remplacée par une vraie URL publique.
 */
async function resolveSiteUrl(ctx: CliContext, args: { siteUrl?: string, yes?: boolean }, port?: number): Promise<string> {
  const env = readEnvFile(join(ctx.instanceDir, ENV_FILE))
  const configured = env.NUXT_SITE_URL?.replace(/\/+$/, '')
  const previousDefault = localSiteUrl(parsePort(env.PORT) ?? DEFAULT_WEB_PORT)
  const current = port && (!configured || configured === previousDefault)
    ? localSiteUrl(port)
    : configured || localSiteUrl(DEFAULT_WEB_PORT)
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

function showSummary(ctx: CliContext, target: DatabaseTarget, siteUrl?: string, port?: number): void {
  const { t } = ctx
  note(
    [
      `${t('summary.provider')} : ${t(`provider.${target.provider}.label`)}`,
      `${t('summary.url')} : ${maskUrl(target.url)}`,
      ...(port ? [`${t('summary.port')} : ${port}`] : []),
      ...(siteUrl ? [`${t('summary.siteUrl')} : ${siteUrl}`] : []),
      `${t('summary.root')} : ${ctx.instanceDir}`,
    ].join('\n'),
    t('summary.title'),
  )
}

/**
 * Écrit le .env de l'installation puis migre la base. Dépôt des sources seulement : schéma de développement
 * réécrit (Prisma Studio, commandes Prisma lancées à la main) et clients Prisma régénérés s'il le faut ; le
 * paquet publié embarque les trois clients dans son serveur construit.
 */
async function applyTarget(ctx: CliContext, target: DatabaseTarget, mode: MigrationMode, extra: Record<string, string> = {}): Promise<void> {
  const { t, packageDir, instanceDir } = ctx

  const envPath = join(instanceDir, ENV_FILE)
  const values: Record<string, string> = { ...extra, DATABASE_PROVIDER: target.provider, DATABASE_URL: target.url }
  // Secrets générés une seule fois (jamais remplacés : cela déconnecterait tout le monde ou
  // invaliderait les liens signés déjà partagés).
  const existing = readEnvFile(envPath)
  const newSecrets = GENERATED_SECRETS.filter(name => !existing[name])
  for (const name of newSecrets) values[name] = randomBytes(32).toString('base64url')

  updateEnvFile(envPath, values, join(packageDir, ENV_EXAMPLE_FILE))
  log.success(t('step.env'))
  for (const name of newSecrets) log.success(t('step.secretGenerated', { name }))
  for (const name of DATABASE_ENV_KEYS) {
    if (process.env[name] !== undefined) log.warn(t('config.shellOverride', { name }))
  }

  if (ctx.isSource) {
    writeSchemaProvider(join(packageDir, SCHEMA_FILE), target.provider)
    log.success(t('step.schema', { provider: target.provider }))
  }

  if (target.provider === 'sqlite') {
    // SQLite crée le fichier mais pas les dossiers parents.
    mkdirSync(dirname(resolve(instanceDir, sqliteFilePath(target.url))), { recursive: true })
  }

  if (ctx.isSource) await generateStep(ctx, target)

  if (mode === 'deploy') {
    await prismaStep(ctx, ['migrate', 'deploy'], t('step.migrate'), t('step.migrateDone'), target)
  }
  else if (mode === 'reset') {
    await prismaStep(ctx, ['migrate', 'reset', '--force'], t('step.reset'), t('step.resetDone'), target)
  }
  else {
    log.info(t('step.migrateSkipped'))
  }

  // Les migrations n'en ont pas besoin, mais le serveur, si : prévenir dès l'installation.
  const driverError = target.provider === 'sqlite' ? sqliteDriverError(packageDir) : undefined
  if (driverError) log.warn(t('error.sqliteDriver', { message: driverError }))
}

/** Clients Prisma des trois fournisseurs (cli/lib/generate.ts) : rien n'est refait s'ils sont à jour. */
async function generateStep(ctx: CliContext, target: DatabaseTarget): Promise<void> {
  const progress = spinner()
  progress.start(ctx.t('step.generate'))
  try {
    const { generated } = await generateClients(ctx.packageDir, {
      env: { DATABASE_PROVIDER: target.provider, DATABASE_URL: target.url },
    })
    progress.stop(ctx.t(generated ? 'step.generateDone' : 'step.generateUpToDate'))
  }
  catch (error) {
    progress.error(ctx.t('error.command', { command: 'prisma generate' }))
    log.message(error instanceof Error ? error.message : String(error))
    process.exit(1)
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
  // Lancée depuis le paquet (prisma.config.ts, migrations du fournisseur), avec le schéma du fournisseur. La cible
  // est passée explicitement : elle prime sur le .env et sur l'environnement du shell.
  const { code, output } = await runPrisma([...args, '--schema', providerSchemaFile(target.provider)], {
    cwd: ctx.packageDir,
    env: { DATABASE_PROVIDER: target.provider, DATABASE_URL: prismaUrl(ctx, target) },
  })
  if (code !== 0) {
    progress.error(ctx.t('error.command', { command: `prisma ${args.join(' ')}` }))
    log.message(output.trim())
    process.exit(1)
  }
  progress.stop(done)
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/**
 * URL passée à Prisma, lancé depuis le dossier du paquet : un chemin SQLite relatif l'est au dossier de
 * l'installation (comme pour le serveur, lancé depuis celle-ci), d'où un chemin absolu (barres obliques).
 */
function prismaUrl(ctx: CliContext, target: DatabaseTarget): string {
  if (target.provider !== 'sqlite') return target.url
  const query = target.url.includes('?') ? target.url.slice(target.url.indexOf('?')) : ''
  return `file:${resolve(ctx.instanceDir, sqliteFilePath(target.url)).replaceAll('\\', '/')}${query}`
}

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
