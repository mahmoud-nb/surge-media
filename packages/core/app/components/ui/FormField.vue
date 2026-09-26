<script setup lang="ts">
/**
 * Champ de formulaire accessible — <UiFormField>.
 * Relie libellé, aide et message d'erreur au contrôle, qui reçoit par le slot
 * `id`, `invalid`, `required` et `aria-describedby` :
 *
 *   <UiFormField v-slot="field" :label="t('…')" :error="errors.email" required>
 *     <UiInput v-bind="field" v-model="form.email" type="email" />
 *   </UiFormField>
 */
import { CircleAlert } from '@lucide/vue'

const props = defineProps<{
  label: string
  /** Identifiant du contrôle (généré si absent). */
  id?: string
  hint?: string
  /** Message d'erreur déjà traduit. */
  error?: string
  required?: boolean
}>()

const generatedId = useId()
const controlId = computed(() => props.id ?? generatedId)
const hintId = computed(() => `${controlId.value}-hint`)
const errorId = computed(() => `${controlId.value}-error`)

const describedBy = computed(() =>
  [props.hint && hintId.value, props.error && errorId.value].filter(Boolean).join(' ') || undefined,
)

// Objet passé au slot par v-bind : les clés à trait d'union (aria-describedby) sont
// conservées, alors que des props de slot déclarées une à une seraient mises en camelCase.
const control = computed(() => ({
  'id': controlId.value,
  'invalid': Boolean(props.error),
  'required': props.required,
  'aria-describedby': describedBy.value,
}))
</script>

<template>
  <div class="grid gap-1.5">
    <label :for="controlId" class="text-sm font-medium text-foreground">
      {{ label }}<span v-if="required" class="text-destructive" aria-hidden="true"> *</span>
    </label>
    <slot v-bind="control" />
    <p v-if="hint" :id="hintId" class="text-sm text-muted-foreground">
      {{ hint }}
    </p>
    <p v-if="error" :id="errorId" class="flex items-start gap-1.5 text-sm font-medium text-destructive">
      <CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>
  </div>
</template>
