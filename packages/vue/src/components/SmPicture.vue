<script setup lang="ts">
/**
 * `<picture>` d'un média SurgeMedia : une `<source type>` par format activé sur le serveur (AVIF, puis WebP)
 * et une image de repli (JPEG, sinon PNG) ; direction artistique par `sources` (un cadrage par media query).
 * Mêmes propriétés et même repli que SmImage. Pour une vidéo : son image d'affiche. Toute la logique est
 * dans le client (`pictureSources`, `imageStyle`, `imageErrorFrameStyle`).
 */
import {
  imageErrorFrameStyle,
  type ImageStage,
  imageStyle,
  type ImageTransform,
  type Media,
  type PictureArtSource,
  pictureSources,
  type TransformFormat,
} from '@surge-media/client'
import { computed, type CSSProperties, ref } from 'vue'
import { useAltText, useImageFallback } from '../composables/image'
import { useDisplaySettings } from '../context'

const props = withDefaults(defineProps<{
  media: Media
  alt?: string
  decorative?: boolean
  width?: number
  height?: number
  aspect?: number | string
  fit?: 'cover' | 'contain' | 'inside'
  transform?: ImageTransform
  preset?: string
  presets?: string[]
  /** Formats proposés (parmi ceux activés sur le serveur). */
  formats?: TransformFormat[]
  /** Cadrages par media query, du plus spécifique au plus général. */
  sources?: PictureArtSource[]
  widths?: number[]
  sizes?: string
  loading?: 'lazy' | 'eager'
  fetchpriority?: 'high' | 'low' | 'auto'
  decoding?: 'async' | 'sync' | 'auto'
  priority?: boolean
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
  formats: undefined,
  sources: () => [],
  widths: undefined,
  sizes: undefined,
  loading: 'lazy',
  fetchpriority: undefined,
  decoding: 'async',
  objectFit: undefined,
})

const emit = defineEmits<{
  load: [event: Event]
  error: [stage: ImageStage]
}>()

const display = useDisplaySettings()
const alt = useAltText(props)
const element = ref<HTMLImageElement | null>(null)
const { stage, handleError } = useImageFallback(() => props.media, element, failed => emit('error', failed))

const picture = computed(() => pictureSources(props.media, props, display.value))
const sourceTags = computed(() => picture.value.sources)
const fallback = computed(() => picture.value.fallback)
const style = computed<CSSProperties>(() => imageStyle(props.media, fallback.value, props))
const frameStyle = computed<CSSProperties>(() => imageErrorFrameStyle(fallback.value))
</script>

<template>
  <picture v-if="stage === 'source'" class="sm-picture">
    <source
      v-for="tag in sourceTags"
      :key="tag.key"
      :media="tag.media"
      :type="tag.type"
      :srcset="tag.srcset"
      :sizes="tag.sizes"
      :width="tag.width"
      :height="tag.height"
    >
    <img
      ref="element"
      class="sm-image"
      :src="fallback.src"
      :srcset="fallback.srcset"
      :sizes="fallback.srcset ? fallback.sizes : undefined"
      :width="fallback.width"
      :height="fallback.height"
      :alt="alt"
      :loading="props.priority ? 'eager' : props.loading"
      :fetchpriority="props.priority ? 'high' : props.fetchpriority"
      :decoding="props.decoding"
      :style="style"
      @load="emit('load', $event)"
      @error="handleError"
    >
  </picture>
  <img
    v-else-if="stage === 'original'"
    class="sm-image sm-image--original"
    :src="props.media.url"
    :width="fallback.width"
    :height="fallback.height"
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
