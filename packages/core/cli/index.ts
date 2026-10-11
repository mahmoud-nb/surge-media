#!/usr/bin/env node
/**
 * CLI `surge-media` : installation et administration du core.
 *
 *   surge-media init        choisir le fournisseur de base de données, l'URL publique, et migrer
 *   surge-media start       lancer le serveur (administration, API, diffusion des médias)
 *   surge-media worker      processus de travail du traitement des vidéos (serveur construit, rôle worker)
 *   surge-media db migrate  appliquer les migrations en attente
 *   surge-media db reset    recréer la base (éventuellement avec un autre fournisseur)
 *
 * Le .env et les données vivent dans le dossier de l'installation : le dossier courant pour le paquet publié,
 * packages/core dans le dépôt des sources (`--cwd` pour un autre dossier ; cli/lib/project.ts).
 */
import { defineCommand, runMain } from 'citty'
import { DATABASE_PROVIDERS } from '../shared/database'
import { runInit, runMigrate, runReset, type CliContext } from './database'
import { createTranslator, detectLocale, langFromArgv, LOCALES } from './i18n'
import { isInsideNodeModules, packageVersion, resolveLocation } from './lib/project'
import { DEFAULT_WEB_PORT, DEFAULT_WORKER_PORT, runServer } from './server'

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
  },
})

runMain(main)
