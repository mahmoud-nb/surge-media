<script setup lang="ts">
/**
 * Bouton « Copier » compact (tableaux, listes) : la confirmation est annoncée (role="status").
 * `label` précise l'objet copié pour les lecteurs d'écran ; il doit commencer par le texte
 * visible du bouton (WCAG 2.5.3), ex. « Copier la clé publique Site vitrine ».
 */
import { Check, Copy } from '@lucide/vue'

const props = defineProps<{
  value: string
  label?: string
}>()

const { t } = useI18n()
const copied = ref(false)
const failed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  clearTimeout(timer)
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    failed.value = false
  }
  catch {
    copied.value = false
    failed.value = true
  }
  timer = setTimeout(() => {
    copied.value = false
    failed.value = false
  }, 5000)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <span class="inline-flex items-center gap-2">
    <UiButton variant="outline" size="sm" :aria-label="label" @click="copy">
      <Check v-if="copied" aria-hidden="true" />
      <Copy v-else aria-hidden="true" />
      {{ t('common.copy') }}
    </UiButton>
    <span class="sr-only" role="status">{{ copied ? t('common.copied') : failed ? t('common.copyFailed') : '' }}</span>
  </span>
</template>
