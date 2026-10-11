<script setup lang="ts">
import { Ban, KeySquare, Plus, Trash2 } from '@lucide/vue'

definePageMeta({ layout: 'admin', permission: 'tokens:personal' })

interface StatusMessage {
  variant: 'success' | 'error'
  message: string
}

const { t, locale } = useI18n()
const { $api } = useNuxtApp()
const { credentialErrorMessage } = useCredentialLabels()

useSeoMeta({ title: () => t('tokens.meta.title') })

const { data, error, refresh } = await useApiFetch('/api/admin/tokens')
type Token = NonNullable<typeof data.value>['tokens'][number]

// Jeton tout juste créé : valeur affichée une seule fois (message transmis par la page de création).
const flash = useFlash().consume()
const revealed = ref<{ value: string, name: string } | null>(flash?.payload ? flash.payload as { value: string, name: string } : null)
const status = ref<StatusMessage | null>(null)

const activeTokens = computed(() => (data.value?.tokens ?? []).filter(token => token.status === 'active'))
const inactiveTokens = computed(() => (data.value?.tokens ?? []).filter(token => token.status !== 'active'))

// ─── Révocation et suppression ───────────────────────────────────────────────

const confirmTarget = ref<{ kind: 'revoke' | 'delete', token: Token } | null>(null)
const confirmOpen = computed({
  get: () => confirmTarget.value !== null,
  set: (value) => {
    if (!value) confirmTarget.value = null
  },
})
const confirmError = ref<string>()
const confirming = ref(false)

function ask(kind: 'revoke' | 'delete', token: Token) {
  confirmError.value = undefined
  confirmTarget.value = { kind, token }
}

async function confirmAction() {
  const target = confirmTarget.value
  if (!target) return
  confirmError.value = undefined
  confirming.value = true
  try {
    if (target.kind === 'revoke') await $api(`/api/admin/tokens/${target.token.id}/revoke`, { method: 'POST' })
    else await $api(`/api/admin/tokens/${target.token.id}`, { method: 'DELETE' })
    confirmTarget.value = null
    await refresh()
    status.value = { variant: 'success', message: t(`tokens.${target.kind}.done`, { name: target.token.name }) }
    // La ligne a changé de section ou disparu : focus sur le titre de la liste.
    await nextTick()
    document.getElementById('tokens-title')?.focus()
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
    <AdminPageHeader :title="t('tokens.title')" :description="t('tokens.description')">
      <template #actions>
        <UiButton to="/admin/tokens/new">
          <Plus aria-hidden="true" />
          {{ t('tokens.create') }}
        </UiButton>
      </template>
    </AdminPageHeader>

    <AdminSecretPanel
      v-if="revealed"
      class="mb-8"
      :title="t('tokens.revealed.title', { name: revealed.name })"
      :description="t('tokens.revealed.description')"
      :label="t('tokens.revealed.label')"
      :value="revealed.value"
      secret
    />

    <UiAlert variant="info" class="mb-6">
      {{ t('tokens.notice') }}
    </UiAlert>

    <section aria-labelledby="tokens-title">
      <h2 id="tokens-title" tabindex="-1" class="mb-3 text-lg font-semibold text-foreground">
        {{ t('tokens.listTitle') }}
      </h2>

      <UiAlert v-if="status" :variant="status.variant" live="polite" class="mb-4">
        {{ status.message }}
      </UiAlert>

      <UiAlert v-if="error" variant="error" live="assertive" :title="t('tokens.loadError')">
        <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
          {{ t('common.retry') }}
        </UiButton>
      </UiAlert>

      <template v-else-if="data">
        <div v-if="activeTokens.length === 0" class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-10 text-center">
          <KeySquare class="size-8 text-muted-foreground" aria-hidden="true" />
          <p class="text-muted-foreground">
            {{ t('tokens.empty') }}
          </p>
        </div>

        <div v-else class="overflow-x-auto rounded-xl border border-border bg-surface" role="region" aria-labelledby="tokens-caption" tabindex="0">
          <table class="w-full min-w-[48rem] text-left text-sm">
            <caption id="tokens-caption" class="sr-only">
              {{ t('tokens.caption') }}
            </caption>
            <thead class="border-b border-border text-muted-foreground">
              <tr>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('tokens.columns.name') }}
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('tokens.columns.access') }}
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('tokens.columns.scopes') }}
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('tokens.columns.expires') }}
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('tokens.columns.lastUsed') }}
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('tokens.columns.actions') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="token in activeTokens" :key="token.id">
                <th scope="row" class="px-4 py-3 align-top font-normal">
                  <span class="font-medium text-foreground">{{ token.name }}</span>
                  <code class="mt-1 block font-mono text-xs text-muted-foreground">{{ token.prefix }}…</code>
                </th>
                <td class="px-4 py-3 align-top">
                  <ul class="grid gap-1">
                    <li v-if="token.allProjects">
                      {{ t('tokens.access.allProjects') }}
                    </li>
                    <li v-for="project in token.projects" :key="project.id">
                      <NuxtLink :to="`/admin/projects/${project.id}`" class="font-medium text-primary underline-offset-4 hover:underline">
                        {{ project.name }}
                      </NuxtLink>
                      <span v-if="project.archivedAt" class="text-xs text-muted-foreground"> · {{ t('projects.status.archived') }}</span>
                    </li>
                    <li v-if="token.includeLibrary">
                      {{ t('tokens.access.library') }}
                    </li>
                  </ul>
                </td>
                <td class="px-4 py-3 align-top">
                  <AdminScopeList :scopes="token.scopes" />
                </td>
                <td class="px-4 py-3 align-top">
                  <NuxtTime v-if="token.expiresAt" :datetime="token.expiresAt" :locale="locale" date-style="medium" />
                </td>
                <td class="px-4 py-3 align-top">
                  <template v-if="token.lastUsedAt">
                    <NuxtTime class="block" :datetime="token.lastUsedAt" :locale="locale" date-style="medium" time-style="short" />
                    <span v-if="token.lastUsedIp" class="text-xs text-muted-foreground">{{ token.lastUsedIp }}</span>
                  </template>
                  <span v-else class="text-muted-foreground">{{ t('credentials.neverUsed') }}</span>
                </td>
                <td class="px-4 py-3 align-top">
                  <UiButton variant="outline" size="sm" :aria-label="t('tokens.revoke.actionLabel', { name: token.name })" @click="ask('revoke', token)">
                    <Ban aria-hidden="true" />
                    {{ t('tokens.revoke.action') }}
                  </UiButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <details v-if="inactiveTokens.length" class="mt-6 rounded-xl border border-border bg-surface">
          <summary class="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium text-foreground hover:bg-muted">
            {{ t('tokens.inactive.summary', { count: inactiveTokens.length }, inactiveTokens.length) }}
          </summary>
          <ul class="divide-y divide-border border-t border-border">
            <li v-for="token in inactiveTokens" :key="token.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div class="grid gap-1">
                <p class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-foreground">{{ token.name }}</span>
                  <AdminTokenStatusBadge :status="token.status" kind="token" />
                </p>
                <p class="text-xs text-muted-foreground">
                  <code class="font-mono">{{ token.prefix }}…</code>
                  ·
                  <i18n-t :keypath="token.status === 'revoked' ? 'credentials.revokedOn' : 'credentials.expiredOn'" scope="global" tag="span">
                    <template #date>
                      <NuxtTime :datetime="(token.revokedAt ?? token.expiresAt)!" :locale="locale" date-style="medium" time-style="short" />
                    </template>
                  </i18n-t>
                </p>
              </div>
              <UiButton variant="outline" size="sm" :aria-label="t('tokens.delete.actionLabel', { name: token.name })" @click="ask('delete', token)">
                <Trash2 aria-hidden="true" />
                {{ t('tokens.delete.action') }}
              </UiButton>
            </li>
          </ul>
        </details>
      </template>
    </section>

    <UiDialog
      v-model:open="confirmOpen"
      :title="confirmTarget ? t(`tokens.${confirmTarget.kind}.title`, { name: confirmTarget.token.name }) : ''"
      :description="confirmTarget ? t(`tokens.${confirmTarget.kind}.description`) : ''"
    >
      <UiAlert v-if="confirmError" variant="error" live="assertive">
        {{ confirmError }}
      </UiAlert>
      <template #actions>
        <UiButton variant="outline" autofocus @click="confirmOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton variant="destructive" :loading="confirming" @click="confirmAction">
          {{ confirmTarget ? t(`tokens.${confirmTarget.kind}.action`) : '' }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
