<script setup lang="ts">
/**
 * `<picture>` d'un média surgeMedia : une `<source type>` par format activé sur le serveur (AVIF, puis WebP)
 * et une image de repli (JPEG, sinon PNG) ; direction artistique par `sources` (un cadrage par media query).
 * Mêmes propriétés et même repli que SmImage. Pour une vidéo : son image d'affiche.
 */
import { FORMAT_MIME_TYPES, type Media, pictureFormats, type TransformFormat } from '@surge-media/client'
import { computed, type CSSProperties, ref } from 'vue'
import { focusPosition, type ImageStage, useAltText, useImageFallback, useTransformMode } from '../composables/image'
import { useSurgeMedia } from '../context'
import { type ImageSourceRequest, type ImageTransform, imageSourceSet, parseAspect } from '../image-sources'

/** Cadrage d'une media query (direction artistique). */
export interface PictureArtSource {
  /** Media query (`(max-width: 640px)`). */
  media: string
  aspect?: number | string
  fit?: 'cover' | 'contain' | 'inside'
  transform?: ImageTransform
  widths?: number[]
  sizes?: string
  preset?: string
  presets?: string[]
}

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

const { settings, presets: knownPresets, defaults } = useSurgeMedia()
const mode = useTransformMode(() => props.media)
const alt = useAltText(props)
const element = ref<HTMLImageElement | null>(null)
const { stage, handleError } = useImageFallback(() => props.media, element, failed => emit('error', failed))
const aspect = computed(() => parseAspect(props.aspect))

const formats = computed(() => {
  const enabled = settings.value.formats.filter(format => !props.formats || props.formats.includes(format))
  return pictureFormats(enabled.length > 0 ? enabled : settings.value.formats)
})

function request(format: TransformFormat, overrides: Partial<ImageSourceRequest> = {}): ImageSourceRequest {
  return {
    media: props.media,
    format,
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
    ...overrides,
  }
}

interface SourceTag {
  key: string
  media?: string
  type: string
  srcset: string
  sizes?: string
  width?: number
  height?: number
}

function sourceTag(format: TransformFormat, query: string | undefined, overrides: Partial<ImageSourceRequest>): SourceTag {
  const set = imageSourceSet(request(format, overrides))
  return {
    key: `${query ?? ''}|${format}`,
    media: query,
    type: FORMAT_MIME_TYPES[format],
    srcset: set.srcset ?? set.src,
    sizes: set.srcset ? set.sizes : undefined,
    width: set.width,
    height: set.height,
  }
}

const sourceTags = computed<SourceTag[]>(() => {
  const tags: SourceTag[] = []
  for (const art of props.sources) {
    const overrides: Partial<ImageSourceRequest> = {
      aspect: parseAspect(art.aspect) ?? undefined,
      fit: art.fit,
      transform: art.transform ?? props.transform,
      widths: art.widths ?? props.widths ?? defaults.widths,
      sizes: art.sizes ?? props.sizes,
      preset: art.preset,
      presetNames: art.presets,
      width: undefined,
      height: undefined,
    }
    for (const format of [...formats.value.sources, formats.value.fallback]) tags.push(sourceTag(format, art.media, overrides))
  }
  for (const format of formats.value.sources) tags.push(sourceTag(format, undefined, {}))
  return tags
})

const fallback = computed(() => imageSourceSet(request(formats.value.fallback)))

const style = computed<CSSProperties>(() => {
  if (props.objectFit) {
    return { width: '100%', height: '100%', objectFit: props.objectFit, objectPosition: focusPosition(props.media, aspect.value) }
  }
  return fallback.value.responsive ? { maxWidth: '100%', height: 'auto' } : {}
})

const frameStyle = computed<CSSProperties>(() => {
  const { width, height, responsive } = fallback.value
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...(width && height ? { aspectRatio: `${width} / ${height}` } : {}),
    ...(responsive ? { width: '100%', maxWidth: width ? `${width}px` : undefined } : { width: width ? `${width}px` : undefined }),
  }
})
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
