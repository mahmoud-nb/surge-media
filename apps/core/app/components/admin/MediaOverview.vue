<script setup lang="ts">
/**
 * Page « Médias », niveau « Tous les médias » (architecture : .claude/architecture-media-view.md) :
 * médias actifs de la bibliothèque et des projets actifs de l'utilisateur, à plat. Les espaces forment
 * le premier niveau de la navigation (tuiles, comme des dossiers racines, MV6) ; le filtre « Espace »
 * mène au même endroit. Chaque carte porte le nom de son espace (MV11). Envoi : destination
 * obligatoire, présélectionnée s'il n'y en a qu'une (MV4). Dossiers, actions groupées et corbeille
 * restent propres à un espace (MV8, MV9). Les espaces viennent du serveur (`scope=all`), jamais de l'URL.
 */
import { ChevronDown, FolderKanban, ImageOff, Library, Search } from '@lucide/vue'
import type { TagOption } from '~/composables/useTagLabels'

/** Tuiles d'espaces affichées avant « Afficher les autres ». */
const SPACE_TILES = 8

const { t } = useI18n()
const route = useRoute()

useSeoMeta({ title: () => t('media.overview.meta.title') })

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Formulaire de filtres (appliqués à la soumission) ; la liste suit les paramètres d'URL.
const filters = reactive({ q: '', kind: '', visibility: '', sort: '', space: '', tags: [] as string[], match: 'any' as TagMatch, untagged: false })
watch(() => route.query, (query) => {
  filters.q = queryValue(query.q)
  filters.kind = queryValue(query.kind)
  filters.visibility = queryValue(query.visibility)
  filters.sort = queryValue(query.sort) || 'newest'
  filters.space = ''
  filters.tags = queryValue(query.tags).split(',').filter(Boolean)
  filters.match = query.match === 'all' ? 'all' : 'any'
  filters.untagged = query.untagged === '1'
}, { immediate: true })
const hasFilters = computed(() => Boolean(route.query.q || route.query.kind || route.query.visibility || route.query.tags || route.query.untagged))

const { data: rules } = await useApiFetch('/api/admin/config/media')
const { data, error, refresh } = await useApiFetch('/api/admin/media', {
  query: computed(() => ({
    scope: 'all',
    q: route.query.q,
    kind: route.query.kind,
    visibility: route.query.visibility,
    sort: route.query.sort,
    page: route.query.page,
    tags: route.query.tags,
    match: route.query.match,
    untagged: route.query.untagged,
  })),
})
const { data: tagData } = await useApiFetch('/api/admin/tags', { query: { scope: 'all' } })
/**
 * Un même slug peut exister dans plusieurs projets : une seule suggestion par slug (le filtre le
 * cherche dans chaque espace, MV10). Les globales viennent en premier (tri du serveur).
 */
const tagOptions = computed(() => {
  const bySlug = new Map<string, TagOption>()
  for (const tag of (tagData.value?.tags ?? []) as TagOption[]) {
    if (!bySlug.has(tag.slug)) bySlug.set(tag.slug, tag)
  }
  return [...bySlug.values()]
})
/** Trop d'étiquettes : seules les globales sont proposées (MV10). */
const tagsTruncated = computed(() => Boolean(tagData.value && 'truncated' in tagData.value && tagData.value.truncated))
const pageCount = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))

// ─── Espaces ─────────────────────────────────────────────────────────────────

// La route renvoie l'une de ses deux formes : ici toujours celle de `scope=all` (avec `spaces`).
type AllMedia = Extract<NonNullable<typeof data.value>, { spaces: unknown }>
type SpaceSummary = AllMedia['spaces'][number]

const spaces = computed<SpaceSummary[]>(() => (data.value && 'spaces' in data.value ? data.value.spaces : []))
const spaceValue = (space: SpaceSummary) => (space.type === 'library' ? 'library' : space.id)
const spaceName = (space: SpaceSummary) => (space.type === 'library' ? t('media.overview.library') : space.name)
/** Nom de l'espace d'un média (badge), d'après son `projectId` (null = bibliothèque). */
const spaceNames = computed(() => new Map(spaces.value.map(space => [space.id, spaceName(space)])))
/** Espaces dont l'utilisateur ne peut pas modifier les médias (bibliothèque hors ADMIN) : icône sur le badge. */
const readOnlySpaces = computed(() => new Set(spaces.value.filter(space => !space.scopes.includes('media:write')).map(space => space.id)))
const showAllSpaces = ref(false)
const shownSpaces = computed(() => (showAllSpaces.value ? spaces.value : spaces.value.slice(0, SPACE_TILES)))
const hiddenSpaceCount = computed(() => Math.max(0, spaces.value.length - SPACE_TILES))
const spacesListId = useId()

/** Lien vers un espace : tri, type, visibilité et étiquettes conservés ; recherche et page réinitialisées. */
function spaceLink(value: string) {
  const { sort, kind, visibility, tags, match, untagged } = route.query
  return { query: { space: value, sort, kind, visibility, tags, match, untagged } }
}

// ─── Envoi (MV4) ─────────────────────────────────────────────────────────────

const destinations = computed(() => spaces.value.filter(space => space.scopes.includes('media:upload')))
const destination = ref('')
const destinationId = useId()
const destinationHintId = useId()
// Une seule destination possible : présélectionnée ; sinon le choix reste à faire (jamais implicite).
watch(destinations, (list) => {
  if (list.length === 1) destination.value = spaceValue(list[0]!)
  else if (!list.some(space => spaceValue(space) === destination.value)) destination.value = ''
}, { immediate: true })
const destinationOptions = computed(() => [
  ...(destinations.value.length > 1 ? [{ value: '', label: t('media.overview.upload.choose') }] : []),
  ...destinations.value.map(space => ({ value: spaceValue(space), label: spaceName(space) })),
])
const uploadEndpoint = computed(() => (destination.value && destination.value !== 'library'
  ? `/api/admin/media?project=${encodeURIComponent(destination.value)}`
  : '/api/admin/media'))

/** Section d'envoi ouverte d'emblée seulement quand il n'y a encore aucun média (rien d'autre à montrer). */
const uploadOpenByDefault = data.value?.total === 0 && !hasFilters.value

async function onUploaded() {
  await refresh()
}

// ─── Filtres ─────────────────────────────────────────────────────────────────

function applyFilters() {
  const query: Record<string, string> = {}
  // Un espace choisi : on y entre (même emplacement que sa tuile).
  if (filters.space) query.space = filters.space
  if (filters.q) query.q = filters.q
  if (filters.kind) query.kind = filters.kind
  if (filters.visibility) query.visibility = filters.visibility
  if (filters.sort && filters.sort !== 'newest') query.sort = filters.sort
  if (filters.tags.length > 0) {
    query.tags = filters.tags.join(',')
    if (filters.match === 'all' && filters.tags.length > 1) query.match = 'all'
  }
  else if (filters.untagged) query.untagged = '1'
  return navigateTo({ query })
}

function pageLink(page: number) {
  return { query: { ...route.query, page: page > 1 ? String(page) : undefined } }
}

const spaceOptions = computed(() => [
  { value: '', label: t('media.overview.filters.allSpaces') },
  ...spaces.value.map(space => ({ value: spaceValue(space), label: spaceName(space) })),
])
const kindOptions = computed(() => [
  { value: '', label: t('media.filters.allKinds') },
  ...Object.keys(rules.value?.acceptedTypes ?? {}).map(kind => ({ value: kind, label: t(`media.kinds.${kind}`) })),
])
const visibilityOptions = computed(() => [
  { value: '' as const, label: t('media.filters.allVisibilities') },
  ...MEDIA_VISIBILITIES.map(value => ({ value, label: t(`media.visibility.${value}.label`) })),
])
const sortOptions = computed(() => (['newest', 'oldest', 'name', 'size'] as const).map(value => ({ value, label: t(`media.filters.sorts.${value}`) })))
const matchOptions = computed(() => TAG_MATCHES.map(value => ({ value, label: t(`media.filters.tagMatches.${value}`) })))
</script>

<template>
  <div>
    <!-- Espaces : premier niveau de la navigation -->
    <section aria-labelledby="spaces-title" class="mb-8 grid gap-4 rounded-xl border border-border bg-surface p-4">
      <h2 id="spaces-title" tabindex="-1" class="text-lg font-semibold text-foreground">
        {{ t('media.overview.spaces.title') }}
      </h2>
      <ul :id="spacesListId" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" :aria-label="t('media.overview.spaces.title')">
        <li v-for="space in shownSpaces" :key="spaceValue(space)">
          <NuxtLink :to="spaceLink(spaceValue(space))" class="flex items-center gap-3 rounded-lg border border-input bg-surface px-3 py-2.5 transition-colors hover:bg-muted">
            <component :is="space.type === 'library' ? Library : FolderKanban" class="size-5 shrink-0 text-primary" aria-hidden="true" />
            <span class="grid min-w-0">
              <span class="truncate text-sm font-medium text-foreground" :title="spaceName(space)">{{ spaceName(space) }}</span>
              <span class="text-xs text-muted-foreground">{{ t('folders.mediaCount', { count: space.mediaCount }, space.mediaCount) }}</span>
            </span>
          </NuxtLink>
        </li>
      </ul>
      <UiButton
        v-if="hiddenSpaceCount > 0"
        variant="ghost"
        size="sm"
        class="justify-self-start"
        :aria-expanded="showAllSpaces"
        :aria-controls="spacesListId"
        @click="showAllSpaces = !showAllSpaces"
      >
        <ChevronDown :class="cn('transition-transform', showAllSpaces && 'rotate-180')" aria-hidden="true" />
        {{ showAllSpaces ? t('media.overview.spaces.showLess') : t('media.overview.spaces.showMore', { count: hiddenSpaceCount }, hiddenSpaceCount) }}
      </UiButton>
    </section>

    <!-- Envoi : toujours dans un espace précis ; section repliée tant qu'il y a des médias à montrer. -->
    <AdminUploadPanel v-if="rules && destinations.length > 0" :default-open="uploadOpenByDefault">
      <div class="mb-3 grid max-w-md gap-1.5">
        <label :for="destinationId" class="text-sm font-medium text-foreground">{{ t('media.overview.upload.destination') }}</label>
        <UiSelect :id="destinationId" v-model="destination" :options="destinationOptions" :aria-describedby="destinationHintId" required />
        <p :id="destinationHintId" class="text-sm text-muted-foreground">
          {{ destination ? t('media.overview.upload.hint') : t('media.overview.upload.required') }}
        </p>
      </div>
      <AdminMediaUploader :rules="rules" :endpoint="uploadEndpoint" :disabled="!destination" :described-by="destinationHintId" @done="onUploaded" />
    </AdminUploadPanel>

    <form
      role="search"
      :aria-label="t('media.filters.label')"
      :class="cn(
        'mb-6 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 sm:items-end',
        kindOptions.length > 2 ? 'xl:grid-cols-[minmax(0,1fr)_9rem_9rem_10rem_10rem]' : 'xl:grid-cols-[minmax(0,1fr)_11rem_11rem_12rem]',
      )"
      @submit.prevent="applyFilters"
    >
      <UiFormField v-slot="field" :label="t('media.filters.search')">
        <UiInput v-bind="field" v-model="filters.q" type="search" name="q" autocomplete="off" />
      </UiFormField>
      <UiFormField v-if="kindOptions.length > 2" v-slot="field" :label="t('media.filters.kind')">
        <UiSelect v-bind="field" v-model="filters.kind" :options="kindOptions" name="kind" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('media.filters.visibility')">
        <UiSelect v-bind="field" v-model="filters.visibility" :options="visibilityOptions" name="visibility" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('media.filters.sort')">
        <UiSelect v-bind="field" v-model="filters.sort" :options="sortOptions" name="sort" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('media.overview.filters.space')">
        <UiSelect v-bind="field" v-model="filters.space" :options="spaceOptions" name="space" />
      </UiFormField>
      <div :class="cn('grid gap-4 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start', kindOptions.length > 2 ? 'xl:col-span-5' : 'xl:col-span-4')">
        <div class="grid gap-1">
          <AdminTagInput
            v-model="filters.tags"
            :options="tagOptions"
            by="slug"
            :label="t('media.filters.tags')"
            :hint="tagsTruncated ? t('media.overview.tagsTruncated') : t('media.filters.tagsHint')"
          />
          <NuxtLink to="/admin/tags" class="justify-self-start text-sm text-primary underline-offset-4 hover:underline">
            {{ t('tags.manageLink') }}
          </NuxtLink>
        </div>
        <UiFormField v-if="filters.tags.length > 1" v-slot="field" :label="t('media.filters.tagMatch')" class="sm:pt-[1.625rem]">
          <UiSelect v-bind="field" v-model="filters.match" :options="matchOptions" name="match" />
        </UiFormField>
      </div>
      <div :class="cn('flex flex-wrap items-center gap-x-6 gap-y-3 sm:col-span-2', kindOptions.length > 2 ? 'xl:col-span-5' : 'xl:col-span-4')">
        <label v-if="filters.tags.length === 0" class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input v-model="filters.untagged" type="checkbox" name="untagged" class="size-4 accent-primary">
          {{ t('media.filters.untagged') }}
        </label>
        <div class="ml-auto flex gap-2">
          <UiButton type="submit" variant="secondary">
            <Search aria-hidden="true" />
            {{ t('media.filters.apply') }}
          </UiButton>
          <UiButton v-if="hasFilters" :to="{ query: {} }" variant="ghost">
            {{ t('media.filters.reset') }}
          </UiButton>
        </div>
      </div>
    </form>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('media.list.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="data">
      <h2 class="sr-only">
        {{ t('media.list.results') }}
      </h2>
      <div class="mb-3 grid gap-1">
        <p class="text-sm text-muted-foreground" role="status">
          {{ t('media.list.count', { count: data.total }, data.total) }}
        </p>
        <p class="text-sm text-muted-foreground">
          {{ t('media.overview.spaceActions') }}
        </p>
      </div>

      <ul v-if="data.items.length > 0" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" :aria-label="t('media.list.gridLabel')">
        <li v-for="item in data.items" :key="item.id">
          <AdminMediaCard
            :media="item"
            :space-label="spaceNames.get(item.projectId)"
            :space-read-only="readOnlySpaces.has(item.projectId)"
            :link-query="{ from: 'all' }"
          />
        </li>
      </ul>

      <div v-else class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-14 text-center">
        <ImageOff class="size-8 text-muted-foreground" aria-hidden="true" />
        <p class="font-medium text-foreground">
          {{ hasFilters ? t('media.list.emptyFiltered') : t('media.overview.empty') }}
        </p>
      </div>

      <UiPagination class="mt-6" :page="data.page" :page-count="pageCount" :to="pageLink" />
    </template>
  </div>
</template>
