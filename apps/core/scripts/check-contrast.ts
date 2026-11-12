/**
 * Vérifie les contrastes WCAG 2.2 AA des jetons de design (app/assets/css/main.css),
 * en thème clair (:root) et sombre (.dark).
 *
 *   pnpm a11y:contrast
 *
 * Texte : 4.5:1 minimum (1.4.3). Bordures de champs et contour de focus : 3:1 (1.4.11).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(import.meta.dirname, '../app/assets/css/main.css'), 'utf8')

function readTokens(selector: string): Record<string, string> {
  const block = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
  if (!block) throw new Error(`Bloc ${selector} introuvable dans main.css`)
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name!, value!]))
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

/** [premier plan, arrière-plan, ratio minimal] */
const PAIRS: [string, string, number][] = [
  ...['background', 'surface', 'muted'].flatMap(bg => [
    ['foreground', bg, 4.5],
    ['muted-foreground', bg, 4.5],
    ['primary', bg, 4.5],
  ] as [string, string, number][]),
  ['primary', 'primary-soft', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['primary-foreground', 'primary-hover', 4.5],
  ['foreground', 'primary-soft', 4.5],
  ['destructive', 'surface', 4.5],
  ['destructive', 'background', 4.5],
  ['destructive', 'destructive-soft', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['destructive-foreground', 'destructive-hover', 4.5],
  ['foreground', 'destructive-soft', 4.5],
  ['success', 'success-soft', 4.5],
  ['success', 'surface', 4.5],
  ['foreground', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['warning', 'surface', 4.5],
  ['foreground', 'warning-soft', 4.5],
  // Documentation de l'API (Scalar) : méthodes HTTP et coloration du code sur ses trois fonds.
  ...['background', 'surface', 'muted'].flatMap(bg =>
    ['success', 'destructive', 'warning', 'code-blue', 'code-orange', 'code-purple', 'code-teal'].map(fg => [fg, bg, 4.5]),
  ) as [string, string, number][],
  // Étiquettes des médias : texte sur son fond doux, et sur les fonds de page (pastille de couleur).
  ...['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet'].flatMap(color => [
    [`tag-${color}-fg`, `tag-${color}-bg`, 4.5],
    [`tag-${color}-fg`, 'surface', 3],
  ] as [string, string, number][]),
  ['input', 'surface', 3],
  ['input', 'background', 3],
  ['input', 'muted', 3],
  ['ring', 'surface', 3],
  ['ring', 'background', 3],
  // Logo (AppLogo) : point du i, élément graphique (1.4.11).
  ['brand-accent', 'surface', 3],
  ['brand-accent', 'background', 3],
]

let failures = 0
for (const [theme, selector] of [['clair', ':root'], ['sombre', '.dark']] as const) {
  const tokens = readTokens(selector)
  for (const [fg, bg, min] of PAIRS) {
    const [a, b] = [tokens[fg], tokens[bg]]
    if (!a || !b) throw new Error(`Jeton manquant (${theme}) : --${a ? bg : fg}`)
    const value = ratio(a, b)
    if (value < min) {
      failures++
      console.error(`✖ ${theme} : --${fg} sur --${bg} = ${value.toFixed(2)}:1 (minimum ${min}:1)`)
    }
  }
}

if (failures > 0) process.exit(1)
console.log(`✔ Contrastes conformes WCAG AA (${PAIRS.length} couples × 2 thèmes).`)
