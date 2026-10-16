/**
 * Contrôles des librairies avant une release (`pnpm release:libs`, CI, workflow de publication) :
 * - @surge-media/client et @surge-media/vue ont la même version (versionnés ensemble, architecture phase E, ED16) ;
 * - ni l'un ni l'autre n'est « private » ; licence MIT déclarée et fichier LICENSE présent ; README présent ;
 * - @surge-media/vue dépend du client de l'espace de travail (`workspace:*`, remplacé par la version au pack) ;
 * - avec `--tag libs-vX.Y.Z` : le tag correspond à la version des paquets.
 *
 *   node packages/scripts/check-release.mjs [--tag libs-v0.1.0]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const PACKAGES = ['client', 'vue']
const TAG_PREFIX = 'libs-v'
const errors = []

const manifests = Object.fromEntries(PACKAGES.map((dir) => {
  const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
  if (manifest.private) errors.push(`${manifest.name} : « private » doit être retiré pour publier.`)
  if (manifest.license !== 'MIT') errors.push(`${manifest.name} : licence « ${manifest.license} » au lieu de MIT.`)
  const license = join(root, dir, 'LICENSE')
  if (!existsSync(license) || !readFileSync(license, 'utf8').startsWith('MIT License')) errors.push(`${manifest.name} : fichier LICENSE (MIT) absent.`)
  if (!existsSync(join(root, dir, 'README.md'))) errors.push(`${manifest.name} : README.md absent.`)
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)) errors.push(`${manifest.name} : version « ${manifest.version} » invalide.`)
  return [dir, manifest]
}))

const versions = [...new Set(PACKAGES.map(dir => manifests[dir].version))]
if (versions.length > 1) errors.push(`Versions différentes : ${PACKAGES.map(dir => `${manifests[dir].name}@${manifests[dir].version}`).join(', ')}.`)
if (manifests.vue.dependencies?.['@surge-media/client'] !== 'workspace:*') {
  errors.push('@surge-media/vue doit dépendre de « @surge-media/client »: « workspace:* ».')
}

const tagIndex = process.argv.indexOf('--tag')
if (tagIndex !== -1) {
  const tag = process.argv[tagIndex + 1] ?? ''
  if (tag !== `${TAG_PREFIX}${versions[0]}`) errors.push(`Le tag « ${tag} » ne correspond pas à la version des paquets (${TAG_PREFIX}${versions[0]}).`)
}

if (errors.length > 0) {
  console.error(`✖ Librairies : ${errors.length} problème(s) avant une release :`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`✔ Librairies prêtes : @surge-media/client et @surge-media/vue en ${versions[0]}, licence MIT.`)
