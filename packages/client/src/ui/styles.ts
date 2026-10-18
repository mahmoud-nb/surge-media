/**
 * Styles en ligne minimaux des composants : ils restent corrects (dimensions, rapports, textes réservés aux
 * lecteurs d'écran) sans la feuille de style facultative. Objets aux propriétés en camelCase, acceptés tels
 * quels par `:style` de Vue et `style` de React ; `cssText` en fait une chaîne (Svelte, Lit, Angular…).
 */

/** Élément masqué à l'écran mais lu par les lecteurs d'écran. */
export const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: '0',
} as const

/** Style en ligne en texte (`max-width: 100%; height: auto`) ; propriétés vides ignorées. */
export function cssText(style: object): string {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([property, value]) => `${property.startsWith('--') ? property : property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}: ${String(value)}`)
    .join('; ')
}
