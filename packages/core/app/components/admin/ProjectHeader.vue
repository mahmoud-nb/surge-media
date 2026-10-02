<script setup lang="ts">
/**
 * En-tête commun des pages d'un projet : retour à la liste, nom (h1 de la page), statut,
 * rôle de l'utilisateur, navigation entre les sections du projet (aria-current="page", ou "true"
 * sur une sous-page comme la création d'une clé) et rappel de l'archivage (lecture seule).
 * Les onglets affichés dépendent des portées de l'utilisateur dans le projet.
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
  /** Portées de l'utilisateur dans le projet (réponse de GET /api/admin/projects/:id). */
  scopes: readonly string[]
}>()

const { t } = useI18n()
const route = useRoute()

const sections = computed(() => {
  const base = `/admin/projects/${props.project.id}`
  const items = [
    { to: base, label: t('projects.nav.overview') },
    { to: `${base}/media`, label: t('projects.nav.media') },
    { to: `${base}/members`, label: t('projects.nav.members') },
    { to: `${base}/transforms`, label: t('projects.nav.transforms') },
  ]
  if (props.scopes.includes('project:credentials')) {
    items.push(
      { to: `${base}/keys`, label: t('projects.nav.keys') },
      { to: `${base}/origins`, label: t('projects.nav.origins') },
    )
  }
  return items
})

function currentState(to: string): 'page' | 'true' | undefined {
  if (route.path === to) return 'page'
  if (to !== `/admin/projects/${props.project.id}` && route.path.startsWith(`${to}/`)) return 'true'
  return undefined
}
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
            :aria-current="currentState(section.to)"
            class="inline-flex rounded-t-lg border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-input hover:text-foreground [&[aria-current]]:border-primary [&[aria-current]]:text-primary"
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
