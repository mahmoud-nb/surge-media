/**
 * Vérification avant une release (`pnpm release`, workflow de publication) : le fichier LICENSE de la racine ne
 * doit plus contenir de champ à compléter (nom légal du concédant, contact pour les licences commerciales).
 *
 *   pnpm --filter @surge-media/core license:check
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const path = resolve(import.meta.dirname, '../../../LICENSE')
const pending = readFileSync(path, 'utf8')
  .split('\n')
  .map((line, index) => ({ line: index + 1, text: line.trim() }))
  .filter(({ text }) => text.includes('TO BE COMPLETED'))

if (pending.length) {
  console.error(`✖ LICENSE : ${pending.length} champ(s) à compléter avant une release :`)
  for (const { line, text } of pending) console.error(`  ligne ${line} : ${text}`)
  process.exit(1)
}
console.log('✔ LICENSE complète')
