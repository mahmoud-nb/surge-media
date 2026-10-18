<script setup lang="ts">
/**
 * Vignette carrée d'un média (galeries, sélecteurs) : image recadrée sur son point d'intérêt, affiche d'une
 * vidéo, sinon icône du genre ; durée d'une vidéo (visible, et en toutes lettres pour les lecteurs
 * d'écran) ; état du traitement (en attente, en cours, échec). Toute la logique est dans le client
 * (`thumbnailSource`, `kindIcon`, styles en ligne).
 */
import {
  formatClock,
  formatDuration,
  kindIcon,
  kindLabelKey,
  type Media,
  processingVisible,
  thumbnailFrameStyle,
  thumbnailIconSizes,
  thumbnailImageStyle,
  thumbnailSource,
  VISUALLY_HIDDEN,
} from '@surge-media/client'
import { computed, type CSSProperties, ref } from 'vue'
import { useDisplaySettings, useSurgeMedia } from '../context'
import { ICON_COMPONENTS, IconPlay } from '../icons'
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

const { locale, t } = useSurgeMedia()
const display = useDisplaySettings()
const failed = ref(false)

const hasImage = computed(() => Boolean(props.media.urlTemplate) && !failed.value)
const set = computed(() => thumbnailSource(props.media, props.size, display.value))
const frame = computed<CSSProperties>(() => thumbnailFrameStyle(props.size))
const imageStyle = computed<CSSProperties>(() => thumbnailImageStyle(props.media))
const iconSizes = computed(() => thumbnailIconSizes(props.size))
const icon = computed(() => ICON_COMPONENTS[kindIcon(props.media.kind)])
const kindLabel = computed(() => t(kindLabelKey(props.media.kind)))
const alt = computed(() => props.alt ?? props.media.altText ?? '')
const showStatus = computed(() => processingVisible(props.media.processing))
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
      <component :is="icon" :size="iconSizes.kind" />
    </span>
    <span v-if="props.media.kind === 'video' && hasImage" class="sm-thumbnail__play" aria-hidden="true">
      <IconPlay :size="iconSizes.play" />
    </span>
    <template v-if="props.media.duration">
      <span class="sm-thumbnail__duration" aria-hidden="true">{{ formatClock(props.media.duration) }}</span>
      <span :style="VISUALLY_HIDDEN">{{ t('thumbnail.duration', { duration: formatDuration(props.media.duration, locale) }) }}</span>
    </template>
    <SmProcessingStatus v-if="showStatus" class="sm-thumbnail__status" :processing="props.media.processing" compact :live="false" />
  </span>
</template>
