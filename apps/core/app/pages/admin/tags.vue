<script setup lang="ts">
/**
 * Étiquettes globales (architecture-tags.md) : communes à la bibliothèque et à tous les projets. Lecture
 * pour tout compte qui voit la bibliothèque, gestion par l'ADMIN (permission `tags:global`).
 */
definePageMeta({ layout: 'admin', permission: 'library:read' })

const { t } = useI18n()
useSeoMeta({ title: () => t('tags.meta.globalTitle') })
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <AdminPageHeader :title="t('tags.page.title')" :description="t('tags.page.description')" />
    <AdminTagManager />
  </div>
</template>
