<script setup lang="ts">
/**
 * Médias d'un espace — la bibliothèque (sans `projectId`) ou un projet : navigation dans les
 * dossiers (fil d'Ariane, sous-dossiers, actions), envoi dans le dossier affiché (si l'utilisateur
 * en a le droit), filtres dans l'URL, grille paginée, rangement groupé et corbeille. L'espace est
 * imposé par le serveur ; les filtres ne font que s'y ajouter.
 *
 * URL : `folder` = dossier affiché (absent = racine), `recursive=1` = sous-dossiers compris ;
 * la corbeille montre tout l'espace.
 */
import { ChevronRight, Folder, FolderInput, ImageOff, ListChecks, Search } from '@lucide/vue'

const props = defineProps<{
  /** Projet affiché ; absent = bibliothèque de l'organisation. */
  projectId?: string
}>()

const { t } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Formulaire de filtres (appliqués à la soumission) ; la liste suit les paramètres d'URL.
const filters = reactive({ q: '', visibility: '', sort: '', status: '', recursive: false })
watch(() => route.query, (query) => {
  filters.q = queryValue(query.q)
  filters.visibility = queryValue(query.visibility)
  filters.sort = queryValue(query.sort) || 'newest'
  filters.status = queryValue(query.status)
  filters.recursive = query.recursive === '1'
}, { immediate: true })

const inTrash = computed(() => route.query.status === 'trash')
const folderId = computed(() => (inTrash.value ? undefined : queryValue(route.query.folder) || undefined))
const recursive = computed(() => !inTrash.value && route.query.recursive === '1')
const hasFilters = computed(() => Boolean(route.query.q || route.query.visibility || recursive.value))

const { data: rules } = await useApiFetch('/api/admin/config/media')
const { data: folderData, refresh: refreshFolders } = await useApiFetch('/api/admin/folders', {
  query: computed(() => ({ project: props.projectId })),
})
const { data, error, refresh } = await useApiFetch('/api/admin/media', {
  query: computed(() => ({
    project: props.projectId,
    folder: folderId.value,
    recursive: recursive.value ? '1' : undefined,
    q: route.query.q,
    visibility: route.query.visibility,
    sort: route.query.sort,
    status: route.query.status,
    page: route.query.page,
  })),
})

const scopes = computed<readonly string[]>(() => folderData.value?.scopes ?? data.value?.scopes ?? [])
const canUpload = computed(() => scopes.value.includes('media:upload'))
const canWrite = computed(() => scopes.value.includes('media:write'))
const uploadEndpoint = computed(() => (props.projectId ? `/api/admin/media?project=${encodeURIComponent(props.projectId)}` : '/api/admin/media'))
const pageCount = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))

// ─── Dossiers ────────────────────────────────────────────────────────────────

const folders = computed(() => folderData.value?.folders ?? [])
const folderIndex = computed(() => indexFolders(folders.value))
const currentFolder = computed(() => (folderId.value ? folderIndex.value.byId.get(folderId.value) ?? null : null))
/** Dossier de l'URL absent de l'espace (supprimé, déplacé ou lien d'un autre espace). */
const folderMissing = computed(() => Boolean(folderId.value && folderData.value && !currentFolder.value))
const breadcrumb = computed(() => (currentFolder.value ? folderAncestors(folderIndex.value, currentFolder.value.id) : []))
const subfolders = computed(() => folderIndex.value.children.get(currentFolder.value?.id ?? null) ?? [])
const uploadFields = computed(() => {
  const fields: Record<string, string> = {}
  if (currentFolder.value) fields.folderId = currentFolder.value.id
  return fields
})

/** Lien vers un dossier : tri, visibilité et récursivité conservés, recherche et page réinitialisées. */
function folderLink(id: string | null) {
  const { sort, visibility, recursive: withSubfolders } = route.query
  return { query: { sort, visibility, recursive: withSubfolders, folder: id ?? undefined } }
}

async function onFoldersChanged() {
  await Promise.all([refreshFolders(), refresh()])
}

/** Dossier supprimé : on affiche son parent, le focus revient sur le titre de la section. */
async function onFolderDeleted(parentId: string | null) {
  await navigateTo(folderLink(parentId))
  await refreshFolders()
  await nextTick()
  document.getElementById('folders-title')?.focus()
}

async function onUploaded() {
  await Promise.all([refresh(), refreshFolders()])
}

// ─── Filtres ─────────────────────────────────────────────────────────────────

function applyFilters() {
  const query: Record<string, string> = {}
  if (filters.q) query.q = filters.q
  if (filters.visibility) query.visibility = filters.visibility
  // Valeurs par défaut omises de l'URL (tri « plus récents », médias actifs).
  if (filters.sort && filters.sort !== 'newest') query.sort = filters.sort
  if (filters.status) query.status = filters.status
  if (filters.status !== 'trash') {
    if (folderId.value) query.folder = folderId.value
    if (filters.recursive) query.recursive = '1'
  }
  return navigateTo({ query })
}

function pageLink(page: number) {
  return { query: { ...route.query, page: page > 1 ? String(page) : undefined } }
}

const resetLink = computed(() => ({ query: inTrash.value ? { status: 'trash' } : { folder: folderId.value } }))

const visibilityOptions = computed(() => [
  { value: '' as const, label: t('media.filters.allVisibilities') },
  ...MEDIA_VISIBILITIES.map(value => ({ value, label: t(`media.visibility.${value}.label`) })),
])
const sortOptions = computed(() => (['newest', 'oldest', 'name', 'size'] as const).map(value => ({ value, label: t(`media.filters.sorts.${value}`) })))
const statusOptions = computed(() => [
  { value: '' as const, label: t('media.filters.active') },
  { value: 'trash' as const, label: t('media.filters.trash') },
])

const emptyMessage = computed(() => {
  if (inTrash.value) return t('media.list.emptyTrash')
  if (route.query.q && !recursive.value && folders.value.length > 0) return t('media.list.emptyFilteredFolder')
  if (hasFilters.value) return t('media.list.emptyFiltered')
  return currentFolder.value ? t('media.list.emptyFolder') : t('media.list.empty')
})

// ─── Sélection et rangement groupé ───────────────────────────────────────────

const ROOT = 'root'
const selecting = ref(false)
const selected = ref<string[]>([])
const bulkTarget = ref(ROOT)
const bulkTargetId = useId()
const filing = ref(false)
const bulkStatus = ref<{ variant: 'success' | 'error', message: string } | null>(null)
const canSelect = computed(() => canWrite.value && !inTrash.value && Boolean(data.value?.items.length))

const bulkOptions = computed(() => [
  { value: ROOT, label: t('folders.root') },
  ...flattenFolders(folderIndex.value).map(({ folder }) => ({ value: folder.id, label: folderPathLabel(folderIndex.value, folder.id) })),
])

// La sélection ne garde que les médias encore affichés (changement de page, de dossier, rechargement).
watch(() => data.value?.items, (items) => {
  const visible = new Set((items ?? []).map(item => item.id))
  selected.value = selected.value.filter(id => visible.has(id))
})

// Changement de dossier : le résultat du dernier rangement n'y a plus de sens.
watch(folderId, () => {
  bulkStatus.value = null
})

function toggleSelecting() {
  selecting.value = !selecting.value
  selected.value = []
  bulkStatus.value = null
  bulkTarget.value = currentFolder.value?.id ?? ROOT
}

function isSelected(id: string) {
  return selected.value.includes(id)
}

function setSelected(id: string, value: boolean) {
  selected.value = value ? [...new Set([...selected.value, id])] : selected.value.filter(item => item !== id)
}

function selectPage() {
  selected.value = (data.value?.items ?? []).map(item => item.id)
}

function fileRequest(ids: string[], target: string | null) {
  return $api('/api/admin/media', { method: 'PATCH', query: { project: props.projectId }, body: { ids, folderId: target } })
}

async function fileSelected() {
  if (selected.value.length === 0) return
  const target = bulkTarget.value === ROOT ? null : bulkTarget.value
  bulkStatus.value = null
  filing.value = true
  try {
    const { moved } = await fileRequest(selected.value, target)
    const destination = target ? folderPathLabel(folderIndex.value, target) : t('folders.root')
    bulkStatus.value = { variant: 'success', message: t('media.selection.moved', { count: moved, folder: destination }, moved) }
    selected.value = []
    await Promise.all([refresh(), refreshFolders()])
  }
  catch (err) {
    const { code } = apiError(err)
    bulkStatus.value = {
      variant: 'error',
      message: code && (FOLDER_ERROR_CODES as readonly string[]).includes(code) ? t(`folders.errors.${code}`) : t('common.unexpectedError'),
    }
  }
  finally {
    filing.value = false
  }
}
</script>

<template>
  <div>
    <!-- Emplacement et dossiers -->
    <section v-if="!inTrash" aria-labelledby="folders-title" class="mb-8 grid gap-4 rounded-xl border border-border bg-surface p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <h2 id="folders-title" tabindex="-1" class="text-lg font-semibold text-foreground">
          {{ t('folders.title') }}
        </h2>
        <AdminFolderActions
          v-if="canWrite && !folderMissing"
          :project-id="projectId"
          :folders="folders"
          :current="currentFolder"
          @changed="onFoldersChanged"
          @deleted="onFolderDeleted"
        />
      </div>
      <nav :aria-label="t('folders.breadcrumbLabel')">
        <ol class="flex flex-wrap items-center gap-1 text-sm">
          <li class="flex items-center gap-1">
            <NuxtLink
              :to="folderLink(null)"
              :aria-current="currentFolder ? undefined : 'page'"
              class="rounded font-medium text-primary underline-offset-4 hover:underline aria-[current=page]:text-foreground aria-[current=page]:no-underline"
            >
              {{ t('folders.root') }}
            </NuxtLink>
          </li>
          <li v-for="(folder, index) in breadcrumb" :key="folder.id" class="flex min-w-0 items-center gap-1">
            <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <NuxtLink
              :to="folderLink(folder.id)"
              :aria-current="index === breadcrumb.length - 1 ? 'page' : undefined"
              class="truncate rounded font-medium text-primary underline-offset-4 hover:underline aria-[current=page]:text-foreground aria-[current=page]:no-underline"
            >
              {{ folder.name }}
            </NuxtLink>
          </li>
        </ol>
      </nav>

      <UiAlert v-if="folderMissing" variant="warning" :title="t('folders.missing.title')">
        <p>{{ t('folders.missing.description') }}</p>
        <UiButton :to="folderLink(null)" variant="outline" size="sm" class="mt-2">
          {{ t('folders.missing.back') }}
        </UiButton>
      </UiAlert>

      <template v-else>
        <ul v-if="subfolders.length > 0" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" :aria-label="t('folders.listLabel')">
          <li v-for="folder in subfolders" :key="folder.id">
            <NuxtLink :to="folderLink(folder.id)" class="flex items-center gap-3 rounded-lg border border-input bg-surface px-3 py-2.5 transition-colors hover:bg-muted">
              <Folder class="size-5 shrink-0 text-primary" aria-hidden="true" />
              <span class="grid min-w-0">
                <span class="truncate text-sm font-medium text-foreground" :title="folder.name">{{ folder.name }}</span>
                <span class="text-xs text-muted-foreground">{{ t('folders.mediaCount', { count: folder.mediaCount }, folder.mediaCount) }}</span>
              </span>
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">
          {{ t('folders.empty') }}
        </p>
      </template>
    </section>

    <section v-if="!inTrash && !folderMissing && rules && canUpload" aria-labelledby="upload-title" class="mb-8">
      <h2 id="upload-title" class="mb-1 text-lg font-semibold text-foreground">
        {{ t('media.upload.title') }}
      </h2>
      <p class="mb-3 text-sm text-muted-foreground">
        {{ currentFolder ? t('folders.upload.destinationFolder', { name: currentFolder.name }) : t('folders.upload.destinationRoot') }}
      </p>
      <AdminMediaUploader :rules="rules" :endpoint="uploadEndpoint" :fields="uploadFields" @done="onUploaded" />
    </section>

    <form role="search" :aria-label="t('media.filters.label')" class="mb-6 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(0,1fr)_11rem_11rem_11rem_auto]" @submit.prevent="applyFilters">
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
        <UiButton v-if="hasFilters" :to="resetLink" variant="ghost">
          {{ t('media.filters.reset') }}
        </UiButton>
      </div>
      <label v-if="filters.status !== 'trash'" class="flex cursor-pointer items-center gap-2 text-sm text-foreground sm:col-span-2 xl:col-span-5">
        <input v-model="filters.recursive" type="checkbox" name="recursive" class="size-4 accent-primary">
        {{ t('media.filters.recursive') }}
      </label>
    </form>

    <UiAlert v-if="error && !folderMissing" variant="error" live="assertive" :title="t('media.list.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="data && !folderMissing">
      <!-- Niveau de titre : les cartes (h3) suivent toujours un h2, même sans la section d'envoi. -->
      <h2 class="sr-only">
        {{ t('media.list.results') }}
      </h2>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground" role="status">
          {{ t('media.list.count', { count: data.total }, data.total) }}
        </p>
        <UiButton v-if="canSelect || selecting" variant="outline" size="sm" @click="toggleSelecting">
          <ListChecks aria-hidden="true" />
          {{ selecting ? t('media.selection.done') : t('media.selection.start') }}
        </UiButton>
      </div>

      <div v-if="selecting" class="mb-4 grid gap-3 rounded-xl border border-border bg-surface p-4">
        <div class="flex flex-wrap items-end gap-3">
          <p class="mr-auto self-center text-sm font-medium text-foreground" role="status">
            {{ t('media.selection.count', { count: selected.length }, selected.length) }}
          </p>
          <UiButton variant="ghost" size="sm" @click="selectPage">
            {{ t('media.selection.selectPage') }}
          </UiButton>
          <div class="grid min-w-56 gap-1.5">
            <label :for="bulkTargetId" class="text-sm font-medium text-foreground">{{ t('media.selection.target') }}</label>
            <UiSelect :id="bulkTargetId" v-model="bulkTarget" :options="bulkOptions" />
          </div>
          <UiButton :disabled="selected.length === 0" :loading="filing" @click="fileSelected">
            <FolderInput aria-hidden="true" />
            {{ t('media.selection.submit') }}
          </UiButton>
        </div>
        <UiAlert v-if="bulkStatus" :variant="bulkStatus.variant" :live="bulkStatus.variant === 'error' ? 'assertive' : 'polite'">
          {{ bulkStatus.message }}
        </UiAlert>
      </div>

      <ul v-if="data.items.length > 0" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" :aria-label="t('media.list.gridLabel')">
        <li v-for="item in data.items" :key="item.id">
          <AdminMediaCard
            :media="item"
            :selectable="selecting"
            :selected="isSelected(item.id)"
            @update:selected="setSelected(item.id, $event)"
          />
        </li>
      </ul>

      <div v-else class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-14 text-center">
        <ImageOff class="size-8 text-muted-foreground" aria-hidden="true" />
        <p class="font-medium text-foreground">
          {{ emptyMessage }}
        </p>
      </div>

      <UiPagination class="mt-6" :page="data.page" :page-count="pageCount" :to="pageLink" />
    </template>
  </div>
</template>
