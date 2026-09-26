<script setup lang="ts">
/**
 * Choix du rôle : boutons radio natifs regroupés (fieldset/legend), chacun décrit par
 * les permissions qu'il accorde. Flèches du clavier pour changer de rôle.
 */
const props = defineProps<{
  legend: string
  /** Id du premier bouton radio (focus en cas d'erreur). */
  id?: string
  hint?: string
  /** Message d'erreur déjà traduit. */
  error?: string
  disabled?: boolean
  required?: boolean
}>()

const model = defineModel<Role | ''>({ default: '' })
const { t } = useI18n()
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
    <div class="grid gap-3 md:grid-cols-3">
      <label
        v-for="(role, index) in ROLES"
        :key="role"
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
            :value="role"
            :required="required"
            :aria-describedby="`${name}-${role}`"
            class="size-4 shrink-0 accent-primary"
          >
          <span class="text-sm font-semibold text-foreground">{{ t(`roles.${role}.label`) }}</span>
        </span>
        <span :id="`${name}-${role}`" class="text-sm text-muted-foreground">
          {{ t(`roles.${role}.description`) }}
        </span>
      </label>
    </div>
    <p v-if="error" :id="errorId" class="text-sm font-medium text-destructive">
      {{ error }}
    </p>
  </fieldset>
</template>
