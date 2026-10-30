<script setup lang="ts">
/**
 * Valeur à copier (lien, identifiant…) : champ en lecture seule + bouton « Copier ».
 * La confirmation est annoncée (role="status") ; si le presse-papiers est indisponible
 * (HTTP, permission refusée), le texte est sélectionné pour une copie manuelle.
 * Emplacement `actions` : autres boutons à côté de « Copier » (ex. envoi par e-mail).
 */
import { Check, Copy } from '@lucide/vue'

const props = defineProps<{
  label: string
  value: string
  /** Texte du bouton ; « Copier » par défaut. */
  copyLabel?: string
  /** Aide sous le champ, reliée à lui (aria-describedby). */
  hint?: string
}>()

const { t } = useI18n()
const inputId = useId()
const hintId = `${inputId}-hint`
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function select() {
  const input = document.getElementById(inputId)
  if (input instanceof HTMLInputElement) {
    input.focus()
    input.select()
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 5000)
  }
  catch {
    select()
  }
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="grid gap-1.5">
    <label :for="inputId" class="text-sm font-medium text-foreground">{{ label }}</label>
    <div class="flex flex-col gap-2 sm:flex-row">
      <UiInput :id="inputId" :model-value="value" readonly :aria-describedby="hint ? hintId : undefined" class="font-mono text-xs sm:text-xs" @focus="select" />
      <UiButton variant="outline" class="shrink-0" @click="copy">
        <Check v-if="copied" aria-hidden="true" />
        <Copy v-else aria-hidden="true" />
        {{ copyLabel ?? t('common.copy') }}
      </UiButton>
      <slot name="actions" />
    </div>
    <p v-if="hint" :id="hintId" class="text-sm text-muted-foreground">
      {{ hint }}
    </p>
    <p class="min-h-5 text-sm font-medium text-success" role="status">
      {{ copied ? t('common.copied') : '' }}
    </p>
  </div>
</template>
