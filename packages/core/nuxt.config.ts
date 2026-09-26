import tailwindcss from '@tailwindcss/vite'

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

  modules: ['@nuxtjs/i18n', '@nuxtjs/color-mode', 'nuxt-auth-utils'],

  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },

  runtimeConfig: {
    // nuxt-auth-utils : cookie scellé HTTP-only (secret : NUXT_SESSION_PASSWORD).
    session: {
      name: 'surge-media-session',
      password: '',
      maxAge: 60 * 60 * 12, // 12 h — NUXT_SESSION_MAX_AGE
      cookie: {
        sameSite: 'lax',
        // HTTPS obligatoire en production (localhost excepté) — NUXT_SESSION_COOKIE_SECURE
        secure: true,
      },
    },
    // Compte d'amorçage (première connexion) — NUXT_BOOTSTRAP_ADMIN_EMAIL / _PASSWORD
    bootstrapAdmin: {
      email: '',
      password: '',
    },
    storage: {
      // Dossier des fichiers médias (pilote unstorage « fs ») — NUXT_STORAGE_BASE
      base: './data/media',
    },
  },

  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    },
    // Pages contenant des données personnelles : ni cache partagé, ni indexation.
    '/admin/**': { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } },
    '/login': { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } },
  },

  // Thème clair / sombre / système ; cookie pour un rendu serveur sans flash.
  colorMode: {
    classSuffix: '',
    storage: 'cookie',
    storageKey: 'surge-media-color-mode',
  },

  // Ajouter une langue : créer i18n/locales/<code>.json (copie de fr.json), l'ajouter
  // ici, puis lancer `pnpm i18n:check` (voir setup.md).
  i18n: {
    defaultLocale: 'fr',
    strategy: 'no_prefix',
    locales: [
      { code: 'fr', language: 'fr-FR', name: 'Français', file: 'fr.json', dir: 'ltr' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json', dir: 'ltr' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'surge-media-locale',
      redirectOn: 'root',
      fallbackLocale: 'fr',
    },
  },
})
