<script setup lang="ts">
/**
 * « Mon compte » (tous les rôles) : identité et double authentification — activer (application puis
 * codes de secours), régénérer les codes, désactiver avec un code. Actions en mode sudo (dialogue de
 * confirmation du mot de passe au besoin). Architecture : .claude/architecture-mfa.md § 6.
 */
import { ShieldCheck, ShieldOff } from '@lucide/vue'
import { normalizeTotpCode } from '#shared/utils/mfa'

definePageMeta({ layout: 'admin' })

const { t, locale } = useI18n()
const { $api } = useNuxtApp()
const { user } = useAuth()
const reauth = useReauth()
const { mfaErrorCode, mfaErrorMessage } = useMfaErrors()

useSeoMeta({ title: () => t('account.meta.title') })

const { data: mfa, refresh } = await useApiFetch('/api/auth/mfa')

const mode = ref<'idle' | 'setup' | 'codes'>('idle')
const codes = ref<string[]>([])
const status = ref<{ variant: 'success' | 'error', message: string } | null>(null)

const enabledDate = computed(() => {
  const value = mfa.value?.enabledAt
  return value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(value)) : ''
})
const codesLeft = computed(() => mfa.value?.recoveryCodesLeft ?? 0)

function startSetup() {
  status.value = null
  mode.value = 'setup'
}

async function onEnabled(result: { recoveryCodes: string[] }) {
  codes.value = result.recoveryCodes
  mode.value = 'codes'
  status.value = { variant: 'success', message: t('account.mfa.enabledDone') }
  await refresh()
}

function onCodesSaved() {
  mode.value = 'idle'
  codes.value = []
}

const regenerating = ref(false)
async function regenerate() {
  status.value = null
  regenerating.value = true
  try {
    const result = await reauth.run(() => $api('/api/auth/mfa/recovery-codes', { method: 'POST' }))
    codes.value = result.recoveryCodes
    mode.value = 'codes'
    status.value = { variant: 'success', message: t('account.mfa.regeneratedDone') }
    await refresh()
  }
  catch (error) {
    if (!isReauthCancelled(error)) status.value = { variant: 'error', message: mfaErrorMessage(error) }
  }
  finally {
    regenerating.value = false
  }
}

// ─── Désactivation (dialogue : un code prouve la possession du second facteur) ──

const disableOpen = ref(false)
const disableFormId = useId()
const disableCodeId = `${disableFormId}-code`
const disableWithRecovery = ref(false)
const disableCode = ref('')
const disableError = ref<string>()
const disableServerError = ref<string>()
const disabling = ref(false)

function openDisable() {
  status.value = null
  disableWithRecovery.value = false
  disableCode.value = ''
  disableError.value = undefined
  disableServerError.value = undefined
  disableOpen.value = true
}

async function onDisable() {
  if (disabling.value) return
  disableServerError.value = undefined
  const value = disableWithRecovery.value ? disableCode.value.trim() : normalizeTotpCode(disableCode.value)
  if (!value) {
    disableError.value = t('mfa.errors.MFA_CODE_INVALID')
    return
  }
  disabling.value = true
  try {
    const body = disableWithRecovery.value ? { recoveryCode: value } : { code: value }
    await reauth.run(() => $api('/api/auth/mfa', { method: 'DELETE', body }))
    disableOpen.value = false
    status.value = { variant: 'success', message: t('account.mfa.disabledDone') }
    await refresh()
  }
  catch (error) {
    if (isReauthCancelled(error)) return
    if (mfaErrorCode(error) === 'MFA_CODE_INVALID') disableError.value = mfaErrorMessage(error)
    else disableServerError.value = mfaErrorMessage(error)
  }
  finally {
    disabling.value = false
  }
}
</script>

<template>
  <div>
    <AdminPageHeader :title="t('account.title')" :description="t('account.description')" />

    <section aria-labelledby="account-identity-title" class="grid max-w-3xl gap-4">
      <h2 id="account-identity-title" class="text-xl font-semibold text-foreground">
        {{ t('account.identity.title') }}
      </h2>
      <dl v-if="user" class="grid gap-3 rounded-xl border border-border bg-surface p-5 sm:grid-cols-[auto_1fr] sm:gap-x-8">
        <dt class="text-sm font-medium text-muted-foreground">
          {{ t('account.identity.email') }}
        </dt>
        <dd class="text-sm text-foreground break-all">
          {{ user.email }}
        </dd>
        <dt class="text-sm font-medium text-muted-foreground">
          {{ t('account.identity.role') }}
        </dt>
        <dd class="text-sm text-foreground">
          {{ t(`roles.${user.role}.label`) }}
        </dd>
      </dl>
    </section>

    <section aria-labelledby="account-mfa-title" class="mt-12 grid max-w-3xl gap-4">
      <div class="grid gap-1">
        <div class="flex flex-wrap items-center gap-3">
          <h2 id="account-mfa-title" class="text-xl font-semibold text-foreground">
            {{ t('account.mfa.title') }}
          </h2>
          <UiBadge v-if="mfa?.enabled" variant="success">
            <ShieldCheck aria-hidden="true" class="size-3.5" />
            {{ t('account.mfa.statusOn', { date: enabledDate }) }}
          </UiBadge>
          <UiBadge v-else-if="mfa" variant="neutral">
            <ShieldOff aria-hidden="true" class="size-3.5" />
            {{ t('account.mfa.statusOff') }}
          </UiBadge>
        </div>
        <p class="text-sm text-muted-foreground">
          {{ t('account.mfa.description') }}
        </p>
      </div>

      <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
        {{ status.message }}
      </UiAlert>

      <div v-if="mfa" class="grid gap-4 rounded-xl border border-border bg-surface p-5">
        <UiAlert v-if="!mfa.available && !mfa.enabled" variant="warning">
          {{ t('account.mfa.unavailable') }}
        </UiAlert>
        <UiAlert v-else-if="mfa.required && !mfa.enabled" variant="warning">
          {{ t('account.mfa.required') }}
        </UiAlert>

        <AdminMfaSetup v-if="mode === 'setup'" context="account" @enabled="onEnabled" @cancel="mode = 'idle'" />
        <AdminMfaRecoveryCodes v-else-if="mode === 'codes'" :codes="codes" :email="user?.email ?? ''" @continue="onCodesSaved" />

        <template v-else-if="mfa.enabled">
          <p class="text-sm" :class="codesLeft <= RECOVERY_CODES_LOW ? 'font-medium text-foreground' : 'text-muted-foreground'">
            {{ t('account.mfa.codesLeft', { count: codesLeft }, codesLeft) }}
            <template v-if="codesLeft <= RECOVERY_CODES_LOW">
              — {{ t('account.mfa.codesLow') }}
            </template>
          </p>
          <div class="flex flex-wrap gap-3">
            <UiButton variant="outline" :loading="regenerating" aria-describedby="account-mfa-regenerate-hint" @click="regenerate">
              {{ t('account.mfa.regenerate') }}
            </UiButton>
            <UiButton v-if="!mfa.required" variant="ghost" @click="openDisable">
              {{ t('account.mfa.disable') }}
            </UiButton>
          </div>
          <p id="account-mfa-regenerate-hint" class="text-sm text-muted-foreground">
            {{ t('account.mfa.regenerateHint') }}
          </p>
        </template>

        <div v-else-if="mfa.available">
          <UiButton @click="startSetup">
            <ShieldCheck aria-hidden="true" />
            {{ t('account.mfa.enable') }}
          </UiButton>
        </div>

        <p class="border-t border-border pt-4 text-sm text-muted-foreground">
          {{ t('account.mfa.devices') }}
          <NuxtLink to="/admin" class="font-medium text-primary underline underline-offset-4">
            {{ t('account.mfa.devicesLink') }}
          </NuxtLink>
        </p>
      </div>
    </section>

    <UiDialog v-model:open="disableOpen" :title="t('account.mfa.disableTitle')" :description="t('account.mfa.disableDescription')">
      <form :id="disableFormId" novalidate class="grid gap-4" @submit.prevent="onDisable">
        <UiAlert v-if="disableServerError" variant="error" live="assertive">
          {{ disableServerError }}
        </UiAlert>
        <UiFormField :id="disableCodeId" v-slot="field" :label="disableWithRecovery ? t('login.mfa.recoveryCode') : t('login.mfa.code')" :error="disableError" required>
          <UiInput
            v-bind="field"
            :key="disableWithRecovery ? 'recovery' : 'app'"
            v-model="disableCode"
            name="code"
            :inputmode="disableWithRecovery ? 'text' : 'numeric'"
            :autocomplete="disableWithRecovery ? 'off' : 'one-time-code'"
            autocapitalize="none"
            spellcheck="false"
            autofocus
            class="font-mono tracking-widest"
            @input="disableError = undefined"
          />
        </UiFormField>
        <UiButton variant="ghost" size="sm" class="justify-self-start" @click="disableWithRecovery = !disableWithRecovery; disableCode = ''; disableError = undefined">
          {{ disableWithRecovery ? t('login.mfa.useApp') : t('login.mfa.useRecovery') }}
        </UiButton>
      </form>
      <template #actions>
        <UiButton variant="outline" @click="disableOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" variant="destructive" :form="disableFormId" :loading="disabling">
          {{ t('account.mfa.disable') }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
