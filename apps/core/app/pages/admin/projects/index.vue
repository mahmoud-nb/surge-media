<script setup lang="ts">
import { FolderKanban, Plus, Search } from '@lucide/vue'

definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const route = useRoute()
const { can } = useAuth()

useSeoMeta({ title: () => t('projects.list.meta.title') })

const flash = useFlash().consume()

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Formulaire de filtres (appliqués à la soumission) ; la liste suit les paramètres d'URL.
const filters = reactive({ q: '', status: '' })
watch(() => route.query, (query) => {
  filters.q = queryValue(query.q)
  filters.status = queryValue(query.status) || 'active'
}, { immediate: true })

const hasFilters = computed(() => Boolean(route.query.q || (route.query.status && route.query.status !== 'active')))

const { data, error, refresh } = await useApiFetch('/api/admin/projects', {
  query: computed(() => ({ q: route.query.q, status: route.query.status, page: route.query.page })),
})

const pageCount = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))

function applyFilters() {
  // Statut « actifs » par défaut : omis de l'URL.
  const query = Object.fromEntries(Object.entries(filters).filter(([name, value]) => value && !(name === 'status' && value === 'active')))
  return navigateTo({ query })
}

function pageLink(page: number) {
  return { query: { ...route.query, page: page > 1 ? String(page) : undefined } }
}

const statusOptions = computed(() => PROJECT_STATUSES.map(value => ({ value, label: t(`projects.status.${value}`) })))
const emptyMessage = computed(() => {
  if (hasFilters.value) return t('projects.list.emptyFiltered')
  return can('projects:all') || can('projects:create') ? t('projects.list.empty') : t('projects.list.emptyMember')
})
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <AdminPageHeader :title="t('projects.list.title')" :description="t('projects.list.description')">
      <template v-if="can('projects:create')" #actions>
        <UiButton to="/admin/projects/new">
          <Plus aria-hidden="true" />
          {{ t('projects.list.create') }}
        </UiButton>
      </template>
    </AdminPageHeader>

    <UiAlert v-if="flash" :variant="flash.variant" live="polite" class="mb-6">
      {{ flash.message }}
    </UiAlert>

    <form role="search" :aria-label="t('projects.filters.label')" class="mb-6 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_auto] lg:items-end" @submit.prevent="applyFilters">
      <UiFormField v-slot="field" :label="t('projects.filters.search')">
        <UiInput v-bind="field" v-model="filters.q" type="search" name="q" autocomplete="off" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('projects.filters.status')">
        <UiSelect v-bind="field" v-model="filters.status" :options="statusOptions" name="status" />
      </UiFormField>
      <div class="flex gap-2">
        <UiButton type="submit" variant="secondary">
          <Search aria-hidden="true" />
          {{ t('projects.filters.apply') }}
        </UiButton>
        <UiButton v-if="hasFilters" to="/admin/projects" variant="ghost">
          {{ t('projects.filters.reset') }}
        </UiButton>
      </div>
    </form>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('projects.list.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="data">
      <p class="mb-3 text-sm text-muted-foreground" role="status">
        {{ t('projects.list.count', { count: data.total }, data.total) }}
      </p>

      <div
        v-if="data.items.length > 0"
        class="overflow-x-auto rounded-xl border border-border bg-surface"
        role="region"
        aria-labelledby="projects-caption"
        tabindex="0"
      >
        <table class="w-full min-w-[40rem] text-left text-sm">
          <caption id="projects-caption" class="sr-only">
            {{ t('projects.list.caption') }}
          </caption>
          <thead class="border-b border-border text-muted-foreground">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('projects.columns.project') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('projects.columns.role') }}
              </th>
              <th scope="col" class="px-4 py-3 text-right font-medium">
                {{ t('projects.columns.media') }}
              </th>
              <th scope="col" class="px-4 py-3 text-right font-medium">
                {{ t('projects.columns.members') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="item in data.items" :key="item.id" class="hover:bg-muted/60">
              <th scope="row" class="px-4 py-3 font-normal">
                <div class="flex flex-wrap items-center gap-2">
                  <NuxtLink :to="`/admin/projects/${item.id}`" class="font-medium text-primary underline-offset-4 hover:underline">
                    {{ item.name }}
                  </NuxtLink>
                  <UiBadge v-if="item.archivedAt" variant="warning">
                    {{ t('projects.status.archived') }}
                  </UiBadge>
                </div>
                <p class="mt-0.5 font-mono text-xs text-muted-foreground">
                  {{ item.slug }}
                </p>
              </th>
              <td class="px-4 py-3">
                {{ item.role ? t(`projectRoles.${item.role}.label`) : t('projects.list.noRole') }}
              </td>
              <td class="px-4 py-3 text-right tabular-nums">
                {{ item.mediaCount }}
              </td>
              <td class="px-4 py-3 text-right tabular-nums">
                {{ item.memberCount }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-14 text-center">
        <FolderKanban class="size-8 text-muted-foreground" aria-hidden="true" />
        <p class="font-medium text-foreground">
          {{ emptyMessage }}
        </p>
        <UiButton v-if="hasFilters" to="/admin/projects" variant="outline" size="sm">
          {{ t('projects.filters.reset') }}
        </UiButton>
      </div>

      <UiPagination class="mt-6" :page="data.page" :page-count="pageCount" :to="pageLink" />
    </template>
  </div>
</template>
