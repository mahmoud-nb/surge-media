<script setup lang="ts">
/**
 * Configuration de l'application d'authentification : QR code (image, doublée de la clé en texte et d'un
 * lien otpauth:// pour un téléphone), puis premier code qui active la double authentification.
 * `context` : `login` (connexion que la politique oblige à configurer : défi en cookie) ou `account`
 * (page « Mon compte » : mode sudo, dialogue de confirmation si besoin).
 */
import { normalizeTotpCode } from '#shared/utils/mfa'
import type { User } from '#auth-utils'

const props = defineProps<{ context: 'login' | 'account' }>()
const emit = defineEmits<{
  enabled: [result: { recoveryCodes: string[], user?: User }]
  /** Défi de connexion expiré : revenir au mot de passe. */
  expired: []
  /** Confirmation du mot de passe abandonnée (page « Mon compte »). */
  cancel: []
}>()

const { t } = useI18n()
const { $api } = useNuxtApp()
const reauth = useReauth()
const { mfaErrorCode, mfaErrorMessage } = useMfaErrors()

const formId = useId()
const codeId = `${formId}-code`
const setup = ref<{ secret: string, otpauthUri: string, qrSvg: string } | null>(null)
const loading = ref(false)
const code = ref('')
const codeError = ref<string>()
const serverError = ref<string>()
const submitting = ref(false)

const qrSrc = computed(() => setup.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.value.qrSvg)}` : '')

/** Requête de la configuration : sans session (connexion) ou avec, en mode sudo (« Mon compte »). */
function request<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  // Adresse dynamique : le type de la réponse est donné par l'appelant.
  if (props.context === 'login') return $fetch(url, { method: 'POST', body }) as Promise<T>
  return reauth.run(() => $api(url, { method: 'POST', body }) as Promise<T>)
}

async function prepare() {
  loading.value = true
  serverError.value = undefined
  code.value = ''
  codeError.value = undefined
  try {
    setup.value = await request('/api/auth/mfa/setup')
  }
  catch (error) {
    if (isReauthCancelled(error)) return emit('cancel')
    if (mfaErrorCode(error) === 'MFA_CHALLENGE_EXPIRED') return emit('expired')
    serverError.value = mfaErrorMessage(error)
  }
  finally {
    loading.value = false
  }
}

async function onSubmit() {
  if (submitting.value) return
  serverError.value = undefined
  const normalized = normalizeTotpCode(code.value)
  if (!normalized) {
    codeError.value = t('mfa.errors.MFA_CODE_INVALID')
    return
  }
  submitting.value = true
  try {
    emit('enabled', await request<{ recoveryCodes: string[], user?: User }>('/api/auth/mfa/enable', { code: normalized }))
  }
  catch (error) {
    if (isReauthCancelled(error)) return
    const errorCode = mfaErrorCode(error)
    if (errorCode === 'MFA_CHALLENGE_EXPIRED') return emit('expired')
    if (errorCode === 'MFA_CODE_INVALID') codeError.value = mfaErrorMessage(error)
    else serverError.value = mfaErrorMessage(error)
  }
  finally {
    submitting.value = false
  }
}

onMounted(prepare)
</script>

<template>
  <div class="grid gap-5">
    <UiAlert v-if="serverError" variant="error" live="assertive">
      {{ serverError }}
      <UiButton v-if="!setup || serverError === t('mfa.errors.MFA_SETUP_EXPIRED')" variant="outline" size="sm" class="mt-3" @click="prepare">
        {{ t('mfa.setup.restart') }}
      </UiButton>
    </UiAlert>

    <p v-if="loading" role="status" class="text-sm text-muted-foreground">
      {{ t('mfa.setup.loading') }}
    </p>

    <template v-else-if="setup">
      <p class="text-sm text-muted-foreground">
        {{ t('mfa.setup.intro') }}
      </p>
      <ol class="grid list-decimal gap-4 pl-5 text-sm text-foreground marker:font-semibold">
        <!-- Le contenu de chaque étape est dans un bloc : un <li> en grille perdrait son numéro. -->
        <li class="pl-1">
          <div class="grid gap-3">
            <span>{{ t('mfa.setup.step1') }}</span>
            <!-- Toujours noir sur blanc, même en thème sombre : les applications lisent mal un QR code inversé. -->
            <img :src="qrSrc" :alt="t('mfa.setup.qrAlt')" width="176" height="176" class="size-44 rounded-lg border border-border bg-white p-2">
            <div class="grid gap-1">
              <span class="font-medium">{{ t('mfa.setup.key') }}</span>
              <div class="flex flex-wrap items-center gap-2">
                <code class="rounded-md bg-muted px-2 py-1 font-mono text-sm break-all" translate="no">{{ setup.secret }}</code>
                <UiCopyButton :value="setup.secret.replace(/ /g, '')" :label="t('mfa.setup.copyKey')" />
              </div>
            </div>
            <a :href="setup.otpauthUri" class="text-sm font-medium text-primary underline underline-offset-4 sm:hidden">
              {{ t('mfa.setup.openLink') }}
            </a>
          </div>
        </li>
        <li class="pl-1">
          <div class="grid gap-3">
            <span>{{ t('mfa.setup.step2') }}</span>
            <form :id="formId" novalidate class="grid gap-3 sm:max-w-xs" @submit.prevent="onSubmit">
              <UiFormField :id="codeId" v-slot="field" :label="t('mfa.setup.code')" :error="codeError" required>
                <UiInput
                  v-bind="field"
                  v-model="code"
                  name="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  spellcheck="false"
                  class="font-mono tracking-widest"
                  @input="codeError = undefined"
                />
              </UiFormField>
              <UiButton type="submit" :loading="submitting">
                {{ t('mfa.setup.submit') }}
              </UiButton>
            </form>
          </div>
        </li>
      </ol>
    </template>
  </div>
</template>
