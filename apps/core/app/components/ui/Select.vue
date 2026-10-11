<script setup lang="ts" generic="T extends string">
/**
 * Liste déroulante native stylée — <UiSelect v-model="role" :options="[{ value, label }]" />.
 * L'élément <select> natif garantit clavier, lecteurs d'écran et mobiles sans code ARIA.
 * Les attributs (id, name, aria-describedby…) sont transmis au <select>.
 */
import { ChevronDown } from '@lucide/vue'
import type { HTMLAttributes } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  options: { value: T | '', label: string }[]
  invalid?: boolean
  class?: HTMLAttributes['class']
}>()

const model = defineModel<T | ''>({ default: '' })
</script>

<template>
  <div :class="cn('relative', props.class)">
    <select
      v-model="model"
      v-bind="$attrs"
      :aria-invalid="invalid || undefined"
      class="block h-10 w-full min-w-0 appearance-none rounded-lg border border-input bg-surface py-0 pr-9 pl-3 text-base text-foreground shadow-xs sm:text-sm aria-invalid:border-2 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <ChevronDown class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
  </div>
</template>
