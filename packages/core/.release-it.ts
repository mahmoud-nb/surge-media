/**
 * Releases de @surge-media/core avec release-it (`pnpm release`, setup.md § 15) :
 *
 *   1. vérifications : branche main ou release/*, arbre propre et à jour avec le dépôt distant, au moins un
 *      commit depuis la dernière version ; lint, typecheck, tests, traductions, migrations à jour ;
 *   2. version suivante calculée depuis les Conventional Commits écrits depuis le dernier tag : rupture → majeure,
 *      `feat` → mineure, `fix` / `perf` → correctif ; avant 1.0.0, un cran de moins (rupture → mineure, `feat` →
 *      correctif). Ou imposée : `pnpm release 0.1.0`, `pnpm release minor`, préversion `--preRelease=beta` ;
 *   3. CHANGELOG.md et version du package.json mis à jour, commit `chore(release): vX.Y.Z`, tag annoté vX.Y.Z, push ;
 *   4. release GitHub (notes = section du CHANGELOG) : par l'API si GITHUB_TOKEN est défini, sinon page
 *      pré-remplie ouverte dans le navigateur, à publier d'un clic.
 *
 * La publication (paquet npm, images Docker sur GHCR) est faite par .github/workflows/release.yml quand la
 * release GitHub est publiée, jamais depuis un poste de travail.
 */
import { readFileSync } from 'node:fs'
import type { Config } from 'release-it'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default {
  git: {
    requireBranch: ['main', 'release/*'],
    requireCleanWorkingDir: true,
    requireUpstream: true,
    requireCommits: true,
    commitMessage: 'chore(release): v${version}',
    tagName: 'v${version}',
    tagAnnotation: 'surgeMedia v${version}',
    push: true,
  },
  // Publié par le workflow de release (provenance, même archive que l'image Docker).
  npm: { publish: false },
  github: {
    release: true,
    releaseName: 'v${version}',
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
      infile: 'CHANGELOG.md',
      header: [
        '# Changelog',
        '',
        'All notable changes to surgeMedia — the `@surge-media/core` npm package and the',
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
