<script setup lang="ts">
/**
 * Gestion d'une liste d'étiquettes (architecture-tags.md) :
 *   - sans `projectId` : la liste **globale** (bibliothèque et tous les projets), gérée par l'ADMIN ;
 *   - avec `projectId` : les étiquettes du projet (gérées par son propriétaire), puis le rappel des globales.
 * Lecture pour tous ; création, modification et suppression selon `canManage`. Les confidentielles ne sont
 * reçues que par l'ADMIN et le MANAGER. Le nombre de médias d'une étiquette de projet mène à la médiathèque
 * du projet filtrée.
 */
import { Pencil, Plus, Tags, Trash2 } from '@lucide/vue'
import { createTagSchema, updateTagSchema } from '#shared/schemas/tags'
import type { TagFormValue } from '~/composables/useTagLabels'

interface TagSummary {
  id: string
  name: string
  slug: string
  color: string
  level: TagLevel
  confidential: boolean
  mediaCount: number | null
}

const props = defineProps<{
  /** Projet ; absent = liste globale. */
  projectId?: string
}>()

const { t } = useI18n()
const { $api } = useNuxtApp()
const { tagErrorMessage } = useTagLabels()

const { data, error, refresh } = await useApiFetch('/api/admin/tags', { query: computed(() => ({ project: props.projectId })) })

const tags = computed(() => (data.value?.tags ?? []) as TagSummary[])
const canManage = computed(() => Boolean(data.value?.canManage))
const canManageGlobal = computed(() => Boolean(data.value?.canManageGlobal))
const canConfidential = computed(() => Boolean(data.value?.canSeeConfidential))
const ownTags = computed(() => tags.value.filter(tag => (props.projectId ? tag.level === 'project' : tag.level === 'global')))
const globalTags = computed(() => (props.projectId ? tags.value.filter(tag => tag.level === 'global') : []))

const status = ref<{ variant: 'success' | 'error', message: string } | null>(null)

function emptyForm(): TagFormValue {
  return { name: '', slug: '', color: TAG_DEFAULT_COLOR, confidential: false }
}

/** Corps envoyé : slug vide = proposé par le serveur ; confidentialité seulement pour qui la voit. */
function payload(form: TagFormValue) {
  return { name: form.name, slug: form.slug || undefined, color: form.color, ...(canConfidential.value ? { confidential: form.confidential } : {}) }
}

/** Lien vers la médiathèque filtrée (étiquettes du projet, ou globales dans un projet). */
function mediaLink(tag: TagSummary) {
  return props.projectId ? { path: `/admin/projects/${props.projectId}/media`, query: { tags: tag.slug, recursive: '1' } } : null
}

// ─── Création ────────────────────────────────────────────────────────────────

const CREATE_IDS = { name: 'tag-create-name', slug: 'tag-create-slug' } as const
const createForm = ref<TagFormValue>(emptyForm())
const creating = ref(false)
const create = useFormValidation(createTagSchema, CREATE_IDS)
const createErrors = computed(() => ({ name: create.message('name'), slug: create.message('slug') }))

async function submitCreate() {
  status.value = null
  const input = create.validate(payload(createForm.value))
  if (!input) return
  creating.value = true
  try {
    const { tag } = await $api('/api/admin/tags', { method: 'POST', query: { project: props.projectId }, body: input })
    status.value = { variant: 'success', message: t('tags.manager.created', { name: tag.name }) }
    createForm.value = emptyForm()
    await refresh()
  }
  catch (err) {
    status.value = { variant: 'error', message: tagErrorMessage(err) }
  }
  finally {
    creating.value = false
  }
}

// ─── Modification ────────────────────────────────────────────────────────────

const EDIT_IDS = { name: 'tag-edit-name', slug: 'tag-edit-slug' } as const
const editing = ref<TagSummary | null>(null)
const editOpen = ref(false)
const editForm = ref<TagFormValue>(emptyForm())
const editStatus = ref<string>()
const saving = ref(false)
const edit = useFormValidation(updateTagSchema, EDIT_IDS)
const editErrors = computed(() => ({ name: edit.message('name'), slug: edit.message('slug') }))

function openEdit(tag: TagSummary) {
  editing.value = tag
  editForm.value = { name: tag.name, slug: tag.slug, color: tag.color as TagColor, confidential: tag.confidential }
  editStatus.value = undefined
  editOpen.value = true
}

async function submitEdit() {
  if (!editing.value) return
  editStatus.value = undefined
  const input = edit.validate({ ...payload(editForm.value), slug: editForm.value.slug })
  if (!input) return
  saving.value = true
  try {
    const { tag } = await $api(`/api/admin/tags/${editing.value.id}`, { method: 'PATCH', body: input })
    editOpen.value = false
    status.value = { variant: 'success', message: t('tags.manager.updated', { name: tag.name }) }
    await refresh()
  }
  catch (err) {
    editStatus.value = tagErrorMessage(err)
  }
  finally {
    saving.value = false
  }
}

// ─── Suppression ─────────────────────────────────────────────────────────────

const removing = ref<TagSummary | null>(null)
const removeOpen = ref(false)
const deleting = ref(false)

function openRemove(tag: TagSummary) {
  removing.value = tag
  removeOpen.value = true
}

async function confirmRemove() {
  const tag = removing.value
  if (!tag) return
  deleting.value = true
  try {
    await $api(`/api/admin/tags/${tag.id}`, { method: 'DELETE' })
    removeOpen.value = false
    status.value = { variant: 'success', message: t('tags.manager.deleted', { name: tag.name }) }
    await refresh()
  }
  catch (err) {
    removeOpen.value = false
    status.value = { variant: 'error', message: tagErrorMessage(err) }
  }
  finally {
    deleting.value = false
  }
}

const removeDescription = computed(() => {
  const tag = removing.value
  if (!tag) return ''
  return tag.mediaCount === null
    ? t('tags.manager.deleteDescriptionUnknown', { name: tag.name })
    : t('tags.manager.deleteDescription', { name: tag.name, count: tag.mediaCount }, tag.mediaCount)
})
</script>

<template>
  <div class="grid gap-8">
    <UiAlert v-if="error" variant="error" live="assertive" :title="t('tags.manager.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="data">
      <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
        {{ status.message }}
      </UiAlert>

      <section aria-labelledby="tags-own-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <h2 id="tags-own-title" class="text-lg font-semibold text-foreground">
          {{ projectId ? t('tags.manager.projectTitle') : t('tags.manager.globalTitle') }}
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ projectId ? t('tags.manager.projectDescription') : t('tags.manager.globalDescription') }}
        </p>
        <UiAlert v-if="!canManage" variant="info" class="mt-4">
          {{ projectId ? t('tags.manager.readOnlyProject') : t('tags.manager.readOnlyGlobal') }}
        </UiAlert>

        <ul v-if="ownTags.length > 0" class="mt-5 divide-y divide-border rounded-lg border border-border" :aria-label="projectId ? t('tags.manager.projectTitle') : t('tags.manager.globalTitle')">
          <li v-for="tag in ownTags" :key="tag.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <AdminTagBadge :tag="tag" />
            <code class="min-w-0 truncate text-xs text-muted-foreground">{{ tag.slug }}</code>
            <span v-if="tag.mediaCount !== null" class="text-sm text-muted-foreground">
              <NuxtLink v-if="mediaLink(tag) && tag.mediaCount > 0" :to="mediaLink(tag)!" class="text-primary underline-offset-4 hover:underline">
                {{ t('tags.manager.mediaCount', { count: tag.mediaCount }, tag.mediaCount) }}
              </NuxtLink>
              <template v-else>{{ t('tags.manager.mediaCount', { count: tag.mediaCount }, tag.mediaCount) }}</template>
            </span>
            <span v-if="canManage" class="ml-auto flex gap-1">
              <UiButton variant="ghost" size="sm" :aria-label="t('tags.manager.editLabel', { name: tag.name })" @click="openEdit(tag)">
                <Pencil aria-hidden="true" />
                {{ t('tags.manager.edit') }}
              </UiButton>
              <UiButton variant="ghost" size="sm" :aria-label="t('tags.manager.deleteLabel', { name: tag.name })" @click="openRemove(tag)">
                <Trash2 aria-hidden="true" />
                {{ t('tags.manager.delete') }}
              </UiButton>
            </span>
          </li>
        </ul>
        <div v-else class="mt-5 flex flex-col items-center gap-2 rounded-lg border border-dashed border-input px-6 py-8 text-center">
          <Tags class="size-6 text-muted-foreground" aria-hidden="true" />
          <p class="text-sm text-muted-foreground">
            {{ t('tags.manager.empty') }}
          </p>
        </div>

        <form v-if="canManage" class="mt-6 grid gap-4 border-t border-border pt-6" novalidate @submit.prevent="submitCreate">
          <h3 class="text-base font-semibold text-foreground">
            {{ t('tags.manager.createTitle') }}
          </h3>
          <AdminTagForm v-model="createForm" id-prefix="tag-create" :errors="createErrors" :can-confidential="canConfidential" />
          <div>
            <UiButton type="submit" :loading="creating">
              <Plus aria-hidden="true" />
              {{ t('tags.manager.create') }}
            </UiButton>
          </div>
        </form>
      </section>

      <section v-if="projectId" aria-labelledby="tags-global-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <h2 id="tags-global-title" class="text-lg font-semibold text-foreground">
          {{ t('tags.manager.globalTitle') }}
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('tags.manager.globalInProject') }}
          <NuxtLink v-if="canManageGlobal" to="/admin/tags" class="text-primary underline-offset-4 hover:underline">{{ t('tags.manager.manageGlobal') }}</NuxtLink>
        </p>
        <ul v-if="globalTags.length > 0" class="mt-4 flex flex-wrap gap-2" :aria-label="t('tags.manager.globalTitle')">
          <li v-for="tag in globalTags" :key="tag.id" class="flex items-center gap-1.5">
            <NuxtLink v-if="tag.mediaCount" :to="mediaLink(tag)!" class="rounded-full">
              <AdminTagBadge :tag="tag" />
              <span class="sr-only">{{ t('tags.manager.mediaCount', { count: tag.mediaCount }, tag.mediaCount) }}</span>
            </NuxtLink>
            <AdminTagBadge v-else :tag="tag" />
          </li>
        </ul>
        <p v-else class="mt-4 text-sm text-muted-foreground">
          {{ t('tags.manager.emptyGlobal') }}
        </p>
      </section>
    </template>

    <UiDialog v-model:open="editOpen" :title="t('tags.manager.editTitle', { name: editing?.name ?? '' })">
      <form id="tag-edit-form" class="grid gap-4" novalidate @submit.prevent="submitEdit">
        <UiAlert v-if="editStatus" variant="error" live="assertive">
          {{ editStatus }}
        </UiAlert>
        <AdminTagForm v-if="editing" v-model="editForm" id-prefix="tag-edit" editing :errors="editErrors" :can-confidential="canConfidential" />
        <UiAlert v-if="editing?.confidential && !editForm.confidential" variant="warning">
          {{ t('tags.manager.unconfidentialWarning') }}
        </UiAlert>
      </form>
      <template #actions>
        <UiButton variant="outline" @click="editOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" form="tag-edit-form" :loading="saving">
          {{ t('common.save') }}
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model:open="removeOpen" :title="t('tags.manager.deleteTitle', { name: removing?.name ?? '' })" :description="removeDescription">
      <template #actions>
        <UiButton variant="outline" autofocus @click="removeOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton variant="destructive" :loading="deleting" @click="confirmRemove">
          {{ t('tags.manager.delete') }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
