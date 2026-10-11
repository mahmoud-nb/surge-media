<script setup lang="ts">
import { Archive, ArchiveRestore, Trash2 } from '@lucide/vue'
import { updateProjectSchema } from '#shared/schemas/projects'

definePageMeta({ layout: 'admin' })

interface StatusMessage {
  variant: 'success' | 'error'
  message: string
}

const { t, locale } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()
const flash = useFlash()
const { can } = useAuth()

const projectId = computed(() => String(route.params.id))
const { data, error, refresh } = await useApiFetch(() => `/api/admin/projects/${projectId.value}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })
}

const project = computed(() => data.value?.project)
const canManage = computed(() => Boolean(data.value?.scopes.includes('project:settings')))
const archived = computed(() => Boolean(project.value?.archivedAt))

useSeoMeta({ title: () => (project.value ? t('projects.overview.meta.title', { name: project.value.name }) : t('projects.list.title')) })

const pageFlash = flash.consume()

function errorMessage(error: unknown): string {
  const { code } = apiError(error)
  return code && (PROJECT_ERROR_CODES as readonly string[]).includes(code) ? t(`projects.errors.${code}`) : t('common.unexpectedError')
}

// ─── Réglages ────────────────────────────────────────────────────────────────

const FIELD_IDS = { name: 'project-name', slug: 'project-slug', description: 'project-description' } as const
const form = reactive({ name: '', slug: '', description: '', publicListing: false })
watch(project, (value) => {
  if (value) Object.assign(form, { name: value.name, slug: value.slug, description: value.description ?? '', publicListing: value.publicListing })
}, { immediate: true })

const { validate, message, clear, setError } = useFormValidation(updateProjectSchema, FIELD_IDS)
const saveStatus = ref<StatusMessage | null>(null)
const saving = ref(false)

async function save() {
  saveStatus.value = null
  const input = validate(form)
  if (!input) return
  saving.value = true
  try {
    await $api(`/api/admin/projects/${projectId.value}`, { method: 'PATCH', body: input })
    await refresh()
    saveStatus.value = { variant: 'success', message: t('projects.settings.saved') }
  }
  catch (error) {
    if (apiError(error).code === 'SLUG_TAKEN') setError('slug', 'validation.slugTaken')
    else saveStatus.value = { variant: 'error', message: errorMessage(error) }
  }
  finally {
    saving.value = false
  }
}

// ─── Archivage ───────────────────────────────────────────────────────────────

const archiveStatus = ref<StatusMessage | null>(null)
const archiving = ref(false)

async function setArchived(value: boolean) {
  archiveStatus.value = null
  archiving.value = true
  try {
    await $api(`/api/admin/projects/${projectId.value}`, { method: 'PATCH', body: { archived: value } })
    await refresh()
    archiveStatus.value = { variant: 'success', message: value ? t('projects.archive.done') : t('projects.archive.restored') }
  }
  catch (error) {
    archiveStatus.value = { variant: 'error', message: errorMessage(error) }
  }
  finally {
    archiving.value = false
  }
}

// ─── Suppression ─────────────────────────────────────────────────────────────

const deleteOpen = ref(false)
// Verser les médias dans la bibliothèque revient à y envoyer des médias : administrateur seulement.
const canKeepMedia = computed(() => can('library:manage'))
const deleteMedia = ref<ProjectMediaOnDelete | ''>('library')
const deleteConfirmation = ref('')
const deleteError = ref<string>()
const confirmationError = ref<string>()
const deleting = ref(false)
const confirmationId = useId()

const deleteOptions = computed(() => PROJECT_MEDIA_ON_DELETE.map(value => ({
  value,
  label: t(`projects.delete.${value}.label`),
  description: t(`projects.delete.${value}.description`),
})))

function openDelete() {
  deleteMedia.value = canKeepMedia.value ? 'library' : 'purge'
  deleteConfirmation.value = ''
  deleteError.value = undefined
  confirmationError.value = undefined
  deleteOpen.value = true
}

async function remove() {
  const current = project.value
  if (!current) return
  deleteError.value = undefined
  if (deleteConfirmation.value.trim() !== current.slug) {
    confirmationError.value = t('projects.delete.confirmMismatch')
    document.getElementById(confirmationId)?.focus()
    return
  }
  deleting.value = true
  try {
    await $api(`/api/admin/projects/${projectId.value}`, { method: 'DELETE', body: { media: deleteMedia.value } })
    flash.set({ variant: 'success', message: t('projects.delete.success', { name: current.name }) })
    deleteOpen.value = false
    await navigateTo('/admin/projects')
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
  <div class="mx-auto max-w-6xl">
    <UiAlert v-if="error" variant="error" live="assertive" :title="t('projects.overview.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="project">
      <AdminProjectHeader :project="project" :scopes="data?.scopes ?? []" />

      <UiAlert v-if="pageFlash" :variant="pageFlash.variant" live="polite" class="mb-6">
        {{ pageFlash.message }}
      </UiAlert>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby="summary-title" class="h-fit rounded-xl border border-border bg-surface p-6 shadow-xs">
          <h2 id="summary-title" class="text-lg font-semibold text-foreground">
            {{ t('projects.overview.summaryTitle') }}
          </h2>
          <dl class="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div class="grid gap-0.5 sm:col-span-2">
              <dt class="text-muted-foreground">
                {{ t('projects.overview.slug') }}
              </dt>
              <dd class="font-mono break-all text-foreground">
                {{ project.slug }}
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('projects.overview.mediaCount') }}
              </dt>
              <dd class="font-medium text-foreground tabular-nums">
                <NuxtLink :to="`/admin/projects/${project.id}/media`" class="text-primary underline-offset-4 hover:underline">
                  {{ project.mediaCount }}
                </NuxtLink>
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('projects.overview.trashCount') }}
              </dt>
              <dd class="font-medium text-foreground tabular-nums">
                {{ data?.trashCount }}
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('projects.overview.memberCount') }}
              </dt>
              <dd class="font-medium text-foreground tabular-nums">
                <NuxtLink :to="`/admin/projects/${project.id}/members`" class="text-primary underline-offset-4 hover:underline">
                  {{ project.memberCount }}
                </NuxtLink>
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('projects.overview.createdAt') }}
              </dt>
              <dd class="font-medium text-foreground">
                <NuxtTime :datetime="project.createdAt" :locale="locale" date-style="medium" />
              </dd>
            </div>
            <div v-if="can('audit:read')" class="grid gap-0.5 sm:col-span-2">
              <dt class="text-muted-foreground">
                {{ t('projects.overview.audit') }}
              </dt>
              <dd>
                <NuxtLink :to="{ path: '/admin/audit', query: { project: project.id } }" class="font-medium text-primary underline-offset-4 hover:underline">
                  {{ t('projects.overview.auditLink') }}
                </NuxtLink>
              </dd>
            </div>
            <div v-if="!canManage" class="grid gap-0.5 sm:col-span-2">
              <dt class="text-muted-foreground">
                {{ t('projects.overview.description') }}
              </dt>
              <dd class="text-foreground">
                {{ project.description || t('projects.overview.noDescription') }}
              </dd>
            </div>
          </dl>
        </section>

        <div v-if="canManage" class="grid content-start gap-6">
          <!-- Réglages -->
          <section aria-labelledby="settings-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="settings-title" class="text-lg font-semibold text-foreground">
              {{ t('projects.settings.title') }}
            </h2>
            <form class="mt-5 grid gap-5" novalidate @submit.prevent="save">
              <UiAlert v-if="saveStatus" :variant="saveStatus.variant" :live="saveStatus.variant === 'error' ? 'assertive' : 'polite'">
                {{ saveStatus.message }}
              </UiAlert>
              <UiFormField :id="FIELD_IDS.name" v-slot="field" :label="t('projects.fields.name')" :error="message('name')" required>
                <UiInput v-bind="field" v-model="form.name" name="name" autocomplete="off" :maxlength="PROJECT_NAME_MAX_LENGTH" @input="clear('name')" />
              </UiFormField>
              <UiFormField :id="FIELD_IDS.slug" v-slot="field" :label="t('projects.fields.slug')" :hint="t('projects.fields.slugHint')" :error="message('slug')" required>
                <UiInput
                  v-bind="field"
                  v-model="form.slug"
                  name="slug"
                  autocomplete="off"
                  autocapitalize="none"
                  spellcheck="false"
                  class="font-mono"
                  :maxlength="PROJECT_SLUG_MAX_LENGTH"
                  @input="clear('slug')"
                />
              </UiFormField>
              <UiFormField :id="FIELD_IDS.description" v-slot="field" :label="t('projects.fields.description')" :hint="t('projects.fields.descriptionHint')" :error="message('description')">
                <UiInput v-bind="field" v-model="form.description" name="description" autocomplete="off" :maxlength="PROJECT_DESCRIPTION_MAX_LENGTH" @input="clear('description')" />
              </UiFormField>
              <UiSwitch v-model="form.publicListing" :label="t('projects.fields.publicListing')" :description="t('projects.fields.publicListingHint')" />
              <div class="flex justify-end">
                <UiButton type="submit" :loading="saving">
                  {{ t('common.save') }}
                </UiButton>
              </div>
            </form>
          </section>

          <!-- Archivage -->
          <section aria-labelledby="archive-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="archive-title" class="text-lg font-semibold text-foreground">
              {{ archived ? t('projects.archive.restoreTitle') : t('projects.archive.title') }}
            </h2>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ archived ? t('projects.archive.restoreDescription') : t('projects.archive.description') }}
            </p>
            <UiAlert v-if="archiveStatus" :variant="archiveStatus.variant" :live="archiveStatus.variant === 'error' ? 'assertive' : 'polite'" class="mt-4">
              {{ archiveStatus.message }}
            </UiAlert>
            <UiButton variant="outline" class="mt-4" :loading="archiving" @click="setArchived(!archived)">
              <component :is="archived ? ArchiveRestore : Archive" aria-hidden="true" />
              {{ archived ? t('projects.archive.restoreAction') : t('projects.archive.action') }}
            </UiButton>
          </section>

          <!-- Suppression (projet archivé uniquement) -->
          <section v-if="archived" aria-labelledby="delete-title" class="rounded-xl border border-destructive/40 bg-surface p-6 shadow-xs">
            <h2 id="delete-title" class="text-lg font-semibold text-foreground">
              {{ t('projects.delete.title') }}
            </h2>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ t('projects.delete.description') }}
            </p>
            <UiButton variant="destructive" class="mt-4" @click="openDelete">
              <Trash2 aria-hidden="true" />
              {{ t('projects.delete.open') }}
            </UiButton>
          </section>
        </div>
      </div>

      <UiDialog
        v-model:open="deleteOpen"
        :title="t('projects.delete.confirmTitle', { name: project.name })"
        :description="t('projects.delete.confirmDescription')"
      >
        <form id="delete-project-form" class="grid gap-5" novalidate @submit.prevent="remove">
          <UiRadioCards v-if="canKeepMedia" v-model="deleteMedia" :legend="t('projects.delete.mediaChoice')" :options="deleteOptions" :columns="2" />
          <UiAlert v-else variant="warning">
            {{ t('projects.delete.purgeOnly') }}
          </UiAlert>
          <UiFormField :id="confirmationId" v-slot="field" :label="t('projects.delete.confirmLabel', { slug: project.slug })" :error="confirmationError" required>
            <UiInput
              v-bind="field"
              v-model="deleteConfirmation"
              name="confirmation"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              class="font-mono"
              @input="confirmationError = undefined"
            />
          </UiFormField>
          <UiAlert v-if="deleteError" variant="error" live="assertive">
            {{ deleteError }}
          </UiAlert>
        </form>
        <template #actions>
          <UiButton variant="outline" autofocus @click="deleteOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton type="submit" form="delete-project-form" variant="destructive" :loading="deleting">
            {{ t('projects.delete.confirm') }}
          </UiButton>
        </template>
      </UiDialog>
    </template>
  </div>
</template>
