#!/usr/bin/env node
/**
 * CLI `surge-media` : installation et administration du core.
 *
 *   surge-media init        choisir le fournisseur de base de données et migrer
 *   surge-media db migrate  appliquer les migrations en attente
 *   surge-media db reset    recréer la base (éventuellement avec un autre fournisseur)
 */
import { defineCommand, runMain } from 'citty'
import { DATABASE_PROVIDERS } from '../shared/database'
import { runInit, runMigrate, runReset, type CliContext } from './database'
import { createTranslator, detectLocale, langFromArgv, LOCALES } from './i18n'
import { packageVersion, resolveCoreRoot } from './lib/project'

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
  const root = resolveCoreRoot(cwd)
  if (!root) {
    console.error(t('error.rootNotFound', { path: cwd ?? process.cwd() }))
    process.exit(1)
  }
  return { t, root }
}

const init = defineCommand({
  meta: { name: 'init', description: t('command.init') },
  args: {
    ...commonArgs,
    ...targetArgs,
    skipMigrate: { type: 'boolean', description: t('args.skipMigrate') },
  },
  run: ({ args }) => runInit(context(args.cwd), args),
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
    db: defineCommand({
      meta: { name: 'db', description: t('command.db') },
      subCommands: { migrate, reset },
    }),
  },
})

runMain(main)
