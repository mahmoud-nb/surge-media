<script setup lang="ts" generic="T extends string">
/**
 * Choix exclusif présenté en cartes — boutons radio natifs dans un fieldset/legend :
 * flèches du clavier pour changer d'option, chaque option décrite (aria-describedby).
 *
 *   <UiRadioCards v-model="visibility" :legend="t('…')" :options="[{ value, label, description }]" />
 */
const props = defineProps<{
  legend: string
  options: { value: T, label: string, description?: string }[]
  /** Id du premier bouton radio (focus en cas d'erreur). */
  id?: string
  hint?: string
  /** Message d'erreur déjà traduit. */
  error?: string
  disabled?: boolean
  required?: boolean
  /** Nombre de colonnes à partir de la largeur « md ». */
  columns?: 2 | 3
}>()

const model = defineModel<T | ''>({ default: '' })
const name = useId()
const hintId = `${name}-hint`
const errorId = `${name}-error`

const describedBy = computed(() =>
  [props.hint && hintId, props.error && errorId].filter(Boolean).join(' ') || undefined,
)
</script>

<template>
  <fieldset :disabled="disabled" :aria-describedby="describedBy" class="grid gap-3">
    <legend class="mb-1 text-sm font-medium text-foreground">
      {{ legend }}<span v-if="required" class="text-destructive" aria-hidden="true"> *</span>
    </legend>
    <p v-if="hint" :id="hintId" class="-mt-1 text-sm text-muted-foreground">
      {{ hint }}
    </p>
    <div :class="cn('grid gap-3', columns === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3')">
      <label
        v-for="(option, index) in options"
        :key="option.value"
        :class="cn(
          'flex cursor-pointer flex-col gap-1.5 rounded-lg border border-input bg-surface p-4 transition-colors hover:bg-muted',
          'has-checked:border-2 has-checked:border-primary has-checked:bg-primary-soft',
          disabled && 'cursor-not-allowed opacity-60 hover:bg-surface',
        )"
      >
        <span class="flex items-center gap-2.5">
          <input
            :id="index === 0 ? id : undefined"
            v-model="model"
            type="radio"
            :name="name"
            :value="option.value"
            :required="required"
            :aria-describedby="option.description ? `${name}-${option.value}` : undefined"
            class="size-4 shrink-0 accent-primary"
          >
          <span class="text-sm font-semibold text-foreground">{{ option.label }}</span>
        </span>
        <span v-if="option.description" :id="`${name}-${option.value}`" class="text-sm text-muted-foreground">
          {{ option.description }}
        </span>
      </label>
    </div>
    <p v-if="error" :id="errorId" class="text-sm font-medium text-destructive">
      {{ error }}
    </p>
  </fieldset>
</template>
