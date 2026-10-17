/**
 * Archives npm des librairies et essai d'installation, sur des paquets déjà construits (`pnpm packages:build`) :
 *
 *   1. `pnpm pack` de @surge-media/client et @surge-media/vue (la dépendance `workspace:*` devient la version) ;
 *   2. contenu vérifié : dist/, LICENSE, README.md, package.json ; ni sources ni tests ;
 *   3. installation des deux archives (et de Vue) dans un dossier vide, comme chez un utilisateur ;
 *   4. import des modules publiés (dont l'entrée serveur `@surge-media/client/server`, absente de l'entrée
 *      principale), pré-contrôle et file d'envoi, rendu serveur d'un SmImage, feuille de style et déclarations.
 *
 *   node packages/scripts/pack-smoke.mjs [--out <dossier des archives>] [--keep]
 *
 * Les archives restent dans `--out` (par défaut packages/.artifacts/, ignoré par git) : le workflow de
 * publication publie exactement celles-ci.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const option = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const out = resolve(option('--out') ?? join(root, '.artifacts'))
const keep = process.argv.includes('--keep')

/**
 * Commande et sa sortie. Sous Windows, `pnpm` et `npm` sont des scripts `.cmd` : lancés par le shell, avec
 * des arguments entre guillemets (chemins avec espaces).
 */
function run(command, args, cwd, { shell = false } = {}) {
  const viaShell = shell && process.platform === 'win32'
  const quoted = args.map(arg => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg))
  const result = viaShell
    ? spawnSync([command, ...quoted].join(' '), { cwd, encoding: 'utf8', shell: true })
    : spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr, result.error ?? '')
    throw new Error(`${command} ${args.join(' ')} a échoué (code ${result.status}).`)
  }
  return result.stdout
}

/** Fichiers d'une archive .tgz (format tar ustar), lus en Node : aucun `tar` externe (Windows, Git Bash). */
function tarEntries(file) {
  const data = gunzipSync(readFileSync(file))
  const names = []
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0[\s\S]*$/, '')
    const size = Number.parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    const prefix = field(345, 155)
    if (type === '0' || type === '') names.push(prefix ? `${prefix}/${field(0, 100)}` : field(0, 100))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return names
}

mkdirSync(out, { recursive: true })
const tarballs = {}
for (const dir of ['client', 'vue']) {
  const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
  if (!existsSync(join(root, dir, 'dist'))) throw new Error(`${manifest.name} n'est pas construit : lancer \`pnpm packages:build\`.`)
  const file = join(out, `surge-media-${dir}-${manifest.version}.tgz`)
  rmSync(file, { force: true })
  run('pnpm', ['pack', '--out', file], join(root, dir), { shell: true })
  // Contenu de l'archive : rien d'autre que le paquet publiable.
  const listing = tarEntries(file)
  const unexpected = listing.filter(entry => !/^package\/(dist\/.+|LICENSE|README\.md|package\.json)$/.test(entry))
  if (unexpected.length > 0) throw new Error(`${manifest.name} : fichiers inattendus dans l'archive : ${unexpected.join(', ')}`)
  for (const required of ['package/LICENSE', 'package/README.md', 'package/package.json']) {
    if (!listing.includes(required)) throw new Error(`${manifest.name} : ${required} absent de l'archive.`)
  }
  tarballs[dir] = { file, version: manifest.version, entries: listing.length }
  console.log(`✔ ${manifest.name}@${manifest.version} : ${listing.length} fichiers → ${file}`)
}

// Installation dans un projet vide, puis essai des modules publiés.
const sandbox = mkdtempSync(join(tmpdir(), 'surge-media-libs-'))
try {
  writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }))
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', tarballs.client.file, tarballs.vue.file, 'vue@3.5.43'], sandbox, { shell: true })
  const installed = JSON.parse(readFileSync(join(sandbox, 'node_modules/@surge-media/vue/package.json'), 'utf8'))
  if (installed.dependencies['@surge-media/client'] !== tarballs.client.version) {
    throw new Error(`@surge-media/vue publié dépend de « ${installed.dependencies['@surge-media/client']} » au lieu de ${tarballs.client.version}.`)
  }
  writeFileSync(join(sandbox, 'smoke.mjs'), `
import { existsSync, readFileSync } from 'node:fs'
import { buildTransform, checkFile, createSurgeClient, createUploadQueue } from '@surge-media/client'
import { createDelegatedToken, UPLOAD_SCOPES } from '@surge-media/client/server'
import { createSurgeMedia, SmImage } from '@surge-media/vue'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

if (buildTransform({ height: 450, width: 800 }) !== 'w_800,h_450') throw new Error('buildTransform')
const client = createSurgeClient({ baseUrl: 'https://media.example.com', projectId: 'cmproject01', publishableKey: 'sm_pk_smoke' })
const rules = { types: [{ mimeType: 'image/png', extension: 'png', kind: 'image', maxSize: 10, converted: false }], remaining: null, visibility: null, folderId: null }
if (checkFile({ name: 'a.png', type: 'image/png', size: 11 }, rules)?.code !== 'FILE_TOO_LARGE') throw new Error('checkFile')
createUploadQueue({ client, rules }).destroy()

// Entrée serveur : importable dans Node, jamais importée par l'entrée principale.
if (UPLOAD_SCOPES.join(' ') !== 'project:read media:read media:upload') throw new Error('UPLOAD_SCOPES')
const issued = await createDelegatedToken({
  baseUrl: 'https://media.example.com', projectId: 'cmproject01', secretKey: 'sm_sk_smoke', scopes: UPLOAD_SCOPES,
  fetch: async () => new Response(JSON.stringify({ token: 'sm_dt_x.y', expiresAt: '2026-01-01T00:15:00.000Z', scopes: UPLOAD_SCOPES }), { status: 201 }),
})
if (issued.token !== 'sm_dt_x.y') throw new Error('createDelegatedToken')
const browserEntry = readFileSync(new URL('./node_modules/@surge-media/client/dist/index.mjs', import.meta.url), 'utf8')
if (/createDelegatedToken|server\\.mjs/.test(browserEntry)) throw new Error("l'entrée principale importe l'aide serveur")
const media = {
  id: 'cmimage0001', projectId: 'cmproject01', kind: 'image', visibility: 'public', title: 'Smoke', altText: 'Smoke test',
  filename: 'smoke.jpg', mimeType: 'image/jpeg', extension: 'jpg', size: 1, width: 1600, height: 900, duration: null,
  version: 1, folderId: null, url: 'https://media.example.com/m/cmimage0001/v1/smoke.jpg', sources: [], previewUrl: null,
  urlTemplate: 'https://media.example.com/m/cmimage0001/v1/{transform}/smoke.{format}', poster: null, textTracks: [],
  processing: null, focalPoint: null, urlExpiresAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}
const app = createSSRApp({ render: () => h(SmImage, { media, widths: [640] }) })
app.use(createSurgeMedia())
const html = await renderToString(app)
if (!html.includes('/w_640/smoke.webp 640w')) throw new Error('rendu serveur : ' + html)
for (const file of ['@surge-media/vue/dist/style.css', '@surge-media/vue/dist/index.d.ts', '@surge-media/client/dist/index.d.mts', '@surge-media/client/dist/server.d.mts']) {
  if (!existsSync(new URL('./node_modules/' + file, import.meta.url))) throw new Error(file + ' absent')
}
console.log('✔ Modules publiés : import, envoi, entrée serveur, rendu serveur, style.css et déclarations')
`)
  process.stdout.write(run(process.execPath, ['smoke.mjs'], sandbox))
}
finally {
  if (!keep) rmSync(sandbox, { recursive: true, force: true })
  else console.log(`Dossier d'essai gardé : ${sandbox}`)
}
