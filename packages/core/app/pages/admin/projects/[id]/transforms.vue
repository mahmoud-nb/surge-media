<script setup lang="ts">
/**
 * Onglet « Transformations » d'un projet : politique des transformations libres de ses médias,
 * préréglages (intégrés, globaux, du projet) et bornes du serveur. Lecture pour tout membre,
 * modification avec la portée project:settings (propriétaires).
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

useSeoMeta({ title: () => (project.value ? t('transforms.meta.projectTitle', { name: project.value.name }) : t('projects.list.title')) })
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

      <div class="mb-6 grid max-w-3xl gap-1">
        <p class="text-sm text-muted-foreground">
          {{ t('transforms.projectDescription') }}
        </p>
      </div>

      <AdminTransformSettings :project-id="project.id" />
    </template>
  </div>
</template>
