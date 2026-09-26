<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue'
import { loginSchema, type LoginInput } from '#shared/schemas/auth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { login, can } = useAuth()

useSeoMeta({ title: () => t('login.meta.title'), robots: 'noindex, nofollow' })

const FIELDS = ['email', 'password'] as const
const FIELD_IDS: Record<keyof LoginInput, string> = { email: 'login-email', password: 'login-password' }

const form = reactive<LoginInput>({ email: '', password: '' })
const errors = ref<Partial<Record<keyof LoginInput, FieldError>>>({})
const serverError = ref<string>()
const submitting = ref(false)
const showPassword = ref(false)

function errorMessage(field: keyof LoginInput): string | undefined {
  const error = errors.value[field]
  return error ? t(error.key, error.params) : undefined
}

function clearError(field: keyof LoginInput) {
  if (errors.value[field]) errors.value = { ...errors.value, [field]: undefined }
}

/** Message traduit d'un échec de l'API (le détail technique n'est jamais affiché). */
function apiErrorMessage(error: unknown): string {
  const { statusCode: status, response } = (error ?? {}) as { statusCode?: number, response?: Response }
  if (status === 401) return t('login.errors.invalidCredentials')
  if (status === 429) {
    const seconds = Number(response?.headers.get('retry-after')) || 60
    return t('login.errors.tooManyAttempts', { minutes: Math.ceil(seconds / 60) })
  }
  if (status === 400) return t('login.errors.invalid')
  return t('login.errors.unexpected')
}

async function onSubmit() {
  serverError.value = undefined
  const result = loginSchema.safeParse(form)
  if (!result.success) {
    errors.value = fieldErrors(result.error)
    // Focus sur le premier champ en erreur : son message est lu via aria-describedby.
    const first = FIELDS.find(field => errors.value[field])
    if (first) document.getElementById(FIELD_IDS[first])?.focus()
    return
  }

  errors.value = {}
  submitting.value = true
  try {
    await login(result.data)
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

/** Page demandée avant la connexion, ou le tableau de bord si le rôle n'y a pas accès. */
function allowedTarget(target: string): string {
  const permission = router.resolve(target).meta.permission
  return permission && !can(permission) ? '/admin' : target
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

        <form class="mt-6 grid gap-5" novalidate @submit.prevent="onSubmit">
          <p class="text-sm text-muted-foreground">
            {{ t('form.requiredNote') }}
          </p>

          <UiFormField v-slot="field" :id="FIELD_IDS.email" :label="t('login.email.label')" :error="errorMessage('email')" required>
            <UiInput
              v-bind="field"
              v-model="form.email"
              type="email"
              name="email"
              autocomplete="username"
              inputmode="email"
              autocapitalize="none"
              spellcheck="false"
              @input="clearError('email')"
            />
          </UiFormField>

          <UiFormField v-slot="field" :id="FIELD_IDS.password" :label="t('login.password.label')" :error="errorMessage('password')" required>
            <div class="relative">
              <UiInput
                v-bind="field"
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                name="password"
                autocomplete="current-password"
                class="pr-12"
                @input="clearError('password')"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground"
                :aria-pressed="showPassword"
                :aria-controls="field.id"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" class="size-4" aria-hidden="true" />
                <Eye v-else class="size-4" aria-hidden="true" />
                <span class="sr-only">{{ t('login.password.show') }}</span>
              </button>
            </div>
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
