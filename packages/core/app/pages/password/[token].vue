<script setup lang="ts">
import { CircleAlert } from '@lucide/vue'
import { PASSWORD_MIN_LENGTH } from '#shared/schemas/auth'
import { newPasswordSchema, type NewPasswordInput } from '#shared/schemas/users'

const { t } = useI18n()
const route = useRoute()

const token = computed(() => String(route.params.token))
const { data, error } = await useFetch(() => `/api/auth/password/${token.value}`)

/** Lien inconnu, expiré ou déjà utilisé (constaté au chargement ou à l'envoi). */
const invalid = ref(Boolean(error.value))
const kind = computed(() => (data.value?.purpose === 'RESET' ? 'reset' : 'invitation'))

useSeoMeta({
  title: () => (invalid.value ? t('password.invalid.title') : t(`password.${kind.value}.title`)),
  robots: 'noindex, nofollow',
})

const FIELD_IDS = { password: 'new-password', confirmation: 'new-password-confirmation' } as const
const form = reactive<NewPasswordInput>({ password: '', confirmation: '' })
const { validate, message, clear } = useFormValidation(newPasswordSchema, FIELD_IDS)
const serverError = ref<string>()
const submitting = ref(false)

async function onSubmit() {
  serverError.value = undefined
  const input = validate(form)
  if (!input) return

  submitting.value = true
  try {
    await $fetch(`/api/auth/password/${token.value}`, { method: 'POST', body: input })
    await navigateTo({ path: '/login', query: { passwordSet: '1' } })
  }
  catch (err) {
    if (apiError(err).code === 'TOKEN_INVALID') invalid.value = true
    else serverError.value = t('common.unexpectedError')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
    <div class="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
      <template v-if="invalid || !data">
        <CircleAlert class="size-8 text-destructive" aria-hidden="true" />
        <h1 class="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          {{ t('password.invalid.title') }}
        </h1>
        <p class="mt-2 text-muted-foreground">
          {{ t('password.invalid.description') }}
        </p>
        <UiButton to="/login" variant="outline" class="mt-6">
          {{ t('password.backToLogin') }}
        </UiButton>
      </template>

      <template v-else>
        <h1 class="text-2xl font-semibold tracking-tight text-foreground">
          {{ t(`password.${kind}.title`) }}
        </h1>
        <p class="mt-2 text-muted-foreground">
          {{ t(`password.${kind}.description`) }}
        </p>

        <UiAlert v-if="serverError" variant="error" live="assertive" class="mt-6">
          {{ serverError }}
        </UiAlert>

        <form class="mt-6 grid gap-5" novalidate @submit.prevent="onSubmit">
          <p class="text-sm text-muted-foreground">
            {{ t('form.requiredNote') }}
          </p>

          <!-- Identifiant en lecture seule : permet aux gestionnaires de mots de passe d'associer le compte. -->
          <UiFormField v-slot="field" :label="t('login.email.label')">
            <UiInput v-bind="field" :model-value="data.email" type="email" name="email" autocomplete="username" readonly />
          </UiFormField>

          <UiFormField
            v-slot="field"
            :id="FIELD_IDS.password"
            :label="t('password.fields.password')"
            :hint="t('password.fields.passwordHint', { min: PASSWORD_MIN_LENGTH })"
            :error="message('password')"
            required
          >
            <UiPasswordInput v-bind="field" v-model="form.password" name="password" autocomplete="new-password" @input="clear('password')" />
          </UiFormField>

          <UiFormField v-slot="field" :id="FIELD_IDS.confirmation" :label="t('password.fields.confirmation')" :error="message('confirmation')" required>
            <UiPasswordInput v-bind="field" v-model="form.confirmation" name="confirmation" autocomplete="new-password" @input="clear('confirmation')" />
          </UiFormField>

          <UiButton type="submit" size="lg" class="mt-1 w-full" :loading="submitting">
            {{ t(`password.${kind}.submit`) }}
          </UiButton>
          <p class="sr-only" role="status">
            {{ submitting ? t('common.saving') : '' }}
          </p>
        </form>
      </template>
    </div>
  </div>
</template>
