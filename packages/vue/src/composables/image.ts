import { focalObjectPosition, type Media, objectPosition, transformMode, type TransformMode } from '@surge-media/client'
import { type ComputedRef, computed, onMounted, type Ref, ref, watch } from 'vue'
import { useSurgeMedia } from '../context'

declare const process: { env: { NODE_ENV?: string } }

/** Mode développement (avertissements) : `process.env.NODE_ENV` remplacé par l'outil de build de l'application. */
export const DEV = (() => {
  try {
    return process.env.NODE_ENV !== 'production'
  }
  catch {
    return false
  }
})()

/** Mode de transformation du média d'après la politique du projet (libres ou préréglages). */
export function useTransformMode(media: () => Pick<Media, 'urlTemplate'>): ComputedRef<TransformMode> {
  const { settings } = useSurgeMedia()
  return computed(() => transformMode(settings.value.policy, media()))
}

const warned = new Set<string>()

/**
 * Texte alternatif : `decorative` → vide ; sinon la propriété `alt`, puis celui du média. Une image
 * sans texte alternatif ni `decorative` est signalée une fois en développement (WCAG 1.1.1).
 */
export function useAltText(props: { media: Media, alt?: string, decorative?: boolean }): ComputedRef<string> {
  return computed(() => {
    if (props.decorative) return ''
    if (props.alt !== undefined) return props.alt
    const alt = props.media.altText ?? ''
    if (!alt && DEV && !warned.has(props.media.id)) {
      warned.add(props.media.id)
      console.warn(`[surge-media] Media ${props.media.id} has no alternative text: pass \`alt\`, or \`decorative\` if the image is purely decorative.`)
    }
    return alt
  })
}

export type ImageStage = 'source' | 'original' | 'error'

/**
 * Repli d'une image (architecture phase E, ED20) : dérivé demandé → fichier original (toujours servi,
 * sans transformation) → état d'erreur. Une erreur survenue avant l'hydratation (rendu serveur), donc
 * avant que l'écouteur `error` existe, est rattrapée au montage : `decode()` n'échoue que pour une image
 * réellement illisible (une image chargée mais pas encore décodée, dans un onglet masqué par exemple,
 * a aussi une largeur nulle).
 */
export function useImageFallback(
  media: () => Media,
  element: Ref<HTMLImageElement | null>,
  onFailure: (stage: ImageStage) => void,
): { stage: Ref<ImageStage>, handleError: () => void } {
  const stage = ref<ImageStage>('source')
  watch(() => `${media().id}:${media().version}:${media().url}`, () => { stage.value = 'source' })

  function handleError() {
    stage.value = stage.value === 'source' && media().kind === 'image' ? 'original' : 'error'
    onFailure(stage.value)
  }

  onMounted(() => {
    const image = element.value
    if (!image || !image.complete || image.naturalWidth > 0 || !image.currentSrc || typeof image.decode !== 'function') return
    const source = image.currentSrc
    image.decode().catch(() => {
      if (element.value === image && image.currentSrc === source && image.naturalWidth === 0 && stage.value === 'source') handleError()
    })
  })
  return { stage, handleError }
}

/** Position CSS du recadrage sur le point d'intérêt (`object-fit: cover`) : exacte si le rapport est connu. */
export function focusPosition(media: Pick<Media, 'width' | 'height' | 'focalPoint'>, aspect: number | null): string {
  const focal = media.focalPoint
  if (!focal) return '50% 50%'
  if (aspect && media.width && media.height) return objectPosition(focalObjectPosition(media.width, media.height, aspect, focal))
  return objectPosition(focal)
}

/** Style en ligne minimal : les composants restent corrects sans la feuille de style facultative. */
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
