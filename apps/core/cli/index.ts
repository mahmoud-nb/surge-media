#!/usr/bin/env node
/**
 * CLI `surge-media` : installation et administration du core.
 *
 *   surge-media init        choisir le fournisseur de base de données, le port, l'URL publique, et migrer
 *   surge-media start       lancer le serveur (administration, API, diffusion des médias)
 *   surge-media worker      processus de travail du traitement des vidéos (serveur construit, rôle worker)
 *   surge-media db migrate  appliquer les migrations en attente
 *   surge-media db reset    recréer la base (éventuellement avec un autre fournisseur)
 *   surge-media user mfa-reset <e-mail> | --all   réinitialiser la double authentification (secours de l'exploitant)
 *   surge-media license clock-reset               ramener le repère de la date de référence des licences à l'horloge
 *   surge-media license usage [usage]             afficher ou déclarer l'usage de l'instance (evaluation, community, commercial)
 *   surge-media diagnose [--out <fichier>]        rapport sans secret pour le support (Markdown, ou JSON avec --json)
 *   surge-media demo snapshot --out <archive>     capturer le contenu de référence de la démo (SQLite, stockage local)
 *   surge-media demo restore --from <archive>     remettre la démo à zéro depuis l'archive (serveur arrêté)
 *   surge-media import plan --from <dossier>      préparer le manifeste CSV d'un import de médias existants
 *   surge-media import run <manifeste.csv>        envoyer les fichiers du manifeste par l'API v1 (reprenable, sans doublon)
 *   surge-media import redirects <table.csv>      écrire les redirections 301 des anciennes adresses (nginx, Caddy, Apache…)
 *
 * Le .env et les données vivent dans le dossier de l'installation : le dossier courant pour le paquet publié,
 * apps/core dans le dépôt des sources (`--cwd` pour un autre dossier ; cli/lib/project.ts).
 */
import { defineCommand, runMain } from 'citty'
import { DATABASE_PROVIDERS } from '../shared/database'
import { runInit, runMigrate, runReset, type CliContext } from './database'
import { runDemoRestore, runDemoSnapshot } from './demo'
import { runDiagnose } from './diagnose'
import { createTranslator, detectLocale, langFromArgv, LOCALES } from './i18n'
import { DEFAULT_CONCURRENCY, runImportPlan, runImportRedirects, runImportRun } from './import'
import { isInsideNodeModules, packageVersion, resolveLocation } from './lib/project'
import { runLicenseClockReset } from './license'
import { DEFAULT_WEB_PORT, DEFAULT_WORKER_PORT, runServer } from './server'
import { runLicenseUsage } from './usage'
import { runMfaReset } from './user'

const t = createTranslator(detectLocale(langFromArgv(process.argv)))

const commonArgs = {
  lang: { type: 'string', description: t('args.lang'), valueHint: LOCALES.join('|') },
  cwd: { type: 'string', description: t('args.cwd'), valueHint: 'path' },
} as const

const targetArgs = {
  provider: { type: 'string', description: t('args.provider'), valueHint: DATABASE_PROVIDERS.join('|') },
  url: { type: 'string', description: t('args.url'), valueHint: 'url' },
  yes: { type: 'boolean', alias: 'y', description: t('args.yes') },
} as const

function context(cwd: string | undefined): CliContext {
  const location = resolveLocation(cwd)
  if (!location.isSource && isInsideNodeModules(location.instanceDir)) {
    console.error(t('error.instanceInNodeModules', { path: location.instanceDir }))
    process.exit(1)
  }
  return { t, ...location }
}

const init = defineCommand({
  meta: { name: 'init', description: t('command.init') },
  args: {
    ...commonArgs,
    ...targetArgs,
    skipMigrate: { type: 'boolean', description: t('args.skipMigrate') },
    siteUrl: { type: 'string', description: t('args.siteUrl'), valueHint: 'url' },
    port: { type: 'string', description: t('args.initPort'), valueHint: DEFAULT_WEB_PORT },
    usage: { type: 'string', description: t('args.usage'), valueHint: 'evaluation|community|commercial' },
  },
  run: ({ args }) => runInit(context(args.cwd), args),
})

const start = defineCommand({
  meta: { name: 'start', description: t('command.start') },
  args: {
    ...commonArgs,
    port: { type: 'string', description: t('args.startPort'), valueHint: DEFAULT_WEB_PORT },
  },
  run: ({ args }) => runServer(context(args.cwd), 'web', args),
})

const worker = defineCommand({
  meta: { name: 'worker', description: t('command.worker') },
  args: {
    ...commonArgs,
    port: { type: 'string', description: t('args.port'), valueHint: DEFAULT_WORKER_PORT },
  },
  run: ({ args }) => runServer(context(args.cwd), 'worker', args),
})

const migrate = defineCommand({
  meta: { name: 'migrate', description: t('command.db.migrate') },
  args: commonArgs,
  run: ({ args }) => runMigrate(context(args.cwd)),
})

const reset = defineCommand({
  meta: { name: 'reset', description: t('command.db.reset') },
  args: { ...commonArgs, ...targetArgs },
  run: ({ args }) => runReset(context(args.cwd), args),
})

const mfaReset = defineCommand({
  meta: { name: 'mfa-reset', description: t('command.user.mfaReset') },
  args: {
    ...commonArgs,
    email: { type: 'positional', required: false, description: t('args.email'), valueHint: 'email' },
    all: { type: 'boolean', description: t('args.all') },
    yes: { type: 'boolean', alias: 'y', description: t('args.yes') },
  },
  run: ({ args }) => runMfaReset(context(args.cwd), args),
})

const licenseClockReset = defineCommand({
  meta: { name: 'clock-reset', description: t('command.license.clockReset') },
  args: {
    ...commonArgs,
    yes: { type: 'boolean', alias: 'y', description: t('args.yes') },
  },
  run: ({ args }) => runLicenseClockReset(context(args.cwd), args),
})

const licenseUsage = defineCommand({
  meta: { name: 'usage', description: t('command.license.usage') },
  args: {
    ...commonArgs,
    usage: { type: 'positional', required: false, description: t('args.usageValue'), valueHint: 'evaluation|community|commercial' },
  },
  run: ({ args }) => runLicenseUsage(context(args.cwd), args),
})

const diagnose = defineCommand({
  meta: { name: 'diagnose', description: t('command.diagnose') },
  args: {
    ...commonArgs,
    out: { type: 'string', description: t('args.diagnoseOut'), valueHint: 'path' },
    json: { type: 'boolean', description: t('args.json') },
    anonymize: { type: 'boolean', description: t('args.anonymize') },
    log: { type: 'string', description: t('args.log'), valueHint: 'path' },
    lines: { type: 'string', description: t('args.lines'), valueHint: '200' },
    url: { type: 'string', description: t('args.healthUrl'), valueHint: 'url' },
    server: { type: 'boolean', default: true, description: t('args.server') },
  },
  run: ({ args }) => runDiagnose(context(args.cwd), args),
})

const demoSnapshot = defineCommand({
  meta: { name: 'snapshot', description: t('command.demo.snapshot') },
  args: {
    ...commonArgs,
    out: { type: 'string', description: t('args.out'), valueHint: 'path' },
    yes: { type: 'boolean', alias: 'y', description: t('args.yes') },
  },
  run: ({ args }) => runDemoSnapshot(context(args.cwd), args),
})

const demoRestore = defineCommand({
  meta: { name: 'restore', description: t('command.demo.restore') },
  args: {
    ...commonArgs,
    from: { type: 'string', description: t('args.from'), valueHint: 'path' },
    yes: { type: 'boolean', alias: 'y', description: t('args.yes') },
  },
  run: ({ args }) => runDemoRestore(context(args.cwd), args),
})

const s3Args = {
  s3Endpoint: { type: 'string', description: t('args.importS3Endpoint'), valueHint: 'url' },
  s3Region: { type: 'string', description: t('args.importS3Region'), valueHint: 'us-east-1' },
  s3PathStyle: { type: 'boolean', description: t('args.importS3PathStyle') },
} as const

const importRedirects = defineCommand({
  meta: { name: 'redirects', description: t('command.import.redirects') },
  args: {
    ...commonArgs,
    mapping: { type: 'positional', required: false, description: t('args.importMapping'), valueHint: 'mapping.csv' },
    format: { type: 'string', description: t('args.importRedirectFormat'), valueHint: 'nginx|caddy|apache|cloudflare|json' },
    out: { type: 'string', description: t('args.importRedirectOut'), valueHint: 'path' },
    prefix: { type: 'string', description: t('args.importRedirectPrefix'), valueHint: '/uploads' },
    origin: { type: 'string', description: t('args.importRedirectOrigin'), valueHint: 'url' },
    force: { type: 'boolean', description: t('args.importForce') },
  },
  run: ({ args }) => runImportRedirects(context(args.cwd), args),
})

const importPlan = defineCommand({
  meta: { name: 'plan', description: t('command.import.plan') },
  args: {
    ...commonArgs,
    from: { type: 'string', description: t('args.importFrom'), valueHint: 'path' },
    out: { type: 'string', description: t('args.importOut'), valueHint: 'manifest.csv' },
    foldersFromPath: { type: 'boolean', description: t('args.importFoldersFromPath') },
    ...s3Args,
    force: { type: 'boolean', description: t('args.importForce') },
  },
  run: ({ args }) => runImportPlan(context(args.cwd), args),
})

const importRun = defineCommand({
  meta: { name: 'run', description: t('command.import.run') },
  args: {
    ...commonArgs,
    manifest: { type: 'positional', required: false, description: t('args.importManifest'), valueHint: 'manifest.csv' },
    project: { type: 'string', description: t('args.importProject'), valueHint: 'id|slug' },
    root: { type: 'string', description: t('args.importRoot'), valueHint: 'path' },
    url: { type: 'string', description: t('args.importUrl'), valueHint: 'url' },
    keyFile: { type: 'string', description: t('args.importKeyFile'), valueHint: 'path' },
    publicUrl: { type: 'string', description: t('args.importPublicUrl'), valueHint: 'url' },
    visibility: { type: 'string', description: t('args.importVisibility'), valueHint: 'public|private' },
    concurrency: { type: 'string', description: t('args.importConcurrency'), valueHint: String(DEFAULT_CONCURRENCY) },
    dryRun: { type: 'boolean', description: t('args.importDryRun') },
    createFolders: { type: 'boolean', description: t('args.importCreateFolders') },
    createTags: { type: 'boolean', description: t('args.importCreateTags') },
    dedupe: { type: 'boolean', default: true, description: t('args.importDedupe') },
    retryRejected: { type: 'boolean', description: t('args.importRetryRejected') },
    resetState: { type: 'boolean', description: t('args.importResetState') },
    json: { type: 'boolean', description: t('args.importJson') },
    ...s3Args,
  },
  run: ({ args }) => runImportRun(context(args.cwd), args),
})

const main = defineCommand({
  meta: { name: 'surge-media', version: packageVersion(), description: t('cli.description') },
  subCommands: {
    init,
    start,
    worker,
    db: defineCommand({
      meta: { name: 'db', description: t('command.db') },
      subCommands: { migrate, reset },
    }),
    user: defineCommand({
      meta: { name: 'user', description: t('command.user') },
      subCommands: { 'mfa-reset': mfaReset },
    }),
    diagnose,
    license: defineCommand({
      meta: { name: 'license', description: t('command.license') },
      subCommands: { 'clock-reset': licenseClockReset, 'usage': licenseUsage },
    }),
    demo: defineCommand({
      meta: { name: 'demo', description: t('command.demo') },
      subCommands: { snapshot: demoSnapshot, restore: demoRestore },
    }),
    import: defineCommand({
      meta: { name: 'import', description: t('command.import') },
      subCommands: { plan: importPlan, run: importRun, redirects: importRedirects },
    }),
  },
})

runMain(main)
