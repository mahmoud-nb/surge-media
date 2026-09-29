<script setup lang="ts">
/**
 * En-tête commun des pages d'un projet : retour à la liste, nom (h1 de la page), statut,
 * rôle de l'utilisateur, navigation entre les sections du projet (aria-current="page") et
 * rappel de l'archivage (lecture seule).
 */
import { ArrowLeft, Archive } from '@lucide/vue'

const props = defineProps<{
  project: {
    id: string
    name: string
    description: string | null
    archivedAt: string | null
    role: ProjectRole | null
  }
}>()

const { t } = useI18n()
const route = useRoute()

const sections = computed(() => [
  { to: `/admin/projects/${props.project.id}`, label: t('projects.nav.overview') },
  { to: `/admin/projects/${props.project.id}/media`, label: t('projects.nav.media') },
  { to: `/admin/projects/${props.project.id}/members`, label: t('projects.nav.members') },
])
</script>

<template>
  <div class="mb-8">
    <NuxtLink to="/admin/projects" class="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" />
      {{ t('projects.backToList') }}
    </NuxtLink>

    <header class="flex flex-wrap items-end justify-between gap-4">
      <div class="grid gap-1.5">
        <h1 class="text-2xl font-semibold tracking-tight text-foreground">
          {{ project.name }}
        </h1>
        <p v-if="project.description" class="text-muted-foreground">
          {{ project.description }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UiBadge v-if="project.archivedAt" variant="warning">
          <Archive class="size-3" aria-hidden="true" />
          {{ t('projects.status.archived') }}
        </UiBadge>
        <UiBadge v-if="project.role" variant="primary">
          {{ t('projects.header.yourRole', { role: t(`projectRoles.${project.role}.label`) }) }}
        </UiBadge>
      </div>
    </header>

    <nav :aria-label="t('projects.nav.label')" class="mt-6 border-b border-border">
      <ul class="-mb-px flex flex-wrap gap-1">
        <li v-for="section in sections" :key="section.to">
          <NuxtLink
            :to="section.to"
            :aria-current="route.path === section.to ? 'page' : undefined"
            class="inline-flex rounded-t-lg border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-input hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-primary"
          >
            {{ section.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <UiAlert v-if="project.archivedAt" variant="warning" :title="t('projects.archived.title')" class="mt-6">
      {{ t('projects.archived.description') }}
    </UiAlert>
  </div>
</template>
