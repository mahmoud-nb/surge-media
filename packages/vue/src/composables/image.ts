import {
  imageFailedEarly,
  type ImageStage,
  type Media,
  nextImageStage,
  resolveAltText,
  transformMode,
  type TransformMode,
} from '@surge-media/client'
import { type ComputedRef, computed, onMounted, type Ref, ref, watch } from 'vue'
import { useSurgeMedia } from '../context'

/** Mode de transformation du média d'après la politique du projet (libres ou préréglages). */
export function useTransformMode(media: () => Pick<Media, 'urlTemplate'>): ComputedRef<TransformMode> {
  const { settings } = useSurgeMedia()
  return computed(() => transformMode(settings.value.policy, media()))
}

/**
 * Texte alternatif : `decorative` → vide ; sinon la propriété `alt`, puis celui du média. Une image
 * sans texte alternatif ni `decorative` est signalée une fois en développement (WCAG 1.1.1).
 */
export function useAltText(props: { media: Media, alt?: string, decorative?: boolean }): ComputedRef<string> {
  return computed(() => resolveAltText(props.media, props))
}

/**
 * Repli d'une image (architecture phase E, ED20) : dérivé demandé → fichier original (toujours servi,
 * sans transformation) → état d'erreur (`nextImageStage` du client). Une erreur survenue avant
 * l'hydratation (rendu serveur), donc avant que l'écouteur `error` existe, est rattrapée au montage
 * (`imageFailedEarly` : `decode()` n'échoue que pour une image réellement illisible).
 */
export function useImageFallback(
  media: () => Media,
  element: Ref<HTMLImageElement | null>,
  onFailure: (stage: ImageStage) => void,
): { stage: Ref<ImageStage>, handleError: () => void } {
  const stage = ref<ImageStage>('source')
  watch(() => `${media().id}:${media().version}:${media().url}`, () => { stage.value = 'source' })

  function handleError() {
    stage.value = nextImageStage(stage.value, media())
    onFailure(stage.value)
  }

  onMounted(() => {
    const image = element.value
    if (!image) return
    void imageFailedEarly(image).then((failed) => {
      if (failed && element.value === image && stage.value === 'source') handleError()
    })
  })
  return { stage, handleError }
}
