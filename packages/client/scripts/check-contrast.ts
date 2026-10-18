/**
 * Vérifie les contrastes WCAG 2.2 AA du thème facultatif (src/styles/theme.css), en clair et en sombre,
 * et que les deux blocs « sombre » (classe et préférence du système) sont identiques.
 *
 *   pnpm --filter @surge-media/client a11y:contrast
 *
 * Texte : 4.5:1 minimum (1.4.3). Contour de focus et bordures porteuses de sens : 3:1 (1.4.11).
 * Repris de apps/core/scripts/check-contrast.ts.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(import.meta.dirname, '../src/styles/theme.css'), 'utf8')

function readBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`Bloc ${selector} introuvable dans theme.css`)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/--sm-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name!, value!.toLowerCase()]))
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
  ...['color-bg', 'color-surface'].flatMap(bg => [
    ['color-fg', bg, 4.5],
    ['color-muted-fg', bg, 4.5],
    ['color-primary', bg, 4.5],
    ['color-success', bg, 4.5],
    ['color-warning', bg, 4.5],
    ['color-danger', bg, 4.5],
    ['focus-ring', bg, 3],
  ] as [string, string, number][]),
  ['color-primary-fg', 'color-primary', 4.5],
  ['color-overlay-fg', 'color-overlay', 4.5],
]

const themes = {
  'clair': readBlock(':where(:root)'),
  'sombre': readBlock(':where(.dark, [data-theme=\'dark\'])'),
  'sombre (système)': readBlock(':where(:root:not(.light):not([data-theme=\'light\']))'),
}

let failures = 0
if (JSON.stringify(themes.sombre) !== JSON.stringify(themes['sombre (système)'])) {
  console.error('✗ Les blocs sombres (classe et préférence du système) diffèrent.')
  failures++
}
for (const [theme, tokens] of Object.entries(themes).slice(0, 2)) {
  for (const [fg, bg, min] of PAIRS) {
    const [a, b] = [tokens[fg], tokens[bg]]
    if (!a || !b) {
      console.error(`✗ ${theme} : jeton manquant (${!a ? fg : bg})`)
      failures++
      continue
    }
    const value = ratio(a, b)
    const ok = value >= min
    if (!ok) failures++
    console.log(`${ok ? '✓' : '✗'} ${theme.padEnd(7)} ${fg.padEnd(17)} sur ${bg.padEnd(14)} ${value.toFixed(2)}:1 (min ${min})`)
  }
}
if (failures > 0) {
  console.error(`\n${failures} contraste(s) insuffisant(s).`)
  process.exit(1)
}
console.log('\nContrastes AA respectés en clair et en sombre.')
