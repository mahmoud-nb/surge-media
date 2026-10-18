/**
 * Releases des librairies front avec release-it (`pnpm release:libs`, setup.md § 17.2) : @surge-media/client et
 * @surge-media/vue sont versionnés ensemble (architecture phase E, ED16), sous des tags `libs-vX.Y.Z` — jamais
 * confondus avec les tags `vX.Y.Z` du core (release-it du core ne retient que `v*`).
 *
 *   1. vérifications : branche main ou release/*, arbre propre et à jour, au moins un commit dans les dossiers des librairies depuis
 *      la dernière version ; contrôles des manifestes (packages/scripts/check-release.mjs), lint, typecheck, tests,
 *      contrastes du thème, build + publint, archives et essai d'installation ;
 *   2. version suivante calculée depuis les Conventional Commits qui touchent les librairies : rupture → majeure, `feat`
 *      → mineure, `fix` / `perf` → correctif ; avant 1.0.0, un cran de moins. Ou imposée : `pnpm release:libs 0.1.0`,
 *      `pnpm release:libs minor`, préversion `--preRelease=alpha` ;
 *   3. version des deux package.json (packages/scripts/set-version.mjs), packages/CHANGELOG.md, commit
 *      `chore(release): libs v${version}`, tag annoté `libs-vX.Y.Z`, push ;
 *   4. release GitHub (notes = section du CHANGELOG, résumée si elle est trop longue pour la page du navigateur) :
 *      par l'API si GITHUB_TOKEN est défini, sinon page pré-remplie ouverte dans le navigateur, à publier d'un clic.
 *
 * La publication npm est faite par .github/workflows/release-libraries.yml quand la release GitHub est publiée,
 * jamais depuis un poste de travail.
 */
import { readFileSync } from 'node:fs'
import type { Config } from 'release-it'

const { version } = JSON.parse(readFileSync(new URL('./client/package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Dossiers des librairies : les commits qui les touchent font la version suivante et le changelog. Pas tout
 * packages/ : le core y vivait (packages/core) jusqu'au 2026-10-11.
 */
const LIBRARY_PATHS = ['packages/client', 'packages/vue', 'packages/scripts', 'packages/.release-it.ts']

/**
 * Sans GITHUB_TOKEN, release-it passe les notes dans l'adresse de la page pré-remplie (`…/releases/new?body=…`) :
 * GitHub refuse une adresse de plus de quelques milliers de caractères (414 vers 8 200, erreurs dès 7 000 environ,
 * mesuré le 2026-10-18). Au-delà de MAX_WEB_NOTES caractères encodés : titre de la version, nombre d'entrées par
 * rubrique, ruptures en entier si elles tiennent, et lien vers le CHANGELOG du tag (complet). Comme le core
 * (apps/core/.release-it.ts).
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
  const link = `https://github.com/mahmoud-nb/surge-media/blob/libs-v${context?.version ?? version}/packages/CHANGELOG.md`
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
    commitsPath: LIBRARY_PATHS.join(' '),
    commitMessage: 'chore(release): libs v${version}',
    tagName: 'libs-v${version}',
    tagMatch: 'libs-v[0-9]*',
    tagAnnotation: 'surgeMedia libraries v${version}',
    push: true,
  },
  // Versions écrites par le crochet after:bump (deux paquets) ; publication par le workflow.
  npm: false,
  github: {
    release: true,
    releaseName: 'Libraries v${version} (@surge-media/client, @surge-media/vue)',
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
      tagPrefix: 'libs-v',
      // Seuls les commits qui touchent les librairies comptent (version suivante et changelog).
      commitsOpts: { path: LIBRARY_PATHS },
      gitRawCommitsOpts: { path: LIBRARY_PATHS },
      infile: 'packages/CHANGELOG.md',
      header: [
        '# Changelog',
        '',
        'All notable changes to the surgeMedia front-end libraries — `@surge-media/client` and `@surge-media/vue`,',
        'released together with the same version — are documented in this file. Versions follow',
        '[Semantic Versioning](https://semver.org); entries are generated from',
        '[Conventional Commits](https://www.conventionalcommits.org) by `pnpm release:libs`.',
      ].join('\n'),
    },
  },
  hooks: {
    'before:init': [
      'node packages/scripts/check-release.mjs',
      'pnpm --filter "./packages/*" lint',
      'pnpm --filter "./packages/*" typecheck',
      'pnpm --filter "./packages/*" test',
      'pnpm --filter @surge-media/client a11y:contrast',
      'pnpm packages:build',
      'node packages/scripts/pack-smoke.mjs',
    ],
    'after:bump': 'node packages/scripts/set-version.mjs ${version}',
    'after:release': 'echo "libs-v${version} : publiez la release GitHub pour lancer la publication npm des librairies."',
  },
} satisfies Config
