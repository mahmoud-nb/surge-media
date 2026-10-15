<script setup lang="ts">
/**
 * État du traitement d'une vidéo par le serveur : texte (porteur du sens) et icône fixe (aucune animation
 * continue, WCAG 2.2.2), barre de progression nommée pendant un réencodage, raison d'un échec. Annonce
 * polie (`role="status"`) aux seules transitions : début, fin, échec.
 */
import { formatPercent, type MediaProcessing } from '@surge-media/client'
import { computed, ref, watch } from 'vue'
import { VISUALLY_HIDDEN } from '../composables/image'
import { useSurgeMedia } from '../context'
import { IconCircleCheck, IconCog, IconHourglass, IconTriangleAlert } from '../icons'

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

const ICONS = {
  pending: IconHourglass,
  processing: IconCog,
  ready: IconCircleCheck,
  failed: IconTriangleAlert,
} as const

const status = computed(() => props.processing?.status ?? null)
const progress = computed(() => status.value === 'processing' ? props.processing?.progress ?? null : null)
const reason = computed(() => {
  const code = props.processing?.error
  if (status.value !== 'failed' || !code) return null
  const text = t(`processing.errors.${code}`)
  return text === `processing.errors.${code}` ? null : text
})

const announcement = ref('')
watch(status, (next, previous) => {
  if (next === previous) return
  if (next === 'processing') announcement.value = t('processing.announce.started')
  else if (next === 'ready' && previous) announcement.value = t('processing.announce.ready')
  else if (next === 'failed') announcement.value = t('processing.announce.failed')
})
</script>

<template>
  <span class="sm-status" :class="[status ? `sm-status--${status}` : null, { 'sm-status--compact': props.compact }]">
    <template v-if="status">
      <component :is="ICONS[status]" class="sm-status__icon" />
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
