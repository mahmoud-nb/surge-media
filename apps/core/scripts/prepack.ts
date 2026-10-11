/**
 * Préparation du paquet publié (script `prepack`, lancé par `pnpm pack` et `npm publish`) :
 *
 *   1. vérifie la build : serveur construit, CLI, schémas par fournisseur (`pnpm build` avant) ;
 *   2. retire du serveur construit les modules natifs, compilés pour la plateforme de la build (sharp et ses
 *      binaires @img/*, @node-rs/argon2*, better-sqlite3) : ce sont des dépendances du paquet, que npm installe
 *      pour la plateforme de l'utilisateur, et que Node trouve en remontant depuis .output/server. Leurs versions
 *      doivent être celles avec lesquelles le serveur a été construit : dépendances épinglées, comparées ici ;
 *   3. remplace par de vraies copies les liens symboliques du serveur construit : quand plusieurs versions d'une
 *      dépendance coexistent, Nitro les range dans node_modules/.nitro/<paquet>@<version> et les relie par des
 *      liens (absolus sous Windows), que l'archive npm ne conserve pas (« Cannot find package » au démarrage) ;
 *   4. copie la licence de la racine du dépôt, que le paquet doit contenir (BSL : « conspicuously display »).
 *
 * Le serveur construit reste utilisable dans le dépôt : apps/core/node_modules fournit ces modules.
 */
import { copyFileSync, cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DATABASE_PROVIDERS } from '../shared/database'

const root = resolve(import.meta.dirname, '..')
const serverDir = join(root, '.output/server')
const tracedDir = join(serverDir, 'node_modules')

/** Dépendance du paquet → dossiers à retirer de .output/server/node_modules (paquet et binaires par plateforme). */
const NATIVE_MODULES: Record<string, string[]> = {
  'sharp': ['sharp', '@img'],
  '@node-rs/argon2': ['@node-rs'],
  'better-sqlite3': ['better-sqlite3'],
}

function fail(message: string): never {
  console.error(`✖ ${message}`)
  process.exit(1)
}

const required = [
  '.output/server/index.mjs',
  'dist/cli/index.mjs',
  ...DATABASE_PROVIDERS.map(provider => `server/generated/schemas/${provider}.prisma`),
]
const missing = required.filter(path => !existsSync(join(root, path)))
if (missing.length) fail(`Build absente ou incomplète (${missing.join(', ')}) : lancez d'abord « pnpm build ».`)

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
const manifestPath = join(serverDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }

for (const [name, dirs] of Object.entries(NATIVE_MODULES)) {
  const declared = pkg.dependencies[name]
  if (!declared) fail(`${name} doit être une dépendance du paquet (installée pour la plateforme de l'utilisateur).`)
  const tracedManifest = join(tracedDir, name, 'package.json')
  // Absent : déjà retiré par un précédent `pack` (même build).
  if (existsSync(tracedManifest)) {
    const { version } = JSON.parse(readFileSync(tracedManifest, 'utf8')) as { version: string }
    if (version !== declared) {
      fail(`${name} : ${version} dans la build, ${declared} dans les dépendances (versions épinglées identiques attendues).`)
    }
  }
  for (const dir of dirs) {
    rmSync(join(tracedDir, dir), { recursive: true, force: true })
    manifest.dependencies = Object.fromEntries(Object.entries(manifest.dependencies ?? {})
      .filter(([dependency]) => dependency !== dir && !dependency.startsWith(`${dir}/`)))
  }
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

/** Liens symboliques sous `dir` (hors node_modules/.nitro, leur cible). */
function findLinks(dir: string, links: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (lstatSync(path).isSymbolicLink()) links.push(path)
    else if (entry.isDirectory() && entry.name !== '.nitro') findLinks(path, links)
  }
  return links
}

const links = existsSync(tracedDir) ? findLinks(tracedDir) : []
for (const link of links) {
  const target = realpathSync(link)
  rmSync(link, { recursive: true, force: true }) // supprime le lien, pas sa cible
  cpSync(target, link, { recursive: true, dereference: true })
}
// Plus rien n'y renvoie : chaque version est désormais copiée là où elle est requise.
rmSync(join(tracedDir, '.nitro'), { recursive: true, force: true })

copyFileSync(join(root, '../../LICENSE'), join(root, 'LICENSE'))
console.log(`✔ Paquet préparé : modules natifs retirés du serveur construit (${Object.keys(NATIVE_MODULES).join(', ')}), `
  + `${links.length} lien(s) remplacé(s) par des copies, licence copiée.`)
