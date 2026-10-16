/**
 * Donne la même version à @surge-media/client et @surge-media/vue (crochet `after:bump` de release-it,
 * packages/.release-it.ts) ; le reste des manifestes est inchangé.
 *
 *   node packages/scripts/set-version.mjs 0.1.0
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage : node packages/scripts/set-version.mjs <version SemVer>')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
for (const dir of ['client', 'vue']) {
  const file = join(root, dir, 'package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  manifest.version = version
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${manifest.name} → ${version}`)
}
