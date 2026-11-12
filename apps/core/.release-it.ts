/**
 * Releases de @surge-media/core avec release-it (`pnpm release`) :
 *
 *   1. vérifications : branche main ou release/*, arbre propre et à jour avec le dépôt distant, au moins un
 *      commit qui touche le core depuis la dernière version ; lint, typecheck, tests, traductions, migrations à jour ;
 *   2. version suivante calculée depuis les Conventional Commits qui touchent le core (CORE_PATHS) écrits depuis le
 *      dernier tag : rupture → majeure, `feat` → mineure, `fix` / `perf` → correctif ; avant 1.0.0, un cran de moins
 *      (rupture → mineure, `feat` → correctif). Ou imposée : `pnpm release 0.1.0`, `pnpm release minor`, préversion
 *      `--preRelease=beta` ;
 *   3. CHANGELOG.md et version du package.json mis à jour, commit `chore(release): vX.Y.Z`, tag annoté vX.Y.Z, push ;
 *   4. release GitHub (notes = section du CHANGELOG, résumée si elle est trop longue pour la page du navigateur) :
 *      par l'API si GITHUB_TOKEN est défini, sinon page pré-remplie ouverte dans le navigateur, à publier d'un clic.
 *
 * La publication (paquet npm, images Docker sur GHCR) est faite par .github/workflows/release.yml quand la
 * release GitHub est publiée, jamais depuis un poste de travail.
 */
import { readFileSync } from 'node:fs'
import type { Config } from 'release-it'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Ce qui fait le paquet npm et l'image Docker : seuls les commits qui touchent ces chemins comptent (version suivante
 * et CHANGELOG), pas ceux des librairies front, du site ou des documents. Chemins relatifs à apps/core, d'où
 * `pnpm release` lance release-it (git les lit depuis le dossier courant) ; packages/core : emplacement du core
 * jusqu'au 2026-10-11.
 */
const CORE_PATHS = ['.', '../../packages/core', '../../Dockerfile', '../../.dockerignore', '../../docker']

/**
 * Sans GITHUB_TOKEN, release-it passe les notes dans l'adresse de la page pré-remplie (`…/releases/new?body=…`) :
 * GitHub refuse une adresse de plus de quelques milliers de caractères (414 vers 8 200, erreurs dès 7 000 environ,
 * mesuré le 2026-10-18 ; 9 926 pour la 0.1.0). Au-delà de MAX_WEB_NOTES caractères encodés : titre de la version,
 * nombre d'entrées par rubrique, ruptures en entier si elles tiennent, et lien vers le CHANGELOG du tag (complet).
 */
const MAX_WEB_NOTES = 4000

/** Contexte passé par release-it (ses types de la version 21 déclarent une fonction sans argument). */
function releaseNotes(context?: { changelog?: string, version?: string }): string {
  const changelog = context?.changelog ?? ''
  const encodedLength = (text: string) => new URLSearchParams({ body: text }).toString().length
  if (process.env.GITHUB_TOKEN || encodedLength(changelog) <= MAX_WEB_NOTES) return changelog

  const [title = '', ...lines] = changelog.split('\n')
  const sections: { name: string, lines: string[] }[] = []
  for (const line of lines) {
    if (line.startsWith('### ')) sections.push({ name: line.slice(4).trim(), lines: [] })
    else if (line.trim()) sections.at(-1)?.lines.push(line)
  }
  const counts = sections.map(s => `${s.name} (${s.lines.filter(l => l.startsWith('* ')).length})`).join(', ')
  const link = `https://github.com/mahmoud-nb/surge-media/blob/v${context?.version ?? version}/apps/core/CHANGELOG.md`
  const summary = [title, '', `${counts}.`, '', `The full list of changes is in the [changelog](${link}).`].join('\n')
  const breaking = sections.find(s => /BREAKING/.test(s.name))
  const withBreaking = breaking ? [summary, '', `### ${breaking.name}`, '', ...breaking.lines].join('\n') : summary
  return encodedLength(withBreaking) <= MAX_WEB_NOTES ? withBreaking : summary
}

export default {
  git: {
    requireBranch: ['main', 'release/*'],
    requireCleanWorkingDir: true,
    requireUpstream: true,
    requireCommits: true,
    commitsPath: CORE_PATHS.join(' '),
    commitMessage: 'chore(release): v${version}',
    tagName: 'v${version}',
    tagAnnotation: 'SurgeMedia v${version}',
    push: true,
  },
  // Publié par le workflow de release (provenance, même archive que l'image Docker).
  npm: { publish: false },
  github: {
    release: true,
    releaseName: 'v${version}',
    releaseNotes,
    web: !process.env.GITHUB_TOKEN,
  },
  plugins: {
    '@release-it/conventional-changelog': {
      preset: {
        name: 'conventionalcommits',
        preMajor: version.startsWith('0.'),
        types: [
          { type: 'feat', section: 'Features' },
          { type: 'fix', section: 'Bug Fixes' },
          { type: 'perf', section: 'Performance' },
          { type: 'build', section: 'Build and Distribution' },
          { type: 'revert', section: 'Reverts' },
          { type: 'docs', effect: 'hidden' },
          { type: 'refactor', effect: 'hidden' },
          { type: 'style', effect: 'hidden' },
          { type: 'test', effect: 'hidden' },
          { type: 'ci', effect: 'hidden' },
          { type: 'chore', effect: 'hidden' },
        ],
      },
      // Seuls les commits qui touchent le core comptent (version suivante et changelog).
      commitsOpts: { path: CORE_PATHS },
      gitRawCommitsOpts: { path: CORE_PATHS },
      infile: 'CHANGELOG.md',
      header: [
        '# Changelog',
        '',
        'All notable changes to SurgeMedia — the `@surge-media/core` npm package and the',
        '`ghcr.io/mahmoud-nb/surge-media` Docker images — are documented in this file. Versions follow',
        '[Semantic Versioning](https://semver.org); entries are generated from',
        '[Conventional Commits](https://www.conventionalcommits.org) by `pnpm release`.',
      ].join('\n'),
    },
  },
  hooks: {
    'before:init': [
      'pnpm license:check',
      'pnpm lint',
      'pnpm typecheck',
      'pnpm test',
      'pnpm i18n:check',
      'pnpm db:migration --check',
    ],
    'after:release': 'echo "v${version} : publiez la release GitHub pour lancer la publication (npm, GHCR)."',
  },
} satisfies Config
