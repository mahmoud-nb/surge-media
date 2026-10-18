/**
 * Thème facultatif `@surge-media/client/style.css` (après tsdown, dans `pnpm build`) : les fichiers importés
 * par src/styles/index.css (jetons, puis styles des composants), mis bout à bout dans dist/style.css. Aucune
 * autre transformation : CSS standard, tout dans `@layer surge-media`. Les librairies de composants le
 * reprennent dans leur propre `style.css` (`import '@surge-media/client/style.css'` de leur build).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const styles = new URL('../src/styles/', import.meta.url)
const index = readFileSync(new URL('index.css', styles), 'utf8')
const files = [...index.matchAll(/@import\s+'\.\/([\w-]+\.css)';/g)].map(([, file]) => file)
if (files.length === 0) throw new Error('src/styles/index.css : aucun @import trouvé.')
const css = files.map(file => readFileSync(new URL(file, styles), 'utf8').trim()).join('\n\n')

const dist = new URL('../dist/', import.meta.url)
mkdirSync(dist, { recursive: true })
writeFileSync(new URL('style.css', dist), `${css}\n`)
console.log(`dist/style.css : ${files.join(' + ')} (${(css.length / 1024).toFixed(1)} Kio)`)
