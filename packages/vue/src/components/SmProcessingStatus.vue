<script setup lang="ts">
/**
 * État du traitement d'une vidéo par le serveur : texte (porteur du sens) et icône fixe (aucune animation
 * continue, WCAG 2.2.2), barre de progression nommée pendant un réencodage, raison d'un échec. Annonce
 * polie (`role="status"`) aux seules transitions : début, fin, échec. Toute la logique est dans le client
 * (`PROCESSING_ICONS`, `processingProgress`, `processingReason`, `processingAnnouncementKey`).
 */
import {
  formatPercent,
  type MediaProcessing,
  PROCESSING_ICONS,
  processingAnnouncementKey,
  processingProgress,
  processingReason,
  VISUALLY_HIDDEN,
} from '@surge-media/client'
import { computed, ref, watch } from 'vue'
import { useSurgeMedia } from '../context'
import { ICON_COMPONENTS } from '../icons'

const props = withDefaults(defineProps<{
  processing: MediaProcessing | null
  /** Icône seule (texte réservé aux lecteurs d'écran) : vignettes. */
  compact?: boolean
  /** Annoncer les transitions aux lecteurs d'écran. */
  live?: boolean
}>(), {
  live: true,
})

const { t, locale } = useSurgeMedia()

const status = computed(() => props.processing?.status ?? null)
const icon = computed(() => (status.value ? ICON_COMPONENTS[PROCESSING_ICONS[status.value]] : null))
const progress = computed(() => processingProgress(props.processing))
const reason = computed(() => processingReason(props.processing, t))

const announcement = ref('')
watch(status, (next, previous) => {
  const key = processingAnnouncementKey(next, previous)
  if (key) announcement.value = t(key)
})
</script>

<template>
  <span class="sm-status" :class="[status ? `sm-status--${status}` : null, { 'sm-status--compact': props.compact }]">
    <template v-if="status">
      <component :is="icon" class="sm-status__icon" />
      <span class="sm-status__label" :style="props.compact ? VISUALLY_HIDDEN : undefined">{{ t(`processing.states.${status}`) }}</span>
      <template v-if="!props.compact">
        <span v-if="progress !== null" class="sm-status__progress">
          <progress max="1" :value="progress" :aria-label="t('processing.progress')" />
          <span aria-hidden="true">{{ formatPercent(progress, locale) }}</span>
        </span>
        <span v-if="reason" class="sm-status__reason">{{ reason }}</span>
      </template>
    </template>
    <span v-if="props.live" role="status" :style="VISUALLY_HIDDEN">{{ announcement }}</span>
  </span>
</template>
