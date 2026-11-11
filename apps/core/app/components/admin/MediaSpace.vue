<script setup lang="ts">
/**
 * Page « Médias », un espace (architecture : .claude/architecture-media-view.md, MV6) : `space` =
 * `library` ou identifiant d'un projet. En-tête de l'espace, puis le navigateur d'un espace (dossiers,
 * envoi dans le dossier affiché, filtres, actions groupées, corbeille), dont chaque lien garde `space`
 * et dont le fil d'Ariane part de « Tous les médias ». Projet introuvable ou invisible : message et
 * retour à « Tous les médias » (MV13). La page Médias d'un projet (/admin/projects/:id/media) reste
 * l'autre entrée vers le même navigateur.
 */
const props = defineProps<{
  /** `library` ou identifiant d'un projet. */
  space: string
  /** Message laissé par la page précédente (ex. média supprimé). */
  flash?: FlashMessage | null
}>()

const { t } = useI18n()
const route = useRoute()
const isLibrary = props.space === 'library'
const inTrash = computed(() => route.query.status === 'trash')

// Composant recréé à chaque changement d'espace (clé dans la page) : l'adresse est fixe ici.
const { data: projectData, error: projectError } = isLibrary
  ? { data: ref(null), error: ref(null) }
  : await useApiFetch(`/api/admin/projects/${encodeURIComponent(props.space)}`)
const project = computed(() => (projectData.value as { project?: { id: string, name: string } } | null)?.project ?? null)
const missing = computed(() => !isLibrary && Boolean(projectError.value))
const spaceName = computed(() => (isLibrary ? t('media.overview.library') : project.value?.name ?? ''))

const title = computed(() => {
  if (inTrash.value) return t('media.list.trashTitle')
  return isLibrary ? t('media.list.title') : spaceName.value
})
const description = computed(() => {
  if (inTrash.value) return t('media.list.trashDescription')
  return isLibrary ? t('media.list.description') : t('media.overview.projectDescription')
})

useSeoMeta({
  title: () => {
    if (missing.value) return t('media.overview.spaceMissing.title')
    if (inTrash.value) return t('media.list.trashTitle')
    return isLibrary ? t('media.list.meta.title') : t('projects.media.meta.title', { name: spaceName.value })
  },
})
</script>

<template>
  <div>
    <template v-if="missing">
      <AdminPageHeader :title="t('media.overview.spaceMissing.title')" />
      <UiAlert variant="warning" :title="t('media.overview.spaceMissing.title')">
        <p>{{ t('media.overview.spaceMissing.description') }}</p>
        <UiButton to="/admin/media" variant="outline" size="sm" class="mt-2">
          {{ t('media.overview.spaceMissing.back') }}
        </UiButton>
      </UiAlert>
    </template>

    <template v-else-if="isLibrary || project">
      <AdminPageHeader :title="title" :description="description" />

      <UiAlert v-if="flash" :variant="flash.variant" live="polite" class="mb-6">
        {{ flash.message }}
      </UiAlert>

      <AdminMediaBrowser :project-id="isLibrary ? undefined : space" :space-param="space" :root-label="spaceName" />
    </template>
  </div>
</template>
