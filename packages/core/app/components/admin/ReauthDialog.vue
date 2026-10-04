<script setup lang="ts">
/**
 * Boîte de dialogue de confirmation du mot de passe, ouverte par useReauth().run() quand l'API
 * exige une saisie récente (403 REAUTH_REQUIRED). Le focus va au champ ; Échap ou « Annuler »
 * abandonnent l'action ; une confirmation réussie la rejoue. Case « Faire confiance à cet appareil »
 * (décochée à chaque ouverture) si l'option est active (NUXT_PUBLIC_TRUSTED_DEVICE_DAYS).
 */
import { confirmPasswordSchema } from '#shared/schemas/credentials'

const { t } = useI18n()
const { $api } = useNuxtApp()
const { user } = useAuth()
const { open, settle } = useReauth()
const trustDays = trustedDeviceDays(useRuntimeConfig().public.trustedDeviceDays)

const formId = useId()
const FIELD_IDS = { password: `${formId}-password` } as const
const trustHintId = `${formId}-trust-hint`
const form = reactive({ password: '', trustDevice: false })
const { validate, message, clear, setError } = useFormValidation(confirmPasswordSchema, FIELD_IDS)
const serverError = ref<string>()
const submitting = ref(false)

watch(open, (value) => {
  if (value) {
    form.password = ''
    form.trustDevice = false
    serverError.value = undefined
    clear('password')
  }
  else {
    // Fermeture par Échap ou « Annuler » : l'action est abandonnée (sans effet si déjà confirmée).
    settle(false)
  }
})

async function onSubmit() {
  if (submitting.value) return
  serverError.value = undefined
  const input = validate(form)
  if (!input) return
  submitting.value = true
  try {
    await $api('/api/auth/confirm-password', { method: 'POST', body: { ...input, trustDevice: trustDays > 0 && form.trustDevice } })
    settle(true)
  }
  catch (error) {
    const { code, status, retryAfter } = apiError(error)
    if (code === 'PASSWORD_INCORRECT') setError('password', 'reauth.incorrect')
    else if (status === 429) serverError.value = t('reauth.tooManyAttempts', { minutes: Math.ceil((retryAfter ?? 60) / 60) })
    else serverError.value = t('common.unexpectedError')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UiDialog v-model:open="open" :title="t('reauth.title')" :description="t('reauth.description')">
    <form :id="formId" novalidate class="grid gap-4" @submit.prevent="onSubmit">
      <!-- Identifiant associé, pour les gestionnaires de mots de passe. -->
      <input type="email" name="username" autocomplete="username" :value="user?.email ?? ''" hidden>
      <UiAlert v-if="serverError" variant="error" live="assertive">
        {{ serverError }}
      </UiAlert>
      <UiFormField v-slot="field" :id="FIELD_IDS.password" :label="t('reauth.password')" :error="message('password')" required>
        <UiPasswordInput
          v-bind="field"
          v-model="form.password"
          name="password"
          autocomplete="current-password"
          autofocus
          @input="clear('password')"
        />
      </UiFormField>
      <div v-if="trustDays > 0" class="grid gap-1">
        <label class="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-foreground">
          <input
            v-model="form.trustDevice"
            type="checkbox"
            name="trust-device"
            :aria-describedby="trustHintId"
            class="mt-0.5 size-4 shrink-0 accent-primary"
          >
          {{ t('reauth.trustDevice', { days: trustDays }, trustDays) }}
        </label>
        <p :id="trustHintId" class="pl-6.5 text-sm text-muted-foreground">
          {{ t('reauth.trustDeviceHint') }}
        </p>
      </div>
    </form>
    <template #actions>
      <UiButton variant="outline" @click="open = false">
        {{ t('common.cancel') }}
      </UiButton>
      <UiButton type="submit" :form="formId" :loading="submitting">
        {{ t('reauth.confirm') }}
      </UiButton>
    </template>
  </UiDialog>
</template>
