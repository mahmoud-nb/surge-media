<script setup lang="ts">
/**
 * Onglet « Étiquettes » d'un projet (architecture-tags.md) : étiquettes du projet (gérées par son
 * propriétaire : ADMIN ou gestionnaire), puis rappel des étiquettes globales. Lecture pour tout membre.
 */
definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const route = useRoute()

const projectId = computed(() => String(route.params.id))
const { data: projectData, error: projectError, refresh: refreshProject } = await useApiFetch(() => `/api/admin/projects/${projectId.value}`)
if (projectError.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })
}
const project = computed(() => projectData.value?.project)

useSeoMeta({ title: () => (project.value ? t('tags.meta.projectTitle', { name: project.value.name }) : t('projects.list.title')) })
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <UiAlert v-if="projectError" variant="error" live="assertive" :title="t('projects.overview.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refreshProject()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="project">
      <AdminProjectHeader :project="project" :scopes="projectData?.scopes ?? []" />
      <div class="max-w-4xl">
        <AdminTagManager :project-id="project.id" />
      </div>
    </template>
  </div>
</template>
