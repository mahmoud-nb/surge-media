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
  },
})

runMain(main)
