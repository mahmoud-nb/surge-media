<script setup lang="ts">
import { Ban, KeyRound, Plus, RefreshCw, Trash2 } from '@lucide/vue'

definePageMeta({ layout: 'admin' })

interface StatusMessage {
  variant: 'success' | 'error'
  message: string
}

const { t, locale } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()
const reauth = useReauth()
const { environmentLabel, compareEnvironments, credentialErrorMessage } = useCredentialLabels()

const projectId = computed(() => String(route.params.id))
const { data: projectData, error: projectError, refresh: refreshProject } = await useApiFetch(() => `/api/admin/projects/${projectId.value}`)
if (projectError.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })
}
const { data, error, refresh } = await useApiFetch(() => `/api/admin/projects/${projectId.value}/keys`)
const archivedError = computed(() => apiError(error.value).code === 'PROJECT_ARCHIVED')
if (error.value?.statusCode === 403 && !archivedError.value) {
  throw createError({ statusCode: 403, statusMessage: 'Forbidden', fatal: true })
}

const project = computed(() => projectData.value?.project)
type Key = NonNullable<typeof data.value>['keys'][number]

useSeoMeta({ title: () => (project.value ? t('apiKeys.meta.title', { name: project.value.name }) : t('projects.list.title')) })

// Clé tout juste créée (page de création) ou renouvelée : valeur affichée une seule fois.
interface Revealed { value: string, type: ProjectKeyType, name: string }
const flash = useFlash().consume()
const revealed = ref<Revealed | null>(flash?.payload ? flash.payload as unknown as Revealed : null)
const status = ref<StatusMessage | null>(flash && !flash.payload ? { variant: 'success', message: flash.message } : null)
const secretPanel = useTemplateRef<{ focus: () => void }>('secretPanel')

const activeKeys = computed(() => (data.value?.keys ?? []).filter(key => key.status === 'active'))
const inactiveKeys = computed(() => (data.value?.keys ?? []).filter(key => key.status !== 'active'))
const groups = computed(() => {
  const byEnvironment = new Map<string, Key[]>()
  for (const key of activeKeys.value) byEnvironment.set(key.environment, [...(byEnvironment.get(key.environment) ?? []), key])
  return [...byEnvironment.entries()]
    .sort(([a], [b]) => compareEnvironments(a, b))
    .map(([environment, keys]) => ({ environment, keys }))
})

function creatorName(key: Key): string | null {
  return key.createdBy ? (key.createdBy.name || key.createdBy.email) : null
}

async function reload() {
  await Promise.all([refresh(), refreshProject()])
}

async function focusTitle() {
  await nextTick()
  document.getElementById('keys-title')?.focus()
}

// ─── Renouvellement (rotation) ───────────────────────────────────────────────

const rotateTarget = ref<Key | null>(null)
const rotateOpen = computed({
  get: () => rotateTarget.value !== null,
  set: (value) => {
    if (!value) rotateTarget.value = null
  },
})
const overlap = ref<RotationOverlap | ''>('24h')
const rotateError = ref<string>()
const rotating = ref(false)
const overlapOptions = computed(() => ROTATION_OVERLAPS.map(value => ({
  value,
  label: t(`apiKeys.rotate.overlaps.${value}.label`),
  description: t(`apiKeys.rotate.overlaps.${value}.description`),
})))

function askRotate(key: Key) {
  overlap.value = '24h'
  rotateError.value = undefined
  rotateTarget.value = key
}

/** Appel isolé : son type de retour est calculé une fois (sinon inférence trop profonde dans run()). */
function rotateRequest(keyId: string, value: RotationOverlap) {
  return $api(`/api/admin/projects/${projectId.value}/keys/${keyId}/rotate`, { method: 'POST', body: { overlap: value } })
}

async function confirmRotate() {
  const key = rotateTarget.value
  const value = overlap.value
  if (!key || !value) return
  rotateError.value = undefined
  rotating.value = true
  try {
    const result = await reauth.run(() => rotateRequest(key.id, value))
    rotateTarget.value = null
    status.value = null
    revealed.value = { value: result.value, type: result.key.type, name: result.key.name }
    await refresh()
    // Le bouton « Renouveler » a disparu de la ligne : focus sur la nouvelle clé.
    await nextTick()
    secretPanel.value?.focus()
  }
  catch (error) {
    if (!isReauthCancelled(error)) rotateError.value = credentialErrorMessage(error)
  }
  finally {
    rotating.value = false
  }
}

// ─── Révocation et suppression ───────────────────────────────────────────────

const confirmTarget = ref<{ kind: 'revoke' | 'delete', key: Key } | null>(null)
const confirmOpen = computed({
  get: () => confirmTarget.value !== null,
  set: (value) => {
    if (!value) confirmTarget.value = null
  },
})
const confirmError = ref<string>()
const confirming = ref(false)

function ask(kind: 'revoke' | 'delete', key: Key) {
  confirmError.value = undefined
  confirmTarget.value = { kind, key }
}

async function confirmAction() {
  const target = confirmTarget.value
  if (!target) return
  confirmError.value = undefined
  confirming.value = true
  try {
    const base = `/api/admin/projects/${projectId.value}/keys/${target.key.id}`
    if (target.kind === 'revoke') await $api(`${base}/revoke`, { method: 'POST' })
    else await $api(base, { method: 'DELETE' })
    confirmTarget.value = null
    await reload()
    status.value = { variant: 'success', message: t(`apiKeys.${target.kind}.done`, { name: target.key.name }) }
    // La ligne a changé de section ou disparu : focus sur le titre de la section.
    await focusTitle()
  }
  catch (error) {
    confirmError.value = credentialErrorMessage(error)
  }
  finally {
    confirming.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <UiAlert v-if="projectError" variant="error" live="assertive" :title="t('projects.overview.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="reload()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="project">
      <AdminProjectHeader :project="project" :scopes="projectData?.scopes ?? []" />

      <AdminSecretPanel
        v-if="revealed"
        ref="secretPanel"
        :key="revealed.value"
        class="mb-8"
        :title="t(`apiKeys.revealed.${revealed.type}.title`, { name: revealed.name })"
        :description="t(`apiKeys.revealed.${revealed.type}.description`)"
        :label="t(`apiKeys.revealed.${revealed.type}.label`)"
        :value="revealed.value"
        :secret="revealed.type === 'SECRET'"
      />

      <section aria-labelledby="keys-title">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div class="grid max-w-3xl gap-1">
            <h2 id="keys-title" tabindex="-1" class="text-lg font-semibold text-foreground">
              {{ t('apiKeys.title') }}
            </h2>
            <p class="text-sm text-muted-foreground">
              {{ t('apiKeys.description') }}
            </p>
          </div>
          <UiButton v-if="!archivedError" :to="`/admin/projects/${project.id}/keys/new`">
            <Plus aria-hidden="true" />
            {{ t('apiKeys.create') }}
          </UiButton>
        </div>

        <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'" class="mb-4">
          {{ status.message }}
        </UiAlert>

        <UiAlert v-if="archivedError" variant="info">
          {{ t('apiKeys.archived') }}
        </UiAlert>

        <UiAlert v-else-if="error" variant="error" live="assertive" :title="t('apiKeys.loadError')">
          <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
            {{ t('common.retry') }}
          </UiButton>
        </UiAlert>

        <template v-else-if="data">
          <dl class="mb-6 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm md:grid-cols-2">
            <div class="grid gap-1">
              <dt class="font-semibold text-foreground">
                {{ t('apiKeys.types.PUBLISHABLE.label') }}
              </dt>
              <dd class="text-muted-foreground">
                {{ t('apiKeys.types.PUBLISHABLE.description') }}
              </dd>
            </div>
            <div class="grid gap-1">
              <dt class="font-semibold text-foreground">
                {{ t('apiKeys.types.SECRET.label') }}
              </dt>
              <dd class="text-muted-foreground">
                {{ t('apiKeys.types.SECRET.description') }}
              </dd>
            </div>
          </dl>

          <div v-if="groups.length === 0" class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-10 text-center">
            <KeyRound class="size-8 text-muted-foreground" aria-hidden="true" />
            <p class="text-muted-foreground">
              {{ t('apiKeys.empty') }}
            </p>
          </div>

          <section
            v-for="group in groups"
            :key="group.environment"
            :aria-labelledby="`env-${group.environment}`"
            class="mb-8"
          >
            <h3 :id="`env-${group.environment}`" class="mb-3 text-base font-semibold text-foreground">
              {{ t('apiKeys.environmentTitle', { environment: environmentLabel(group.environment) }) }}
            </h3>
            <div class="overflow-x-auto rounded-xl border border-border bg-surface" role="region" :aria-labelledby="`caption-${group.environment}`" tabindex="0">
              <table class="w-full min-w-[48rem] text-left text-sm">
                <caption :id="`caption-${group.environment}`" class="sr-only">
                  {{ t('apiKeys.caption', { environment: environmentLabel(group.environment) }) }}
                </caption>
                <thead class="border-b border-border text-muted-foreground">
                  <tr>
                    <th scope="col" class="px-4 py-3 font-medium">
                      {{ t('apiKeys.columns.name') }}
                    </th>
                    <th scope="col" class="px-4 py-3 font-medium">
                      {{ t('apiKeys.columns.key') }}
                    </th>
                    <th scope="col" class="px-4 py-3 font-medium">
                      {{ t('apiKeys.columns.scopes') }}
                    </th>
                    <th scope="col" class="px-4 py-3 font-medium">
                      {{ t('apiKeys.columns.expires') }}
                    </th>
                    <th scope="col" class="px-4 py-3 font-medium">
                      {{ t('apiKeys.columns.lastUsed') }}
                    </th>
                    <th scope="col" class="px-4 py-3 font-medium">
                      {{ t('apiKeys.columns.actions') }}
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  <tr v-for="key in group.keys" :key="key.id">
                    <th scope="row" class="px-4 py-3 align-top font-normal">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-medium text-foreground">{{ key.name }}</span>
                        <UiBadge :variant="key.type === 'SECRET' ? 'primary' : 'neutral'">
                          {{ t(`apiKeys.types.${key.type}.short`) }}
                        </UiBadge>
                      </div>
                      <p class="mt-1 text-xs text-muted-foreground">
                        <i18n-t v-if="creatorName(key)" keypath="apiKeys.createdBy" scope="global" tag="span">
                          <template #date>
                            <NuxtTime :datetime="key.createdAt" :locale="locale" date-style="medium" />
                          </template>
                          <template #name>
                            {{ creatorName(key) }}
                          </template>
                        </i18n-t>
                        <i18n-t v-else keypath="apiKeys.createdOn" scope="global" tag="span">
                          <template #date>
                            <NuxtTime :datetime="key.createdAt" :locale="locale" date-style="medium" />
                          </template>
                        </i18n-t>
                        <template v-if="key.createdBy && !key.createdBy.isActive">
                          · {{ t('apiKeys.creatorInactive') }}
                        </template>
                      </p>
                    </th>
                    <td class="px-4 py-3 align-top">
                      <!-- Préfixe seulement ; la clé publique (non secrète) se copie en entier. -->
                      <code class="block font-mono text-xs whitespace-nowrap text-foreground">{{ key.prefix }}…</code>
                      <UiCopyButton v-if="key.publicValue" class="mt-2" :value="key.publicValue" :label="t('apiKeys.copyPublic', { name: key.name })" />
                    </td>
                    <td class="px-4 py-3 align-top">
                      <AdminScopeList :scopes="key.scopes" />
                    </td>
                    <td class="px-4 py-3 align-top">
                      <template v-if="key.replacedBy">
                        <UiBadge variant="warning">
                          {{ t('apiKeys.replaced') }}
                        </UiBadge>
                        <p class="mt-1 text-xs text-muted-foreground">
                          {{ t('apiKeys.replacedBy', { name: `${key.replacedBy.prefix}…` }) }}
                        </p>
                      </template>
                      <NuxtTime v-if="key.expiresAt" class="block" :class="key.replacedBy && 'mt-1'" :datetime="key.expiresAt" :locale="locale" date-style="medium" time-style="short" />
                      <span v-else>{{ t('credentials.never') }}</span>
                    </td>
                    <td class="px-4 py-3 align-top">
                      <template v-if="key.lastUsedAt">
                        <NuxtTime class="block" :datetime="key.lastUsedAt" :locale="locale" date-style="medium" time-style="short" />
                        <span v-if="key.lastUsedIp" class="text-xs text-muted-foreground">{{ key.lastUsedIp }}</span>
                      </template>
                      <span v-else class="text-muted-foreground">{{ t('credentials.neverUsed') }}</span>
                    </td>
                    <td class="px-4 py-3 align-top">
                      <div class="flex flex-wrap gap-2">
                        <UiButton
                          v-if="!key.replacedBy"
                          variant="outline"
                          size="sm"
                          :aria-label="t('apiKeys.rotate.actionLabel', { name: key.name })"
                          @click="askRotate(key)"
                        >
                          <RefreshCw aria-hidden="true" />
                          {{ t('apiKeys.rotate.action') }}
                        </UiButton>
                        <UiButton variant="outline" size="sm" :aria-label="t('apiKeys.revoke.actionLabel', { name: key.name })" @click="ask('revoke', key)">
                          <Ban aria-hidden="true" />
                          {{ t('apiKeys.revoke.action') }}
                        </UiButton>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <details v-if="inactiveKeys.length" class="group rounded-xl border border-border bg-surface">
            <summary class="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium text-foreground hover:bg-muted">
              {{ t('apiKeys.inactive.summary', { count: inactiveKeys.length }, inactiveKeys.length) }}
            </summary>
            <ul class="divide-y divide-border border-t border-border">
              <li v-for="key in inactiveKeys" :key="key.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div class="grid gap-1">
                  <p class="flex flex-wrap items-center gap-2">
                    <span class="font-medium text-foreground">{{ key.name }}</span>
                    <UiBadge>{{ t(`apiKeys.types.${key.type}.short`) }}</UiBadge>
                    <UiBadge>{{ environmentLabel(key.environment) }}</UiBadge>
                    <AdminTokenStatusBadge :status="key.status" kind="key" />
                  </p>
                  <p class="text-xs text-muted-foreground">
                    <code class="font-mono">{{ key.prefix }}…</code>
                    ·
                    <i18n-t :keypath="key.status === 'revoked' ? 'credentials.revokedOn' : 'credentials.expiredOn'" scope="global" tag="span">
                      <template #date>
                        <NuxtTime :datetime="(key.revokedAt ?? key.expiresAt)!" :locale="locale" date-style="medium" time-style="short" />
                      </template>
                    </i18n-t>
                  </p>
                </div>
                <UiButton variant="outline" size="sm" :aria-label="t('apiKeys.delete.actionLabel', { name: key.name })" @click="ask('delete', key)">
                  <Trash2 aria-hidden="true" />
                  {{ t('apiKeys.delete.action') }}
                </UiButton>
              </li>
            </ul>
          </details>
        </template>
      </section>

      <UiDialog
        v-model:open="rotateOpen"
        :title="t('apiKeys.rotate.title', { name: rotateTarget?.name ?? '' })"
        :description="t('apiKeys.rotate.description')"
      >
        <div class="grid gap-4">
          <UiAlert v-if="rotateError" variant="error" live="assertive">
            {{ rotateError }}
          </UiAlert>
          <UiRadioCards v-model="overlap" :legend="t('apiKeys.rotate.overlapLegend')" :options="overlapOptions" :columns="2" />
        </div>
        <template #actions>
          <UiButton variant="outline" autofocus @click="rotateOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton :loading="rotating" @click="confirmRotate">
            <RefreshCw aria-hidden="true" />
            {{ t('apiKeys.rotate.confirm') }}
          </UiButton>
        </template>
      </UiDialog>

      <UiDialog
        v-model:open="confirmOpen"
        :title="confirmTarget ? t(`apiKeys.${confirmTarget.kind}.title`, { name: confirmTarget.key.name }) : ''"
        :description="confirmTarget ? t(`apiKeys.${confirmTarget.kind}.description`) : ''"
      >
        <UiAlert v-if="confirmError" variant="error" live="assertive">
          {{ confirmError }}
        </UiAlert>
        <template #actions>
          <UiButton variant="outline" autofocus @click="confirmOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton variant="destructive" :loading="confirming" @click="confirmAction">
            {{ confirmTarget ? t(`apiKeys.${confirmTarget.kind}.action`) : '' }}
          </UiButton>
        </template>
      </UiDialog>
    </template>
  </div>
</template>
