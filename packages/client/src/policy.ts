import type { Media, TransformPolicy } from './types'

/**
 * Ce qu'un composant peut demander au serveur pour un média, selon la politique de transformation du
 * projet (architecture phase E, § 3.3) :
 * - `free` : paramètres libres (`w_800,h_450`) construits depuis `urlTemplate` ;
 * - `presets` : préréglages seulement (toujours servis, quelle que soit la politique).
 *
 * `open` → libres ; `signed` → libres si le gabarit porte déjà une signature (média privé : droit
 * `derived`), sinon préréglages ; `presets` → préréglages. Politique inconnue : libres (le repli des
 * composants couvre une erreur).
 */
export type TransformMode = 'free' | 'presets'

export function isSignedTemplate(template: string | null): boolean {
  if (!template) return false
  const query = template.split('?')[1]
  return query !== undefined && new URLSearchParams(query).has('sig')
}

export function transformMode(policy: TransformPolicy | null | undefined, media: Pick<Media, 'urlTemplate'>): TransformMode {
  if (policy === 'presets') return 'presets'
  if (policy === 'signed') return isSignedTemplate(media.urlTemplate) ? 'free' : 'presets'
  return 'free'
}
