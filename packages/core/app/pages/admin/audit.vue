<script setup lang="ts">
import { Filter, ScrollText, X } from '@lucide/vue'

definePageMeta({ layout: 'admin', permission: 'audit:read' })

const { t, locale } = useI18n()
const route = useRoute()
const { environmentLabel } = useCredentialLabels()

useSeoMeta({ title: () => t('audit.meta.title') })

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const filters = reactive({ category: '' })
watch(() => route.query.category, (value) => {
  filters.category = queryValue(value)
}, { immediate: true })

const { data, error, refresh } = await useApiFetch('/api/admin/audit', {
  query: computed(() => ({ category: route.query.category, project: route.query.project, page: route.query.page })),
})
type Item = NonNullable<typeof data.value>['items'][number]

const pageCount = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))

function applyFilters() {
  return navigateTo({ query: { project: route.query.project, category: filters.category || undefined } })
}

function pageLink(page: number) {
  return { query: { ...route.query, page: page > 1 ? String(page) : undefined } }
}

const projectFilterLink = computed(() => ({ query: { ...route.query, project: undefined, page: undefined } }))

const categoryOptions = computed(() => [
  { value: '' as const, label: t('audit.filters.allCategories') },
  ...AUDIT_CATEGORIES.map(category => ({ value: category, label: t(`audit.categories.${category}`) })),
])

function actionLabel(action: string): string {
  return (AUDIT_ACTIONS as readonly string[]).includes(action) ? t(`audit.actions.${action}`) : action
}

function credentialName(token: NonNullable<Item['token']>): string {
  return 'deleted' in token ? t('audit.deletedCredential') : t(`credentials.named.${token.type}`, { name: token.name })
}

/** Auteur : compte (session, ou propriétaire d'un jeton personnel), sinon identifiant d'API, sinon système. */
function actorName(item: Item): string {
  const { actor, token } = item
  if (actor) return 'deleted' in actor ? t('audit.deletedUser') : (actor.name || actor.email)
  return token ? credentialName(token) : t('audit.system')
}

/** Précisions sur une action faite par l'API v1 : identifiant utilisé (si l'auteur est un compte), jeton délégué. */
function actorDetails(item: Item): string[] {
  const data = item.data as Record<string, unknown>
  const lines: string[] = []
  if (item.token && item.actor) lines.push(t('audit.via', { credential: credentialName(item.token) }))
  if (data.via === 'delegated') {
    lines.push(typeof data.subject === 'string' ? t('audit.delegatedSubject', { subject: data.subject }) : t('audit.delegated'))
  }
  return lines
}

function projectName(project: NonNullable<Item['project']>): string {
  return 'deleted' in project ? t('audit.deletedProject') : project.name
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function spaceName(space: unknown): string {
  return space && typeof space === 'object' && 'name' in space ? text(space.name) : t('space.library')
}

/** Détails lisibles d'une entrée, selon son action (données enregistrées par le serveur). */
function details(item: Item): string | null {
  const data = item.data as Record<string, unknown>
  const change = (data.changes ?? {}) as Record<string, { from: unknown, to: unknown }>
  switch (item.action) {
    case 'member.added':
      return t('audit.details.role', { role: t(`projectRoles.${text(data.role)}.label`) })
    case 'member.role_changed':
      return t('audit.details.change', { from: t(`projectRoles.${text(data.from)}.label`), to: t(`projectRoles.${text(data.to)}.label`) })
    case 'project.updated':
      return t('audit.details.fields', { fields: Object.keys(change).map(field => t(`audit.fields.${field}`)).join(', ') })
    case 'project.deleted':
      return t(`audit.details.projectMedia.${data.media === 'purge' ? 'purge' : 'library'}`, { count: Number(data.count ?? 0) })
    case 'media.visibility_changed':
      return t('audit.details.change', { from: t(`media.visibility.${text(data.from)}.label`), to: t(`media.visibility.${text(data.to)}.label`) })
    case 'media.moved':
      return t('audit.details.change', { from: spaceName(data.from), to: spaceName(data.to) })
    case 'key.created':
    case 'key.revoked':
    case 'key.deleted':
      return `${t(`apiKeys.types.${text(data.type)}.short`)} · ${environmentLabel(text(data.environment))}`
    case 'key.rotated':
      return [t(`apiKeys.rotate.overlaps.${text(data.overlap)}.label`), data.replacedBy ? t('apiKeys.replacedBy', { name: text(data.replacedBy) }) : null].filter(Boolean).join(' · ')
    case 'user.created':
      return t('audit.details.role', { role: t(`roles.${text(data.role)}.label`) })
    case 'user.updated':
      return [
        change.role ? t('audit.details.change', { from: t(`roles.${text(change.role.from)}.label`), to: t(`roles.${text(change.role.to)}.label`) }) : null,
        change.isActive ? t(change.isActive.to ? 'audit.details.activated' : 'audit.details.deactivated') : null,
      ].filter(Boolean).join(' · ') || null
    case 'user.password_link':
      return t(`audit.details.passwordLink.${data.purpose === 'RESET' ? 'reset' : 'invitation'}`)
    case 'user.sessions_revoked':
      return t('audit.details.sessions', { count: Number(data.count ?? 0) }, Number(data.count ?? 0))
    default:
      return null
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <AdminPageHeader :title="t('audit.title')" :description="t('audit.description')" />

    <form role="search" :aria-label="t('audit.filters.label')" class="mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-4" @submit.prevent="applyFilters">
      <UiFormField v-slot="field" :label="t('audit.filters.category')" class="w-64">
        <UiSelect v-bind="field" v-model="filters.category" :options="categoryOptions" name="category" />
      </UiFormField>
      <UiButton type="submit" variant="secondary">
        <Filter aria-hidden="true" />
        {{ t('audit.filters.apply') }}
      </UiButton>
      <p v-if="data?.filterProject" class="flex flex-wrap items-center gap-2 text-sm text-foreground">
        {{ t('audit.filters.project', { name: projectName(data.filterProject) }) }}
        <UiButton :to="projectFilterLink" variant="ghost" size="sm" :aria-label="t('audit.filters.clearProjectLabel', { name: projectName(data.filterProject) })">
          <X aria-hidden="true" />
          {{ t('audit.filters.clearProject') }}
        </UiButton>
      </p>
    </form>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('audit.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="data">
      <h2 class="sr-only">
        {{ t('audit.results') }}
      </h2>
      <p class="mb-3 text-sm text-muted-foreground" role="status">
        {{ t('audit.count', { count: data.total }, data.total) }}
      </p>

      <div v-if="data.items.length === 0" class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-10 text-center">
        <ScrollText class="size-8 text-muted-foreground" aria-hidden="true" />
        <p class="text-muted-foreground">
          {{ t('audit.empty') }}
        </p>
      </div>

      <div v-else class="overflow-x-auto rounded-xl border border-border bg-surface" role="region" :aria-label="t('audit.caption')" tabindex="0">
        <table class="w-full min-w-[48rem] text-left text-sm">
          <caption class="sr-only">
            {{ t('audit.caption') }}
          </caption>
          <thead class="border-b border-border text-muted-foreground">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('audit.columns.date') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('audit.columns.action') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('audit.columns.target') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('audit.columns.project') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('audit.columns.actor') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="item in data.items" :key="item.id">
              <td class="px-4 py-3 align-top whitespace-nowrap">
                <NuxtTime :datetime="item.at" :locale="locale" date-style="medium" time-style="medium" />
              </td>
              <th scope="row" class="min-w-48 px-4 py-3 align-top font-normal">
                <span class="font-medium text-foreground">{{ actionLabel(item.action) }}</span>
                <p v-if="details(item)" class="mt-0.5 text-xs text-muted-foreground">
                  {{ details(item) }}
                </p>
              </th>
              <td class="min-w-44 px-4 py-3 align-top break-words">
                {{ item.label ?? '—' }}
              </td>
              <td class="px-4 py-3 align-top">
                <template v-if="item.project">
                  <NuxtLink
                    v-if="!('deleted' in item.project)"
                    :to="`/admin/projects/${item.project.id}`"
                    class="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {{ item.project.name }}
                  </NuxtLink>
                  <span v-else class="text-muted-foreground">{{ t('audit.deletedProject') }}</span>
                </template>
                <span v-else class="text-muted-foreground">—</span>
              </td>
              <td class="px-4 py-3 align-top">
                <span class="text-foreground">{{ actorName(item) }}</span>
                <span v-for="line in actorDetails(item)" :key="line" class="block text-xs break-all text-muted-foreground">{{ line }}</span>
                <span v-if="item.ipAddress" class="block text-xs text-muted-foreground">{{ item.ipAddress }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <UiPagination class="mt-6" :page="data.page" :page-count="pageCount" :to="pageLink" />
    </template>
  </div>
</template>
