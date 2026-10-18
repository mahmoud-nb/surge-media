import type { MediaProcessing, ProcessingStatus } from '../types'
import type { IconName } from './icons'
import type { Translate } from './i18n'

/**
 * Logique de l'état du traitement d'une vidéo sans framework : icône fixe par état (aucune animation
 * continue, WCAG 2.2.2), avancement, raison d'un échec, annonces aux seules transitions.
 */

/** Icône de chaque état (le sens est porté par le texte `processing.states.*`). */
export const PROCESSING_ICONS: Readonly<Record<ProcessingStatus, IconName>> = {
  pending: 'hourglass',
  processing: 'cog',
  ready: 'circle-check',
  failed: 'triangle-alert',
}

/** État à montrer : en attente, en cours ou en échec (rien pour une vidéo prête ou une image). */
export function processingVisible(processing: MediaProcessing | null | undefined): processing is MediaProcessing {
  return processing ? processing.status !== 'ready' : false
}

/** Avancement (0 à 1) pendant un réencodage ; null s'il est inconnu ou hors traitement. */
export function processingProgress(processing: MediaProcessing | null | undefined): number | null {
  return processing?.status === 'processing' ? processing.progress ?? null : null
}

/** Raison traduite d'un échec (`processing.errors.*`) ; null sans échec ou pour un code sans texte. */
export function processingReason(processing: MediaProcessing | null | undefined, t: Translate): string | null {
  const code = processing?.error
  if (processing?.status !== 'failed' || !code) return null
  const key = `processing.errors.${code}`
  const text = t(key)
  return text === key ? null : text
}

/**
 * Annonce polie (`role="status"`) d'un changement d'état : début du traitement, vidéo prête (après un état
 * connu : pas au premier rendu), échec ; null pour les autres changements (avancement…).
 */
export function processingAnnouncementKey(next: ProcessingStatus | null, previous: ProcessingStatus | null | undefined): string | null {
  if (next === previous) return null
  if (next === 'processing') return 'processing.announce.started'
  if (next === 'ready' && previous) return 'processing.announce.ready'
  if (next === 'failed') return 'processing.announce.failed'
  return null
}
