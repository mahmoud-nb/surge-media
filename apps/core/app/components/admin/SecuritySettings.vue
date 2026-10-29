<script setup lang="ts">
/**
 * Réglages › Sécurité : politique de double authentification (facultative, obligatoire pour les
 * administrateurs, obligatoire pour tous). Les comptes concernés qui ne l'ont pas encore activée la
 * configurent à leur prochaine connexion ; leur nombre est indiqué pour chaque choix. Enregistrement en
 * mode sudo. Architecture : .claude/architecture-mfa.md § 7.
 */
import { MFA_POLICIES, type MfaPolicy } from '#shared/utils/mfa'

const { t } = useI18n()
const { $api } = useNuxtApp()
const reauth = useReauth()
const { mfaErrorMessage } = useMfaErrors()

const { data, refresh } = await useApiFetch('/api/admin/security')
const policy = ref<MfaPolicy>(data.value?.mfaPolicy ?? 'optional')
watch(() => data.value?.mfaPolicy, (value) => {
  if (value) policy.value = value
})

const options = computed(() => MFA_POLICIES.map((value) => {
  const pending = value === 'optional' ? 0 : (data.value?.withoutMfa[value] ?? 0)
  const description = t(`settings.security.policies.${value}.description`)
  return {
    value,
    label: t(`settings.security.policies.${value}.label`),
    description: pending > 0 ? `${description} ${t('settings.security.pending', { count: pending }, pending)}` : description,
  }
}))

const status = ref<{ variant: 'success' | 'error', message: string } | null>(null)
const saving = ref(false)
const changed = computed(() => data.value !== undefined && data.value !== null && policy.value !== data.value.mfaPolicy)

async function save() {
  status.value = null
  saving.value = true
  try {
    await reauth.run(() => $api('/api/admin/security', { method: 'PUT', body: { mfaPolicy: policy.value } }))
    status.value = { variant: 'success', message: t('settings.security.saved') }
    await refresh()
  }
  catch (error) {
    if (!isReauthCancelled(error)) status.value = { variant: 'error', message: mfaErrorMessage(error) }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="data" class="grid max-w-3xl gap-4 rounded-xl border border-border bg-surface p-5">
    <UiAlert v-if="!data.available" variant="warning">
      {{ t('settings.security.unavailable') }}
    </UiAlert>
    <UiRadioCards v-model="policy" :legend="t('settings.security.legend')" :options="options" />
    <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
      {{ status.message }}
    </UiAlert>
    <div>
      <UiButton :disabled="!changed" :loading="saving" @click="save">
        {{ t('common.save') }}
      </UiButton>
    </div>
  </div>
</template>
