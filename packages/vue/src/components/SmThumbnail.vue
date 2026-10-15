<script setup lang="ts">
/**
 * Vignette carrée d'un média (galeries, sélecteurs) : image recadrée sur son point d'intérêt, affiche d'une
 * vidéo, sinon icône du genre ; durée d'une vidéo (visible, et en toutes lettres pour les lecteurs
 * d'écran) ; état du traitement (en attente, en cours, échec).
 */
import { formatClock, formatDuration, imageFormat, type Media } from '@surge-media/client'
import { computed, type CSSProperties, ref } from 'vue'
import { focusPosition, useTransformMode, VISUALLY_HIDDEN } from '../composables/image'
import { useSurgeMedia } from '../context'
import { IconFile, IconFilm, IconImage, IconPlay } from '../icons'
import { imageSourceSet } from '../image-sources'
import SmProcessingStatus from './SmProcessingStatus.vue'

const props = withDefaults(defineProps<{
  media: Media
  /** Côté de la vignette, en pixels CSS. */
  size?: number
  /** Texte alternatif (sinon celui du média ; vide si le contexte nomme déjà le média). */
  alt?: string
  loading?: 'lazy' | 'eager'
}>(), {
  size: 160,
  alt: undefined,
  loading: 'lazy',
})

const { settings, presets, defaults, locale, t } = useSurgeMedia()
const mode = useTransformMode(() => props.media)
const failed = ref(false)

const hasImage = computed(() => Boolean(props.media.urlTemplate) && !failed.value)
const set = computed(() => imageSourceSet({
  media: props.media,
  format: imageFormat(settings.value.formats, defaults.imageFormat),
  mode: mode.value,
  maxDimension: settings.value.maxDimension,
  presets: presets.value,
  width: props.size,
  height: props.size,
  // Préréglages seulement : l'aperçu (480 px) recadré par le navigateur.
  ...(mode.value === 'presets' ? { preset: 'preview' } : {}),
}))

const frame = computed<CSSProperties>(() => ({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  width: `${props.size}px`,
  height: `${props.size}px`,
  flex: 'none',
}))

const imageStyle = computed<CSSProperties>(() => ({
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: focusPosition(props.media.kind === 'video' && props.media.poster ? { ...props.media.poster, focalPoint: props.media.focalPoint } : props.media, 1),
}))

const icon = computed(() => props.media.kind === 'image' ? IconImage : props.media.kind === 'video' ? IconFilm : IconFile)
const kindLabel = computed(() => t(`thumbnail.kinds.${props.media.kind === 'image' || props.media.kind === 'video' ? props.media.kind : 'other'}`))
const alt = computed(() => props.alt ?? props.media.altText ?? '')
const showStatus = computed(() => props.media.processing && props.media.processing.status !== 'ready')
</script>

<template>
  <span class="sm-thumbnail" :class="`sm-thumbnail--${props.media.kind}`" :style="frame">
    <img
      v-if="hasImage"
      class="sm-thumbnail__image"
      :src="set.src"
      :srcset="set.srcset"
      :width="props.size"
      :height="props.size"
      :alt="alt"
      :loading="props.loading"
      decoding="async"
      :style="imageStyle"
      @error="failed = true"
    >
    <span v-else class="sm-thumbnail__placeholder" role="img" :aria-label="alt || kindLabel">
      <component :is="icon" :size="Math.max(16, Math.round(props.size / 4))" />
    </span>
    <span v-if="props.media.kind === 'video' && hasImage" class="sm-thumbnail__play" aria-hidden="true">
      <IconPlay :size="Math.max(12, Math.round(props.size / 8))" />
    </span>
    <template v-if="props.media.duration">
      <span class="sm-thumbnail__duration" aria-hidden="true">{{ formatClock(props.media.duration) }}</span>
      <span :style="VISUALLY_HIDDEN">{{ t('thumbnail.duration', { duration: formatDuration(props.media.duration, locale) }) }}</span>
    </template>
    <SmProcessingStatus v-if="showStatus" class="sm-thumbnail__status" :processing="props.media.processing" compact :live="false" />
  </span>
</template>
