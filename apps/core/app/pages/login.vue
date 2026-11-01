<script setup lang="ts">
/**
 * Connexion en étapes : mot de passe, puis, si le compte a la double authentification, code de
 * l'application ou code de secours ; si la politique l'exige d'un compte qui ne l'a pas, configuration
 * de l'application et codes de secours avant d'entrer (server/utils/mfa.ts). Le focus va au titre de
 * chaque nouvelle étape. En mode démo, les comptes de démonstration sont affichés sous le formulaire, avec un
 * bouton qui le remplit.
 */
import { loginSchema, type LoginInput } from '#shared/schemas/auth'
import { normalizeTotpCode } from '#shared/utils/mfa'

type Step = 'password' | 'code' | 'setup' | 'codes' | 'recovery'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { login, can, refresh } = useAuth()
const { mfaErrorCode, mfaErrorMessage } = useMfaErrors()
const trustDays = trustedDeviceDays(useRuntimeConfig().public.trustedDeviceDays)

useSeoMeta({ title: () => t('login.meta.title'), robots: 'noindex, nofollow' })

const FIELD_IDS = { email: 'login-email', password: 'login-password' } as const

const step = ref<Step>('password')
const heading = useTemplateRef<HTMLHeadingElement>('heading')
const form = reactive<LoginInput>({ email: '', password: '' })
const { validate, message, clear } = useFormValidation(loginSchema, FIELD_IDS)
const serverError = ref<string>()
const submitting = ref(false)
const demo = useDemoInfo()

/** Mode démo : remplit le formulaire avec un compte de démonstration, puis place le focus sur « Se connecter ». */
function fillDemoAccount(account: { email: string, password: string }) {
  form.email = account.email
  form.password = account.password
  clear('email')
  clear('password')
  serverError.value = undefined
  nextTick(() => document.getElementById('login-submit')?.focus())
}

/** Information transmise par la page précédente (valeurs connues uniquement). */
const notice = computed(() => {
  if (route.query.passwordSet === '1') return { variant: 'success' as const, message: t('login.notices.passwordSet') }
  if (route.query.expired === '1') return { variant: 'info' as const, message: t('login.notices.expired') }
  return null
})

const title = computed(() => ({
  password: t('login.title'),
  code: t('login.mfa.title'),
  setup: t('login.mfa.setupTitle'),
  codes: t('login.mfa.codesTitle'),
  recovery: t('login.mfa.recoveryUsedTitle'),
})[step.value])

watch(step, async () => {
  serverError.value = undefined
  await nextTick()
  heading.value?.focus()
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

async function enter() {
  await refresh()
  await navigateTo(allowedTarget(safeAdminRedirect(route.query.redirect)))
}

/** Défi expiré (délai, trop d'essais) : retour au mot de passe, avec le message. */
function backToPassword(expired = false) {
  step.value = 'password'
  form.password = ''
  nextTick(() => {
    if (expired) serverError.value = t('login.mfa.expired')
  })
}

async function onSubmit() {
  serverError.value = undefined
  const credentials = validate(form)
  if (!credentials) return

  submitting.value = true
  try {
    const { mfa } = await login(credentials)
    if (mfa) {
      step.value = mfa
      return
    }
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

// ─── Second facteur ──────────────────────────────────────────────────────────

const codeId = 'login-mfa-code'
const useRecovery = ref(false)
const code = ref('')
const codeError = ref<string>()
const trustDevice = ref(false)
const recoveryLeft = ref(0)

function toggleRecovery() {
  useRecovery.value = !useRecovery.value
  code.value = ''
  codeError.value = undefined
  nextTick(() => document.getElementById(codeId)?.focus())
}

async function onVerify() {
  if (submitting.value) return
  serverError.value = undefined
  const value = useRecovery.value ? code.value.trim() : normalizeTotpCode(code.value)
  if (!value) {
    codeError.value = t('mfa.errors.MFA_CODE_INVALID')
    return
  }
  submitting.value = true
  try {
    const body = useRecovery.value ? { recoveryCode: value } : { code: value, trustDevice: trustDays > 0 && trustDevice.value }
    const result = await $fetch<{ recoveryCodesLeft?: number }>('/api/auth/mfa/verify', { method: 'POST', body })
    if (result.recoveryCodesLeft !== undefined) {
      recoveryLeft.value = result.recoveryCodesLeft
      await refresh()
      step.value = 'recovery'
      return
    }
    await enter()
  }
  catch (error) {
    const errorCode = mfaErrorCode(error)
    if (errorCode === 'MFA_CHALLENGE_EXPIRED') backToPassword(true)
    else if (errorCode === 'MFA_CODE_INVALID') codeError.value = mfaErrorMessage(error)
    else serverError.value = mfaErrorMessage(error)
  }
  finally {
    submitting.value = false
  }
}

// ─── Configuration exigée par la politique ──────────────────────────────────

const recoveryCodes = ref<string[]>([])

function onEnabled(result: { recoveryCodes: string[] }) {
  recoveryCodes.value = result.recoveryCodes
  step.value = 'codes'
}
</script>

<template>
  <div class="flex flex-1 items-center justify-center px-4 py-12 sm:py-20">
    <div class="w-full" :class="step === 'setup' || step === 'codes' ? 'max-w-lg' : 'max-w-md'">
      <div class="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        <h1 ref="heading" tabindex="-1" class="text-2xl font-semibold tracking-tight text-foreground outline-none">
          {{ title }}
        </h1>

        <!-- Étape 1 : adresse et mot de passe -->
        <template v-if="step === 'password'">
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

            <UiFormField :id="FIELD_IDS.email" v-slot="field" :label="t('login.email.label')" :error="message('email')" required>
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

            <UiFormField :id="FIELD_IDS.password" v-slot="field" :label="t('login.password.label')" :error="message('password')" required>
              <UiPasswordInput
                v-bind="field"
                v-model="form.password"
                name="password"
                autocomplete="current-password"
                @input="clear('password')"
              />
            </UiFormField>

            <UiButton id="login-submit" type="submit" size="lg" class="mt-1 w-full" :loading="submitting">
              {{ t('login.submit') }}
            </UiButton>
            <p class="sr-only" role="status">
              {{ submitting ? t('login.submitting') : '' }}
            </p>
          </form>

          <p class="mt-6 border-t border-border pt-5 text-sm text-muted-foreground">
            {{ t('login.noAccount') }}
          </p>
        </template>

        <!-- Étape 2 : code de l'application ou code de secours -->
        <template v-else-if="step === 'code'">
          <p class="mt-2 text-muted-foreground">
            {{ useRecovery ? t('login.mfa.recoveryDescription') : t('login.mfa.description') }}
          </p>

          <UiAlert v-if="serverError" variant="error" live="assertive" class="mt-6">
            {{ serverError }}
          </UiAlert>

          <form class="mt-6 grid gap-5" novalidate @submit.prevent="onVerify">
            <UiFormField :id="codeId" v-slot="field" :label="useRecovery ? t('login.mfa.recoveryCode') : t('login.mfa.code')" :error="codeError" required>
              <UiInput
                v-bind="field"
                :key="useRecovery ? 'recovery' : 'app'"
                v-model="code"
                name="code"
                :inputmode="useRecovery ? 'text' : 'numeric'"
                :autocomplete="useRecovery ? 'off' : 'one-time-code'"
                autocapitalize="none"
                spellcheck="false"
                autofocus
                class="font-mono tracking-widest"
                @input="codeError = undefined"
              />
            </UiFormField>

            <div v-if="trustDays > 0 && !useRecovery" class="grid gap-1">
              <label class="flex cursor-pointer items-start gap-2.5 text-sm font-medium text-foreground">
                <input
                  v-model="trustDevice"
                  type="checkbox"
                  name="trust-device"
                  aria-describedby="login-mfa-trust-hint"
                  class="mt-0.5 size-4 shrink-0 accent-primary"
                >
                {{ t('reauth.trustDevice', { days: trustDays }, trustDays) }}
              </label>
              <p id="login-mfa-trust-hint" class="pl-6.5 text-sm text-muted-foreground">
                {{ t('login.mfa.trustDeviceHint') }}
              </p>
            </div>

            <UiButton type="submit" size="lg" class="w-full" :loading="submitting">
              {{ t('login.mfa.submit') }}
            </UiButton>
            <p class="sr-only" role="status">
              {{ submitting ? t('login.mfa.submitting') : '' }}
            </p>
          </form>

          <div class="mt-6 flex flex-wrap justify-between gap-3 border-t border-border pt-5">
            <UiButton variant="ghost" size="sm" @click="toggleRecovery">
              {{ useRecovery ? t('login.mfa.useApp') : t('login.mfa.useRecovery') }}
            </UiButton>
            <UiButton variant="ghost" size="sm" @click="backToPassword()">
              {{ t('login.mfa.back') }}
            </UiButton>
          </div>
        </template>

        <!-- Configuration exigée par la politique -->
        <template v-else-if="step === 'setup'">
          <p class="mt-2 mb-6 text-muted-foreground">
            {{ t('login.mfa.setupDescription') }}
          </p>
          <AdminMfaSetup context="login" @enabled="onEnabled" @expired="backToPassword(true)" />
        </template>

        <!-- Codes de secours remis à l'activation -->
        <div v-else-if="step === 'codes'" class="mt-4">
          <AdminMfaRecoveryCodes :codes="recoveryCodes" :email="form.email" @continue="enter" />
        </div>

        <!-- Connexion par un code de secours : codes restants -->
        <template v-else>
          <UiAlert :variant="recoveryLeft <= RECOVERY_CODES_LOW ? 'warning' : 'info'" live="polite" class="mt-6">
            {{ t('login.mfa.recoveryUsed', { count: recoveryLeft }, recoveryLeft) }}
          </UiAlert>
          <p class="mt-4 text-sm text-muted-foreground">
            {{ t('login.mfa.recoveryUsedHint') }}
          </p>
          <UiButton size="lg" class="mt-6 w-full" @click="enter">
            {{ t('login.mfa.continue') }}
          </UiButton>
        </template>
      </div>

      <!-- Mode démo : comptes partagés par tous les visiteurs -->
      <section
        v-if="demo && step === 'password' && (demo.accounts.length || demo.contactUrl)"
        aria-labelledby="demo-accounts-title"
        class="mt-6 rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8"
      >
        <h2 id="demo-accounts-title" class="text-lg font-semibold text-foreground">
          {{ t('demo.accounts.title') }}
        </h2>
        <template v-if="demo.accounts.length">
          <p class="mt-1 text-sm text-muted-foreground">
            {{ t('demo.accounts.description') }}
          </p>
          <ul class="mt-4 grid gap-3">
            <li v-for="account in demo.accounts" :key="account.email" class="grid justify-items-start gap-3 rounded-lg border border-border p-4">
              <dl class="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt class="text-muted-foreground">
                  {{ t('demo.accounts.role') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ account.role ? t(`roles.${account.role}.label`) : t('demo.accounts.unknownRole') }}
                </dd>
                <dt class="text-muted-foreground">
                  {{ t('login.email.label') }}
                </dt>
                <dd class="font-mono wrap-anywhere text-foreground">
                  {{ account.email }}
                </dd>
                <dt class="text-muted-foreground">
                  {{ t('login.password.label') }}
                </dt>
                <dd class="font-mono wrap-anywhere text-foreground">
                  {{ account.password }}
                </dd>
              </dl>
              <UiButton
                variant="outline"
                size="sm"
                :aria-label="t('demo.accounts.useLabel', { role: account.role ? t(`roles.${account.role}.label`) : account.email })"
                @click="fillDemoAccount(account)"
              >
                {{ t('demo.accounts.use') }}
              </UiButton>
            </li>
          </ul>
        </template>
        <i18n-t
          v-if="demo.contactUrl"
          keypath="demo.accounts.contact"
          scope="global"
          tag="p"
          :class="demo.accounts.length ? 'mt-5 border-t border-border pt-4 text-sm text-muted-foreground' : 'mt-2 text-sm text-muted-foreground'"
        >
          <template #link>
            <a :href="demo.contactUrl" class="rounded font-medium text-primary underline underline-offset-2 hover:no-underline">{{ t('demo.accounts.contactLink') }}</a>
          </template>
        </i18n-t>
      </section>
    </div>
  </div>
</template>
