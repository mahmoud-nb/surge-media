<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import { createProjectSchema } from '#shared/schemas/projects'

definePageMeta({ layout: 'admin', permission: 'projects:create' })

const { t } = useI18n()
const { $api } = useNuxtApp()
const flash = useFlash()

useSeoMeta({ title: () => t('projects.create.meta.title') })

const FIELD_IDS = { name: 'project-name', slug: 'project-slug', description: 'project-description' } as const

const form = reactive({ name: '', slug: '', description: '' })
const { validate, message, clear, setError } = useFormValidation(createProjectSchema, FIELD_IDS)
const serverError = ref<string>()
const submitting = ref(false)

/** Identifiant qui sera déduit du nom si le champ reste vide (aperçu dans l'aide du champ). */
const derivedSlug = computed(() => slugify(form.name))

async function onSubmit() {
  serverError.value = undefined
  const input = validate({ ...form, slug: form.slug.trim() || undefined })
  if (!input) return

  submitting.value = true
  try {
    const { project } = await $api('/api/admin/projects', { method: 'POST', body: input })
    flash.set({ variant: 'success', message: t('projects.create.success', { name: project.name }) })
    await navigateTo(`/admin/projects/${project.id}`)
  }
  catch (error) {
    const { code } = apiError(error)
    if (code === 'SLUG_TAKEN') setError('slug', 'validation.slugTaken')
    else serverError.value = t('common.unexpectedError')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <NuxtLink to="/admin/projects" class="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" />
      {{ t('projects.backToList') }}
    </NuxtLink>
    <AdminPageHeader :title="t('projects.create.title')" :description="t('projects.create.description')" />

    <UiAlert v-if="serverError" variant="error" live="assertive" class="mb-6">
      {{ serverError }}
    </UiAlert>

    <form class="grid gap-6 rounded-xl border border-border bg-surface p-6 shadow-xs" novalidate @submit.prevent="onSubmit">
      <p class="text-sm text-muted-foreground">
        {{ t('form.requiredNote') }}
      </p>

      <div class="grid gap-5 sm:grid-cols-2">
        <UiFormField v-slot="field" :id="FIELD_IDS.name" :label="t('projects.fields.name')" :error="message('name')" required>
          <UiInput v-bind="field" v-model="form.name" name="name" autocomplete="off" :maxlength="PROJECT_NAME_MAX_LENGTH" @input="clear('name')" />
        </UiFormField>
        <UiFormField
          v-slot="field"
          :id="FIELD_IDS.slug"
          :label="t('projects.fields.slug')"
          :hint="derivedSlug ? t('projects.fields.slugAuto', { slug: derivedSlug }) : t('projects.fields.slugAutoEmpty')"
          :error="message('slug')"
        >
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
      </div>

      <UiFormField v-slot="field" :id="FIELD_IDS.description" :label="t('projects.fields.description')" :hint="t('projects.fields.descriptionHint')" :error="message('description')">
        <UiInput v-bind="field" v-model="form.description" name="description" autocomplete="off" :maxlength="PROJECT_DESCRIPTION_MAX_LENGTH" @input="clear('description')" />
      </UiFormField>

      <div class="flex flex-wrap justify-end gap-3">
        <UiButton to="/admin/projects" variant="outline">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" :loading="submitting">
          {{ t('projects.create.submit') }}
        </UiButton>
      </div>
    </form>
  </div>
</template>
