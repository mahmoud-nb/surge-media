<script setup lang="ts">
/**
 * Champ de saisie — <UiInput v-model="…">.
 * Les attributs (id, type, autocomplete, aria-describedby…) sont transmis à <input>.
 * À placer dans <UiFormField> qui fournit le libellé, l'aide et l'erreur associés.
 */
import type { HTMLAttributes } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** Valeur refusée : bordure d'erreur et aria-invalid. */
  invalid?: boolean
  class?: HTMLAttributes['class']
}>()

const model = defineModel<string>({ default: '' })
</script>

<template>
  <input
    v-model="model"
    v-bind="$attrs"
    :aria-invalid="invalid || undefined"
    :class="cn(
      'block h-10 w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-base text-foreground shadow-xs transition-colors sm:text-sm',
      'placeholder:text-muted-foreground',
      'focus-visible:border-ring',
      'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
      'aria-invalid:border-destructive aria-invalid:border-2',
      props.class,
    )"
  >
</template>
