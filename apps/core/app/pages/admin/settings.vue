<script setup lang="ts">
/**
 * Réglages de l'installation (permission settings:manage : ADMIN). Section « Transformations
 * d'images » : politique des transformations libres des médias de la bibliothèque, préréglages
 * globaux (utilisables dans tous les projets) et bornes du serveur (variables d'environnement).
 * Section « Traitement des vidéos » (phase D3) : état en lecture seule (variables NUXT_VIDEO_*),
 * processus de travail, tâches, et « Traiter les vidéos existantes ».
 * Section « Licence » (ancre #license, liens du tableau de bord) : licence commerciale et identifiant
 * de l'installation.
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

    <section aria-labelledby="settings-security-title" class="mt-12 grid gap-4">
      <div class="grid max-w-3xl gap-1">
        <h2 id="settings-security-title" class="text-xl font-semibold text-foreground">
          {{ t('settings.security.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ t('settings.security.description') }}
        </p>
      </div>
      <AdminSecuritySettings />
    </section>

    <section aria-labelledby="settings-video-processing-title" class="mt-12 grid gap-4">
      <div class="grid max-w-3xl gap-1">
        <h2 id="settings-video-processing-title" class="text-xl font-semibold text-foreground">
          {{ t('settings.videoProcessing.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ t('settings.videoProcessing.description') }}
        </p>
      </div>
      <AdminVideoProcessingSettings :heading-level="3" />
    </section>

    <section id="license" aria-labelledby="settings-license-title" class="mt-12 grid scroll-mt-6 gap-4">
      <div class="grid max-w-3xl gap-1">
        <h2 id="settings-license-title" class="text-xl font-semibold text-foreground">
          {{ t('settings.license.title') }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ t('settings.license.description') }}
        </p>
      </div>
      <AdminLicenseSettings />
    </section>
  </div>
</template>
