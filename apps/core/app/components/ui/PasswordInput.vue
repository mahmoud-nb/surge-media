<script setup lang="ts">
/**
 * Champ mot de passe avec bouton « Afficher » (aria-pressed) — s'utilise comme <UiInput>
 * dans un <UiFormField> ; `autocomplete` : current-password (connexion) ou new-password.
 */
import { Eye, EyeOff } from '@lucide/vue'

defineOptions({ inheritAttrs: false })

defineProps<{
  id?: string
  invalid?: boolean
}>()

const model = defineModel<string>({ default: '' })
const visible = ref(false)
const { t } = useI18n()
</script>

<template>
  <div class="relative">
    <UiInput
      :id="id"
      v-bind="$attrs"
      v-model="model"
      :invalid="invalid"
      :type="visible ? 'text' : 'password'"
      class="pr-12"
    />
    <button
      type="button"
      class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground"
      :aria-pressed="visible"
      :aria-controls="id"
      @click="visible = !visible"
    >
      <EyeOff v-if="visible" class="size-4" aria-hidden="true" />
      <Eye v-else class="size-4" aria-hidden="true" />
      <span class="sr-only">{{ t('form.showPassword') }}</span>
    </button>
  </div>
</template>
