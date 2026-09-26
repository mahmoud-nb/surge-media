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

  optimization: {
    // Clé de cache automatique pour le wrapper de useFetch (app/composables/useApiFetch.ts).
    keyedComposables: [{ name: 'useApiFetch', argumentLength: 3 }],
  },
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
    // Médias — variables NUXT_MEDIA_* (voir .env.example et setup.md § 7).
    media: {
      maxUploadSize: 25 * 1024 * 1024, // octets — NUXT_MEDIA_MAX_UPLOAD_SIZE
      signingSecret: '', // liens signés des médias privés — NUXT_MEDIA_SIGNING_SECRET
      storage: {
        driver: 'local', // local | s3 — NUXT_MEDIA_STORAGE_DRIVER
        root: './data/media', // pilote local — NUXT_MEDIA_STORAGE_ROOT
        prefix: '', // préfixe de toutes les clés — NUXT_MEDIA_STORAGE_PREFIX
        s3: {
          bucket: '', // NUXT_MEDIA_STORAGE_S3_BUCKET
          region: '', // NUXT_MEDIA_STORAGE_S3_REGION
          endpoint: '', // services compatibles S3 — NUXT_MEDIA_STORAGE_S3_ENDPOINT
          accessKeyId: '', // NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID
          secretAccessKey: '', // NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY
          forcePathStyle: false, // NUXT_MEDIA_STORAGE_S3_FORCE_PATH_STYLE
        },
      },
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
    '/password/**': { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } },
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
