<script setup lang="ts">
import { ArchiveRestore, ArrowLeft, Copy, FolderInput, Link2, Trash2 } from '@lucide/vue'
import { MEDIA_TEXT_MAX_LENGTH, mediaMetadataSchema } from '#shared/schemas/media'

// Accès décidé par l'espace du média (bibliothèque ou projet) : vérifié par l'API (404 sinon).
definePageMeta({ layout: 'admin' })

interface StatusMessage {
  variant: 'success' | 'error'
  message: string
}

const { t, locale } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()
const flash = useFlash()

const mediaId = computed(() => String(route.params.id))
const { data, error, refresh } = await useApiFetch(() => `/api/admin/media/${mediaId.value}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Media not found', fatal: true })
}
const { data: rules } = await useApiFetch('/api/admin/config/media')

const media = computed(() => data.value?.media)
const displayName = computed(() => media.value?.title || media.value?.originalName || '')
const inTrash = computed(() => Boolean(media.value?.deletedAt))

/** Compte à l'origine de l'envoi ; sans compte, une application (clé d'API) ou un auteur supprimé. */
const uploaderName = computed(() => {
  const value = media.value
  if (value?.uploadedBy) return value.uploadedBy.name || value.uploadedBy.email
  return value?.uploadedByToken ? t('media.detail.apiUploader') : t('media.detail.unknownUploader')
})

useSeoMeta({ title: () => displayName.value || t('media.list.title') })

// ─── Espace et droits ────────────────────────────────────────────────────────

const space = computed(() => data.value?.space)
const project = computed(() => space.value?.project ?? null)
const scopes = computed<readonly string[]>(() => data.value?.scopes ?? [])
const canWrite = computed(() => scopes.value.includes('media:write'))
const canDelete = computed(() => scopes.value.includes('media:delete'))
const spaceLabel = computed(() => (project.value ? t('space.project', { name: project.value.name }) : t('space.library')))

/** Liste d'où l'on vient : médias du projet ou bibliothèque (corbeille le cas échéant). */
const listPath = computed(() => (project.value ? `/admin/projects/${project.value.id}/media` : '/admin/media'))
const backLink = computed(() => (inTrash.value
  ? { path: listPath.value, query: { status: 'trash' } }
  : { path: listPath.value, query: { folder: media.value?.folderId ?? undefined } }))

// Dossiers de l'espace du média (dossier affiché dans les informations, choix de rangement).
const { data: spaceFolders } = await useApiFetch('/api/admin/folders', { query: computed(() => ({ project: project.value?.id })) })
const spaceFolderIndex = computed(() => indexFolders(spaceFolders.value?.folders ?? []))
const folderPath = computed(() => (media.value?.folderId ? folderPathLabel(spaceFolderIndex.value, media.value.folderId) : ''))

// Barre latérale : la fiche d'un média de projet relève de la section Projets.
const section = useAdminSection()
watch(project, (value) => {
  section.value = value ? '/admin/projects' : null
}, { immediate: true })
onBeforeUnmount(() => {
  section.value = null
})

// ─── Métadonnées ─────────────────────────────────────────────────────────────

const FIELD_IDS = { title: 'media-title', altText: 'media-alt', visibility: 'media-visibility' } as const
const form = reactive<{ title: string, altText: string, visibility: MediaVisibility | '' }>({ title: '', altText: '', visibility: '' })
watch(media, (value) => {
  if (value) Object.assign(form, { title: value.title ?? '', altText: value.altText ?? '', visibility: value.visibility })
}, { immediate: true })

const { validate, message, clear } = useFormValidation(mediaMetadataSchema, FIELD_IDS)
const saveStatus = ref<StatusMessage | null>(null)
const saving = ref(false)

async function save() {
  saveStatus.value = null
  const input = validate(form)
  if (!input) return
  saving.value = true
  try {
    await $api(`/api/admin/media/${mediaId.value}`, { method: 'PATCH', body: input })
    await refresh()
    link.value = null
    saveStatus.value = { variant: 'success', message: t('media.detail.saved') }
  }
  catch {
    saveStatus.value = { variant: 'error', message: t('common.unexpectedError') }
  }
  finally {
    saving.value = false
  }
}

const visibilityOptions = computed(() => MEDIA_VISIBILITIES.map(value => ({
  value,
  label: t(`media.visibility.${value}.label`),
  description: t(`media.visibility.${value}.description`),
})))

// ─── Liens d'accès ───────────────────────────────────────────────────────────

const publicUrl = computed(() => data.value?.publicUrl ?? '')
const durationId = useId()
const duration = ref(String(SIGNED_URL_DURATIONS[0]))
const DURATION_KEYS: Record<(typeof SIGNED_URL_DURATIONS)[number], string> = { 3600: 'hour', 86400: 'day', 604800: 'week' }
const durationOptions = computed(() => SIGNED_URL_DURATIONS.map(seconds => ({ value: String(seconds), label: t(`media.links.durations.${DURATION_KEYS[seconds]}`) })))
const link = ref<{ url: string, expiresAt: string } | null>(null)
const linkError = ref<string>()
const generating = ref(false)

async function generateLink() {
  linkError.value = undefined
  generating.value = true
  try {
    const result = await $api(`/api/admin/media/${mediaId.value}/signed-url`, { method: 'POST', body: { expiresIn: Number(duration.value) } })
    link.value = { url: result.url, expiresAt: String(result.expiresAt) }
  }
  catch {
    linkError.value = t('common.unexpectedError')
  }
  finally {
    generating.value = false
  }
}

// ─── Remplacement, corbeille ─────────────────────────────────────────────────

const replaceStatus = ref<StatusMessage | null>(null)

async function onReplaced() {
  await refresh()
  link.value = null
  replaceStatus.value = { variant: 'success', message: t('media.replace.success') }
}

const actionError = ref<string>()
const busy = ref(false)

async function moveToTrash() {
  actionError.value = undefined
  busy.value = true
  try {
    await $api(`/api/admin/media/${mediaId.value}`, { method: 'DELETE' })
    flash.set({ variant: 'success', message: t('media.trash.moved', { name: displayName.value }) })
    await navigateTo(listPath.value)
  }
  catch {
    actionError.value = t('common.unexpectedError')
  }
  finally {
    busy.value = false
  }
}

async function restore() {
  actionError.value = undefined
  busy.value = true
  try {
    await $api(`/api/admin/media/${mediaId.value}/restore`, { method: 'POST' })
    await refresh()
  }
  catch {
    actionError.value = t('common.unexpectedError')
  }
  finally {
    busy.value = false
  }
}

const purgeOpen = ref(false)
const purgeError = ref<string>()

async function purge() {
  purgeError.value = undefined
  busy.value = true
  try {
    await $api(`/api/admin/media/${mediaId.value}?permanent=true`, { method: 'DELETE' })
    flash.set({ variant: 'success', message: t('media.trash.purged', { name: displayName.value }) })
    purgeOpen.value = false
    await navigateTo({ path: listPath.value, query: { status: 'trash' } })
  }
  catch {
    purgeError.value = t('common.unexpectedError')
  }
  finally {
    busy.value = false
  }
}

// ─── Duplication, déplacement ────────────────────────────────────────────────

const { data: targets } = await useApiFetch('/api/admin/spaces', { query: { scope: 'media:upload' } })
const targetId = useId()
const organizeStatus = ref<StatusMessage | null>(null)
const organizing = ref<'duplicate' | 'move' | null>(null)

/** Valeur du sélecteur : identifiant du projet, ou « library ». */
const LIBRARY_VALUE = 'library'
const currentTarget = computed(() => project.value?.id ?? LIBRARY_VALUE)
const target = ref('')
watch(currentTarget, (value) => {
  target.value = value
}, { immediate: true })

const targetOptions = computed(() => (targets.value?.spaces ?? []).map((item) => {
  const value = item.type === 'project' ? item.id : LIBRARY_VALUE
  const label = item.type === 'project' ? t('space.project', { name: item.name }) : t('space.library')
  return { value, label: value === currentTarget.value ? t('media.organize.current', { space: label }) : label }
}))

// Dossier cible dans l'espace choisi (racine par défaut ; dossier actuel pour l'espace du média).
const ROOT_FOLDER = 'root'
const targetFolderId = useId()
const targetFolder = ref(ROOT_FOLDER)
const sameSpace = computed(() => target.value === currentTarget.value)
const currentFolderValue = computed(() => media.value?.folderId ?? ROOT_FOLDER)
const { data: targetFolders } = await useApiFetch('/api/admin/folders', {
  query: computed(() => ({ project: target.value && target.value !== LIBRARY_VALUE ? target.value : undefined })),
})
const targetFolderIndex = computed(() => indexFolders(targetFolders.value?.folders ?? []))
const targetFolderOptions = computed(() => [
  { value: ROOT_FOLDER, label: t('folders.root') },
  ...flattenFolders(targetFolderIndex.value).map(({ folder }) => ({ value: folder.id, label: folderPathLabel(targetFolderIndex.value, folder.id) })),
].map(option => (sameSpace.value && option.value === currentFolderValue.value
  ? { ...option, label: t('media.organize.current', { space: option.label }) }
  : option)))
watch([target, currentFolderValue], () => {
  targetFolder.value = sameSpace.value ? currentFolderValue.value : ROOT_FOLDER
}, { immediate: true })

/** Déplacer : vers un autre espace (media:delete) ou un autre dossier du même espace (media:write). */
const canMove = computed(() => (sameSpace.value ? canWrite.value && targetFolder.value !== currentFolderValue.value : canDelete.value))

function spaceRequest(action: 'duplicate' | 'move', body: { projectId: string | null, folderId: string | null }) {
  return $api(`/api/admin/media/${mediaId.value}/${action}`, { method: 'POST', body })
}

function folderRequest(folderId: string | null) {
  return $api(`/api/admin/media/${mediaId.value}`, { method: 'PATCH', body: { folderId } })
}

async function organize(action: 'duplicate' | 'move') {
  if (!target.value) return
  organizeStatus.value = null
  organizing.value = action
  const folderId = targetFolder.value === ROOT_FOLDER ? null : targetFolder.value
  const targetProject = targets.value?.spaces.find(item => item.type === 'project' && item.id === target.value)
  const spaceName = targetProject?.type === 'project' ? t('space.project', { name: targetProject.name }) : t('space.library')
  const destination = folderId ? `${spaceName} / ${folderPathLabel(targetFolderIndex.value, folderId)}` : spaceName
  try {
    if (action === 'duplicate') {
      const result = await spaceRequest('duplicate', { projectId: target.value === LIBRARY_VALUE ? null : target.value, folderId })
      flash.set({ variant: 'success', message: t('media.organize.duplicated', { space: destination }) })
      await navigateTo(`/admin/media/${result.media.id}`)
      return
    }
    if (sameSpace.value) await folderRequest(folderId)
    else await spaceRequest('move', { projectId: target.value === LIBRARY_VALUE ? null : target.value, folderId })
    await refresh()
    organizeStatus.value = { variant: 'success', message: t('media.organize.moved', { space: destination }) }
  }
  catch (error) {
    const { code } = apiError(error)
    organizeStatus.value = {
      variant: 'error',
      message: code && (FOLDER_ERROR_CODES as readonly string[]).includes(code) ? t(`folders.errors.${code}`) : t('common.unexpectedError'),
    }
  }
  finally {
    organizing.value = null
  }
}

// Message laissé par une duplication (redirection vers la copie).
const pageFlash = flash.consume()
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <NuxtLink :to="backLink" class="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" />
      {{ inTrash ? t('media.detail.backToTrash') : project ? t('media.detail.backToProject') : t('media.detail.backToList') }}
    </NuxtLink>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('media.detail.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="media">
      <AdminPageHeader :title="displayName" :description="media.title ? media.originalName : undefined">
        <template #actions>
          <UiBadge :variant="media.visibility === 'PRIVATE' ? 'neutral' : 'primary'">
            {{ t(`media.visibility.${media.visibility}.label`) }}
          </UiBadge>
        </template>
      </AdminPageHeader>

      <UiAlert v-if="pageFlash" :variant="pageFlash.variant" live="polite" class="mb-6">
        {{ pageFlash.message }}
      </UiAlert>

      <UiAlert v-if="!canWrite" variant="info" class="mb-6">
        {{ project?.archivedAt ? t('media.detail.archivedProject') : t('media.detail.readOnly') }}
      </UiAlert>

      <UiAlert v-if="inTrash" variant="warning" :title="t('media.trash.bannerTitle')" class="mb-6">
        <p>{{ t('media.trash.bannerDescription') }}</p>
        <div v-if="canDelete" class="mt-3 flex flex-wrap gap-3">
          <UiButton variant="outline" size="sm" :loading="busy" @click="restore">
            <ArchiveRestore aria-hidden="true" />
            {{ t('media.trash.restore') }}
          </UiButton>
          <UiButton variant="destructive" size="sm" @click="purgeOpen = true">
            <Trash2 aria-hidden="true" />
            {{ t('media.trash.purge') }}
          </UiButton>
        </div>
      </UiAlert>
      <UiAlert v-if="actionError" variant="error" live="assertive" class="mb-6">
        {{ actionError }}
      </UiAlert>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <!-- Aperçu et informations -->
        <div class="grid content-start gap-6">
          <figure class="bg-checker overflow-hidden rounded-xl border border-border">
            <img
              :src="media.url"
              :alt="media.altText ?? ''"
              :width="media.width ?? undefined"
              :height="media.height ?? undefined"
              class="mx-auto max-h-[28rem] w-auto object-contain"
            >
          </figure>

          <section aria-labelledby="info-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="info-title" class="text-lg font-semibold text-foreground">
              {{ t('media.detail.infoTitle') }}
            </h2>
            <dl class="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.space') }}
                </dt>
                <dd class="font-medium text-foreground">
                  <NuxtLink v-if="project" :to="`/admin/projects/${project.id}`" class="text-primary underline-offset-4 hover:underline">
                    {{ spaceLabel }}
                  </NuxtLink>
                  <template v-else>
                    {{ spaceLabel }}
                  </template>
                </dd>
              </div>
              <div class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.folder') }}
                </dt>
                <dd class="font-medium break-words text-foreground">
                  <NuxtLink v-if="media.folderId && folderPath" :to="{ path: listPath, query: { folder: media.folderId } }" class="text-primary underline-offset-4 hover:underline">
                    {{ folderPath }}
                  </NuxtLink>
                  <template v-else>
                    {{ t('media.detail.noFolder') }}
                  </template>
                </dd>
              </div>
              <div v-if="media.duplicatedFromId" class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.duplicatedFrom') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ t('media.detail.duplicatedFromValue') }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.format') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ media.extension?.toUpperCase() }} <span class="text-muted-foreground">({{ media.mimeType }})</span>
                </dd>
              </div>
              <div v-if="media.width && media.height" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.dimensions') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ t('media.dimensions', { width: media.width, height: media.height }) }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.size') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ formatBytes(media.size, locale) }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.version') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ media.version }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.uploadedBy') }}
                </dt>
                <dd class="font-medium break-all text-foreground">
                  {{ uploaderName }}
                </dd>
              </div>
              <div v-if="media.uploadedByToken" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.credential') }}
                </dt>
                <dd class="font-medium break-all text-foreground">
                  {{ t(`credentials.named.${media.uploadedByToken.type}`, { name: media.uploadedByToken.name }) }}
                  <code class="block font-mono text-xs font-normal text-muted-foreground">{{ media.uploadedByToken.prefix }}…</code>
                </dd>
              </div>
              <div v-if="media.uploadSubject" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.subject') }}
                </dt>
                <dd class="font-medium break-all text-foreground">
                  {{ media.uploadSubject }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.createdAt') }}
                </dt>
                <dd class="font-medium text-foreground">
                  <NuxtTime :datetime="media.createdAt" :locale="locale" date-style="medium" time-style="short" />
                </dd>
              </div>
              <div class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.checksum') }}
                </dt>
                <dd class="font-mono text-xs break-all text-foreground">
                  {{ media.checksum }}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <div class="grid content-start gap-6">
          <!-- Métadonnées éditoriales -->
          <section aria-labelledby="edit-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="edit-title" class="text-lg font-semibold text-foreground">
              {{ t('media.detail.editTitle') }}
            </h2>
            <!-- Lecture seule : les valeurs restent lisibles (pas de champs désactivés). -->
            <dl v-if="!canWrite" class="mt-4 grid gap-3 text-sm">
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.fields.title') }}
                </dt>
                <dd class="font-medium break-words text-foreground">
                  {{ media.title || '—' }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.fields.altText') }}
                </dt>
                <dd class="font-medium break-words text-foreground">
                  {{ media.altText || '—' }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.fields.visibility') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ t(`media.visibility.${media.visibility}.label`) }}
                </dd>
              </div>
            </dl>
            <form v-else class="mt-5 grid gap-5" novalidate @submit.prevent="save">
              <UiAlert v-if="saveStatus" :variant="saveStatus.variant" :live="saveStatus.variant === 'error' ? 'assertive' : 'polite'">
                {{ saveStatus.message }}
              </UiAlert>
              <UiFormField v-slot="field" :id="FIELD_IDS.title" :label="t('media.fields.title')" :hint="t('media.fields.titleHint')" :error="message('title')">
                <UiInput v-bind="field" v-model="form.title" name="title" autocomplete="off" :maxlength="MEDIA_TEXT_MAX_LENGTH" @input="clear('title')" />
              </UiFormField>
              <UiFormField v-slot="field" :id="FIELD_IDS.altText" :label="t('media.fields.altText')" :hint="t('media.fields.altTextHint')" :error="message('altText')">
                <UiInput v-bind="field" v-model="form.altText" name="altText" autocomplete="off" :maxlength="MEDIA_TEXT_MAX_LENGTH" @input="clear('altText')" />
              </UiFormField>
              <UiRadioCards
                :id="FIELD_IDS.visibility"
                v-model="form.visibility"
                :legend="t('media.fields.visibility')"
                :options="visibilityOptions"
                :columns="2"
                :error="message('visibility')"
              />
              <div class="flex justify-end">
                <UiButton type="submit" :loading="saving" :disabled="inTrash">
                  {{ t('common.save') }}
                </UiButton>
              </div>
            </form>
          </section>

          <!-- Liens -->
          <section v-if="!inTrash" aria-labelledby="links-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="links-title" class="text-lg font-semibold text-foreground">
              {{ t('media.links.title') }}
            </h2>
            <div v-if="media.visibility === 'PUBLIC'" class="mt-4 grid gap-2">
              <p class="text-sm text-muted-foreground">
                {{ t('media.links.publicDescription') }}
              </p>
              <UiCopyField :label="t('media.links.publicUrl')" :value="publicUrl" />
            </div>
            <div v-else class="mt-4 grid gap-4">
              <p class="text-sm text-muted-foreground">
                {{ t('media.links.privateDescription') }}
              </p>
              <div class="flex flex-wrap items-end gap-3">
                <div class="grid gap-1.5">
                  <label :for="durationId" class="text-sm font-medium text-foreground">{{ t('media.links.duration') }}</label>
                  <UiSelect :id="durationId" v-model="duration" :options="durationOptions" class="w-44" />
                </div>
                <UiButton variant="outline" :loading="generating" @click="generateLink">
                  <Link2 aria-hidden="true" />
                  {{ t('media.links.generate') }}
                </UiButton>
              </div>
              <UiAlert v-if="linkError" variant="error" live="assertive">
                {{ linkError }}
              </UiAlert>
              <div v-if="link" class="grid gap-1">
                <UiCopyField :label="t('media.links.temporaryUrl')" :value="link.url" />
                <p class="text-sm text-muted-foreground">
                  <i18n-t keypath="media.links.expires" tag="span" scope="global">
                    <template #date>
                      <NuxtTime :datetime="link.expiresAt" :locale="locale" date-style="long" time-style="short" class="font-medium text-foreground" />
                    </template>
                  </i18n-t>
                </p>
              </div>
            </div>
          </section>

          <!-- Remplacement -->
          <section v-if="!inTrash && rules && canWrite" aria-labelledby="replace-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="replace-title" class="text-lg font-semibold text-foreground">
              {{ t('media.replace.title') }}
            </h2>
            <p class="mt-2 mb-4 text-sm text-muted-foreground">
              {{ t('media.replace.description') }}
            </p>
            <UiAlert v-if="replaceStatus" :variant="replaceStatus.variant" live="polite" class="mb-4">
              {{ replaceStatus.message }}
            </UiAlert>
            <AdminMediaUploader
              :rules="rules"
              :endpoint="`/api/admin/media/${media.id}/file`"
              method="PUT"
              :multiple="false"
              :with-visibility="false"
              @uploaded="onReplaced"
            />
          </section>

          <!-- Duplication, déplacement -->
          <section v-if="!inTrash" aria-labelledby="organize-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="organize-title" class="text-lg font-semibold text-foreground">
              {{ t('media.organize.title') }}
            </h2>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ t('media.organize.description') }}
            </p>
            <p v-if="targetOptions.length === 0" class="mt-4 text-sm text-foreground">
              {{ t('media.organize.noTargets') }}
            </p>
            <div v-else class="mt-4 grid gap-4">
              <div class="flex flex-wrap items-end gap-3">
                <div class="grid min-w-56 flex-1 gap-1.5">
                  <label :for="targetId" class="text-sm font-medium text-foreground">{{ t('media.organize.target') }}</label>
                  <UiSelect :id="targetId" v-model="target" :options="targetOptions" />
                </div>
                <div class="grid min-w-56 flex-1 gap-1.5">
                  <label :for="targetFolderId" class="text-sm font-medium text-foreground">{{ t('media.organize.folder') }}</label>
                  <UiSelect :id="targetFolderId" v-model="targetFolder" :options="targetFolderOptions" />
                </div>
                <UiButton variant="outline" :loading="organizing === 'duplicate'" @click="organize('duplicate')">
                  <Copy aria-hidden="true" />
                  {{ t('media.organize.duplicate') }}
                </UiButton>
                <UiButton
                  v-if="canDelete || canWrite"
                  variant="outline"
                  :disabled="!canMove"
                  :loading="organizing === 'move'"
                  @click="organize('move')"
                >
                  <FolderInput aria-hidden="true" />
                  {{ t('media.organize.move') }}
                </UiButton>
              </div>
              <p v-if="(canDelete || canWrite) && !canMove" class="text-sm text-muted-foreground">
                {{ t('media.organize.moveDisabled') }}
              </p>
              <UiAlert v-if="organizeStatus" :variant="organizeStatus.variant" :live="organizeStatus.variant === 'error' ? 'assertive' : 'polite'">
                {{ organizeStatus.message }}
              </UiAlert>
            </div>
          </section>

          <!-- Corbeille -->
          <section v-if="!inTrash && canDelete" aria-labelledby="trash-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="trash-title" class="text-lg font-semibold text-foreground">
              {{ t('media.trash.title') }}
            </h2>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ t('media.trash.description') }}
            </p>
            <UiButton variant="outline" class="mt-4" :loading="busy" @click="moveToTrash">
              <Trash2 aria-hidden="true" />
              {{ t('media.trash.move') }}
            </UiButton>
          </section>
        </div>
      </div>

      <UiDialog
        v-model:open="purgeOpen"
        :title="t('media.trash.confirmTitle')"
        :description="t('media.trash.confirmDescription', { name: displayName })"
      >
        <UiAlert v-if="purgeError" variant="error" live="assertive">
          {{ purgeError }}
        </UiAlert>
        <template #actions>
          <UiButton variant="outline" autofocus @click="purgeOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton variant="destructive" :loading="busy" @click="purge">
            {{ t('media.trash.confirm') }}
          </UiButton>
        </template>
      </UiDialog>
    </template>
  </div>
</template>
