<script setup lang="ts">
definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const route = useRoute()

const projectId = computed(() => String(route.params.id))
const { data, error, refresh } = await useApiFetch(() => `/api/admin/projects/${projectId.value}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })
}
const project = computed(() => data.value?.project)

useSeoMeta({ title: () => (project.value ? t('projects.media.meta.title', { name: project.value.name }) : t('projects.list.title')) })

const flash = useFlash().consume()
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <UiAlert v-if="error" variant="error" live="assertive" :title="t('projects.overview.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="project">
      <AdminProjectHeader :project="project" />

      <UiAlert v-if="flash" :variant="flash.variant" live="polite" class="mb-6">
        {{ flash.message }}
      </UiAlert>

      <AdminMediaBrowser :project-id="project.id" />
    </template>
  </div>
</template>
