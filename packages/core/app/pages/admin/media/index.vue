<script setup lang="ts">
import { ImageOff, Search } from '@lucide/vue'

definePageMeta({ layout: 'admin', permission: 'media:manage' })

const { t } = useI18n()
const route = useRoute()

useSeoMeta({ title: () => (route.query.status === 'trash' ? t('media.list.trashTitle') : t('media.list.meta.title')) })

const flash = useFlash().consume()

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Formulaire de filtres (appliqués à la soumission) ; la liste suit les paramètres d'URL.
const filters = reactive({ q: '', visibility: '', sort: '', status: '' })
watch(() => route.query, (query) => {
  filters.q = queryValue(query.q)
  filters.visibility = queryValue(query.visibility)
  filters.sort = queryValue(query.sort) || 'newest'
  filters.status = queryValue(query.status)
}, { immediate: true })

const inTrash = computed(() => route.query.status === 'trash')
const hasFilters = computed(() => Boolean(route.query.q || route.query.visibility))

const { data: rules } = await useApiFetch('/api/admin/config/media')
const { data, error, refresh } = await useApiFetch('/api/admin/media', {
  query: computed(() => ({
    q: route.query.q,
    visibility: route.query.visibility,
    sort: route.query.sort,
    status: route.query.status,
    page: route.query.page,
  })),
})

const pageCount = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))

function applyFilters() {
  // Valeurs par défaut omises de l'URL (tri « plus récents », médiathèque).
  const query = Object.fromEntries(Object.entries(filters).filter(([name, value]) => value && !(name === 'sort' && value === 'newest')))
  return navigateTo({ query })
}

function pageLink(page: number) {
  return { query: { ...route.query, page: page > 1 ? String(page) : undefined } }
}

const visibilityOptions = computed(() => [
  { value: '' as const, label: t('media.filters.allVisibilities') },
  ...MEDIA_VISIBILITIES.map(value => ({ value, label: t(`media.visibility.${value}.label`) })),
])
const sortOptions = computed(() => (['newest', 'oldest', 'name', 'size'] as const).map(value => ({ value, label: t(`media.filters.sorts.${value}`) })))
const statusOptions = computed(() => [
  { value: '' as const, label: t('media.filters.library') },
  { value: 'trash' as const, label: t('media.filters.trash') },
])
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <AdminPageHeader
      :title="inTrash ? t('media.list.trashTitle') : t('media.list.title')"
      :description="inTrash ? t('media.list.trashDescription') : t('media.list.description')"
    />

    <UiAlert v-if="flash" :variant="flash.variant" live="polite" class="mb-6">
      {{ flash.message }}
    </UiAlert>

    <section v-if="!inTrash && rules" aria-labelledby="upload-title" class="mb-8">
      <h2 id="upload-title" class="mb-3 text-lg font-semibold text-foreground">
        {{ t('media.upload.title') }}
      </h2>
      <AdminMediaUploader :rules="rules" @done="refresh()" />
    </section>

    <form role="search" :aria-label="t('media.filters.label')" class="mb-6 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_11rem_auto] lg:items-end" @submit.prevent="applyFilters">
      <UiFormField v-slot="field" :label="t('media.filters.search')">
        <UiInput v-bind="field" v-model="filters.q" type="search" name="q" autocomplete="off" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('media.filters.visibility')">
        <UiSelect v-bind="field" v-model="filters.visibility" :options="visibilityOptions" name="visibility" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('media.filters.sort')">
        <UiSelect v-bind="field" v-model="filters.sort" :options="sortOptions" name="sort" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('media.filters.show')">
        <UiSelect v-bind="field" v-model="filters.status" :options="statusOptions" name="status" />
      </UiFormField>
      <div class="flex gap-2">
        <UiButton type="submit" variant="secondary">
          <Search aria-hidden="true" />
          {{ t('media.filters.apply') }}
        </UiButton>
        <UiButton v-if="hasFilters" :to="{ query: inTrash ? { status: 'trash' } : {} }" variant="ghost">
          {{ t('media.filters.reset') }}
        </UiButton>
      </div>
    </form>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('media.list.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="data">
      <!-- Niveau de titre : les cartes (h3) suivent toujours un h2, même sans la section d'envoi. -->
      <h2 class="sr-only">
        {{ t('media.list.results') }}
      </h2>
      <p class="mb-3 text-sm text-muted-foreground" role="status">
        {{ t('media.list.count', { count: data.total }, data.total) }}
      </p>

      <ul v-if="data.items.length > 0" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" :aria-label="t('media.list.gridLabel')">
        <li v-for="item in data.items" :key="item.id">
          <AdminMediaCard :media="item" />
        </li>
      </ul>

      <div v-else class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-14 text-center">
        <ImageOff class="size-8 text-muted-foreground" aria-hidden="true" />
        <p class="font-medium text-foreground">
          {{ hasFilters ? t('media.list.emptyFiltered') : inTrash ? t('media.list.emptyTrash') : t('media.list.empty') }}
        </p>
      </div>

      <UiPagination class="mt-6" :page="data.page" :page-count="pageCount" :to="pageLink" />
    </template>
  </div>
</template>
