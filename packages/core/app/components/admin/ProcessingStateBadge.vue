<script setup lang="ts">
/**
 * État du traitement d'une vidéo (phase D3, § 37), commun à la carte de la médiathèque et à la section
 * « Traitement » de la fiche : même texte (`media.processing.states.*`), même couleur, même icône fixe
 * (aucune animation continue, WCAG 2.2.2). Le texte porte le sens ; couleur et icône ne sont que des
 * repères. Échec en « avertissement » : la vidéo reste servie (original, rendus déjà produits).
 */
import type { HTMLAttributes } from 'vue'
import { CircleCheck, Cog, Hourglass, TriangleAlert } from '@lucide/vue'
import type { ProcessingStateValue } from '#shared/utils/video-processing'

const props = defineProps<{
  state: ProcessingStateValue
  class?: HTMLAttributes['class']
}>()

const { t } = useI18n()
const BADGES = {
  PENDING: { variant: 'primary', icon: Hourglass },
  PROCESSING: { variant: 'primary', icon: Cog },
  READY: { variant: 'success', icon: CircleCheck },
  FAILED: { variant: 'warning', icon: TriangleAlert },
} as const
</script>

<template>
  <UiBadge :variant="BADGES[props.state].variant" :class="props.class">
    <component :is="BADGES[props.state].icon" class="size-3 shrink-0" aria-hidden="true" />
    {{ t(`media.processing.states.${props.state}`) }}
  </UiBadge>
</template>
