// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-09-26',
  // Nuxt 3 avec la structure et les comportements de Nuxt 4 (dossier app/, shared/…) :
  // la future migration vers Nuxt 4 se limitera à la mise à jour de la dépendance.
  future: {
    compatibilityVersion: 4,
  },
  devtools: { enabled: true },
  typescript: {
    strict: true,
  },
  runtimeConfig: {
    storage: {
      // Dossier des fichiers médias (pilote unstorage « fs ») — NUXT_STORAGE_BASE
      base: './data/media',
    },
  },
})
