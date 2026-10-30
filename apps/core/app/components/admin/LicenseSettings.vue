<script setup lang="ts">
/**
 * Réglages › Licence : licence commerciale en vigueur (état, titulaire, offre, fonctions payantes, instances
 * couvertes, dates), identifiant de cette installation, et installation / retrait d'une licence (mode sudo).
 * Licence fournie par NUXT_LICENSE_KEY : lecture seule. Sans licence : édition Community, avec le rappel des
 * conditions de la BUSL. Les dates et jours restants sont jugés à la date de référence du serveur, pas à
 * l'horloge du navigateur. Architecture : .claude/architecture-licence.md § 8.
 */
import { BadgeCheck, KeyRound } from '@lucide/vue'
import { LICENSE_TOKEN_MAX_LENGTH } from '#shared/schemas/license'
import {
  daysUntil,
  LICENSE_CLOCK_WARNING_MS,
  LICENSE_ERROR_CODES,
  LICENSE_INVALID_REASONS,
  type LicenseState,
} from '#shared/utils/license'

const { t, te, locale } = useI18n()
const { $api } = useNuxtApp()
const reauth = useReauth()
const ids = { state: useId(), install: useId() }

const { data, error, refresh } = await useApiFetch('/api/admin/license')
type LicenseView = NonNullable<typeof data.value>

const STATE_BADGES: Record<LicenseState, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  none: 'neutral',
  invalid: 'danger',
  pending: 'primary',
  valid: 'success',
  expiring: 'warning',
  grace: 'warning',
  expired: 'danger',
}

const referenceMs = computed(() => data.value ? Date.parse(data.value.referenceAt) : 0)
const daysLeft = computed(() => data.value?.license ? daysUntil(Date.parse(data.value.license.expiresAt), referenceMs.value) : 0)
const clockBehind = computed(() => {
  const ms = data.value?.clockBehindMs ?? 0
  if (ms <= LICENSE_CLOCK_WARNING_MS) return null
  const days = Math.round(ms / 86_400_000)
  const hours = Math.round(ms / 3_600_000)
  return ms >= 86_400_000 ? t('settings.license.clockDays', { count: days }, days) : t('settings.license.clockHours', { count: hours }, hours)
})

function planLabel(plan: string): string {
  return te(`settings.license.plans.${plan}`) ? t(`settings.license.plans.${plan}`) : plan
}
function featureLabel(feature: string): string {
  return te(`settings.license.features.${feature}`) ? t(`settings.license.features.${feature}`) : feature
}
function reasonText(reason: string | null): string {
  return reason && (LICENSE_INVALID_REASONS as readonly string[]).includes(reason) ? t(`settings.license.reasons.${reason}`) : ''
}
const supportEnded = computed(() => data.value?.license ? Date.parse(data.value.license.supportEndsAt) <= referenceMs.value : false)

// ─── Installation et retrait ─────────────────────────────────────────────────

const token = ref('')
const tokenError = ref<string>()
const status = ref<{ variant: 'success' | 'error', message: string } | null>(null)
const installing = ref(false)
const removeOpen = ref(false)
const removing = ref(false)

function errorMessage(caught: unknown): string {
  const { code, details } = apiError(caught)
  if (code === 'LICENSE_INVALID') return reasonText(String(details?.reason ?? '')) || t('settings.license.reasons.payload')
  if ((LICENSE_ERROR_CODES as readonly string[]).includes(code ?? '')) return t(`settings.license.errors.${code}`)
  return t('settings.license.errors.unexpected')
}

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  token.value = file.size > LICENSE_TOKEN_MAX_LENGTH ? '' : (await file.text()).trim()
  tokenError.value = token.value ? undefined : t('settings.license.fileUnreadable')
  input.value = ''
}

async function afterChange(updated: LicenseView, message: string) {
  data.value = updated
  status.value = { variant: 'success', message }
  await refreshNuxtData('license-features')
}

async function install() {
  status.value = null
  tokenError.value = token.value.trim() ? undefined : t('validation.required')
  if (tokenError.value) return
  installing.value = true
  try {
    const updated = await reauth.run(() => $api('/api/admin/license', { method: 'PUT', body: { token: token.value } }))
    token.value = ''
    await afterChange(updated as LicenseView, t('settings.license.installed'))
  }
  catch (caught) {
    if (!isReauthCancelled(caught)) status.value = { variant: 'error', message: errorMessage(caught) }
  }
  finally {
    installing.value = false
  }
}

async function remove() {
  status.value = null
  removing.value = true
  try {
    const updated = await reauth.run(() => $api('/api/admin/license', { method: 'DELETE' }))
    removeOpen.value = false
    await afterChange(updated as LicenseView, t('settings.license.removed'))
  }
  catch (caught) {
    removeOpen.value = false
    if (!isReauthCancelled(caught)) status.value = { variant: 'error', message: errorMessage(caught) }
  }
  finally {
    removing.value = false
  }
}
</script>

<template>
  <UiAlert v-if="error" variant="error" live="assertive" :title="t('settings.license.loadError')">
    <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
      {{ t('common.retry') }}
    </UiButton>
  </UiAlert>

  <div v-else-if="data" class="grid max-w-3xl gap-6">
    <!-- État -->
    <section :aria-labelledby="ids.state" class="grid gap-4 rounded-xl border border-border bg-surface p-5">
      <div class="flex flex-wrap items-center gap-3">
        <h3 :id="ids.state" class="flex items-center gap-2 text-lg font-semibold text-foreground">
          <BadgeCheck class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {{ t('settings.license.stateTitle') }}
        </h3>
        <UiBadge :variant="STATE_BADGES[data.state]">
          {{ t(`settings.license.states.${data.state}.badge`) }}
        </UiBadge>
      </div>

      <div class="grid gap-2 text-sm text-foreground">
        <i18n-t v-if="data.license" :keypath="`settings.license.states.${data.state}.text`" scope="global" tag="p" :plural="daysLeft">
          <template #date>
            <NuxtTime :datetime="data.state === 'pending' ? data.license.startsAt : data.license.expiresAt" :locale="locale" date-style="long" />
          </template>
          <template #end>
            <NuxtTime :datetime="data.license.graceEndsAt" :locale="locale" date-style="long" />
          </template>
          <template #days>
            {{ daysLeft }}
          </template>
        </i18n-t>
        <p v-else-if="data.state === 'invalid'">
          {{ t('settings.license.states.invalid.text') }} {{ reasonText(data.reason) }}
        </p>
        <template v-else>
          <p>{{ t('settings.license.states.none.text') }}</p>
          <i18n-t keypath="settings.license.community" scope="global" tag="p" class="text-muted-foreground">
            <template #email>
              <a href="mailto:licensing@surgeup.org" class="font-medium text-primary underline-offset-4 hover:underline">licensing@surgeup.org</a>
            </template>
          </i18n-t>
        </template>
      </div>

      <UiAlert v-if="clockBehind" variant="warning" :title="t('settings.license.clockTitle')">
        {{ clockBehind }}
      </UiAlert>

      <dl v-if="data.license" class="grid gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('settings.license.licensee') }}
          </dt>
          <dd class="font-medium break-words text-foreground">
            {{ data.license.licensee.name }}<template v-if="data.license.licensee.country">
              ({{ data.license.licensee.country }})
            </template>
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('settings.license.plan') }}
          </dt>
          <dd class="font-medium text-foreground">
            {{ planLabel(data.license.plan) }}
          </dd>
        </div>
        <div class="grid gap-0.5 sm:col-span-2">
          <dt class="text-muted-foreground">
            {{ t('settings.license.featuresLabel') }}
          </dt>
          <dd class="text-foreground">
            <ul v-if="data.license.features.length" class="flex flex-wrap gap-2">
              <li v-for="feature in data.license.features" :key="feature">
                <UiBadge :variant="data.features.includes(feature) ? 'primary' : 'neutral'">
                  {{ featureLabel(feature) }}
                </UiBadge>
              </li>
            </ul>
            <span v-else>{{ t('settings.license.noFeatures') }}</span>
            <span v-if="data.license.features.length && !data.features.length" class="mt-1 block text-muted-foreground">
              {{ t('settings.license.featuresOff') }}
            </span>
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('settings.license.instances') }}
          </dt>
          <dd class="font-medium text-foreground">
            {{ data.license.instances === null ? t('settings.license.unlimited') : new Intl.NumberFormat(locale).format(data.license.instances) }}
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('settings.license.validity') }}
          </dt>
          <dd class="text-foreground">
            <i18n-t keypath="settings.license.validityRange" scope="global" tag="span">
              <template #start>
                <NuxtTime :datetime="data.license.startsAt" :locale="locale" date-style="long" />
              </template>
              <template #end>
                <NuxtTime :datetime="data.license.expiresAt" :locale="locale" date-style="long" />
              </template>
            </i18n-t>
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('settings.license.support') }}
          </dt>
          <dd class="text-foreground">
            <i18n-t :keypath="supportEnded ? 'settings.license.supportEnded' : 'settings.license.supportUntil'" scope="global" tag="span">
              <template #date>
                <NuxtTime :datetime="data.license.supportEndsAt" :locale="locale" date-style="long" />
              </template>
            </i18n-t>
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('settings.license.number') }}
          </dt>
          <dd class="font-mono text-xs text-foreground">
            {{ data.license.id }}
          </dd>
        </div>
      </dl>

      <p v-if="data.source" class="text-sm text-muted-foreground">
        {{ t(`settings.license.source.${data.source}`) }}
      </p>

      <div class="border-t border-border pt-4">
        <UiCopyField :label="t('settings.license.instanceId')" :value="data.instanceId" :hint="t('settings.license.instanceIdHint')" />
      </div>
    </section>

    <!-- Installation -->
    <section v-if="data.source !== 'env'" :aria-labelledby="ids.install" class="grid gap-4 rounded-xl border border-border bg-surface p-5">
      <h3 :id="ids.install" class="flex items-center gap-2 text-lg font-semibold text-foreground">
        <KeyRound class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {{ data.source === 'database' ? t('settings.license.replaceTitle') : t('settings.license.installTitle') }}
      </h3>
      <form class="grid gap-4" novalidate @submit.prevent="install">
        <UiFormField v-slot="field" :label="t('settings.license.tokenLabel')" :hint="t('settings.license.tokenHint')" :error="tokenError" required>
          <textarea
            v-bind="field"
            v-model="token"
            rows="4"
            spellcheck="false"
            autocomplete="off"
            :maxlength="LICENSE_TOKEN_MAX_LENGTH"
            :aria-invalid="field.invalid || undefined"
            class="block w-full min-w-0 rounded-lg border border-input bg-surface px-3 py-2 font-mono text-sm break-all text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:border-2 aria-invalid:border-destructive"
          />
        </UiFormField>
        <UiFormField v-slot="field" :label="t('settings.license.fileLabel')">
          <input
            :id="field.id"
            type="file"
            accept=".lic,.txt,text/plain"
            class="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-input file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
            @change="readFile"
          >
        </UiFormField>
        <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
          {{ status.message }}
        </UiAlert>
        <div class="flex flex-wrap gap-3">
          <UiButton type="submit" :loading="installing">
            {{ t('settings.license.install') }}
          </UiButton>
          <UiButton v-if="data.source === 'database'" type="button" variant="outline" @click="removeOpen = true">
            {{ t('settings.license.remove') }}
          </UiButton>
        </div>
      </form>

      <UiDialog v-model:open="removeOpen" :title="t('settings.license.removeTitle')" :description="t('settings.license.removeDescription')">
        <template #actions>
          <UiButton variant="outline" autofocus @click="removeOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton variant="destructive" :loading="removing" @click="remove">
            {{ t('settings.license.removeConfirm') }}
          </UiButton>
        </template>
      </UiDialog>
    </section>

    <UiAlert v-else variant="info" :title="t('settings.license.envTitle')">
      {{ t('settings.license.envText') }}
    </UiAlert>
  </div>
</template>
