import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxtjs/i18n', '@nuxtjs/color-mode', 'nuxt-auth-utils', '@nuxt/eslint'],
  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  // Thème clair / sombre / système ; cookie pour un rendu serveur sans flash.
  colorMode: {
    classSuffix: '',
    storage: 'cookie',
    storageKey: 'surge-media-color-mode',
  },

  runtimeConfig: {
    // URL publique de l'installation (ex. https://media.example.com), demandée par
    // `surge-media init` ; à défaut, déduite de chaque requête — NUXT_SITE_URL
    siteUrl: '',
    // Mandataires inverses de confiance pour X-Forwarded-For (adresse IP réelle du client) : true = boucle
    // locale et réseaux privés (Docker), false = en-tête ignoré, ou liste d'adresses / plages CIDR
    // (server/lib/http/client-ip.ts) — NUXT_TRUST_PROXY. Texte : Nitro peut en faire un booléen (destr), géré.
    trustProxy: 'true',
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
    // Double authentification : clé de chiffrement des secrets TOTP en base, générée par `surge-media init`
    // et par l'image Docker ; absente = activation impossible (server/lib/mfa/) — NUXT_MFA_ENCRYPTION_KEY
    mfa: {
      encryptionKey: '',
    },
    // Licence commerciale (fonctions payantes) : l'emporte sur celle installée depuis Réglages › Licence,
    // qui passe alors en lecture seule (server/utils/license.ts) — NUXT_LICENSE_KEY
    license: {
      key: '',
    },
    // Mode démo : instance publique remise à zéro à heures fixes, contenu de référence en lecture seule,
    // e-mail coupé (server/utils/demo.ts, .claude/architecture-demo.md) — NUXT_DEMO_*
    demo: {
      mode: false, // NUXT_DEMO_MODE
      resetInterval: 120, // minutes entre deux remises à zéro, créneaux alignés sur minuit UTC — NUXT_DEMO_RESET_INTERVAL
      accounts: '', // comptes affichés à la connexion, JSON [{ "email", "password" }] — NUXT_DEMO_ACCOUNTS
      uploadQuota: 1024 * 1024 * 1024, // octets envoyés par cycle (une adresse IP : le quart) — NUXT_DEMO_UPLOAD_QUOTA
      contactUrl: '', // NUXT_DEMO_CONTACT_URL
      abuseUrl: '', // NUXT_DEMO_ABUSE_URL
      termsUrl: '', // NUXT_DEMO_TERMS_URL
      // Pages légales de la démo (/legal, /privacy, /terms), servies dès que l'éditeur est renseigné — NUXT_DEMO_LEGAL_*
      legal: {
        publisherName: '', // éditeur, avec sa forme (ex. « Jeanne Martin EI ») — NUXT_DEMO_LEGAL_PUBLISHER_NAME
        tradeName: '', // nom commercial — NUXT_DEMO_LEGAL_TRADE_NAME
        registration: '', // ex. « SIRET 123 456 789 00012 » — NUXT_DEMO_LEGAL_REGISTRATION
        address: '', // adresse publiée (domicile ou domiciliation) — NUXT_DEMO_LEGAL_ADDRESS
        email: '', // NUXT_DEMO_LEGAL_EMAIL
        phone: '', // NUXT_DEMO_LEGAL_PHONE
        director: '', // directeur de la publication, l'éditeur à défaut — NUXT_DEMO_LEGAL_DIRECTOR
        hostName: '', // hébergeur du serveur — NUXT_DEMO_LEGAL_HOST_NAME
        hostAddress: '', // NUXT_DEMO_LEGAL_HOST_ADDRESS
        hostPhone: '', // NUXT_DEMO_LEGAL_HOST_PHONE
        logRetentionDays: 30, // conservation annoncée des journaux du serveur — NUXT_DEMO_LEGAL_LOG_RETENTION_DAYS
      },
    },
    // Compte d'amorçage (première connexion) — NUXT_BOOTSTRAP_ADMIN_EMAIL / _PASSWORD
    bootstrapAdmin: {
      email: '',
      password: '',
    },
    // Envoi d'e-mails (liens d'invitation et de réinitialisation) — NUXT_SMTP_*. Hôte ou expéditeur
    // vide : envoi désactivé, le bouton « Envoyer par e-mail » n'est pas proposé (server/lib/mail/).
    smtp: {
      host: '', // NUXT_SMTP_HOST
      port: 587, // NUXT_SMTP_PORT
      secure: false, // TLS dès la connexion (port 465) ; sinon STARTTLS si le serveur le propose — NUXT_SMTP_SECURE
      user: '', // identifiant, facultatif (relais sans authentification) — NUXT_SMTP_USER
      password: '', // NUXT_SMTP_PASSWORD
      from: '', // expéditeur, ex. « surgeMedia <no-reply@example.com> » — NUXT_SMTP_FROM
    },
    public: {
      // Appareils de confiance : jours sans ressaisie du mot de passe pour les actions sensibles,
      // 0 = option désactivée (shared/utils/auth.ts) — NUXT_PUBLIC_TRUSTED_DEVICE_DAYS
      trustedDeviceDays: 15,
    },
    // API publique v1 : requêtes par minute (seau à jetons, en mémoire) — NUXT_API_RATE_LIMIT_*
    api: {
      rateLimit: {
        publishable: 300, // par clé publique et par IP — NUXT_API_RATE_LIMIT_PUBLISHABLE
        secret: 1200, // par clé secrète — NUXT_API_RATE_LIMIT_SECRET
        personal: 1200, // par jeton personnel — NUXT_API_RATE_LIMIT_PERSONAL
        delegated: 300, // par émetteur de jetons délégués et par IP — NUXT_API_RATE_LIMIT_DELEGATED
        uploads: 60, // envois de fichiers par identifiant (en plus) — NUXT_API_RATE_LIMIT_UPLOADS
        authFailures: 30, // échecs d'authentification par IP — NUXT_API_RATE_LIMIT_AUTH_FAILURES
      },
    },
    // Rôle du processus : web | worker (processus de travail des vidéos : exécute les tâches, ne sert que
    // /api/health) — NUXT_SERVER_ROLE
    serverRole: 'web',
    // Binaires ffmpeg et ffprobe du système (phase D3) — NUXT_FFMPEG_PATH / NUXT_FFPROBE_PATH
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    // Traitement des vidéos par ffmpeg (phase D3) — variables NUXT_VIDEO_* (voir .env.example et setup.md § 7.6).
    // Sans rapport avec NUXT_MEDIA_PROCESSING_* (traitements d'images, sharp).
    video: {
      processing: 'off', // off | embedded | external — NUXT_VIDEO_PROCESSING
      concurrency: 1, // tâches simultanées par processus — NUXT_VIDEO_CONCURRENCY
      threads: 0, // fils par ffmpeg, 0 = moitié des cœurs — NUXT_VIDEO_THREADS
      rendition: 'auto', // rendu H.264 : auto | always | never (sauf formats convertis) — NUXT_VIDEO_RENDITION
      preset: 'veryfast', // préréglage x264 — NUXT_VIDEO_PRESET
      crf: 23, // qualité x264 (0–51, plus bas = meilleur) — NUXT_VIDEO_CRF
      av1: false, // rendu AV1 en plus (on/off) — NUXT_VIDEO_AV1
      maxDuration: 10800, // s : au-delà, pas de conversion (échec TOO_LONG) — NUXT_VIDEO_MAX_DURATION
      memoryLimit: 4096, // Mio par ffmpeg (Linux, prlimit), 0 = sans limite — NUXT_VIDEO_MEMORY_LIMIT
    },
    // Médias — variables NUXT_MEDIA_* (voir .env.example et setup.md § 7.4 et § 7.5).
    media: {
      maxUploadSize: 25 * 1024 * 1024, // images, octets — NUXT_MEDIA_MAX_UPLOAD_SIZE
      maxVideoUploadSize: 512 * 1024 * 1024, // vidéos, octets, 2 147 483 647 au plus — NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE
      // Délai (s) pour recevoir une requête entière (envois longs) ; Node coupe sinon à 300 s — NUXT_MEDIA_UPLOAD_TIMEOUT
      uploadTimeout: 3600,
      // Préparation des MP4/MOV à l'envoi : index en tête, métadonnées d'origine (lieu, appareil) retirées ;
      // « faststart », « metadata », les deux, ou « none » — NUXT_MEDIA_VIDEO_PREPARE
      videoPrepare: 'faststart,metadata',
      signingSecret: '', // liens signés des médias privés — NUXT_MEDIA_SIGNING_SECRET
      previousSigningSecret: '', // ancien secret, accepté pendant une rotation — NUXT_MEDIA_PREVIOUS_SIGNING_SECRET
      // Base des URL de diffusion (CDN, domaine dédié) ; vide = NUXT_SITE_URL — NUXT_MEDIA_PUBLIC_URL
      publicUrl: '',
      // Traitements d'images simultanés (sharp) : 0 = nombre de cœurs ; au-delà, file d'attente,
      // puis 503 SERVER_BUSY — NUXT_MEDIA_PROCESSING_CONCURRENCY / NUXT_MEDIA_PROCESSING_QUEUE
      processing: {
        concurrency: 0,
        queue: 100,
      },
      // Transformations à la demande (/m/<id>/v<n>/w_800,h_600/<nom>.webp) — NUXT_MEDIA_TRANSFORM_*
      transform: {
        maxDimension: 4096, // largeur et hauteur de sortie maximales — _MAX_DIMENSION
        formats: 'jpg,png,webp,avif', // formats de sortie activés — _FORMATS
        maxVariants: 50, // dérivés par version de média, au-delà : plus de paramètres libres nouveaux — _MAX_VARIANTS
        rateLimit: 60, // nouvelles générations libres non signées par IP et par minute, 0 = sans limite — _RATE_LIMIT
        presetMaxAge: 604800, // cache (s) des URL d'un préréglage global ou de projet, modifiable — _PRESET_MAX_AGE
      },
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

  optimization: {
    // Clé de cache automatique pour le wrapper de useFetch (app/composables/useApiFetch.ts).
    keyedComposables: [{ name: 'useApiFetch', argumentLength: 3 }],
  },
  // Nuxt 3 avec la structure et les comportements de Nuxt 4 (dossier app/, shared/…) :
  // la future migration vers Nuxt 4 se limitera à la mise à jour de la dépendance.
  future: {
    compatibilityVersion: 4,
  },
  compatibilityDate: '2026-09-26',

  nitro: {
    // Documentation de l'API v1 générée depuis le code : chaque route décrit son opération avec
    // `defineRouteMeta({ openAPI })`, que Nitro extrait à la compilation ; la spécification est
    // assemblée par GET /api/v1/openapi.json (server/lib/api/openapi.ts) et affichée dans
    // l'administration (/admin/api). Les interfaces intégrées de Nitro (/_scalar, /_swagger, chargées
    // depuis un CDN) restent désactivées ; /_openapi.json (toutes les routes) n'existe qu'en développement.
    experimental: { openAPI: true },
    openAPI: {
      meta: { title: 'surgeMedia', version: '1.0.0' },
      ui: { scalar: false, swagger: false },
    },
    // Cible du serveur alignée sur `engines.node` (≥ 24) : celle de Nitro par défaut (es2019) signale à tort les
    // littéraux BigInt (`62n`, server/lib/access/tokens.ts) comme non pris en charge.
    esbuild: { options: { target: 'node24' } },
  },
  vite: {
    plugins: [tailwindcss()],
    // Documentation de l'API (Scalar, chargé à la demande) : pré-optimisé au démarrage du serveur de
    // développement, sinon sa découverte tardive charge une seconde copie de Vue (erreur au montage).
    optimizeDeps: { include: ['@scalar/api-reference'] },
  },
  typescript: {
    strict: true,
  },

  // ESLint (eslint.config.mjs, `pnpm lint`) : configuration générée par @nuxt/eslint (règles JavaScript,
  // TypeScript, Vue et Nuxt) et règles de style @stylistic, celles du code existant : indentation de 2 espaces,
  // guillemets simples, sans point-virgule, virgule finale en multiligne, `else` / `catch` sur leur propre ligne.
  eslint: {
    config: {
      stylistic: true,
    },
  },

  // Ajouter une langue : créer i18n/locales/<code>.json (copie de fr.json), l'ajouter
  // ici, puis lancer `pnpm i18n:check` (voir setup.md § 18).
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
