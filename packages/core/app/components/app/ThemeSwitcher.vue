<script setup lang="ts">
/**
 * Choix du thème (système / clair / sombre) : groupe de boutons radio natifs,
 * donc navigation au clavier par les flèches et état annoncé sans ARIA spécifique.
 */
import { Monitor, Moon, Sun } from '@lucide/vue'

const { t } = useI18n()
const colorMode = useColorMode()
const name = useId()

const OPTIONS = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
] as const

const labels = computed(() => ({
  system: t('theme.system'),
  light: t('theme.light'),
  dark: t('theme.dark'),
}))
</script>

<template>
  <fieldset>
    <legend class="sr-only">
      {{ t('theme.label') }}
    </legend>
    <div class="inline-flex rounded-lg border border-border bg-muted p-0.5">
      <label v-for="option in OPTIONS" :key="option.value" :title="labels[option.value]" class="relative cursor-pointer">
        <input
          v-model="colorMode.preference"
          type="radio"
          :name="name"
          :value="option.value"
          class="peer sr-only"
        >
        <span
          class="flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:text-foreground peer-checked:border-input peer-checked:bg-surface peer-checked:text-foreground peer-checked:shadow-xs peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring forced-colors:peer-checked:bg-[Highlight] forced-colors:peer-checked:text-[HighlightText]"
        >
          <component :is="option.icon" class="size-4" aria-hidden="true" />
        </span>
        <span class="sr-only">{{ labels[option.value] }}</span>
      </label>
    </div>
  </fieldset>
</template>
