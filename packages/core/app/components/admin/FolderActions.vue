<script setup lang="ts">
/**
 * Actions sur les dossiers d'un espace, depuis le dossier affiché : nouveau dossier (dans le
 * dossier affiché), et pour ce dossier : renommer, déplacer, supprimer. Chaque action ouvre une
 * boîte de dialogue ; le résultat est annoncé (role="status"). Le parent recharge l'arbre et les
 * médias à l'événement `changed`, et affiche le dossier parent après une suppression (`deleted`).
 */
import { FolderInput, FolderPlus, Pencil, Trash2 } from '@lucide/vue'
import { folderFormSchema } from '#shared/schemas/folders'

interface FolderItem {
  id: string
  parentId: string | null
  name: string
  mediaCount: number
}

const props = defineProps<{
  /** Projet de l'espace ; absent = bibliothèque. */
  projectId?: string
  folders: FolderItem[]
  /** Dossier affiché (null = racine). */
  current: FolderItem | null
}>()

const emit = defineEmits<{
  changed: []
  /** Dossier supprimé : afficher son parent. */
  deleted: [parentId: string | null]
}>()

const { t, locale } = useI18n()
const { $api } = useNuxtApp()

const ROOT = 'root'
const index = computed(() => indexFolders(props.folders))
/** Dernier résultat annoncé, lié au dossier où il s'affiche (le parent après une suppression). */
const status = ref<{ variant: 'success' | 'error', message: string, folderId: string | null } | null>(null)
watch(() => props.current?.id ?? null, (id) => {
  if (status.value && status.value.folderId !== id) status.value = null
})

function folderLabel(id: string | null): string {
  return id ? folderPathLabel(index.value, id) : t('folders.root')
}

function errorMessage(error: unknown): string {
  const { code } = apiError(error)
  return code && (FOLDER_ERROR_CODES as readonly string[]).includes(code) ? t(`folders.errors.${code}`) : t('common.unexpectedError')
}

// ─── Nouveau dossier, renommage ──────────────────────────────────────────────

const NAME_ID = useId()
const nameOpen = ref(false)
const nameMode = ref<'create' | 'rename'>('create')
const nameForm = reactive({ name: '' })
const nameError = ref<string>()
const saving = ref(false)
const { validate, message, clear, setError } = useFormValidation(folderFormSchema, { name: NAME_ID })

function openCreate() {
  nameMode.value = 'create'
  nameForm.name = ''
  nameError.value = undefined
  clear('name')
  nameOpen.value = true
}

function openRename() {
  if (!props.current) return
  nameMode.value = 'rename'
  nameForm.name = props.current.name
  nameError.value = undefined
  clear('name')
  nameOpen.value = true
}

function createRequest(name: string) {
  return $api('/api/admin/folders', { method: 'POST', query: { project: props.projectId }, body: { name, parentId: props.current?.id ?? null } })
}

function renameRequest(id: string, name: string) {
  return $api(`/api/admin/folders/${id}`, { method: 'PATCH', body: { name } })
}

async function submitName() {
  nameError.value = undefined
  const input = validate(nameForm)
  if (!input) return
  saving.value = true
  try {
    if (nameMode.value === 'create') {
      const { folder } = await createRequest(input.name)
      status.value = { variant: 'success', message: t('folders.create.created', { name: folder.name }), folderId: props.current?.id ?? null }
    }
    else if (props.current) {
      const { folder } = await renameRequest(props.current.id, input.name)
      status.value = { variant: 'success', message: t('folders.rename.renamed', { name: folder.name }), folderId: props.current.id }
    }
    nameOpen.value = false
    emit('changed')
  }
  catch (error) {
    if (apiError(error).code === 'FOLDER_NAME_TAKEN') setError('name', 'folders.errors.FOLDER_NAME_TAKEN')
    else nameError.value = errorMessage(error)
  }
  finally {
    saving.value = false
  }
}

// ─── Déplacement ─────────────────────────────────────────────────────────────

const moveOpen = ref(false)
const moveTarget = ref(ROOT)
const moveError = ref<string>()
const moving = ref(false)

/** Destinations possibles : la racine et tout dossier hors du sous-arbre, sans dépasser 8 niveaux. */
const moveOptions = computed(() => {
  const current = props.current
  if (!current) return []
  const candidates = [{ id: null as string | null }, ...flattenFolders(index.value).map(({ folder }) => ({ id: folder.id as string | null }))]
  return candidates
    .filter(({ id }) => !folderMoveProblem(index.value, current.id, id))
    .map(({ id }) => ({
      value: id ?? ROOT,
      label: id === current.parentId ? t('folders.move.currentLocation', { path: folderLabel(id) }) : folderLabel(id),
    }))
})

function openMove() {
  if (!props.current) return
  moveTarget.value = props.current.parentId ?? ROOT
  moveError.value = undefined
  moveOpen.value = true
}

function moveRequest(id: string, parentId: string | null) {
  return $api(`/api/admin/folders/${id}`, { method: 'PATCH', body: { parentId } })
}

async function submitMove() {
  const current = props.current
  if (!current) return
  const parentId = moveTarget.value === ROOT ? null : moveTarget.value
  if (parentId === current.parentId) {
    moveOpen.value = false
    return
  }
  moveError.value = undefined
  moving.value = true
  try {
    await moveRequest(current.id, parentId)
    status.value = { variant: 'success', message: t('folders.move.moved', { name: current.name, destination: folderLabel(parentId) }), folderId: current.id }
    moveOpen.value = false
    emit('changed')
  }
  catch (error) {
    moveError.value = errorMessage(error)
  }
  finally {
    moving.value = false
  }
}

// ─── Suppression ─────────────────────────────────────────────────────────────

const deleteOpen = ref(false)
/** Après une suppression, le parent place le focus (le bouton d'ouverture désigne alors un autre dossier). */
const deleteReturnFocus = ref(true)
const deleteError = ref<string>()
const deleting = ref(false)
const childCount = computed(() => (props.current ? (index.value.children.get(props.current.id) ?? []).length : 0))
const isEmpty = computed(() => Boolean(props.current && props.current.mediaCount === 0 && childCount.value === 0))
const deleteDescription = computed(() => {
  const current = props.current
  if (!current) return ''
  if (isEmpty.value) return t('folders.delete.emptyDescription')
  // Seulement les parties non vides : « un média », « 2 sous-dossiers », ou les deux.
  const parts = [
    current.mediaCount > 0 ? t('folders.counts.media', { count: current.mediaCount }, current.mediaCount) : null,
    childCount.value > 0 ? t('folders.counts.folders', { count: childCount.value }, childCount.value) : null,
  ].filter((part): part is string => Boolean(part))
  return t('folders.delete.contentDescription', {
    content: new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(parts),
    parent: folderLabel(current.parentId),
  })
})

function openDelete() {
  deleteError.value = undefined
  deleteReturnFocus.value = true
  deleteOpen.value = true
}

function deleteRequest(id: string, withContent: boolean) {
  return $api(`/api/admin/folders/${id}`, { method: 'DELETE', query: withContent ? { content: 'parent' } : {} })
}

async function submitDelete() {
  const current = props.current
  if (!current) return
  deleteError.value = undefined
  deleting.value = true
  try {
    await deleteRequest(current.id, !isEmpty.value)
    status.value = {
      variant: 'success',
      message: isEmpty.value
        ? t('folders.delete.deleted', { name: current.name })
        : t('folders.delete.deletedWithContent', { name: current.name, parent: folderLabel(current.parentId) }),
      folderId: current.parentId,
    }
    deleteReturnFocus.value = false
    deleteOpen.value = false
    emit('deleted', current.parentId)
  }
  catch (error) {
    deleteError.value = errorMessage(error)
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="grid gap-3">
    <div class="flex flex-wrap gap-2">
      <UiButton variant="outline" size="sm" @click="openCreate">
        <FolderPlus aria-hidden="true" />
        {{ t('folders.actions.create') }}
      </UiButton>
      <template v-if="current">
        <UiButton variant="ghost" size="sm" @click="openRename">
          <Pencil aria-hidden="true" />
          {{ t('folders.actions.rename') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" @click="openMove">
          <FolderInput aria-hidden="true" />
          {{ t('folders.actions.move') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" @click="openDelete">
          <Trash2 aria-hidden="true" />
          {{ t('folders.actions.delete') }}
        </UiButton>
      </template>
    </div>
    <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
      {{ status.message }}
    </UiAlert>

    <UiDialog
      v-model:open="nameOpen"
      :title="nameMode === 'create' ? t('folders.create.title') : t('folders.rename.title')"
      :description="nameMode === 'create'
        ? (current ? t('folders.create.descriptionIn', { name: folderLabel(current.id) }) : t('folders.create.descriptionRoot'))
        : undefined"
    >
      <form id="folder-name-form" novalidate class="grid gap-4" @submit.prevent="submitName">
        <UiFormField v-slot="field" :id="NAME_ID" :label="t('folders.fields.name')" :hint="t('folders.fields.nameHint')" :error="message('name')" required>
          <UiInput v-bind="field" v-model="nameForm.name" name="name" autocomplete="off" :maxlength="FOLDER_NAME_MAX_LENGTH" @input="clear('name')" />
        </UiFormField>
        <UiAlert v-if="nameError" variant="error" live="assertive">
          {{ nameError }}
        </UiAlert>
      </form>
      <template #actions>
        <UiButton variant="outline" @click="nameOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" form="folder-name-form" :loading="saving">
          {{ nameMode === 'create' ? t('folders.create.submit') : t('folders.rename.submit') }}
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog
      v-model:open="moveOpen"
      :title="t('folders.move.title', { name: current?.name ?? '' })"
      :description="t('folders.move.description')"
    >
      <form id="folder-move-form" novalidate class="grid gap-4" @submit.prevent="submitMove">
        <UiFormField v-slot="field" :label="t('folders.fields.destination')">
          <UiSelect v-bind="field" v-model="moveTarget" :options="moveOptions" name="destination" />
        </UiFormField>
        <UiAlert v-if="moveError" variant="error" live="assertive">
          {{ moveError }}
        </UiAlert>
      </form>
      <template #actions>
        <UiButton variant="outline" @click="moveOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" form="folder-move-form" :loading="moving">
          {{ t('folders.move.submit') }}
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog
      v-model:open="deleteOpen"
      :return-focus="deleteReturnFocus"
      :title="t('folders.delete.title', { name: current?.name ?? '' })"
      :description="deleteDescription"
    >
      <UiAlert v-if="deleteError" variant="error" live="assertive">
        {{ deleteError }}
      </UiAlert>
      <template #actions>
        <UiButton variant="outline" autofocus @click="deleteOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton variant="destructive" :loading="deleting" @click="submitDelete">
          {{ isEmpty ? t('folders.delete.submit') : t('folders.delete.submitWithContent') }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
