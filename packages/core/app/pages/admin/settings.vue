<script setup lang="ts">
/**
 * Réglages de l'installation (permission settings:manage : ADMIN). Section « Transformations
 * d'images » : politique des transformations libres des médias de la bibliothèque, préréglages
 * globaux (utilisables dans tous les projets) et bornes du serveur (variables d'environnement).
 */
definePageMeta({ layout: 'admin', permission: 'settings:manage' })

const { t } = useI18n()
useSeoMeta({ title: () => t('settings.meta.title') })
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <AdminPageHeader :title="t('settings.title')" :description="t('settings.description')" />

    <section aria-labelledby="settings-transforms-title" class="grid gap-4">
      <div class="grid max-w-3xl gap-1">
        <h2 id="settings-transforms-title" class="text-xl font-semibold text-foreground">
          {{ t('settings.transforms.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ t('settings.transforms.description') }}
        </p>
      </div>
      <AdminTransformSettings :heading-level="3" />
    </section>
  </div>
</template>
