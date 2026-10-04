<script setup lang="ts">
/**
 * Tableau de bord : statistiques, raccourcis, envois sur 30 jours, points d'attention, projets,
 * activité récente (audit:read) et compte. Disposition fixe ; chaque widget n'apparaît que si le
 * compte a les droits correspondants (données de GET /api/admin/dashboard, limitées à ses espaces).
 */
import { FolderKanban, Images, KeyRound, Layers, UserPlus, Users } from '@lucide/vue'
import type { Component } from 'vue'

definePageMeta({ layout: 'admin' })

const { t, locale } = useI18n()
const { user, role, can } = useAuth()

useSeoMeta({ title: () => t('admin.dashboard.meta.title') })

// Réservé aux administrateurs : identifiants d'amorçage encore présents dans l'environnement ?
const { data: status } = await useFetch('/api/admin/status', {
  immediate: can('users:manage'),
})
const { data, error, refresh } = await useApiFetch('/api/admin/dashboard')

const displayName = computed(() => user.value?.name || user.value?.email || '')
const number = computed(() => new Intl.NumberFormat(locale.value))

interface Card {
  key: string
  icon: Component
  label: string
  value: string
  detail?: string
  to?: string
}

const cards = computed<Card[]>(() => {
  const d = data.value
  if (!d) return []
  const n = (value: number) => number.value.format(value)
  const plural = (key: string, count: number) => t(key, { count: n(count) }, count)
  const list: Card[] = []
  if (d.media) {
    list.push({
      key: 'media',
      icon: Images,
      label: t('admin.dashboard.stats.media'),
      value: n(d.media.total),
      detail: [formatBytes(d.media.size, locale.value), plural('admin.dashboard.stats.images', d.media.kinds.IMAGE.count), plural('admin.dashboard.stats.private', d.media.private)].join(' · '),
      to: can('library:read') ? '/admin/media' : '/admin/projects',
    })
  }
  list.push({
    key: 'projects',
    icon: FolderKanban,
    label: t('admin.dashboard.stats.projects'),
    value: n(d.projects.active),
    detail: plural('admin.dashboard.stats.archived', d.projects.archived),
    to: '/admin/projects',
  })
  if (d.variants) {
    list.push({
      key: 'variants',
      icon: Layers,
      label: t('admin.dashboard.stats.variants'),
      value: n(d.variants.count),
      detail: t('admin.dashboard.stats.variantsSize', { size: formatBytes(d.variants.size, locale.value) }),
    })
  }
  if (d.users) {
    list.push(d.users.scope === 'all'
      ? {
          key: 'users',
          icon: Users,
          label: t('admin.dashboard.stats.users'),
          value: n(d.users.total),
          detail: [plural('admin.dashboard.stats.invited', d.users.invited), plural('admin.dashboard.stats.inactive', d.users.inactive)].join(' · '),
          to: '/admin/users',
        }
      : {
          key: 'invitations',
          icon: UserPlus,
          label: t('admin.dashboard.stats.invitedUsers'),
          value: n(d.users.total),
          detail: plural('admin.dashboard.stats.invited', d.users.invited),
          to: '/admin/users',
        })
  }
  if (d.credentials) {
    const { personalTokens, projectKeys } = d.credentials
    list.push({
      key: 'credentials',
      icon: KeyRound,
      label: t('admin.dashboard.stats.credentials'),
      value: n((personalTokens ?? 0) + (projectKeys ?? 0)),
      detail: [
        personalTokens === null ? null : plural('admin.dashboard.stats.personalTokens', personalTokens),
        projectKeys === null ? null : plural('admin.dashboard.stats.projectKeys', projectKeys),
      ].filter(Boolean).join(' · '),
      to: personalTokens === null ? '/admin/projects' : '/admin/tokens',
    })
  }
  return list
})
</script>

<template>
  <div v-if="user && role" class="mx-auto max-w-6xl">
    <AdminPageHeader
      :title="t('admin.dashboard.title')"
      :description="t('admin.dashboard.greeting', { name: displayName })"
    />

    <UiAlert
      v-if="status?.bootstrapCredentialsSet"
      variant="warning"
      :title="t('admin.dashboard.bootstrapWarning.title')"
      class="mb-6"
    >
      {{ t('admin.dashboard.bootstrapWarning.description') }}
    </UiAlert>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('admin.dashboard.loadError')" class="mb-6">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <div v-else-if="data" class="grid gap-6">
      <section aria-labelledby="stats-title">
        <h2 id="stats-title" class="sr-only">
          {{ t('admin.dashboard.stats.title') }}
        </h2>
        <ul class="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-4">
          <AdminDashboardStatCard
            v-for="card in cards"
            :key="card.key"
            :icon="card.icon"
            :label="card.label"
            :value="card.value"
            :detail="card.detail"
            :to="card.to"
          />
        </ul>
      </section>

      <AdminDashboardShortcuts />

      <div class="grid gap-6 lg:grid-cols-3">
        <ClientOnly v-if="data.uploads">
          <AdminDashboardUploadsChart :since="data.uploads.since" :hours="data.uploads.hours" class="lg:col-span-2" />
          <template #fallback>
            <section aria-labelledby="uploads-loading-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs lg:col-span-2">
              <h2 id="uploads-loading-title" class="text-lg font-semibold text-foreground">
                {{ t('admin.dashboard.uploads.title') }}
              </h2>
              <p class="mt-4 text-sm text-muted-foreground">
                {{ t('admin.dashboard.uploads.loading') }}
              </p>
            </section>
          </template>
        </ClientOnly>
        <AdminDashboardAttention :items="data.attention" :class="data.uploads ? undefined : 'lg:col-span-3'" />
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <AdminDashboardProjects :items="data.projects.items" :total="data.projects.active" />
        <AdminDashboardActivity v-if="data.activity" :items="data.activity" />
        <AdminDashboardAccount v-else />
      </div>

      <AdminDashboardAccount v-if="data.activity" />
    </div>

    <AdminDashboardAccount v-else-if="error" />
  </div>
</template>
