<script setup lang="ts">
/**
 * Image responsive d'un média surgeMedia (`<img>`) : srcset en largeurs (descripteurs = taille réelle des
 * fichiers produits) ou en densités pour une taille fixe, recadrage serveur centré sur le point d'intérêt,
 * politique du projet respectée (préréglages si les paramètres libres sont refusés), dimensions toujours
 * posées (aucun décalage au chargement), repli sur l'original puis état d'erreur. Rendu serveur déterministe.
 */
import type { Media, TransformFormat } from '@surge-media/client'
import { imageFormat } from '@surge-media/client'
import { computed, type CSSProperties, ref } from 'vue'
import { focusPosition, type ImageStage, useAltText, useImageFallback, useTransformMode } from '../composables/image'
import { useSurgeMedia } from '../context'
import { type ImageTransform, imageSourceSet, parseAspect } from '../image-sources'

const props = withDefaults(defineProps<{
  media: Media
  /** Texte alternatif (sinon celui du média). */
  alt?: string
  /** Image purement décorative : texte alternatif vide. */
  decorative?: boolean
  /** Taille d'affichage fixe en pixels CSS (srcset en densités 1x, 2x, 3x). */
  width?: number
  height?: number
  /** Rapport imposé (`16/9`, `1`, `4:3`) : recadrage par le serveur, centré sur le point d'intérêt. */
  aspect?: number | string
  /** Ajustement dans le cadre (`cover` par défaut avec un rapport). */
  fit?: 'cover' | 'contain' | 'inside'
  /** Autres paramètres : qualité, rotation, miroir, zone, fond. */
  transform?: ImageTransform
  /** Préréglage du projet. */
  preset?: string
  /** Préréglages formant le srcset (politique « préréglages seulement »). */
  presets?: string[]
  format?: TransformFormat
  widths?: number[]
  sizes?: string
  loading?: 'lazy' | 'eager'
  fetchpriority?: 'high' | 'low' | 'auto'
  decoding?: 'async' | 'sync' | 'auto'
  /** Image prioritaire (au-dessus de la ligne de flottaison) : chargement immédiat et prioritaire. */
  priority?: boolean
  /** Remplit son conteneur, recadrée par le navigateur sur le point d'intérêt. */
  objectFit?: 'cover' | 'contain'
}>(), {
  alt: undefined,
  width: undefined,
  height: undefined,
  aspect: undefined,
  fit: undefined,
  transform: undefined,
  preset: undefined,
  presets: undefined,
  format: undefined,
  widths: undefined,
  sizes: undefined,
  loading: 'lazy',
  fetchpriority: undefined,
  decoding: 'async',
  objectFit: undefined,
})

const emit = defineEmits<{
  load: [event: Event]
  /** Le dérivé (`original`) puis l'original (`error`) n'ont pas pu être affichés. */
  error: [stage: ImageStage]
}>()

const { settings, presets: knownPresets, defaults } = useSurgeMedia()
const mode = useTransformMode(() => props.media)
const alt = useAltText(props)
const element = ref<HTMLImageElement | null>(null)
const { stage, handleError } = useImageFallback(() => props.media, element, failed => emit('error', failed))
const aspect = computed(() => parseAspect(props.aspect))

const set = computed(() => imageSourceSet({
  media: props.media,
  format: imageFormat(settings.value.formats, props.format ?? defaults.imageFormat),
  mode: mode.value,
  maxDimension: settings.value.maxDimension,
  presets: knownPresets.value,
  width: props.width,
  height: props.height,
  aspect: aspect.value ?? undefined,
  fit: props.fit,
  transform: props.transform,
  preset: props.preset,
  presetNames: props.presets,
  widths: props.widths ?? defaults.widths,
  sizes: props.sizes,
}))

const style = computed<CSSProperties>(() => {
  if (props.objectFit) {
    return { width: '100%', height: '100%', objectFit: props.objectFit, objectPosition: focusPosition(props.media, aspect.value) }
  }
  return set.value.responsive ? { maxWidth: '100%', height: 'auto' } : {}
})

const frameStyle = computed<CSSProperties>(() => {
  const { width, height } = set.value
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...(width && height ? { aspectRatio: `${width} / ${height}` } : {}),
    ...(set.value.responsive ? { width: '100%', maxWidth: width ? `${width}px` : undefined } : { width: width ? `${width}px` : undefined }),
  }
})
</script>

<template>
  <img
    v-if="stage === 'source'"
    ref="element"
    class="sm-image"
    :src="set.src"
    :srcset="set.srcset"
    :sizes="set.srcset ? set.sizes : undefined"
    :width="set.width"
    :height="set.height"
    :alt="alt"
    :loading="props.priority ? 'eager' : props.loading"
    :fetchpriority="props.priority ? 'high' : props.fetchpriority"
    :decoding="props.decoding"
    :style="style"
    @load="emit('load', $event)"
    @error="handleError"
  >
  <img
    v-else-if="stage === 'original'"
    class="sm-image sm-image--original"
    :src="props.media.url"
    :width="set.width"
    :height="set.height"
    :alt="alt"
    :loading="props.priority ? 'eager' : props.loading"
    :decoding="props.decoding"
    :style="style"
    @load="emit('load', $event)"
    @error="handleError"
  >
  <span
    v-else
    class="sm-image sm-image--error"
    :role="alt ? 'img' : undefined"
    :aria-label="alt || undefined"
    :aria-hidden="alt ? undefined : 'true'"
    :style="frameStyle"
  >
    <span v-if="alt" class="sm-image__error-text" aria-hidden="true">{{ alt }}</span>
  </span>
</template>
