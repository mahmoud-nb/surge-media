<script setup lang="ts">
import { loginSchema, type LoginInput } from '#shared/schemas/auth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { login, can } = useAuth()

useSeoMeta({ title: () => t('login.meta.title'), robots: 'noindex, nofollow' })

const FIELD_IDS = { email: 'login-email', password: 'login-password' } as const

const form = reactive<LoginInput>({ email: '', password: '' })
const { validate, message, clear } = useFormValidation(loginSchema, FIELD_IDS)
const serverError = ref<string>()
const submitting = ref(false)

/** Information transmise par la page précédente (valeurs connues uniquement). */
const notice = computed(() => {
  if (route.query.passwordSet === '1') return { variant: 'success' as const, message: t('login.notices.passwordSet') }
  if (route.query.expired === '1') return { variant: 'info' as const, message: t('login.notices.expired') }
  return null
})

/** Message traduit d'un échec de l'API (le détail technique n'est jamais affiché). */
function apiErrorMessage(error: unknown): string {
  const { status, retryAfter } = apiError(error)
  if (status === 401) return t('login.errors.invalidCredentials')
  if (status === 429) return t('login.errors.tooManyAttempts', { minutes: Math.ceil((retryAfter ?? 60) / 60) })
  if (status === 400) return t('login.errors.invalid')
  return t('login.errors.unexpected')
}

/** Page demandée avant la connexion, ou le tableau de bord si le rôle n'y a pas accès. */
function allowedTarget(target: string): string {
  const permission = router.resolve(target).meta.permission
  return permission && !can(permission) ? '/admin' : target
}

async function onSubmit() {
  serverError.value = undefined
  const credentials = validate(form)
  if (!credentials) return

  submitting.value = true
  try {
    await login(credentials)
  }
  catch (error) {
    serverError.value = apiErrorMessage(error)
    return
  }
  finally {
    submitting.value = false
  }
  await navigateTo(allowedTarget(safeAdminRedirect(route.query.redirect)))
}
</script>

<template>
  <div class="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
    <div class="w-full max-w-md">
      <div class="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        <h1 class="text-2xl font-semibold tracking-tight text-foreground">
          {{ t('login.title') }}
        </h1>
        <p class="mt-2 text-muted-foreground">
          {{ t('login.description') }}
        </p>

        <UiAlert v-if="serverError" variant="error" live="assertive" class="mt-6">
          {{ serverError }}
        </UiAlert>
        <UiAlert v-else-if="notice" :variant="notice.variant" live="polite" class="mt-6">
          {{ notice.message }}
        </UiAlert>

        <form class="mt-6 grid gap-5" novalidate @submit.prevent="onSubmit">
          <p class="text-sm text-muted-foreground">
            {{ t('form.requiredNote') }}
          </p>

          <UiFormField v-slot="field" :id="FIELD_IDS.email" :label="t('login.email.label')" :error="message('email')" required>
            <UiInput
              v-bind="field"
              v-model="form.email"
              type="email"
              name="email"
              autocomplete="username"
              inputmode="email"
              autocapitalize="none"
              spellcheck="false"
              @input="clear('email')"
            />
          </UiFormField>

          <UiFormField v-slot="field" :id="FIELD_IDS.password" :label="t('login.password.label')" :error="message('password')" required>
            <UiPasswordInput
              v-bind="field"
              v-model="form.password"
              name="password"
              autocomplete="current-password"
              @input="clear('password')"
            />
          </UiFormField>

          <UiButton type="submit" size="lg" class="mt-1 w-full" :loading="submitting">
            {{ t('login.submit') }}
          </UiButton>
          <p class="sr-only" role="status">
            {{ submitting ? t('login.submitting') : '' }}
          </p>
        </form>

        <p class="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
          {{ t('login.noAccount') }}
        </p>
      </div>
    </div>
  </div>
</template>
