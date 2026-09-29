<script setup lang="ts">
import { Globe, Plus, Trash2 } from '@lucide/vue'
import { addOriginSchema } from '#shared/schemas/credentials'

definePageMeta({ layout: 'admin' })

interface StatusMessage {
  variant: 'success' | 'error'
  message: string
}

const { t, locale } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()
const { credentialErrorMessage } = useCredentialLabels()

const projectId = computed(() => String(route.params.id))
const { data: projectData, error: projectError, refresh: refreshProject } = await useApiFetch(() => `/api/admin/projects/${projectId.value}`)
if (projectError.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })
}
const { data, error, refresh } = await useApiFetch(() => `/api/admin/projects/${projectId.value}/origins`)
const archivedError = computed(() => apiError(error.value).code === 'PROJECT_ARCHIVED')
if (error.value?.statusCode === 403 && !archivedError.value) {
  throw createError({ statusCode: 403, statusMessage: 'Forbidden', fatal: true })
}

const project = computed(() => projectData.value?.project)
type Origin = NonNullable<typeof data.value>['origins'][number]

useSeoMeta({ title: () => (project.value ? t('origins.meta.title', { name: project.value.name }) : t('projects.list.title')) })

const status = ref<StatusMessage | null>(null)

async function reload() {
  await Promise.all([refresh(), refreshProject()])
}
const limitReached = computed(() => (data.value?.origins.length ?? 0) >= MAX_ALLOWED_ORIGINS)

// ─── Ajout ───────────────────────────────────────────────────────────────────

const FIELD_IDS = { origin: 'origin-input' } as const
const form = reactive({ origin: '' })
const { validate, message, clear, setError } = useFormValidation(addOriginSchema, FIELD_IDS)
const adding = ref(false)
const addError = ref<string>()

async function add() {
  if (adding.value) return
  status.value = null
  addError.value = undefined
  const input = validate(form)
  if (!input) return
  adding.value = true
  try {
    const result = await $api(`/api/admin/projects/${projectId.value}/origins`, { method: 'POST', body: input })
    form.origin = ''
    await refresh()
    status.value = { variant: 'success', message: t('origins.added', { origin: result.origin.origin }) }
  }
  catch (error) {
    if (apiError(error).code === 'ORIGIN_EXISTS') setError('origin', 'credentials.errors.ORIGIN_EXISTS')
    else addError.value = credentialErrorMessage(error)
  }
  finally {
    adding.value = false
  }
}

// ─── Retrait ─────────────────────────────────────────────────────────────────

const removeTarget = ref<Origin | null>(null)
const removeOpen = computed({
  get: () => removeTarget.value !== null,
  set: (value) => {
    if (!value) removeTarget.value = null
  },
})
const removeError = ref<string>()
const removing = ref(false)

function askRemove(origin: Origin) {
  removeError.value = undefined
  removeTarget.value = origin
}

async function confirmRemove() {
  const origin = removeTarget.value
  if (!origin) return
  removeError.value = undefined
  removing.value = true
  try {
    await $api(`/api/admin/projects/${projectId.value}/origins/${origin.id}`, { method: 'DELETE' })
    removeTarget.value = null
    await refresh()
    status.value = { variant: 'success', message: t('origins.removed', { origin: origin.origin }) }
    // La ligne a disparu avec son bouton : focus sur le titre de la liste.
    await nextTick()
    document.getElementById('origins-list-title')?.focus()
  }
  catch (error) {
    removeError.value = credentialErrorMessage(error)
  }
  finally {
    removing.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <UiAlert v-if="projectError" variant="error" live="assertive" :title="t('projects.overview.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="reload()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="project">
      <AdminProjectHeader :project="project" :scopes="projectData?.scopes ?? []" />

      <div class="mb-6 grid max-w-3xl gap-1">
        <h2 class="text-lg font-semibold text-foreground">
          {{ t('origins.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ t('origins.description') }}
        </p>
      </div>

      <UiAlert v-if="archivedError" variant="info">
        {{ t('origins.archived') }}
      </UiAlert>

      <UiAlert v-else-if="error" variant="error" live="assertive" :title="t('origins.loadError')">
        <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
          {{ t('common.retry') }}
        </UiButton>
      </UiAlert>

      <div v-else-if="data" class="grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <section aria-labelledby="origins-list-title">
          <h3 id="origins-list-title" tabindex="-1" class="mb-3 text-base font-semibold text-foreground">
            {{ t('origins.listTitle', { count: data.origins.length }, data.origins.length) }}
          </h3>

          <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'" class="mb-4">
            {{ status.message }}
          </UiAlert>

          <div v-if="data.origins.length === 0" class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-10 text-center">
            <Globe class="size-8 text-muted-foreground" aria-hidden="true" />
            <p class="max-w-md text-muted-foreground">
              {{ t('origins.empty') }}
            </p>
          </div>

          <ul v-else class="divide-y divide-border rounded-xl border border-border bg-surface">
            <li v-for="origin in data.origins" :key="origin.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div class="grid min-w-0 gap-1">
                <p class="flex flex-wrap items-center gap-2">
                  <code class="font-mono text-sm break-all text-foreground">{{ origin.origin }}</code>
                  <UiBadge v-if="origin.wildcard" variant="primary">
                    {{ t('origins.wildcard') }}
                  </UiBadge>
                </p>
                <p class="text-xs text-muted-foreground">
                  <i18n-t keypath="origins.addedOn" scope="global" tag="span">
                    <template #date>
                      <NuxtTime :datetime="origin.createdAt" :locale="locale" date-style="medium" />
                    </template>
                  </i18n-t>
                </p>
              </div>
              <UiButton variant="outline" size="sm" :aria-label="t('origins.removeLabel', { origin: origin.origin })" @click="askRemove(origin)">
                <Trash2 aria-hidden="true" />
                {{ t('origins.remove') }}
              </UiButton>
            </li>
          </ul>
        </section>

        <section aria-labelledby="origins-add-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
          <h3 id="origins-add-title" class="text-base font-semibold text-foreground">
            {{ t('origins.add.title') }}
          </h3>
          <UiAlert v-if="limitReached" variant="warning" class="mt-4">
            {{ t('credentials.errors.ORIGIN_LIMIT_REACHED') }}
          </UiAlert>
          <form v-else novalidate class="mt-4 grid gap-4" @submit.prevent="add">
            <UiAlert v-if="addError" variant="error" live="assertive">
              {{ addError }}
            </UiAlert>
            <UiFormField v-slot="field" :id="FIELD_IDS.origin" :label="t('origins.add.label')" :hint="t('origins.add.hint')" :error="message('origin')" required>
              <UiInput
                v-bind="field"
                v-model="form.origin"
                type="url"
                name="origin"
                inputmode="url"
                autocomplete="off"
                spellcheck="false"
                :maxlength="ORIGIN_MAX_LENGTH"
                @input="clear('origin')"
              />
            </UiFormField>
            <div>
              <UiButton type="submit" :loading="adding">
                <Plus aria-hidden="true" />
                {{ t('origins.add.submit') }}
              </UiButton>
            </div>
          </form>
          <p class="mt-4 text-sm text-muted-foreground">
            {{ t('origins.add.examples') }}
          </p>
        </section>
      </div>

      <UiDialog
        v-model:open="removeOpen"
        :title="t('origins.removeTitle', { origin: removeTarget?.origin ?? '' })"
        :description="t('origins.removeDescription')"
      >
        <UiAlert v-if="removeError" variant="error" live="assertive">
          {{ removeError }}
        </UiAlert>
        <template #actions>
          <UiButton variant="outline" autofocus @click="removeOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton variant="destructive" :loading="removing" @click="confirmRemove">
            {{ t('origins.remove') }}
          </UiButton>
        </template>
      </UiDialog>
    </template>
  </div>
</template>
