<script setup lang="ts">
/**
 * Page « Médias » (architecture : .claude/architecture-media-view.md) : sans `space`, « Tous les médias »
 * (bibliothèque et projets actifs de l'utilisateur) ; avec `space` (`library` ou identifiant d'un
 * projet), cet espace, dossiers compris. L'API décide de ce qui est visible.
 */
definePageMeta({ layout: 'admin', permission: 'library:read' })

const { t } = useI18n()
const route = useRoute()

// Ancienne adresse de la bibliothèque (`?folder=…`, `?status=trash` sans `space`) : la bibliothèque.
const space = computed(() => {
  if (typeof route.query.space === 'string' && route.query.space.trim()) return route.query.space.trim()
  return route.query.folder || route.query.status === 'trash' ? 'library' : ''
})
const flash = useFlash().consume()
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <AdminMediaSpace v-if="space" :key="space" :space="space" :flash="flash" />

    <template v-else>
      <AdminPageHeader :title="t('media.overview.title')" :description="t('media.overview.description')" />

      <UiAlert v-if="flash" :variant="flash.variant" live="polite" class="mb-6">
        {{ flash.message }}
      </UiAlert>

      <AdminMediaOverview />
    </template>
  </div>
</template>
