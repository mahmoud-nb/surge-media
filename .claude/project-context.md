# surgeMedia — contexte de référence du projet

> **Rôle de ce fichier** : mémoire technique permanente pour reprendre le développement sans
> l'historique des conversations. Complète `setup.md` (guide d'installation / d'exploitation en
> français, avec le « Journal des étapes »). En cas de divergence, **le code fait foi**, puis
> `setup.md`, puis ce fichier.
>
> **Maintenance du 2026-10-10** (après `89938e2`, non commitée au moment de la rédaction ; § 9.24, `setup.md` § 12.1 et journal) :
> test global sous Windows et montée en charge — deux correctifs de débit et de fiabilité (configuration d'exécution calculée une
> fois, réponses de `/m/` jamais envoyées en keep-alive), **alerte « base SQLite sous pression »** au tableau de bord, vérifications
> D3 sous Windows faites (Ctrl+C, priorité, `taskkill`). **Suite** (décisions de l'utilisateur) : adresse IP réelle derrière un
> mandataire (`NUXT_TRUST_PROXY`, § 9.24), WAL vérifié au démarrage, attente du verrou SQLite gardée à 10 s.
>
> **État décrit** : commit `dbf3aa7` (**étape 22, D3 — traitement des vidéos par ffmpeg**, 2026-10-09 ; § 9.23 ; documentation de
> D3 écrite ensuite — brouillon commité en `fbfcfaa`, version finale non commitée au moment de la rédaction : vérifier `git log`), après `919a113` (**étape 18, envoi des liens par
> e-mail**, 2026-10-04 ; § 8), `608b8f6` (**étape 17, appareils de confiance** ; § 7.2) et `7a42f45` (**étape 16, rôle Gestionnaire** ;
> § 7.1, § 8, § 9.10), **étape 19, tableau de bord** (2026-10-04 ; § 9.20). Étapes terminées : 1 (monorepo, core, base), 2 (UI, auth, rôles),
> 3 (utilisateurs), 4 (médias, phase A), 5 = **B1** (projets, espaces, autorisations), 6 = **B2**
> (identifiants d'API, origines, mode sudo, journal d'audit), 7 = **B3** (API publique v1 en lecture),
> 8 = **B4** (API v1 en écriture, jetons délégués `sm_dt_`, file bornée des traitements, pré-génération),
> 9 = **B5** (dossiers : arborescence, navigation et rangement dans l'admin, API v1), 10 = **documentation
> interactive de l'API** (OpenAPI généré depuis `defineRouteMeta`, page `/admin/api` avec Scalar, § 9.15),
> 11 = **C1** (transformations d'images à la demande : moteur et diffusion par `/m/`, § 9.16), 12 = **C2** (politique des
> transformations, préréglages, page « Réglages », § 9.17), 13 = **C3** (API : `urlTemplate`, `focalPoint`, liens signés de
> transformation unitaires et par lot ; point d'intérêt dans la fiche média, § 9.18), 14 = **C4** (générateur d'adresses de la
> fiche média : aperçu à la volée non enregistré, adresses signées si nécessaire, extraits HTML, § 9.19), 16 = **rôle Gestionnaire**
> (`MANAGER` : administre ses projets, invite développeurs et éditeurs ; bibliothèque gérée par l'ADMIN seul). **Les phases B et C sont
> terminées** (`.claude/architecture-phase-c.md` : décisions CD1 à CD12, écarts en tête). **Phase D = vidéos** : architecture
> `.claude/architecture-phase-d.md` (DD1 à DD14) **validée le 2026-10-05** ; **D1 faite** le 2026-10-05 (étape 20 : envoi, stockage,
> CRUD, diffusion directe sans transcodage ; § 9.21 ; commit `bda9cfb`) ; **D2 faite** le 2026-10-06 (DD15 à DD24 validées le 2026-10-05,
> étape 21 : préparation des MP4/MOV — index en tête, lieu et appareil retirés —, image d'affiche, sous-titres WebVTT ; § 9.22) ;
> **D3 faite** le 2026-10-09 (DD25 à DD36 validées le 2026-10-06, étape 22 : traitement des vidéos par ffmpeg hors du chemin des
> requêtes — file persistante, modes `off`/`embedded`/`external`, processus de travail, rendus H.264/AV1, retrait des pistes GPS,
> réparation des WebM, affiche du serveur, formats convertis, `sources[]` ; § 9.23 ; commits `bf5e58a` à `dbf3aa7` sur `main`,
> état final : `.claude/architecture-phase-d.md`, section « D3 — état de l'implémentation »). Suite : vérifications sous Windows
> (§ 21), puis D4 (streaming adaptatif HLS) **à proposer et faire valider**. **Correctifs du 2026-10-05** (non commités au moment de la
> rédaction ; § 7.6, § 9.4, § 9.6, § 18) : fermeture des flux interrompus de `/m/`, corps JSON bornés (1 Mio, 30 s), envois arrêtés
> après 60 s sans donnée. Architecture de la phase B :
> `.claude/architecture-phase-b.md` (en-tête = écarts B1 à B5).
>
> **Phase E = bibliothèques front** (étude validée le 2026-10-15) : `.claude/architecture-phase-e.md` (décisions ED1 à ED28)
> — `packages/client` (`@surge-media/client`, sans framework) + `packages/vue` (`@surge-media/vue`), composants sans
> dépendance CSS + thème facultatif, les quatre familles (affichage, envoi, parcours/sélection, édition) dans la 0.1 livrées
> en étapes E1 à E5, `@surge-media/nuxt` séparé plus tard. **E1 faite le 2026-10-15** (étape 26 : fondations, composants
> d'affichage, bac à sable `apps/playground`, `Project.transformFormats` / `transformMaxDimension` ; § 9.25). **E2 (envoi)**,
> choisie avant le paquet React, **validée telle quelle puis faite le 2026-10-17** (étape 27 ; § 9.26 ; `architecture-phase-e.md`
> § 12 et « E2 — état de l'implémentation »). **Prochaine étape : E3 (parcours et sélection)** à détailler et faire valider ;
> le paquet React demandera d'abord de déplacer dans le client la logique d'affichage encore dans `@surge-media/vue`.
>
> Les éléments marqués **[À CONFIRMER]** sont des hypothèses ou des points non validés par
> l'utilisateur (récapitulés en § 22).

---

## 1. Produit et périmètre

- **surgeMedia** : plateforme **auto-hébergée** à code source public (**BSL 1.1**, pas « open source » au sens de l'OSI), modulaire, de gestion et de traitement
  des médias (« mini-Cloudinary »). Déployée sur l'infrastructure du client.
- Deux faces du core : **interface d'administration** (médias, utilisateurs, jetons) et **couche
  d'API** pour les applications tierces du client (authentification, autorisations, CORS).
- Traitements d'images à la demande par URL (crop, resize, optimisation : phase C, terminée) ; vidéos (phase D : envoi et diffusion
  directe, préparation, affiche, sous-titres ; D3 : conversion facultative par ffmpeg hors du chemin des requêtes, § 9.23).
- Monorepo cible : `@surge-media/core` (admin + API, `apps/core`), site et documentation (`apps/website`, étape 25),
  `@surge-media/client` (client sans framework) + `@surge-media/vue` (composants : images optimisées, vidéos, galeries,
  sélecteurs, envoi, édition — phase E, `.claude/architecture-phase-e.md`), puis `@surge-media/nuxt`, `react`, `svelte`.
  **Aujourd'hui : `apps/core`, `apps/website`, `apps/playground` ; `packages/client` et `packages/vue` (MIT, pas encore publiés ; E1 et E2 faites, § 9.25 et § 9.26).**
- Base de données par défaut SQLite, configurable (PostgreSQL, MySQL/MariaDB) via la CLI
  `surge-media init` ou un script de réinitialisation.
- Exigences transverses de l'utilisateur (permanentes) :
  - **Multilingue** : français par défaut, anglais, extensible ; **aucun texte en dur**.
  - **Accessibilité stricte W3C / WCAG 2.2 AA** (ARIA, clavier), en clair et sombre, dans chaque langue.
  - Style « calme, moderne, robuste, professionnel » ; thèmes clair / sombre.
  - **Tenir `setup.md` à jour à chaque étape** (FR + « Journal des étapes »).
  - Présenter les choix d'architecture et **attendre la validation** avant les gros chantiers
    (l'utilisateur l'a demandé pour les médias).

## 2. Environnement et versions (épinglées volontairement)

| Élément | Version | Remarque |
| --- | --- | --- |
| Node.js | **≥ 24** (`.nvmrc` = 24, machine : 24.20) | exigé par Flydrive 2 ; `engines` racine et core `>=24.0.0` |
| pnpm | 12.4.2 (`packageManager`) | pnpm 12 bloque les scripts d'install : `pnpm approve-builds` ; `allowBuilds` : `@prisma/engines`, `better-sqlite3`, `esbuild`, `prisma` |
| Nuxt | **3.21.11** + `future.compatibilityVersion: 4` | Nuxt 3 demandé ; structure `app/`, `shared/`, `server/` de Nuxt 4 ; Nitro 2.13, Vite 7 |
| Prisma | **7.10.0 exact** (prisma, @prisma/client, adapters) | le tag npm `latest` pointe vers une 8.0.0-rc : ne pas mettre à jour sans tester |
| TypeScript | **~6.0.3** | TS 7 (natif) incompatible avec vue-tsc |
| vue-router | 5.3.x | |
| Tailwind CSS | 4.3 (plugin `@tailwindcss/vite`) | pas de `@nuxtjs/tailwindcss` |
| nuxt-auth-utils | 0.5.30 | configKey `auth` (ne pas utiliser `runtimeConfig.auth`) |
| @nuxtjs/i18n | 10.6 (vue-i18n 11) | |
| @nuxtjs/color-mode | 4.0 | stockage cookie |
| sharp | 0.35 (libvips 8.18) | binaires précompilés |
| flydrive | 2.1 | stockage des fichiers (fs, s3) |
| busboy | 1.6 | multipart en flux |
| @aws-sdk/client-s3 + s3-request-presigner | 3.114x | pilote S3 de Flydrive |
| @node-rs/argon2 | 2.2 | argon2id, binaires napi |
| zod | 4.6 | schémas partagés app/serveur |
| citty 0.2, @clack/prompts 1.8, tsdown 0.23, tsx 4 | | CLI |
| Vitest | 5.0 | tests des modules purs (`apps/core/tests/`, `vitest.config.ts`, alias `#shared`) |
| @scalar/api-reference | **1.72.3 exact** | documentation interactive (étape 10) ; `vue-demi` (dépendance) : `allowBuilds: false` ; `vite.optimizeDeps.include` |
| node:sqlite (intégré) | Node 24 | uniquement dans les scripts de test ad hoc (vieillir `Session.passwordVerifiedAt`, nettoyer l'audit) ; avertissement « experimental » |
| ffmpeg + ffprobe (D3) | **≥ 6**, du **système** (pas un paquet npm) | facultatif (`NUXT_VIDEO_PROCESSING=off` par défaut) ; `libx264` + `aac` exigés, `zscale`/`tonemap` (HDR) et `libsvtav1`/`libopus` (AV1) facultatifs ; vérifié avec 6.1.1 (Linux du nuage) ; Windows : `winget install Gyan.FFmpeg`, non vérifié (§ 22) |
| oxc-transform | **0.141.0 forcé** (`pnpm-workspace.yaml` › `overrides`) | Windows Smart App Control bloque le binaire 0.143.0 exigé par Nuxt 3.21 (`^0.143.0`) ; typecheck/dev/build vérifiés ; à retirer dès que possible (l'utilisateur a choisi cette option) |

Plateforme de dev de l'utilisateur : **Windows 11** (PowerShell + Git Bash). Chemin : `C:\__develop\surge-media`.

## 3. Architecture globale

```text
surge-media/                         monorepo pnpm (workspaces apps/* et packages/*), dépôt git (main)
├─ package.json                      scripts racine (délèguent au core), engines, packageManager
├─ pnpm-workspace.yaml               packages + allowBuilds
├─ setup.md                          guide FR + Journal des étapes (à maintenir)
├─ README.md                         présentation courte
├─ .claude/launch.json               serveurs pour l'aperçu Claude : core (dev), core-start (prod), core-start-3100 (prod sur 3100, cwd apps/core)
├─ .claude/project-context.md        CE FICHIER
├─ packages/client                  @surge-media/client (phases E1–E2, MIT) : client de l'API v1, URL d'images / vidéos, envoi (§ 9.25, § 9.26)
├─ packages/vue                     @surge-media/vue (phases E1–E2, MIT) : composants Sm*, plugin, thème facultatif (§ 9.25, § 9.26)
├─ apps/playground                  bac à sable des bibliothèques (Vite, port 5173, .env.local ; jamais publié)
├─ apps/website                     site public et documentation (Astro Starlight, étape 25)
└─ apps/core                         @surge-media/core (paquet npm publié, bin surge-media) ; apps/ = applications
   ├─ app/                           interface Vue/Nuxt (SSR)
   ├─ server/                        Nitro : api/, routes/, middleware/, plugins/, utils/ (auto-importés), lib/ (imports explicites), generated/ (Prisma, non versionné)
   ├─ shared/                        code partagé app/serveur/CLI (auto-import de shared/utils et shared/types)
   ├─ prisma/                        schema.prisma + migrations/<fournisseur>/ + schema.snapshot.prisma
   ├─ prisma.config.ts               config Prisma 7 (URL, dossier de migrations selon DATABASE_PROVIDER)
   ├─ cli/                           CLI surge-media (init, db migrate, db reset, worker — D3), i18n fr/en
   ├─ scripts/                       db-migration.ts, i18n-check.ts, check-contrast.ts
   ├─ tests/                         Vitest : permissions, signing, projects, credentials, api (modules purs)
   ├─ i18n/locales/                  fr.json (référence), en.json
   ├─ tsdown.config.ts               build de la CLI → dist/cli/index.mjs
   └─ data/                          (non versionné) base SQLite + médias du pilote local
```

Couches serveur :

```text
 Navigateur (admin, SSR + client)          Applications tierces (phase B)          Visiteurs / <img>
        │ cookie de session                         │ Bearer (API v1, B3)                │
        ▼                                            ▼                                    ▼
 server/api/auth/*, admin/*  ──►  server/utils (requireAuth, users, password-tokens…)   server/routes/m/[...path].ts
        │                                   │                                              │
        ▼                                   ▼                                              ▼
 server/lib/media/service.ts (métier médias)  ◄────────────  server/lib/media/delivery.ts (accès, dérivés)
   ├─ lib/media/handlers/ (par genre : image)   ├─ lib/media/upload.ts (busboy)   ├─ lib/media/sniff.ts
   ├─ lib/media/keys.ts, urls.ts, signing.ts    └─ lib/storage (MediaStorage → Flydrive local | s3)
   └─ usePrisma() (server/utils/prisma.ts) ──► Prisma 7 + driver adapter (better-sqlite3 | pg | mariadb)
```

Traitement des vidéos (D3) : `service.ts` crée les `MediaJob` → boucle `plugins/0.video-processing.ts` (serveur `embedded` ou processus
`NUXT_SERVER_ROLE=worker`) → `lib/video-processing/` (file, pipeline) → ffmpeg/ffprobe en processus enfants.

## 4. Inventaire des fichiers importants (apps/core)

**app/**
- `app.vue` (useAppHead + `<NuxtRouteAnnouncer>`), `error.vue` (401/403/404/500 traduits, `useAppHead`).
- `layouts/default.vue` (public : lien d'évitement, en-tête logo/langue/thème/bouton connexion, main, footer) ;
  `layouts/admin.vue` (`<header>` = landmark banner contenant barre mobile + barre latérale, menu mobile `aria-expanded`, Échap).
- `middleware/auth.global.ts` (protection `/admin*`, permission `definePageMeta`, redirection `/login`).
- `plugins/api.ts` (`$api` ; en SSR transmet `cookie`, `host` et `x-forwarded-proto` aux appels internes — sinon les URL absolues
  valent `http://localhost`), `types/page-meta.d.ts` (`PageMeta.permission`).
- `composables/` : `useAuth`, `useApiFetch`, `useFormValidation`, `useFlash`, `useMediaUpload`, `useAppHead`,
  `useAdminSection` (section de la barre latérale imposée par une page, ex. fiche d'un média de projet → Projets),
  **`useReauth`** (`run(action)` : rejoue l'action après confirmation du mot de passe ; `ReauthCancelledError`/`isReauthCancelled`),
  **useAuditFormat** (étape 19 : `actionLabel`, `actorName`, `actorDetails`, `projectName`, `details` d'une entrée du journal ; type
  `AuditEntryView` à importer explicitement depuis `~/composables/useAuditFormat`),
  **`useCredentialLabels`** (libellés d'environnement, tri, options de portées, messages d'erreur des identifiants),
  **`useProcessingPoll`** (D3 : suivi du traitement d'une vidéo toutes les 5 s, types `ProcessingSnapshot`/`ProcessingJobView`,
  `processingInProgress`, § 9.23).
- `utils/` (auto-importés) : `cn` (clsx + tailwind-merge), `redirect.ts` (`safeAdminRedirect`), `validation.ts` (`fieldErrors`), `api-error.ts` (`apiError`), `format.ts` (`formatBytes`, `formatPercent`),
  `video-frame.ts` (D2 : capture d'affiche), **`processing-view.ts`** (D3, pur, testé : `processingTransition`, `processingNeedsReload`,
  `displayedAttempt`, `failureDetailParts`).
- `components/ui/` (`<Ui…>`) : Button, Input, FormField, Alert, Badge, Select, Switch, PasswordInput, Dialog, Pagination, RadioCards,
  **CheckboxGroup** (cartes à cocher, fieldset/legend, `id` de la 1re case), CopyField, **CopyButton** (bouton compact + annonce `role=status`).
- `components/app/` (`<App…>`) : Logo, SkipLink, ThemeSwitcher, LocaleSwitcher.
- `components/admin/` (`<Admin…>`) : Sidebar, PageHeader, RoleField (prop `roles`, défaut `ROLES`), UserStatusBadge, PasswordLinkPanel, MediaUploader, MediaCard,
  **MediaBrowser** (médias d'un espace : envoi si portée, filtres URL, grille, corbeille ; prop `projectId?`), **ProjectHeader** (retour, h1, badges,
  onglets Aperçu/Médias/Membres + Clés d'API/Origines si `project:credentials` — prop `scopes` ; `aria-current="true"` sur une sous-page ; alerte archivé),
  **FolderActions** (B5 : nouveau dossier, renommer, déplacer, supprimer), **TransformSettings** (C2 : politique, préréglages, limites),
  **FocalPointEditor** (C3 : point d'intérêt de la fiche média, clic + curseurs, aperçus 1:1 / 16:9), **UrlGenerator** (C4 : générateur
  d'adresses de la fiche média), **CropSelector** (zone de recadrage du générateur), **TransformFields** (C4 : champs structurés d'une transformation, partagés avec le dialogue des
  préréglages), **ReauthDialog** (dans `layouts/admin.vue`), **SecretPanel** (valeur affichée une fois, focus sur le titre, `defineExpose({ focus })`),
  **ScopeList**, **TokenStatusBadge** (prop `kind: key|token` pour l'accord en français). `UpcomingSection` supprimé en B2.
  **`admin/dashboard/`** (étape 19, `<AdminDashboard…>`) : StatCard, Shortcuts, UploadsChart, Attention, Projects, Activity, Account (§ 9.20).
  D2 : **TextTracksPanel** ; D3 (§ 9.23) : **VideoProcessingPanel** (section « Traitement » de la fiche), **VideoProcessingSettings**
  (section « Traitement des vidéos » de « Réglages »), **ProcessingStateBadge** (état du traitement, carte et fiche).
- `pages/` : `index` (accueil), `login`, `password/[token]`, `admin/index` (tableau de bord), `admin/users/{index,new,[id]}`,
  `admin/media/{index (bibliothèque),[id]}`, `admin/projects/{index,new}`, `admin/projects/[id]/{index (aperçu, réglages, archivage, suppression),media,members}`,
  `admin/projects/[id]/keys/{index,new}`, `admin/projects/[id]/origins`, `admin/tokens/{index,new}` (`tokens:personal`), `admin/audit` (`audit:read`),
  `admin/api` (`api:docs`, étape 10 : documentation interactive, `providesMain`), `admin/projects/[id]/transforms` et
  `admin/settings` (`settings:manage`) (C2).
- Étape 10 : `components/admin/ApiReference.client.vue` (Scalar, chargé par `<LazyAdminApiReference>`), `assets/css/scalar.css`
  (thème Scalar sur nos jetons), `types/page-meta.d.ts` + `providesMain` (la mise en page rend alors `<div id="main">`), `UiButton` prop `external`.
- `assets/css/main.css` : Tailwind v4, jetons de couleur `:root` / `.dark`, `@theme inline`, focus `outline`, `@utility bg-checker`, reduced-motion.

**server/**
- `api/health.get.ts`, `api/auth/{login.post,logout.post,confirm-password.post}.ts`, `api/auth/password/[token].{get,post}.ts`,
  `api/admin/status.get.ts`, `api/admin/users/**`, `api/admin/media/**` (dont `[id]/duplicate.post.ts`, `[id]/move.post.ts`),
  `api/admin/config/media.get.ts`, `api/admin/spaces.get.ts`, `api/admin/projects/**` (`index.{get,post}`, `[id].{get,patch,delete}`,
  `[id]/members/{index.get,index.post,[userId].patch,[userId].delete}`, `[id]/candidates.get`, `[id]/keys/{index.get,index.post,[keyId].delete,[keyId]/revoke.post,[keyId]/rotate.post}`,
  `[id]/origins/{index.get,index.post,[originId].delete}`), `api/admin/tokens/{index.get,index.post,[id].delete,[id]/revoke.post}`, `api/admin/audit.get.ts`,
  `api/admin/api-docs.get.ts` (étape 10).
- `routes/m/[...path].ts` (diffusion des médias, sans cookie ; Bearer, Range, OPTIONS depuis B3).
- `api/v1/**` (API publique, § 9.12).
- `middleware/api-v1.ts` (entrée de l'API v1), `middleware/csrf.ts`, **`middleware/body-limit.ts`** (2026-10-05 : `req.rawBody` = lecture
  différée et bornée, § 7.6), **`middleware/0.server-role.ts`** (D3 : processus de travail → `/api/health` seulement, 404 sinon).
- `plugins/` : `auth-session.ts` (hooks nuxt-auth-utils), `bootstrap-admin.ts` (avertissements au démarrage), `database.ts` (déconnexion Prisma à l'arrêt),
  `site-url.ts` (avertit en production si `NUXT_SITE_URL` est vide), `search-backfill.ts` (indexe la recherche des médias existants),
  `delegated-usage.ts` (purge horaire des compteurs de jetons délégués expirés), `http-timeouts.ts` (D1), `variant-keys.ts` (C1),
  **`0.video-processing.ts`** (D3 : boucle des tâches vidéo, avant `database.ts`), **`runtime-config.ts`** (2026-10-10 : configuration
  d'exécution calculée une fois, § 9.24), **`database-pressure.ts`** (2026-10-10 : alerte SQLite, § 9.24), **`client-ip.ts`** (2026-10-10 : `X-Forwarded-For`, § 9.24). En rôle `worker`, `bootstrap-admin`, `site-url`,
  `search-backfill`, `variant-keys` et `delegated-usage` ne font rien (`isWorkerRole`).
- `utils/` (auto-importés par Nitro) : `prisma.ts` (`usePrisma`, `textContains`, `textSearch`, `isUniqueViolation`, `disconnectPrisma`), `auth.ts`, `password.ts`, `rate-limit.ts`, `users.ts` (`toUserSummary` + `invitedBy`, `USER_SUMMARY_INCLUDE`,
  `visibleUsersWhere`, `userListWhere(query, actor)`, `findVisibleUserOr404` — étape 16), `password-tokens.ts`,
  **`access.ts`** (`Space`, `LIBRARY`, `spaceFor`, `spaceOfMedia`, `sameSpace`, `describeAccess`, `resolveSpaceAccess`, `assertScope`, `requireSpaceAccess`, `requireMediaAccess` ; vérif. de type enum `ProjectRole`),
  **`projects.ts`** (`projectError`), **`credentials.ts`** (`credentialError` ; vérif. de type enum `TokenType`), **`audit.ts`** (`recordAudit`, `AuditEntry`) ;
  `auth.ts` a en plus `authError`, `requireRecentPassword`, `markPasswordVerified`.
- `lib/` (**imports explicites**, pas d'auto-import) : `storage/{types,flydrive,index}.ts`, `media/{service,delivery,upload,sniff,keys,urls,signing,errors}.ts`,
  `media/handlers/{types,image,index}.ts`, **`projects/service.ts`** (liste, création, réglages, archivage, suppression, membres, candidats, `listSpaces` ;
  `updateMemberRole` → `{ member, previousRole }`, `removeMember` → membre retiré), **`projects/origins.ts`**, **`access/tokens.ts`** (pur, testé : format,
  CRC, empreinte), **`credentials/service.ts`** (clés, jetons personnels, rotation, révocation, suppression), **`audit/service.ts`** (`listAuditEvents`),
  B3 : **`access/credentials.ts`**, **`api/{context,problem,rate-limit,cursor,queries,serializers,openapi}.ts`**, **`cache/{lru,revisions}.ts`**,
  **`media/{cache,range}.ts`**, **`projects/state.ts`** (§ 9.12) ; B4 : **`access/{principal,delegated}.ts`**, **`api/writes.ts`**,
  **`media/{processing,variants}.ts`** (dérivés sortis de `delivery.ts`) (§ 9.13) ; B5 : **`folders/service.ts`** (§ 9.14) ;
  étape 10 : **`api/docs.ts`** (`docsProjects`), `api/openapi.ts` réécrit (§ 9.15), `server/types/nitro-handlers-meta.d.ts` ;
  C1 : **`media/{delivery-path,transform-plan,transform-settings}.ts`** (chemins et opération effective purs, bornes), plugin
  `server/plugins/variant-keys.ts` (§ 9.16) ; C2 : **`transforms/service.ts`** (politique, préréglages, § 9.17), `server/utils/transforms.ts` ;
  C3 : **`api/{signature-plan,signed-urls}.ts`** (liens signés de l'API, § 9.18 ; réutilisés par l'administration en C4) ;
  2026-10-05 : **`http/{body,stream}.ts`** (purs, testés : `readLimitedBody`, `BodyReadError`, `BODY_MAX_SIZE`, `BODY_READ_TIMEOUT_MS` ;
  `closeWithResponse` ; 2026-10-10 : `responseReady`), **`http/client-ip.ts`** (2026-10-10 : adresse réelle derrière un mandataire),
  **`http/runtime-config.ts`** (2026-10-10 : `sharesRuntimeConfig`, `hookEvent`),
  **`database/pressure.ts`** (2026-10-10 : compteurs, constat `Setting`, § 9.24) ; D1 : **`media/limits.ts`** (limites par genre, `UploadRules`, `uploadRules`, `useUploadSizes`), **`media/video/`**
  (`source`, `isobmff`, `ebml`, `codecs`, `probe` : lecteur d'en-têtes pur, testé), `handlers/video.ts`, plugin `server/plugins/http-timeouts.ts`
  (§ 9.21) ; D2 : **`media/video/prepare.ts`** (préparation des MP4/MOV, pur, testé), **`media/text-track.ts`** (analyse et réécriture
  WebVTT/SRT, pur, testé), **`media/tracks.ts`** (service des pistes), `media/keys.ts` (`posterKey`, `trackKey`), `api/tracks.ts`,
  `shared/utils/text-tracks.ts`, `app/utils/video-frame.ts` (capture d'affiche), `AdminTextTracksPanel`, routes `[id]/{poster.put,poster.delete,
  prepare.post}`, `[id]/tracks/**` et leurs équivalents v1 (§ 9.22) ; D3 (§ 9.23) : **`video-processing/`** (`settings`, `ffmpeg`,
  `run`, `args`, `ffprobe`, `plan`, `jobs`, `runner`, `pipeline`, `status`, `worker-id` ; tout nouveau code du traitement vidéo va là,
  jamais dans `media/processing.ts`, qui est la file des images), **`media/{sources,renditions}.ts`**, `media/keys.ts` (`renditionKey`),
  plugin `server/plugins/0.video-processing.ts`, middleware `server/middleware/0.server-role.ts`, routes
  `api/admin/media/[id]/{process.post,processing.get}.ts`, `api/admin/video-processing/{index.get,backfill.post}.ts` ; C4 : routes
  `api/admin/media/[id]/{transform.get,links.post}.ts` (§ 9.19). Les nouveaux modules **importent explicitement** les utilitaires de
  `#shared/utils/*` (un auto-import non injecté a causé un `ReferenceError` en production, voir § 18).
  Les **types** exportés de `server/utils` (ex. `Space`) s'importent explicitement (`import type { Space } from '../../utils/access'`).

**shared/**
- `database.ts` (fournisseurs, URL par défaut, `readDatabaseEnv`, `sqliteFilePath`) — importé explicitement (`#shared/database`).
- `utils/permissions.ts` (`CredentialContext` a un cas `DELEGATED` depuis B4 ; ROLES, PERMISSIONS, ROLE_PERMISSIONS, hasPermission, MEDIA_SCOPES, PROJECT_SCOPES, PROJECT_ROLES,
  PROJECT_ROLE_SCOPES, PROJECT_ROLE_CEILING, ARCHIVED_PROJECT_SCOPES, assignableProjectRoles, effectiveProjectRole, spaceScopes, hasScope,
  TOKEN_SCOPES, TOKEN_BASE_SCOPES, TOKEN_OPTIONAL_SCOPES, tokenScopes) — auto-importé, **pur** (testé).
- `utils/folders.ts` (B5 : règles pures de l'arborescence, § 9.14), `schemas/folders.ts`.
- `utils/transforms.ts` (C1 : grammaire et forme canonique des transformations, préréglages intégrés, § 9.16 ; C2 : politiques et
  préréglages, § 9.17 ; C3 : point d'intérêt, `focalObjectPosition`, § 9.18) — auto-importé, **pur** (testé) ; `schemas/transforms.ts` (C2 ;
  C4 : `transformFieldsSchema`, `transformPreviewQuerySchema`, `transformLinksSchema`) ; `utils/snippets.ts` (C4 : extraits HTML, pur, testé).
- `utils/projects.ts` (longueurs, `PROJECT_SLUG_PATTERN`, `PROJECT_STATUSES`, `PROJECT_MEDIA_ON_DELETE`, `slugify`, `PROJECT_ERROR_CODES`) — auto-importé.
- `utils/credentials.ts` (`TOKEN_TYPES`, `PROJECT_KEY_TYPES`, `TOKEN_PREFIXES`, `KEY_ENVIRONMENTS`, `ENVIRONMENT_PATTERN`, durées, `ROTATION_OVERLAPS`,
  `tokenStatus`, `MAX_ALLOWED_ORIGINS`, `CREDENTIAL_ERROR_CODES`), `utils/origins.ts` (`normalizeOrigin`, `isWildcardOrigin`, `isOriginAllowed` — purs, testés),
  `utils/auth.ts` (`REAUTH_WINDOW_SECONDS` = 600, `AUTH_ERROR_CODES`, `isRecentlyVerified` ; étape 17 : `TRUSTED_DEVICE_DEFAULT_DAYS`,
  `TRUSTED_DEVICE_MAX_DAYS`, `trustedDeviceDays`, `TRUSTED_DEVICE_SCOPES`), `utils/audit.ts` (`AUDIT_ACTIONS`, `AUDIT_CATEGORIES`, `auditCategory`) — auto-importés.
- `utils/users.ts` (USER_STATUSES, userStatus, USER_ERROR_CODES) — auto-importé.
- **`utils/database-pressure.ts`** (2026-10-10 : seuils, `evaluateDatabasePressure`, `readPressureReport`, `isDatabaseBusyError`,
  `isWriteOperation` — pur, testé ; importer explicitement dans les composants), `utils/dashboard.ts` + point d'attention `database`.
- `utils/media.ts` (MEDIA_KINDS, MEDIA_VISIBILITIES, ACCEPTED_MEDIA_TYPES (+ VIDEO depuis D1), ACCEPTED_MIME_TYPES, MEDIA_SIZE_CEILING, DEFAULT_UPLOAD_SIZES,
  UploadSizes, ENABLED_MEDIA_KINDS, mediaKindForMime, extensionForMime, SIGNED_URL_DURATIONS, SIGNED_URL_MAX_TTL, MEDIA_ERROR_CODES) — auto-importé ;
  `utils/video.ts` (D1 : `VideoMetadata`, `videoPlayback`, `codecLabel`, `videoMetadata`, `videoSourceType`, `VIDEO_MAX_DIMENSION` — importer
  explicitement `#shared/utils/video` dans les composants ; D3 : `PLAYABLE_VIDEO_CONTAINERS` / `CONVERTED_VIDEO_CONTAINERS`,
  `isConvertedContainer`, `VIDEO_CONTAINER_BY_MIME`, `playback` `none`, champs `dataTracks`, `hdr`, `rewrites`) ; `utils/snippets.ts` +
  `videoSnippet` (D1 ; D3 : `sources`). D3 : `utils/media.ts` + `CONVERTED_VIDEO_TYPES`, `CONVERTED_MIME_TYPES`, `acceptedMimeTypes(actif)`,
  codes `PROCESSING_DISABLED`, `PROCESSING_PENDING` ; **`utils/video-processing.ts`** (modes, rôles, `RENDITION_MODES`, `X264_PRESETS`,
  `PROCESSING_STATES`, `MEDIA_JOB_STATUSES`, `API_PROCESSING_STATUSES`, `JOB_STEPS`, `VIDEO_JOB_ERROR_CODES`, `VIDEO_JOB_WARNINGS`,
  `RENDITION_NAMES`, `RENDITION_FORMATS`, constantes de la file, `retryDelay`, `truncateText`, `deliveryHeld` — pur, testé).
- `utils/api.ts` (`API_ERRORS` catalogue code → statut + titre, `API_CREDENTIAL_TYPES` (+ `DELEGATED`, type `ApiCredentialType`),
  `API_MEDIA_SORTS`, limites, `API_LINK_TTL` 3600 / `API_LINK_BUCKET` 900, `API_SIGNED_URL_TARGETS` (C3 : + `transform`),
  `API_SIGNED_URLS_MAX` 100, `API_DEFAULT_TRANSFORM_FORMAT` `webp` ; B4 : `DELEGATED_TOKEN_PREFIX`,
  `DELEGATED_TOKEN_TTL` {60, 3600, 900}, `DELEGATED_TOKEN_MAX_LENGTH` 4096, `DELEGATED_SUBJECT_MAX_LENGTH` 128, `DELEGATED_MAX_FILES` 1000,
  `DELEGATED_MAX_TYPES` 20, `DELEGATED_SIGNED_URL_MAX_TTL` 3600), `utils/search.ts` (`normalizeSearchText`, `mediaSearchColumns`) ;
  `MEDIA_PRESETS` retiré de `utils/media.ts` en C3 (tout préréglage est accepté par l'API) ; `utils/permissions.ts` a `CredentialContext` +
  `credentialScopes` (pur, testé).
- `schemas/api.ts` (requêtes v1 strictes : `apiMediaListQuerySchema`, `apiProjectListQuerySchema`, `apiSignedUrlBodySchema` ; B4 :
  `apiMediaUploadFieldsSchema`, `apiMediaUpdateSchema`, `apiDuplicateBodySchema`, `apiUploadConstraintsSchema`, `apiDelegatedTokenBodySchema`,
  `delegatedTokenClaimsSchema` ; réponses : `apiMediaSchema` (+ `projectId`), `apiMediaListSchema`, `apiProjectSchema`, `apiProjectListSchema`,
  `apiMeSchema` (+ `delegated`), `apiSignedUrlSchema`, `apiDelegatedTokenSchema`, `apiProblemSchema` ; C3 : `apiSignedUrlsBodySchema`,
  `apiSignedUrlListSchema`, `apiSignedUrlErrorSchema`, `API_SIGNED_URL_ITEM_ERRORS` ; `schemas/media.ts` : `focalPointSchema` ; D3 :
  `apiMediaSourceSchema`, `apiMediaProcessingSchema`, `Media.sources`/`processing`, `SignedUrl.sources`, types convertis dans
  `apiUploadConstraintsSchema`).
- `schemas/{auth,users,media,projects,credentials}.ts` (zod ; projects : `updateProjectSchema` accepte `publicListing` ; credentials : `createPersonalTokenSchema`, `createProjectKeySchema`, `rotateKeySchema`,
  `addOriginSchema` (normalise), `confirmPasswordSchema`, `auditQuerySchema`, `AUDIT_PAGE_SIZE` = 50) — import explicite `#shared/schemas/…` (media : + `spaceQuerySchema`, `mediaTargetSchema`, param `project`).
- `types/auth.d.ts` (augmentation `#auth-utils` : User, UserSession, SecureSessionData).

## 5. Modèle de données (prisma/schema.prisma)

Identifiants : `String @id @default(cuid())` partout. Horodatages `createdAt @default(now())`, `updatedAt @updatedAt`.

| Modèle | Champs clés | Relations / index |
| --- | --- | --- |
| **User** | `email @unique` (stocké en minuscules), `name?`, `passwordHash?` (null = invitation non acceptée), `role Role @default(EDITOR)`, `locale @default("fr")` (**non utilisé par l'UI**), `isActive @default(true)`, `lastLoginAt?`, `invitedById?` (étape 16, `UserInvitedBy`, SetNull, index) | invitedBy / invitedUsers, sessions, projectMemberships, createdProjects (`ProjectCreatedBy`), uploadedMedia (`MediaUploadedBy`), accessTokens (`AccessTokenCreatedBy`), passwordTokens (`PasswordTokenUser`), issuedPasswordTokens (`PasswordTokenCreatedBy`) |
| **Session** | `userId`, `tokenHash @unique` (SHA-256 hex du jeton), `ipAddress?`, `userAgent?` (≤191), `expiresAt`, `lastSeenAt`, `passwordVerifiedAt` (B2 : dernière saisie du mot de passe, mode sudo) | user (Cascade) ; index userId, expiresAt |
| **TrustedDevice** (étape 17) | `userId`, `tokenHash @unique` (SHA-256 du jeton du cookie), `ipAddress?`, `userAgent?`, `expiresAt`, `lastUsedAt` (≤ 5 min), `createdAt` | user (Cascade) ; index userId |
| **PasswordToken** | `userId`, `purpose PasswordTokenPurpose`, `tokenHash @unique`, `expiresAt`, `usedAt?`, `createdById?` | user (Cascade), createdBy (SetNull) ; index userId |
| **Project** | `name`, `slug @unique`, `description?`, `archivedAt?` (lecture seule), `publicListing` (B3, défaut false), `transformPolicy` (C2, OPEN par défaut), `createdById?` | createdBy (SetNull), members, media, folders, accessTokens (clés), tokenGrants (`AccessTokenProject`), allowedOrigins, transformPresets (C2) |
| **TransformPreset** (C2) | `projectId?` (null = global), `name`, `transformation` (canonique, sans format), `description?` | projet (Cascade) ; index projectId ; unicité des noms par niveau : application (§ 9.17) |
| **Setting** (C2) | `key @id`, `value Json`, `updatedAt` | réglages de l'installation (`transforms.libraryPolicy`) ; D3 : présences des processus de travail (`videoWorker:<id>`, réécrites toutes les 60 s, purgées après 1 jour) |
| **ProjectMember** | `projectId`, `userId`, `role ProjectRole`, `createdAt`, `updatedAt` | `@@id([projectId, userId])`, project et user (Cascade) ; index userId |
| **AccessToken** (B2) | `type TokenType`, `name`, `projectId?` (clés), `environment?` (clés), `userId?` (PAT), `allProjects`, `includeLibrary`, `prefix`, `tokenHash @unique` (SHA-256 hex), `publicValue?` (clé publique seulement), `scopes` (espaces, ordre canonique), `expiresAt?`, `lastUsedAt?`, `lastUsedIp?` (B3), `revokedAt?`, `replacedById?` (rotation), `createdById?` | project (Cascade), user (`AccessTokenOwner`, Cascade), createdBy (`AccessTokenCreatedBy`, SetNull), replacedBy/replaces (`AccessTokenRotation`, SetNull), projects ; index projectId, userId, replacedById |
| **AccessTokenProject** (B2) | `tokenId`, `projectId` | `@@id([tokenId, projectId])`, Cascade des deux côtés ; index projectId |
| **AllowedOrigin** | `projectId`, `origin` (normalisée, joker `https://*.x.y` possible) | project (Cascade) ; `@@unique([projectId, origin])` |
| **DelegatedTokenUsage** (B4) | `jti @id`, `uploads Int`, `expiresAt` | aucune relation ; index expiresAt ; purgé toutes les heures |
| **CacheRevision** (B3) | `scope @id` (`project:<id>` \| `library`), `revision Int`, `updatedAt` | aucune relation |
| **AuditEvent** (B2) | `at`, `actorUserId?`, `tokenId?` (B3), `projectId?`, `action`, `targetType?`, `targetId?`, `ipAddress?`, `data Json?` (`label` lisible + détails) | **aucune clé étrangère** (survit aux suppressions) ; index (projectId, at), (actorUserId, at), at |
| **Folder** | `projectId?` (null = bibliothèque), `parentId?`, `name` | projet (Cascade), arbre (`FolderTree`, Cascade : jamais déclenché, la suppression exige un dossier vide ou remonte le contenu), media (SetNull) ; index (projectId, parentId) — utilisé depuis B5 (§ 9.14) |
| **Media** | `projectId?` (**null = bibliothèque** ; un seul espace), `folderId?`, `kind MediaKind`, `visibility Visibility @default(PUBLIC)`, `storageKey @unique` (clé opaque), `version Int @default(1)`, `originalName`, `mimeType`, `size Int` (octets, ≤ 2 Gio sous PG/MySQL), `checksum` (SHA-256 hex), `width?`, `height?`, `duration?`, `title?`, `altText?`, `searchTitle?`, `searchName` (défaut `''` = à indexer), `searchAlt?` (B3, normalisées), `metadata Json?`, `focalX?`, `focalY?` (C3 : point d'intérêt, fractions 0 à 1, 4 décimales ; affiche d'une vidéo depuis D2), `posterKey? @unique`, `posterWidth?`, `posterHeight?`, `posterSize?`, `posterTime?` (D2 : image d'affiche, JPEG normalisé `variants/<média>/poster-….jpg`), `processingState ProcessingState?` (D3 : résumé de la dernière tâche vidéo, null = non concerné), `uploadedById?`, `uploadedByTokenId?` (B4, identifiant d'API ou émetteur d'un jeton délégué), `uploadSubject?` (B4, sujet final d'un jeton délégué), `duplicatedFromId?` (provenance d'une copie), `deletedAt?` (corbeille) | project (**Restrict** : un projet n'emporte jamais ses médias), folder (SetNull), uploadedBy (SetNull), uploadedByToken (`MediaUploadedByToken`, SetNull ; index), duplicatedFrom/duplicates (`MediaDuplicates`, SetNull), variants, textTracks, jobs, renditions ; index (projectId, deletedAt, createdAt), (projectId, checksum), folderId, deletedAt, duplicatedFromId |
| **MediaJob** (D3) | `mediaId`, `sourceKey` (clé de l'original visé : un autre fichier rend la tâche caduque), `status MediaJobStatus @default(QUEUED)`, `priority` (0 envoi, 10 piste de données, −10 existant), `attempts`, `runAfter`, `lockedBy?` (`<hôte>:<pid>:<aléa>`), `leaseUntil?`, `step?`, `progress?` (0–1), `result Json?` (`steps`, `warnings`, `renditions`), `errorCode?`, `errorDetail?` (≤ 191, sans chemin), `createdAt`, `updatedAt`, `startedAt?`, `finishedAt?` | media (Cascade) ; index (status, runAfter, priority), mediaId |
| **MediaRendition** (D3) | `mediaId`, `name` (`h264` \| `av1`), `container` (mp4 \| webm), `mimeType`, `codecs` (RFC 6381), `width`, `height`, `duration`, `bitrate`, `size`, `checksum`, `storageKey @unique` (`variants/<média>/rendition-<nom>-<aléa>.<ext>`, **sans version**), `createdAt` | media (Cascade) ; `@@unique([mediaId, name])` |
| **MediaTextTrack** (D2) | `mediaId`, `kind TextTrackKind` (SUBTITLES, CAPTIONS, DESCRIPTIONS, CHAPTERS), `language` (BCP 47 canonique), `label`, `isDefault`, `storageKey @unique` (`variants/<média>/track-….vtt`), `size`, `checksum`, `cueCount`, `sourceFormat` (vtt, srt), dates | media (Cascade) ; index mediaId |
| **MediaVariant** | `mediaId`, `transformation` (`v<n>/<opération effective>.<format>` depuis C1, ex. `v3/size_480x320,q_72.webp`), `storageKey @unique`, `format` (webp…), `size`, `width`, `height` | media (Cascade) ; `@@unique([mediaId, transformation])` |

Enums : `Role { ADMIN MANAGER DEVELOPER EDITOR }` (MANAGER : étape 16), `ProjectRole { OWNER DEVELOPER EDITOR }`, `TokenType { PERSONAL SECRET PUBLISHABLE }`, `PasswordTokenPurpose { INVITATION RESET }`,
`MediaKind { IMAGE VIDEO AUDIO DOCUMENT OTHER }`, `Visibility { PUBLIC PRIVATE }` ; D3 : `ProcessingState { PENDING PROCESSING READY FAILED }`,
`MediaJobStatus { QUEUED RUNNING DONE FAILED CANCELLED }`.

**Migrations** (une par fournisseur : `prisma/migrations/{sqlite,postgresql,mysql}/`) :
`20260926142611_init`, `20260926151906_update_roles` (VIEWER → EDITOR avec reprise de données ajoutée
à la main), `20260926163647_password_tokens`, `20260926203012_media_version`,
`20260928222702_projects_spaces` (B1 ; reprise à la main : médias et dossiers du projet `default` → bibliothèque,
projet `default` supprimé ; vérifiée sur SQLite, SQL PG/MySQL non exécuté), `20260929112748_b3_api_read` (B3 ; colonnes remplies au démarrage, rien à la main), `20260929155037_b4_api_write` (B4 ; SQLite
recrée la table Media, rien à la main), `20260929103323_b2_credentials` (B2 ; reprises à la
main : `DELETE FROM AccessToken` en tête — ancien format jamais utilisable — et `UPDATE Session SET passwordVerifiedAt = createdAt` en fin ;
vérifiée sur SQLite ; la reprise de fin a été ajoutée après application locale : somme de contrôle mise à jour à la main dans
`_prisma_migrations` de la base de dev), `20261001154517_api_console` (colonne inutilisée, retirée par `20261002180128_drop_api_console`),
`20261001205756_c2_transforms` (C2), `20261002181734_c3_focal_point` (C3 : `Media.focalX`, `focalY`, rien à la main),
`20261003194322_manager_role` (étape 16 : `Role.MANAGER`, `User.invitedById` ; PostgreSQL : type `Role` **recréé** — une valeur ajoutée
par `ADD VALUE` est inutilisable dans la même transaction — ; reprise à la main : DEVELOPER propriétaires → MANAGER, adhésions des MANAGER →
OWNER, autres ramenées au plafond ; vérifiée sur une copie SQLite ; générée sous le nom `d1_manager_role` puis renommée avant commit, ligne
`_prisma_migrations` de la base de dev renommée à la main), `20261004151952_trusted_devices` (étape 17 : table `TrustedDevice`, rien à la main), `20261005215018_video_poster_tracks` (D2 : colonnes
`Media.poster*`, table `MediaTextTrack` ; appliquée à la base de dev **à la main** — même SQL et même empreinte SHA-256 que `migrate deploy`,
qui échouait « database is locked » tant que le `nuxt dev` tournait ; `migrate status` la reconnaît), `20261006211348_d3_video_processing`
(D3 : `Media.processingState`, tables `MediaJob`, `MediaRendition`, deux enums ; SQLite, PostgreSQL, MySQL ; rien à la main ; à appliquer par
`pnpm db:migrate` après un pull ; `db:migration --check` vert le 2026-10-09).

**Règles de portabilité** (schéma commun SQLite / PostgreSQL / MySQL) : pas d'attribut `@db.*`, pas de
`String[]`, chaînes ≤ 191 caractères sous MySQL (validées par zod/API), enums et Json acceptés
(Prisma ≥ 6.2 pour SQLite), ne jamais modifier le `provider` à la main (la CLI le réécrit).

**Workflow de modification du schéma** : modifier `schema.prisma` → `pnpm --filter @surge-media/core
db:migration <nom>` (diff hors ligne contre `prisma/migrations/schema.snapshot.prisma`, écrit la
migration des 3 fournisseurs et met l'instantané à jour) → relire le SQL (ajouter les reprises de
données) → `pnpm db:migrate`. `db:migration --check` échoue si le schéma a changé sans migration (CI).
Ne jamais modifier une migration publiée.

## 6. Configuration

### 6.1 Variables d'environnement (`apps/core/.env`, modèle `.env.example`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `sqlite` | `sqlite` \| `postgresql` \| `mysql` (MariaDB = mysql) |
| `DATABASE_URL` | `file:./data/surge-media.db` | schéma d'URL validé contre le fournisseur (`file:`, `postgres(ql):`, `mysql:`) |
| `NUXT_SESSION_PASSWORD` | généré par `db:init` | secret des cookies scellés (≥ 32 car.) |
| `NUXT_SESSION_MAX_AGE` | 43200 (12 h) | durée de session (cookie + base) |
| `NUXT_SESSION_COOKIE_SECURE` | true | `false` seulement pour tester en HTTP hors localhost (vaut aussi pour le cookie des appareils de confiance) |
| `NUXT_SMTP_HOST`, `_PORT` (587), `_SECURE` (false), `_USER`, `_PASSWORD`, `_FROM` | — | envoi d'e-mails (étape 18) ; hôte + expéditeur requis, sinon désactivé |
| `NUXT_PUBLIC_TRUSTED_DEVICE_DAYS` | 15 | appareils de confiance (étape 17) : jours sans ressaisie pour les actions sensibles, 0 = désactivé (et appareils existants ignorés), ≤ 365 ; lu côté client (case) et serveur |
| `NUXT_BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` | — | compte d'amorçage (§ 7.5) |
| `NUXT_SITE_URL` | demandée par `db:init` (`--site-url`) | URL publique de l'installation ; vide = origine de la requête (avertissement en prod) |
| `NUXT_TRUST_PROXY` | `true` | mandataires de confiance pour `X-Forwarded-For` (2026-10-10) : `true` = boucle locale + réseaux privés, `false`, ou liste IP/CIDR + `loopback`/`private` ; adresse réelle dans `event.context.clientAddress` (§ 9.24) |
| `NUXT_MEDIA_PUBLIC_URL` | vide (= `NUXT_SITE_URL`) | base des URL de diffusion (CDN, sous-domaine) ; `mediaBaseUrl(event)` |
| `NUXT_MEDIA_MAX_UPLOAD_SIZE` | 26214400 (25 Mio) | taille max d'une **image** envoyée |
| `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE` | 536870912 (512 Mio) | taille max d'une **vidéo** (D1), plafonnée à 2147483647 (`MEDIA_SIZE_CEILING`) |
| `NUXT_MEDIA_UPLOAD_TIMEOUT` | 3600 | secondes : `server.requestTimeout` de Node relevé par `http-timeouts.ts` (D1) |
| `NUXT_MEDIA_VIDEO_PREPARE` | `faststart,metadata` | préparation des MP4/MOV à l'envoi (D2) : `faststart`, `metadata`, les deux, `none` ; lu une fois (`useVideoPreparation`) |
| `NUXT_VIDEO_PROCESSING` | `off` | traitement des vidéos par ffmpeg (D3, § 9.23) : `off` \| `embedded` \| `external` |
| `NUXT_SERVER_ROLE` | `web` | `worker` = processus de travail (tâches vidéo seulement, ne sert que `/api/health`) ; posé par `surge-media worker` |
| `NUXT_FFMPEG_PATH` / `NUXT_FFPROBE_PATH` | `ffmpeg` / `ffprobe` | binaires du système (≥ 6 ; `libx264` et `aac` exigés) |
| `NUXT_VIDEO_CONCURRENCY` | 1 | tâches simultanées par processus (1 à 16) |
| `NUXT_VIDEO_THREADS` | 0 (= moitié des cœurs) | fils par ffmpeg (0 à 64 accepté, 16 au plus appliqués : `MAX_THREADS` d'`args.ts`) |
| `NUXT_VIDEO_RENDITION` | `auto` | rendu H.264 : `auto` (seulement s'il sert) \| `always` \| `never` (formats convertis toujours rendus) |
| `NUXT_VIDEO_PRESET` / `NUXT_VIDEO_CRF` | `veryfast` / 23 | préréglage x264 (`X264_PRESETS`) / qualité 0 à 51 |
| `NUXT_VIDEO_AV1` | off | rendu AV1/Opus en plus (`libsvtav1` + `libopus`) |
| `NUXT_VIDEO_MAX_DURATION` | 10800 | s (1 à 86 400) ; au-delà, aucun réencodage (échec `TOO_LONG` si un rendu servait) ; borne aussi la durée écrite par un encodage |
| `NUXT_VIDEO_MEMORY_LIMIT` | 4096 | Mio par ffmpeg (Linux, `prlimit --as`), 0 = sans limite |
| `NUXT_MEDIA_SIGNING_SECRET` | généré par `db:init` | HMAC des liens signés ; repli : dérivé du secret de session |
| `NUXT_MEDIA_PREVIOUS_SIGNING_SECRET` | vide | ancien secret accepté pendant une rotation (sélection par `kid`) |
| `NUXT_MEDIA_STORAGE_DRIVER` | `local` | `local` \| `s3` |
| `NUXT_MEDIA_STORAGE_ROOT` | `./data/media` | racine du pilote local (relative au dossier de lancement ou absolue) |
| `NUXT_MEDIA_STORAGE_PREFIX` | vide | préfixe de toutes les clés |
| `NUXT_MEDIA_STORAGE_S3_BUCKET/REGION/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE` | vides / false | pilote S3 (endpoint vide = AWS) |
| `NUXT_API_RATE_LIMIT_PUBLISHABLE/SECRET/PERSONAL/DELEGATED/UPLOADS/AUTH_FAILURES` | 300 / 1200 / 1200 / 300 / 60 / 30 | par minute, API v1 (`runtimeConfig.api.rateLimit`) ; `DELEGATED` par (émetteur, IP), `UPLOADS` = fichiers par identifiant |
| `NUXT_MEDIA_PROCESSING_CONCURRENCY` / `_QUEUE` | 0 (= cœurs) / 100 | file bornée des traitements d'images (`runtimeConfig.media.processing`) |
| `NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE` | 604800 | cache (s) des URL d'un préréglage global ou de projet (C2), revalidé ; intégrés : immuables |
| `NUXT_MEDIA_TRANSFORM_MAX_DIMENSION` / `_FORMATS` / `_MAX_VARIANTS` / `_RATE_LIMIT` | 4096 / `jpg,png,webp,avif` / 50 / 60 | transformations (`runtimeConfig.media.transform`, C1) : borne de sortie, formats, dérivés par version, générations libres non signées par IP et par minute (0 = sans limite) |
| `SURGE_MEDIA_LANG` | locale système, sinon fr | langue de la CLI |

`NUXT_STORAGE_BASE` (étape 1) **n'existe plus** (remplacée par `NUXT_MEDIA_STORAGE_ROOT`).
Prisma 7 ne charge pas `.env` : `prisma.config.ts` fait `process.loadEnvFile` (les variables du shell priment).
En production, `.env` n'est lu que par le script `start` (`node --env-file-if-exists=.env`).
**Chemins relatifs** (SQLite, stockage local) résolus depuis le **dossier de lancement** : lancer depuis `apps/core`.

### 6.2 nuxt.config.ts (points notables)

- `modules`: `@nuxtjs/i18n`, `@nuxtjs/color-mode`, `nuxt-auth-utils`. `css`: `~/assets/css/main.css`. `vite.plugins`: tailwindcss().
- `optimization.keyedComposables: [{ name: 'useApiFetch', argumentLength: 3 }]`.
- `runtimeConfig`: `siteUrl`, `api { rateLimit { publishable, secret, personal, delegated, uploads, authFailures } }`, `session { name: 'surge-media-session', password: '', maxAge: 43200, cookie { sameSite: 'lax', secure: true } }`,
  `bootstrapAdmin { email, password }`, `media { maxUploadSize, signingSecret, previousSigningSecret, publicUrl, processing { concurrency, queue }, storage { driver, root, prefix, s3 {…} } }`.
  D3 : `serverRole`, `ffmpegPath`, `ffprobePath`, `video { processing, concurrency, threads, rendition, preset, crf, av1, maxDuration,
  memoryLimit }` (lus par `resolveVideoProcessingSettings` ; sans rapport avec `media.processing`, la file des images).
- `routeRules` : `'/**'` → `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` ;
  `'/admin/**'`, `'/login'`, `'/password/**'` → `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`.
- `colorMode { classSuffix: '', storage: 'cookie', storageKey: 'surge-media-color-mode' }`.
- `i18n { defaultLocale: 'fr', strategy: 'no_prefix', locales: [fr (fr-FR, Français), en (en-US, English)], detectBrowserLanguage { useCookie, cookieKey: 'surge-media-locale', redirectOn: 'root', fallbackLocale: 'fr' } }`.
- **Pas** de `nitro.externals` (retiré avec `file-type`).

### 6.3 Scripts

Racine : `dev`, `build`, `typecheck`, `test`, `cli`, `db:init`, `db:migrate`, `db:reset`, `db:studio`, `i18n:check`, `a11y:contrast` (tous délégués au core).
Core : `test` = `vitest run`.
Core : `dev` / `build` / `typecheck` lancent d'abord `tsx scripts/prisma-generate.ts` (**un client Prisma par fournisseur**,
`cli/lib/generate.ts`, rien de refait si schéma et version de Prisma inchangés) ; `build` = génération + `nuxt build` + `tsdown` ;
`start` = serveur de prod ; `postinstall` = `nuxt prepare && tsx scripts/prisma-generate.ts` (**cet ordre est obligatoire**) ;
`db:generate` = régénération forcée ; `prepack` = `scripts/prepack.ts` (modules natifs retirés du serveur construit, liens de Nitro copiés,
licence) ; `lint` / `lint:fix` (ESLint) ; `release` / `release:dry` / `changelog:preview` (release-it) ; `smoke:package <archive>` (essai du
paquet : installation dans un dossier vide, init, start, /api/health) ;
`cli`, `db:init|migrate|reset` (via tsx), `db:studio`, `db:migration`, `i18n:check`, `a11y:contrast`.

## 7. Authentification, sessions, rôles

### 7.1 Rôles, permissions et portées (source : `shared/utils/permissions.ts`, testée)

Permissions de **plateforme** (`User.role`) :

| Rôle | `library:read` | `library:manage` | `projects:create` | `projects:all` | `tokens:personal` | `api:docs` (étape 10) | `users:invite` | `users:manage` | `audit:read` (B2) | `settings:manage` (C2) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| ADMIN | ✓ | ✓ | ✓ | ✓ (OWNER implicite partout) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MANAGER (étape 16) | ✓ | | ✓ | | ✓ | ✓ | ✓ | | | |
| DEVELOPER | ✓ | | | | ✓ | ✓ | | | | |
| EDITOR (défaut, moindre privilège) | ✓ | | | | | | | | | |

Étape 16 (décisions validées par l'utilisateur le 2026-10-03) : un MANAGER membre d'un projet en est **toujours propriétaire**
(`PROJECT_ROLE_FLOOR`) ; un DEVELOPER ne crée plus de projet et n'est plus jamais propriétaire (plafond `DEVELOPER`) ; bibliothèque
**en lecture** pour tous sauf l'ADMIN (`library:read` → `media:read`) ; `invitableRoles` : ADMIN → tous, MANAGER → DEVELOPER/EDITOR ;
le MANAGER suit ses invitations (§ 8).

Portées d'**espace** : `media:read|upload|write|delete` (bibliothèque ou projet) et `project:read|credentials|members|settings`.
- Bibliothèque : `library:manage` (ADMIN) → toutes les portées `media:*` ; `library:read` (autres rôles) → `media:read` seul.
- Projet : rôle de membre `OWNER` (`project:*` + `media:*`), `DEVELOPER` (`project:read`, `project:credentials`, `media:*`),
  `EDITOR` (`project:read`, `media:*`) ; **plafond** `PROJECT_ROLE_CEILING` : ADMIN/MANAGER → OWNER, DEVELOPER → DEVELOPER,
  EDITOR → EDITOR ; **plancher** `PROJECT_ROLE_FLOOR` : MANAGER → OWNER ; `clampProjectRole(platformRole, memberRole)` encadre le rôle ;
  rôle exercé = `effectiveProjectRole(platformRole, memberRole)` (ADMIN → OWNER même non membre ; non membre → null = projet invisible ;
  sinon `clampProjectRole`) ; `assignableProjectRoles` = rôles entre plancher et plafond (MANAGER : OWNER seul).
- Projet archivé : `ARCHIVED_PROJECT_SCOPES` = `project:read`, `project:settings`, `media:read`.
- `spaceScopes(role, { type: 'library' } | { type: 'project', memberRole, archived })` est la seule source des droits.
- Vérifications de type : `ROLES` ↔ enum `Role` (`server/utils/auth.ts`), `PROJECT_ROLES` ↔ enum `ProjectRole` (`server/utils/access.ts`).
- Côté serveur : `requireAuth(event, permission?)` (plateforme) ; `requireSpaceAccess(event, space, scope?)` et
  `requireMediaAccess(event, () => findMedia(id), scope)` → **404** si l'espace/le média est invisible, **403** si la portée manque
  (`PROJECT_ARCHIVED` si c'est l'archivage). Côté UI : `useAuth().can()`, `definePageMeta({ permission })` et les `scopes`
  renvoyés par l'API (ergonomie uniquement).
- Portées des identifiants d'API (B2) : `TOKEN_SCOPES` = `project:read` + `media:*` ; `TOKEN_BASE_SCOPES` (`project:read`, `media:read`)
  toujours incluses ; `tokenScopes(optionnelles)` rend l'ensemble canonique. Jamais de portée de gestion (membres, clés, réglages).
- Barre latérale : Tableau de bord (tous), Bibliothèque (`library:read`), Projets (tous), Jetons personnels (`tokens:personal`),
  Utilisateurs (`users:invite` ; libellé « Mes invitations » sans `users:manage`), Journal d'audit (`audit:read`), Documentation de
  l'API (`api:docs`), Réglages (`settings:manage`).

### 7.2 Sessions hybrides (cookie scellé + base)

- nuxt-auth-utils : cookie `surge-media-session` (HTTP-only, SameSite=Lax, Secure), chiffré avec `NUXT_SESSION_PASSWORD`.
  Contenu : `user { id, email, name, role, locale }`, `loggedInAt`, `secure { token }` (jamais envoyé au client).
- `startSession` (`server/utils/auth.ts`) : jeton aléatoire 32 octets (base64url), `Session.tokenHash = sha256(token)`, expiration = maxAge,
  IP / user-agent tronqués à 191, purge des sessions expirées de l'utilisateur, `lastLoginAt`, puis `replaceUserSession` (anti-fixation).
- `resolveSession` : session en base existante, non expirée, utilisateur actif ; met à jour `lastSeenAt` au plus toutes les 5 min.
- Hook `fetch` (`GET /api/_auth/session`) : si session invalide → `clearUserSession` + 401 ; sinon **rafraîchit `session.user` depuis la base** (rôle, nom).
- Hook `clear` : supprime la session en base (`revokeSession`).
- Conséquence : désactiver un compte, supprimer ses sessions ou changer son rôle prend effet immédiatement côté serveur.
- `requireAuth` met l'utilisateur en cache dans `event.context.authUser` (utilisé aussi par `recordAudit` pour l'auteur).
- **Mode sudo (B2)** : `Session.passwordVerifiedAt` (connexion = saisie) ; `requireRecentPassword(event)` → 403 `REAUTH_REQUIRED` au-delà de
  `REAUTH_WINDOW_SECONDS` (600) ; `POST /api/auth/confirm-password` (422 `PASSWORD_INCORRECT` — surtout pas 401, que `$api` traite comme une
  session expirée —, 429 après 5 échecs / 15 min par compte, limiteur en mémoire) met la date à jour. Exigé pour : clé secrète (création,
  rotation), jeton personnel (création), membres (ajout, rôle, retrait d'autrui), invitation rattachée à des projets. Client :
  `useReauth().run(() => …)` + `<AdminReauthDialog>`.
- **Appareils de confiance (étape 17, choix validés le 2026-10-04 : case dans le dialogue seulement ; gestion depuis le tableau de bord et
  la fiche d'un compte)** : `confirm-password` accepte `trustDevice` → `trustDevice(event, user)` (`server/utils/trusted-devices.ts`) :
  jeton 32 octets dans le cookie `surge-media-trusted-device` (HTTP-only, Secure selon `session.cookie.secure`, **SameSite=Lax, chemin /**
  — d'abord `/api` + Strict, abandonné : le rendu serveur d'une page ne le transmettait pas à l'API —), empreinte en base liée au compte,
  échéance fixe ; l'ancien jeton de ce navigateur et les expirés du compte sont supprimés. `requireRecentPassword` : fenêtre de 10 min **ou**
  `findTrustedDevice` (toutes les valeurs homonymes du cookie, compte, échéance ; `lastUsedAt` ≤ 5 min ; option à 0 → ignoré). Retrait :
  `DELETE /api/auth/trusted-devices { scope }` (`forgetCurrentDevice` / `revokeTrustedDevices`, cookie effacé), `DELETE
  /api/admin/users/:id/trusted-devices` (`users:manage`), transactions du nouveau mot de passe (`consumePasswordToken`) et de la
  désactivation (PATCH). Survit à la déconnexion. Audit `user.device_trusted` (`days`) et `user.devices_revoked` (`scope`, `count`).
  Interface : case (décochée à chaque ouverture, aide « ordinateur partagé ») ; tableau de bord « Appareil de confiance » (échéance, autres
  appareils, bouton « tous » seulement s'il y en a d'autres, focus rendu au titre) ; fiche : `trustedDevices` (null pour un gestionnaire) +
  bouton de retrait.

### 7.3 Connexion (`POST /api/auth/login`)

- Corps validé par `loginSchema` (email : trim + minuscules + ≤ 191 + format ; password : 1 à 128).
- Limiteur en mémoire (fenêtre fixe 15 min) : **5 échecs par e-mail**, **50 par IP** → 429 + `Retry-After`. Réinitialisé pour l'e-mail après succès.
- Compte inconnu / inactif / sans mot de passe → vérification argon2 factice (temps constant) → 401 message générique.
- Mots de passe : argon2id (`@node-rs/argon2`, m=19456, t=2, p=1). Fonctions `hashUserPassword` / `verifyUserPassword`
  (noms distincts des `hashPassword` scrypt de nuxt-auth-utils, qui existent aussi en auto-import).
- Après connexion, le client redirige vers `safeAdminRedirect(query.redirect)` (uniquement `/admin…`, pas de `//`) ; si la page cible
  exige une permission que le rôle n'a pas → `/admin`.

### 7.4 Déconnexion et expiration

- `POST /api/auth/logout` → `clearUserSession` (hook → session supprimée en base). `useAuth().logout()` → `/login`.
- Client : `$api` (plugin) intercepte les 401 → `useUserSession().fetch()` puis `/login?redirect=<page>&expired=1` (message « session expirée »).

### 7.5 Compte d'amorçage (première connexion)

- `NUXT_BOOTSTRAP_ADMIN_EMAIL` + `NUXT_BOOTSTRAP_ADMIN_PASSWORD` (≥ 12 car.) : utilisables **uniquement tant qu'aucun utilisateur n'existe**.
  La première connexion avec ces identifiants (comparaison à temps constant) crée un ADMIN en base (mot de passe haché).
- Ensuite ignorés ; `server/plugins/bootstrap-admin.ts` avertit au démarrage ; le tableau de bord affiche un avertissement aux ADMIN
  via `GET /api/admin/status` (`bootstrapCredentialsSet`).
- Pas d'inscription publique.

### 7.6 Protections transverses

- **CSRF** (`server/middleware/csrf.ts`) : pour POST/PUT/PATCH/DELETE sur `/api/auth/`, `/api/admin/`, `/api/_auth/`, si l'en-tête `Origin`
  est présent, son hôte doit égaler `Host` → sinon 403. Sans Origin (clients non navigateurs) : accepté (ils n'utilisent pas le cookie).
- En-têtes de sécurité et `no-store` / `noindex` via `routeRules` (§ 6.2).
- **Corps des requêtes** (2026-10-05, `server/middleware/body-limit.ts`) : h3 1.15 `readRawBody` lit tout en mémoire sans limite ; le
  middleware pose sur chaque requête à corps (POST/PUT/PATCH/DELETE avec `Content-Length` > 0 ou `chunked`) un **thenable** dans
  `req.rawBody` (h3 le prend avant de lire la socket) : la lecture n'a lieu que si la route lit son corps (après ses contrôles d'accès),
  une seule fois, bornée à **1 Mio** (413 `BODY_TOO_LARGE`, `data.maxSize`) et **30 s** (408 `REQUEST_TIMEOUT`), avec `Connection: close`.
  Ignoré si `req.body` est posé (appels internes `$fetch` de Nitro : `body` vaut au moins `null`). Les envois multipart lisent la
  socket en flux (busboy) et ne sont pas concernés. `readApiBody` (API v1) laisse passer les 408/413 au lieu d'`INVALID_REQUEST`.
  À revérifier avec h3 2.

## 8. Gestion des utilisateurs (étape 3)

- Pages : `/admin/users` (recherche nom/e-mail, filtres rôle et statut dans l'URL, tableau, pagination 20), `/admin/users/new`,
  `/admin/users/[id]` (profil, accès et sécurité, suppression dans `<UiDialog>`). Permission `users:manage`.
- **Pas de mot de passe saisi par l'administrateur** : création → **lien d'invitation** à usage unique (7 jours) affiché une fois
  (`AdminPasswordLinkPanel`, focus sur son titre), transmis à la main ou par e-mail (étape 18, si SMTP). Réinitialisation : lien de 24 h depuis la fiche.
- **Envoi par e-mail (étape 18, choix validés le 2026-10-04 : SMTP par l'environnement, langue de l'expéditeur)** : `runtimeConfig.smtp`
  (`NUXT_SMTP_HOST|PORT|SECURE|USER|PASSWORD|FROM`, serveur seulement) ; `mailEnabled` = hôte + expéditeur ; `GET /api/admin/config/mail`
  → `{ enabled }` (`users:invite`) pilote le bouton « Envoyer par e-mail » (emplacement `actions` de `UiCopyField`, prop `userId` du panneau).
  `POST /api/admin/users/:id/password-link/email { token, locale, timeZone? }` : `findVisibleUserOr404`, 409 `MAIL_NOT_CONFIGURED`,
  `findValidPasswordToken(token)` du **même compte** (sinon 404 `TOKEN_INVALID`), non-ADMIN : `INVITATION` seulement (409
  `INVITATION_ACCEPTED`), limiteur 5/h par compte (429 + Retry-After, compté avant l'envoi), destinataire = `user.email` (un champ `to` est
  ignoré par zod), `passwordLinkMail` (`server/lib/mail/password-link.ts`, pur, testé : `mail.*` de `fr.json`/`en.json` importés,
  `app.name`, HTML échappé `role="article"` + `aria-roledescription="email"`, échéance `Intl` avec fuseau, repli sur celui du serveur),
  `sendMail` (nodemailer, transport mis en cache par configuration, délais 10/10/20 s) ; échec → `console.error` + 502 `MAIL_FAILED` sans
  audit ; succès → audit `user.link_emailed` (`purpose`) → `{ to }`. `EMAIL_LOCALES` (`shared/utils/users.ts`) = langues de
  `nuxt.config.ts` (test). nodemailer 10 a des exports conditionnels : tracé correct vérifié par une build (`dist/esm` dans `.output`).
- Page publique `/password/[token]` : e-mail en lecture seule (`autocomplete=username`), nouveau mot de passe (12–128) + confirmation,
  puis `/login?passwordSet=1`. Lien invalide / expiré / utilisé / compte inactif → page « Lien invalide ou expiré ».
- Liens (`server/utils/password-tokens.ts`) : un seul lien actif par compte (les non utilisés sont supprimés à l'émission) ; seule
  l'empreinte est stockée ; consommation **atomique** (`updateMany` conditionnel) puis mot de passe enregistré, autres liens supprimés,
  **toutes les sessions du compte supprimées** ; liens utilisés conservés (`usedAt`).
- Statuts calculés : `active` (mot de passe défini), `invited` (actif sans mot de passe), `inactive` (désactivé).
- Règles serveur (`assertUserChangeAllowed`) :
  - `SELF_ACTION` (403) : changer son propre rôle, se désactiver, se supprimer ;
  - `LAST_ADMIN` (409) : retirer le dernier ADMIN actif (rétrogradation, désactivation, suppression) ;
  - désactivation → sessions supprimées dans la même transaction ;
  - e-mail non modifiable après création (PATCH n'accepte que name, role, isActive) ; `EMAIL_TAKEN` (409) à la création.
- Fermer les sessions d'un compte : sur son propre compte, la session courante est conservée.
- **Invitations (étape 16)** : `POST /api/admin/users` exige `users:invite` ; rôle ∈ `invitableRoles(acteur)` (403
  `ROLE_NOT_INVITABLE`) ; `projectIds` + `projectRole` (schéma : rôle requis dès qu'un projet est choisi, projets dédoublonnés,
  50 au plus) — obligatoires sans `users:manage` (422 `PROJECTS_REQUIRED`), chaque projet résolu avec `resolveSpaceAccess` et la portée
  `project:members` (422 `PROJECT_UNAVAILABLE` : inconnu, d'autrui ou archivé), rôle de projet ∈ `assignableProjectRoles(rôle invité)`
  (422 `ROLE_NOT_ASSIGNABLE`), `requireRecentPassword` si projets ; création unique (`user.create` + `projectMemberships`,
  `invitedById` = acteur — aussi pour un ADMIN), puis lien ; audit `user.created` (`projects` : noms) + `member.added` par projet.
- **Suivi par un gestionnaire** : `visibleUsersWhere(acteur)` = `{}` avec `users:manage`, sinon `{ invitedById: acteur }` ; liste,
  fiche (`findVisibleUserOr404` → 404 pour un autre compte) et `password-link` en `users:invite` ; lien seulement si le mot de passe
  n'est pas défini (409 `INVITATION_ACCEPTED`). PATCH, DELETE et sessions restent `users:manage`. La fiche renvoie `projects`
  (adhésions du compte parmi les projets visibles de l'acteur, rôle exercé). Interface : `/admin/users` « Mes invitations », formulaire
  avec rôles permis + projets (`/api/admin/spaces?scope=project:members`) + rôle de projet (texte fixe s'il n'y en a qu'un ; projets
  masqués pour le rôle ADMIN), fiche en lecture (profil, projets, lien d'invitation), colonne « Invité par » pour l'ADMIN.
- **Changement de rôle de plateforme** : `membershipNormalization(prisma, userId, role)` (`lib/projects/service.ts`) ajoute à la
  transaction du PATCH un `updateMany` par rôle de projet hors bornes (`clampProjectRole`) : rôle enregistré = rôle exercé.

## 9. Médias (étape 4, phase A)

### 9.1 Décisions validées par l'utilisateur

Étape 4 : Flydrive derrière notre interface `MediaStorage` · phase A d'abord (admin, diffusion, liens signés), jetons / API v1 ensuite ·
médias privés accessibles par **liens signés + jetons** · projet par défaut automatique (**remplacé en B1**).
Phase B (D1–D15, architecture § 16) : **un média = un seul espace** (bibliothèque ou projet), réutilisation par **duplication**
(+ déplacement) ; diffusion **sans cookie**, domaine = celui de l'application par défaut, configurable.

Analyse comparative faite (résumé) : `@nuxtjs/universal-storage` = module Nuxt 2 (2021) de synchronisation cookies/localStorage,
hors sujet ; `unstorage` = KV sans flux (fichiers entiers en mémoire, pas de Range, pas d'URL signées) → gardé pour cache/KV seulement,
plus en dépendance directe ; NuxtHub blob = plateforme trop couplante ; `nuxt-file-storage` = base64 local ; Flydrive = flux, fs/S3/GCS,
URL signées, visibilité, normalisation des clés anti-traversée.

### 9.2 Stockage physique (`server/lib/storage/`)

- Interface `MediaStorage` : `driver`, `put(key, Readable, { contentType, size })`, `getStream(key)`, `copy(fromKey, toKey)` (B1 ; S3 : CopyObject côté service),
  `stat(key) → { size } | null`, `delete(key)` (sans erreur si absent), `deletePrefix(prefix)`, `healthcheck()`. Lecture partielle depuis B3 : `getStream(key, { start, end })`.
- `createFlydriveStorage(driver, disk, prefix)` : ajoute le préfixe, traduit « introuvable » (ENOENT, NoSuchKey, NotFound) en null / no-op.
- `useMediaStorage()` : singleton créé depuis `runtimeConfig.media.storage` ; pilotes importés à la demande :
  - `local` → `FSDriver({ location: resolve(root), visibility: 'private' })`, dossier créé au besoin ;
  - `s3` → `S3Driver({ bucket, region, endpoint?, forcePathStyle, credentials, requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED', visibility: 'private', supportsACL: false })` ; paramètres manquants → erreur explicite.
  - Nouveau backend = un `case` + éventuellement un adaptateur.
- Clés (`server/lib/media/keys.ts`) : originaux `originals/<AAAA>/<MM>/<16 octets base64url>.<ext>` ; dérivés
  `variants/<mediaId>/v<version>-<sha256(transformation) 16 hex>.<ext>`. Jamais dérivées du nom client, jamais exposées.
- Changer de backend : configuration + copie manuelle des fichiers (mêmes clés / préfixe) ; aucune modification de code ni de base.

### 9.3 Genres de médias (extensibilité)

- Types acceptés : `ACCEPTED_MEDIA_TYPES` (`shared/utils/media.ts`) — v1 : IMAGE = `image/jpeg→jpg`, `image/png→png`, `image/webp→webp`,
  `image/avif→avif`, `image/gif→gif`. **SVG exclu** (script). HEIC, TIFF non acceptés.
- Détection du type réel : `server/lib/media/sniff.ts` (`SNIFF_HEADER_BYTES` = **1024** premiers octets depuis D3 — 256 avant —, signatures
  JPEG, PNG, GIF87a/89a, RIFF…WEBP, boîte ISO `ftyp` avec marque avif/avis ; vidéos : § 9.21 et § 9.23). Liste d'autorisation stricte ;
  nom et Content-Type client ignorés. Reconnaître un format ne suffit pas à l'accepter (formats convertis : seulement si le traitement
  des vidéos est actif).
- Gestionnaires (`server/lib/media/handlers/`) : interface `MediaTypeHandler { kind, inspect(path, mime) → { width, height, duration,
  metadata }, preview?(Readable) → { data, mimeType, extension, width, height } }` ; registre `handlerFor(kind)`.
- Image (`handlers/image.ts`) : `sharp.cache(false)` (verrous Windows) ; en-tête lu sans limite puis contrôle `largeur × hauteur de page
  × pages ≤ 100 Mpx` → `DIMENSIONS_TOO_LARGE` ; illisible → `UNREADABLE_FILE` ; orientation EXIF 5–8 = dimensions permutées ;
  metadata JSON : `format, orientation, space, hasAlpha, pages, animated, density, hasExif, hasIccProfile`.
  Aperçu : première image, `rotate()`, `resize` 480×480 `inside` sans agrandissement, WebP q72, **sans métadonnées**.
- **Vidéo (D1, § 9.21)** : MP4, WebM, MOV ; gestionnaire sans `transform` (`hasDerivedFiles` faux sauf avec une affiche, D2), `queued: false`.
  D3 (§ 9.23) : MKV, AVI, 3GP/3G2, MPEG-TS/M2TS, OGV, WMV acceptés **seulement si le traitement est actif** (`CONVERTED_VIDEO_TYPES`),
  ébauche de métadonnées à l'envoi, analysés et convertis par la tâche.
- Ajouter un genre (audio, document) : signature dans `sniff.ts` + types et limite dans `shared/utils/media.ts` + gestionnaire au registre
  (+ Range dans `MediaStorage` pour la vidéo).

### 9.4 Envoi (`server/lib/media/upload.ts` + `service.ts`)

1. `requireSpaceAccess(event, spaceFor(?project), 'media:upload')` (avant de lire le corps).
2. `receiveUpload(event, maxSize)` : exige `multipart/form-data` (sinon 400 `MULTIPART_REQUIRED`) ; refus immédiat si `Content-Length` >
   max + 64 Kio (413) ; busboy (`defParamCharset: utf8`, limites : 1 fichier champ `file`, 10 champs, 4096 o/champ, 12 parties) ;
   écriture dans un dossier temporaire `surge-media-upload-*` avec SHA-256 et taille au fil de l'eau ; dépassement → 413 `FILE_TOO_LARGE`
   (`data.maxSize`) ; fichier vide ou absent → 400 `NO_FILE` ; `cleanup()` ne lève jamais (retries, simple avertissement) ;
   **inactivité** (2026-10-05) : aucune donnée pendant `UPLOAD_IDLE_TIMEOUT_MS` (60 s) → `unpipe`, flux du fichier détruit,
   `Connection: close`, 408 `UPLOAD_TIMEOUT` (`data.timeout`) ; `file.catch(() => {})` évite un rejet non traité. Depuis D1, règles
   `UploadRules` (`limits.ts`) : type décidé dès les `SNIFF_HEADER_BYTES` (1024 depuis D3) premiers octets reçus → 415 / 422 / limite du
   genre aussitôt ; D3 : types de base = `acceptedMimeTypes(await videoProcessingActive())` (admin, remplacement, `withApiUpload`,
   `analyze`), restreints par un jeton délégué (intersection, jamais élargis) ; aucun type restant → 415 d'emblée.
3. `sanitizeFilename` : basename, NFC, sans caractères de contrôle, ≤ 191 (extension préservée), défaut `media`.
4. Champs texte (`title`, `altText`, `visibility`) validés par `mediaMetadataSchema` (400 avec issues zod si invalide).
5. `analyze` : `sniffMimeType` → genre → gestionnaire, sinon 415 `UNSUPPORTED_TYPE` (`data.accepted`) ; `inspect`.
6. `storage.put` puis `prisma.media.create` (espace de la requête, visibilité PUBLIC par défaut) ; échec base → suppression du fichier.
   D3 : vidéo et traitement actif (ou format converti) → tâche `MediaJob` créée dans la même écriture, `processingState` PENDING (§ 9.23).

**Duplication** (`duplicateMedia(media, target, actor)`) : refus si corbeille (409 `IN_TRASH`) ; `storage.copy` vers une nouvelle
clé `originals/…` ; nouvelle ligne (version 1, mêmes kind/visibility/originalName/mimeType/size/checksum/dimensions/title/altText/metadata,
`duplicatedFromId`, `uploadedById` = acteur) ; échec base → fichier copié supprimé ; dérivés non copiés. Même espace permis.
**Déplacement** (`moveMedia`) : `projectId` changé, `folderId` remis à null, id/URL/fichiers inchangés ; même espace = aucun changement.
**Purge en lot** : `deleteStoredFiles(items)` (original + `variants/<id>/`), ne lève jamais (utilisée par la purge et la suppression de projet).

### 9.5 Remplacement, métadonnées, corbeille

- `PUT /file` : mêmes contrôles ; genre différent → 422 `KIND_MISMATCH` (en pratique un non-image échoue avant, en 415) ; nouvelle clé ;
  `updateMany where { id, version }` avec `version: { increment: 1 }` → 0 ligne = 409 `VERSION_CONFLICT` (nouvelle clé supprimée) ;
  puis suppression de l'ancien original, des `MediaVariant` de l'ancienne version (`transformation startsWith v<old>/`) et des fichiers
  `variants/<id>/v<old>-*`. Titre, texte alternatif, visibilité conservés ; `originalName` = nouveau fichier. D3 (vidéo) : même
  transaction (`commitFile`, écriture conditionnelle d'abord) : tâches actives annulées, lignes `MediaRendition` supprimées (fichiers
  après validation), nouvelle tâche si le traitement est actif (toujours pour un format converti), sinon `processingState` remis à null.
- PATCH : `title`, `altText` (texte vide → null), `visibility`.
- Corbeille : `deletedAt` ; restauration ; suppression définitive **uniquement depuis la corbeille** (409 `NOT_IN_TRASH`) : ligne supprimée
  d'abord (variants en cascade), puis original + `variants/<id>/` (échec physique = fichier orphelin journalisé). D3 : corbeille =
  tâches vidéo actives annulées (état gardé) ; restauration = nouvelle tâche si actif et état ≠ READY ; purge : tâches et rendus en
  cascade, fichiers des rendus sous `variants/<id>/`.

### 9.6 Diffusion (`server/routes/m/[...path].ts`, `server/lib/media/delivery.ts`)

- URL : `/m/<id>/v<version>/<nom>.<ext>` (original) · `/m/<id>/v<version>/<préréglage|paramètres>/<nom>.<format>` (dérivé, C1 :
  § 9.16 ; aperçu = `preview/<nom>.webp`). `<nom>` = slug ASCII de `title || originalName` (≤ 80), **purement indicatif**. Grammaire :
  3–4 segments, id `^[a-z0-9]{8,64}$`, version `v\d{1,9}` ; sinon 404. Méthodes GET/HEAD (autres → 405 + `Allow`). HEAD : 200 avec en-têtes seuls.
- Vidéos : pistes `…/tracks/<piste>.vtt` (D2, § 9.22) ; rendus `…/renditions/h264.mp4|av1.webm` (D3, droit signé de l'original),
  **503 `PROCESSING_PENDING`** (`Retry-After: 30`) sur l'original et les rendus d'une vidéo dont la piste de données n'est pas encore
  retirée (sauf lien « admin »), original d'un format converti en `Content-Disposition: attachment` (§ 9.23).
- Version différente de la courante → **302** vers l'URL courante, même transformation (`Cache-Control: no-cache`) ; **404** si le média est en corbeille.
- Accès (`authorizeDelivery`, **synchrone, sans cookie ni session** depuis B1) :

| Situation | Règle | Cache-Control |
| --- | --- | --- |
| Paramètres signés présents | valide (et, si corbeille, `scope=admin`) → OK ; corbeille sinon → 404 ; expirée → 403 `SIGNATURE_EXPIRED` ; invalide → 403 `SIGNATURE_INVALID` | `private, max-age=min(échéance, 3600)` |
| Corbeille sans signature | 404 | — |
| PUBLIC | libre | `public, max-age=31536000, immutable` |
| PRIVATE + `Authorization: Bearer` (B3) | clé secrète / PAT avec `media:read` dans l'espace (jamais clé publique, projet archivé, navigateur) ; jeton délégué `media:read` de son projet (B4, `browserGuard`) ; 401 si invalide | `private, no-cache` + `Vary: Authorization` |
| PRIVATE sinon | 403 `MEDIA_FORBIDDEN` | — |

- L'administration reçoit des chemins **signés `scope=admin`** pour les médias privés ou en corbeille (`adminMediaPaths`, ~1 h,
  échéance alignée sur 15 min) ; chemins publics inchangés sinon.

- En-têtes : `Content-Type` (base, ou format du dérivé), `ETag` (original : 32 premiers hex du SHA-256 ; dérivé : 24 hex + `-` + 10 hex de l'opération), 304 sur `If-None-Match`,
  `Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cross-Origin-Resource-Policy: cross-origin`, `Access-Control-Allow-Origin: *` (B1), `Content-Disposition: inline; filename="ascii"; filename*=UTF-8''…` (nom d'origine pour
  l'original), `X-Robots-Tag: noindex` hors public ; plus les en-têtes globaux (`X-Frame-Options: DENY`…).
- **Flux interrompus** (2026-10-05) : `sendStream(event, closeWithResponse(event.node.res, await storage.getStream(…)))` — h3 1.15
  n'appelle que `stream.abort()` à la fermeture de la réponse (absente de `fs.ReadStream` et du corps S3) : sans ce garde-fou,
  chaque requête abandonnée gardait un descripteur ou une connexion S3 jusqu'au redémarrage (mesuré : 20/20).
- Dérivés (`media/variants.ts` depuis B4, généralisés en C1 : § 9.16) : `resolveDeliverable` → cache → ligne `MediaVariant (mediaId, "v<version>/<opération>.<format>")` sinon
  génération par le gestionnaire dans la file bornée (dédoublonnée par processus via une Map de promesses), `put` puis `create`
  (violation d'unicité ignorée) ; pré-générés après envoi/remplacement/duplication ; file pleine → 503 + `Retry-After`.

### 9.7 Liens signés v2 (`server/lib/media/signing.ts`, `urls.ts`) — depuis B1

- Paramètres `?exp=<unix>&kid=<8 car.>[&scope=derived|admin]&sig=<base64url>` ; `sig = HMAC-SHA256(secret, "v2:<id>:<version>:<droit>:<exp>")`.
  Droit = cible exacte `file` (original) / `preset:<nom>` (ex. `preset:preview`), ou élargi `derived` (tout dérivé, jamais l'original)
  ou `admin` (tout fichier de la version, même en corbeille). Phase C : `t:<transformation canonique>`.
- `kid = sha256("surge-media:kid:" + secret)[0..8]` : secrets acceptés = courant + `NUXT_MEDIA_PREVIOUS_SIGNING_SECRET`.
  Secret courant : `NUXT_MEDIA_SIGNING_SECRET`, sinon dérivé `HMAC(sessionSecret, 'surge-media:media-signing')`.
- Fonctions pures testées : `keyId`, `targetGrant`, `computeSignature`, `alignedExpiry`, `buildSignatureQuery`, `checkSignature` ;
  runtime : `signMediaAccess(media, access, exp)`, `verifyMediaSignature(target, query)`.
- Liens de partage (`signedMediaPath`) : échéance exacte, 60 s à 7 jours (`signedUrlSchema`) ; l'UI propose 1 h / 24 h / 7 jours.
  Aperçus admin (`adminMediaPaths`) : `scope=admin`, TTL 3600, tranche 900 s.
- **Les liens v1 (sans `kid`) ne sont plus reconnus** (non publiés, choix assumé).
- Invalidation : remplacer le fichier (version), échéance, ou retirer l'ancien secret.

### 9.8 Espaces (remplace le projet par défaut depuis B1)

- `Media.projectId` null = **bibliothèque de l'organisation** ; sinon le projet. `defaultProjectId()` a été supprimé ; la migration
  `projects_spaces` a mis les médias du projet `default` dans la bibliothèque et supprimé ce projet.
- `server/utils/access.ts` : `Space = { type: 'library' } | { type: 'project', id }` ; `listMedia(space, query)` impose `projectId` du
  serveur (les filtres s'ajoutent) ; `createMedia(space, …)`.
- Cibles de duplication/déplacement : `listSpaces(user, scope)` (bibliothèque si portée + projets actifs visibles avec la portée).

### 9.9 Interface médias

- `AdminMediaBrowser` (prop `projectId?`) utilisé par `/admin/media` (**Bibliothèque**) et `/admin/projects/[id]/media` : section d'envoi
  seulement si `scopes` contient `media:upload` (`AdminMediaUploader`, endpoint `/api/admin/media?project=<id>` : champ fichier natif +
  glisser-déposer, visibilité des envois, file de 20 entrées, XHR + `<progress>`, pré-contrôle, annonces `role=status`), filtres
  (recherche, visibilité, tri, Médias/Corbeille) dans l'URL (`sort=newest` omis), 5 colonnes seulement à partir de `xl`, `h2` masqué
  « Résultats », grille de `AdminMediaCard`, pagination 24.
- `/admin/media/[id]` (pas de permission de page : l'API décide, 404 sinon) : retour vers la bibliothèque ou les médias du projet,
  alerte lecture seule si pas `media:write` (ou projet archivé), aperçu, informations (**Espace** avec lien projet, **Origine** si copie),
  formulaire (titre, alt, visibilité) ou valeurs en lecture seule, adresse publique absolue (`publicUrl` de l'API) ou lien temporaire,
  remplacement (si `media:write`), **Dupliquer ou déplacer** (sélecteur d'espace `GET /api/admin/spaces?scope=media:upload`, duplication →
  redirection vers la copie + message ; déplacement si `media:delete` et autre espace), corbeille (si `media:delete`) ; grille 2 colonnes à
  partir de `xl` ; `useAdminSection` → section Projets pour un média de projet.

### 9.10 Projets et membres (B1, `server/lib/projects/service.ts`)

- Visibilité : ADMIN (`projects:all`) → tous ; sinon (MANAGER compris) projets dont l'utilisateur est membre. `toProjectSummary` : id, name, slug,
  description, archivedAt, dates, `role` (exercé), `memberRole`, `mediaCount` (hors corbeille), `memberCount`.
- Création (`projects:create` : ADMIN, MANAGER depuis l'étape 16) : slug fourni → 409 `SLUG_TAKEN` s'il est pris ; sinon `slugify(name) || 'project'` suffixé `-2…-20`
  en cas de collision ; le créateur devient `OWNER` (membre).
- Réglages / archivage : `PATCH { name?, slug?, description?, archived? }` (`project:settings`, permis aussi archivé).
- Suppression : projet **archivé** seulement (409 `PROJECT_NOT_ARCHIVED`), `{ media: 'library' | 'purge' }` (`library` exige
  `media:upload` sur la bibliothèque, donc l'ADMIN : 403 `LIBRARY_NOT_ALLOWED` sinon, étape 16 ; l'interface ne propose alors que la purge) :
  `library` = transaction `updateMany(projectId → null, folderId → null)` + delete ; `purge` = transaction `deleteMany` + delete, puis
  `deleteStoredFiles` **sans attendre**. Membres, dossiers, jetons, origines partent en cascade.
- Membres : ajout (comptes actifs, 404 `USER_NOT_FOUND`, 409 `ALREADY_MEMBER`, 422 `ROLE_NOT_ASSIGNABLE` au-delà du plafond),
  changement de rôle et retrait (409 `LAST_OWNER` : le dernier propriétaire **effectif** — `clampProjectRole(rôle de plateforme, rôle`
  `de membre)` = OWNER, étape 16 — ne peut être ni rétrogradé ni retiré ; un MANAGER n'a que OWNER d'attribuable, d'où 422 avant 409 ; la
  suppression d'un compte ou la baisse de son rôle de plateforme ne sont pas bloquées — un ADMIN reste capable d'administrer),
  départ volontaire (`project:read` suffit pour se retirer soi-même). `toMemberSummary` : user (id, name, email, role, isActive,
  status), role, `effectiveRole`, `assignableRoles`, createdAt.
- Environnements (décision D13) : étiquette sur les clés d'un même projet (B2) ; environnement jetable = projet séparé.
- Écrans : `/admin/projects` (recherche, statut actif/archivé), `/admin/projects/new` (slug déduit affiché dans l'aide),
  `/admin/projects/[id]` (résumé, réglages, archivage, suppression : dialogue avec `UiRadioCards` bibliothèque/purge + saisie du slug),
  `/admin/projects/[id]/media` (`AdminMediaBrowser`), `/admin/projects/[id]/members` (tableau, rôle + bouton Enregistrer par ligne,
  retrait/départ confirmé, recherche de comptes et ajout ; focus remis sur le titre de section / des résultats quand la ligne disparaît).

### 9.11 Identifiants d'API, origines et journal d'audit (B2)

- **Format** (`server/lib/access/tokens.ts`, pur) : `sm_pat_` / `sm_sk_` / `sm_pk_` + 43 car. base62 (32 octets, complété à gauche par
  `0`) + 6 car. base62 du CRC32 (`node:zlib`) calculé sur préfixe + corps. `parseAccessToken` → type ou null (regex + CRC, sans base).
  `hashAccessToken` = SHA-256 hex ; `displayPrefix` = préfixe + 6 car. (12–13 car.).
- **Clés de projet** (`credentials/service.ts`) : `createProjectKey` (publique : portées de base, sans échéance, `publicValue` = valeur ;
  secrète : portées choisies, durée `30|90|365|never`, défaut 365), `rotateProjectKey(key, actor, overlap)` (nouvelle clé : mêmes nom,
  environnement, portées, **même durée** = `expiresAt - createdAt` ; ancienne : `replacedById`, `revokedAt` si `now`, sinon
  `expiresAt = min(actuelle, maintenant + recouvrement)` ; 409 `TOKEN_NOT_ACTIVE` / `TOKEN_REPLACED`), `revokeToken`, `deleteToken`
  (inactif seulement). Résumés `toKeySummary` (jamais d'empreinte ; `createdBy` avec `isActive`) / `toPersonalTokenSummary` (projets
  sélectionnés avec `archivedAt`). Libellé d'audit : `tokenAuditLabel` = `nom (préfixe…)`.
- **Jetons personnels** : `createPersonalToken` (projets choisis visibles et **actifs** sinon 422 `PROJECT_UNAVAILABLE` ; `allProjects`
  ignore la sélection ; `includeLibrary` exige `library:manage`), `findPersonalToken(user, id)` (404 pour le jeton d'autrui, même ADMIN).
- **Origines** (`projects/origins.ts`) : normalisées par `addOriginSchema` → `normalizeOrigin` ; joker = premier libellé `*.` suivi d'au
  moins deux libellés (pas d'IP, pas `*.com`, pas `*.localhost`) ; `isOriginAllowed` : exacte, ou joker même schéma + port, jamais le
  domaine nu ; 100 par projet (409 `ORIGIN_LIMIT_REACHED`), doublon 409 `ORIGIN_EXISTS`.
- **Accès** : clés et origines = `project:credentials` (OWNER, DEVELOPER du projet ; ADMIN) ; projet archivé → 403 `PROJECT_ARCHIVED`
  (portée retirée par l'archivage). Jetons personnels = `tokens:personal`, chacun les siens.
- **Audit** (`server/utils/audit.ts`) : `recordAudit` attendu (await) après l'action, erreurs avalées et journalisées. Actions :
  `shared/utils/audit.ts` (32 depuis l'étape 18). Choix : `member.role_changed` seulement si le rôle change (`{ from, to }`) ; `project.updated` avec
  `changes` (name, slug, description) ; `project.archived|restored` ; `media.visibility_changed` seulement si elle change ;
  `media.moved` rattaché au projet d'origine (sinon cible), `data.from/to` = `{ id, name } | null` ; `media.deleted` = purge définitive ;
  `key.rotated` avec `overlap` et `replacedBy` (libellé) ; jetons personnels sans `projectId`. Lecture : `listAuditEvents` (50/page,
  filtres `category` = préfixe d'action, `project`), auteurs/projets résolus, `{ id, deleted: true }` s'ils n'existent plus.
- **Écrans** : clés groupées par environnement (h3 + tableau, région nommée par la légende), valeur publique copiable
  (`UiCopyButton`), secrets révélés une fois via `useFlash` (payload) ou après rotation (`AdminSecretPanel`, focus replacé après le
  rechargement), clés/jetons inactifs dans un `<details>` ; formulaire de clé : type (radio), nom, environnement (liste + « Autre… »
  → saisie libre, le focus d'erreur suit le champ affiché via un objet `fieldIds` réactif), portées et durée si secrète ; jeton
  personnel : durée, accès (tous / choisis + cases), bibliothèque (interrupteur), portées ; erreur « aucun espace » reliée au fieldset.

### 9.12 API publique v1 en lecture (B3)

- **Entrée** : `server/middleware/api-v1.ts` pour tout `/api/v1/**` : `X-Request-Id` (aussi `requestId` des erreurs), CORS
  (sous `/api/v1/projects/<id>` : `isOriginAllowed(origin, getProjectState(id).origins)` → `Access-Control-Allow-Origin: <origine>`
  + `Vary: Origin` + `Expose-Headers` ; ailleurs toute origine ; `openapi.json`/`errors` en `*`), preflight `OPTIONS` → 204 sans
  authentification, puis `authenticateApiRequest` (sauf documents publics) → `event.context.apiPrincipal`. Erreurs du middleware
  renvoyées par `sendProblem`.
- **Authentification** (`server/lib/api/context.ts`) : `?access_token` → 400 ; pas d'en-tête → 401 `TOKEN_MISSING` ; limiteur d'échecs
  par IP (fenêtre fixe 60 s, `authFailures`, vérifié **avant** la résolution : au-delà, toute requête v1 de l'IP → 429) ;
  `resolveCredential` (`server/lib/access/credentials.ts` : format+CRC, SHA-256, LRU 60 s y compris les inconnus, révoqué, expiré,
  propriétaire inactif → `TOKEN_REVOKED`) ; `SECRET_IN_BROWSER` si clé secrète/PAT et (`Origin` ou `Sec-Fetch-Site`) ;
  `ORIGIN_NOT_ALLOWED` si clé publique avec `Origin` non autorisée ; seau à jetons (`pk:<id>:<ip>`, `sk:<id>`, `pat:<id>`, limites
  `runtimeConfig.api.rateLimit`) + en-têtes `RateLimit*` ; `touchCredential` (≤ 5 min, `updateMany` conditionnel, sans attendre).
- **Routes** (`server/api/v1/**`, écrites avec `defineApiHandler(async (event, principal) => …)` qui pose `Cache-Control: private,
  no-cache` et convertit toute erreur en problème) : `me.get`, `projects/index.get`, `projects/[projectId]/index.get`,
  `projects/[projectId]/media/index.get`, `…/media/[mediaId]/index.get`, `…/media/[mediaId]/signed-url.post`, `openapi.json.get`,
  `errors.get`, `[...]` (404). `requireApiProject(event, principal, scope)` : projet via `getProjectState` (cache 60 s), portées via
  `credentialProjectScopes` (PAT : ligne `ProjectMember` relue à chaque requête, ADMIN = OWNER), 404 `PROJECT_NOT_FOUND` si vide, puis
  403 `PROJECT_ARCHIVED`, puis 403 `INSUFFICIENT_SCOPE`. `parseApiQuery` / `readApiBody` : validation zod stricte → 400 avec `errors`.
- **Requêtes** (`server/lib/api/queries.ts`) : `listApiMedia(projectId, query, publicOnly)` — base `projectId + deletedAt null`
  (+ `PUBLIC` pour clé publique), filtres ajoutés en `AND`, `ids` (ordre conservé, sans curseur), keyset sur (champ, id) dans le même
  sens (`newest` createdAt desc, `oldest` asc, `name` originalName asc, `size` desc), `take limit+1`, `count` si `withTotal` ;
  `findApiMedia` ; `listApiProjects` (clé : son projet s'il est actif ; PAT : `archivedAt null` + sélection ou tous, + membre sauf
  `projects:all`, tri nom/id, curseur `name`).
- **Contrats** (`shared/schemas/api.ts`, `server/lib/api/serializers.ts`) : `toApiMedia(media, mediaBaseUrl(event), apiLinkExpiry())`
  (URL absolues, signées pour un privé avec `alignedExpiry(now, 3600, 900)`), `toApiProject(project, scopes)` ; ETag :
  `weakEtag(['media-list', projet, révision, query, audience, échéance])`, `mediaEtag` (+ échéance si privé), `etagMatches`.
- **Erreurs** (`server/lib/api/problem.ts`) : `ApiProblem(code, { detail, errors, headers })`, `toProblem` (h3 400/404/405/413/415 →
  codes, autre → 500 journalisé), `sendProblem` (`application/problem+json`, `no-store`, `WWW-Authenticate` sur 401), `apiBaseUrl(event)`
  = `NUXT_SITE_URL` ou origine + `/api/v1`. Catalogue : `API_ERRORS` (`shared/utils/api.ts`).
- **OpenAPI** : réécrit à l'étape 10 (génération depuis `defineRouteMeta`, bilingue) — voir § 9.15.
- **Caches** (`server/lib/cache/lru.ts` `createLruCache({ max, ttlMs, now })`, `deleteWhere`) : identités (`access/credentials.ts`,
  `invalidateCredential(hash)` sur révocation/rotation/suppression, `invalidateUserCredentials(userId)` sur PATCH/DELETE d'un compte),
  état des projets (`projects/state.ts`, `invalidateProjectState` sur réglages/archivage/suppression/origines), métadonnées de diffusion
  et dérivés (`media/cache.ts` : `findDeliveryMedia`, `variantCache`, `mediaChanged(ids, ...espaces)` appelé par **toutes** les écritures
  du service médias), révisions (`cache/revisions.ts` : `getRevision` 2 s, `bumpRevision` upsert, ne lève jamais).
- **Recherche** : `normalizeSearchText` / `mediaSearchColumns` (`shared/utils/search.ts`, NFKD + suppression des marques + minuscules
  + espaces, ≤ 191) ; écrites par `createMedia`, `replaceMediaFile` (nom), `updateMediaMetadata` (titre/alt), `duplicateMedia` ;
  `search-backfill.ts` remplit `searchName = ''` au démarrage par lots de 200 puis incrémente les révisions touchées.
- **Diffusion** : `authorizeDelivery` est **asynchrone** (Bearer : `credentialProjectScopes`/`credentialLibraryScopes`, jamais une clé
  publique ni un projet archivé, `SECRET_IN_BROWSER` → 403, identifiant invalide → 401 `WWW-Authenticate`), mode `credential` →
  `private, no-cache` + `Vary: Authorization` ; `resolveRange` (`media/range.ts`, pur) ; `MediaStorage.getStream(key, { start, end })`
  (local : `createReadStream` borné ; S3 : `GetObjectCommand` avec `Range`, client S3 créé par nous et passé à `S3Driver({ client })`).
- **Interface** : `PATCH /api/admin/projects/:id` accepte `publicListing` (réglages de l'aperçu, journalisé dans `changes`) ;
  `GET /api/admin/projects/:id/keys` renvoie aussi `apiBaseUrl` (encart « Accès à l'API »).

### 9.13 API v1 en écriture, jetons délégués, traitements (B4)

- **Identité** (`server/lib/access/principal.ts`) : `Principal = { type: personal|secret|publishable|delegated, credential,
  delegated: DelegatedGrant | null }` — pour un jeton délégué, `credential` = **l'émetteur**. `resolvePrincipal(valeur)` (opaque →
  `resolveCredential` ; `sm_dt_` → `verifyDelegatedToken` puis `resolveCredentialById(iss)`, tout échec d'émetteur → `TOKEN_REVOKED`),
  `principalProjectScopes` (délégué : `credentialScopes({ type: 'DELEGATED', scopes, ownProject, issuerScopes })`),
  `principalLibraryScopes` (jamais pour un délégué), `browserGuard` (secret/PAT + navigateur → `SECRET_IN_BROWSER` ; clé publique ou
  délégué avec `Origin` hors projet, ou ≠ origine du jeton → `ORIGIN_NOT_ALLOWED`). `ApiPrincipal = Principal` ; **toute décision
  passe par `principal.type` / ces fonctions, jamais par `credential.type` seul** (un délégué porte l'émetteur).
- **Jetons délégués** (`server/lib/access/delegated.ts`) : `encodeDelegatedToken` / `decodeDelegatedToken(valeur, secrets, maintenant)`
  (purs, testés : forme, `kid` → secret, signature en temps constant **avant** l'analyse zod stricte `delegatedTokenClaimsSchema`, puis
  échéance), `issueDelegatedToken` (secret courant, `jti` 12 octets), `verifyDelegatedToken` (secrets acceptés), `toDelegatedGrant`,
  `reserveDelegatedUpload` (création de la ligne `DelegatedTokenUsage` si absente puis `updateMany uploads < maxFiles` → +1),
  `releaseDelegatedUpload`, `purgeDelegatedUsage` (plugin `server/plugins/delegated-usage.ts` : 1 min après le démarrage puis toutes les heures).
  Secrets : `currentSigningSecret()` / `acceptedSigningSecrets()` exportés par `media/signing.ts`.
- **Identités par identifiant** : `resolveCredentialById` (LRU 60 s, inconnus 10 s) ; `invalidateCredential({ id, tokenHash })` vide
  les deux caches (révocation, rotation, suppression) ; `invalidateUserCredentials` aussi.
- **Routes** : `media/index.post.ts` (envoi), `media/[mediaId]/{index.patch,index.delete,file.put,duplicate.post}.ts`,
  `projects/[projectId]/delegated-tokens.post.ts` ; `signed-url.post` (délégué ≤ `DELEGATED_SIGNED_URL_MAX_TTL` = 3600 s),
  `me.get` (branche déléguée), `projects/index.get` → `listApiProjects(principal, …)`. `requireApiProject(event, principal, scope,
  projectId?)` (4e paramètre : projet cible d'une duplication).
- **Écritures** (`server/lib/api/writes.ts`) : `withApiUpload(event, principal, task)` = `requireUploadAllowance` (seau `up:<id>` ou
  `up:dt:<émetteur>:<ip>`, politique « uploads » **ajoutée** aux en-têtes) → réservation déléguée (403 `UPLOAD_LIMIT_REACHED`) →
  `receiveUpload(min(limite, maxSize))` → `task(upload, { acceptedTypes })` → nettoyage, libération si échec ; `principalProvenance`,
  `toMetadataInput(champs, visibilitéImposée?)`, `apiMediaLocation`. Schémas stricts (`z.strictObject`) : `apiMediaUploadFieldsSchema`,
  `apiMediaUpdateSchema`, `apiDuplicateBodySchema`, `apiDelegatedTokenBodySchema` (+ `apiUploadConstraintsSchema`,
  `delegatedTokenClaimsSchema`, `apiDelegatedTokenSchema`).
- **Service médias** : `createMedia(espace, upload, champs, provenance: MediaProvenance, { acceptedTypes? })`,
  `replaceMediaFile(media, upload, options)`, `duplicateMedia(media, cible, provenance)` ; `MediaProvenance = { userId, tokenId?, subject? }`
  (admin : `{ userId: user.id }`) ; `MEDIA_INCLUDE` (uploadedBy + `uploadedByToken { id, name, type, prefix }`) ; `toMediaSummary`
  expose `uploadedByToken` et `uploadSubject`.
- **Erreurs** : `toProblem` convertit toute erreur portant `data.code` connu du catalogue (erreurs médias, projets…) avec un `detail`
  (taille max, types acceptés, pixels) et `Retry-After` depuis `data.retryAfter`.
- **Traitements** (`server/lib/media/processing.ts`) : `createSemaphore({ concurrency, queue })` (pur, testé ; place transmise
  directement au suivant), `useMediaProcessing()`, `runProcessing(task)` → `QueueFullError` devient 503 `SERVER_BUSY`
  (`data.retryAfter` = 5). Utilisé par `analyze` (inspect) et `renderVariant` (le flux source n'est ouvert qu'une fois la place obtenue).
- **Dérivés** (`server/lib/media/variants.ts`, sorti de `delivery.ts`) : `resolveDeliverable`, `pregenerateVariants(media)` (appelé par
  create/replace/duplicate ; ignoré si `pending > 0` ; erreurs `SERVER_BUSY` silencieuses). `/m/` pose `Retry-After` sur 503.
- **Audit** : `recordAudit` lit aussi `event.context.apiPrincipal` (`tokenId`, `actorUserId` = propriétaire, `data.via`,
  `data.subject`) ; `listAuditEvents` résout `token { id, name, type, prefix } | { id, deleted }`.
- **Interface** : fiche média (lignes « Identifiant d'API » + préfixe, « Utilisateur de l'application » ; « Une application (API) » sans
  compte) ; journal (`actorName(item)`, `actorDetails` : « Par l'API — … », « Jeton délégué, utilisateur … ») ; clés i18n
  `credentials.named.<TYPE>`, `media.detail.{apiUploader,credential,subject}`, `media.errors.SERVER_BUSY`,
  `audit.{via,deletedCredential,delegated,delegatedSubject}`.

### 9.14 Dossiers (B5)

- **Règles pures** (`shared/utils/folders.ts`, auto-importé, testé) : `FOLDER_NAME_MAX_LENGTH` 100, `FOLDER_MAX_DEPTH` 8,
  `FOLDERS_PER_SPACE_MAX` 1000, `FOLDER_ERROR_CODES`, `folderNameKey` (NFC + minuscules : unicité parmi les voisins),
  `indexFolders` (byId, enfants triés ; parent inconnu → racine), `folderAncestors`, `folderDepth`, `descendantIds`,
  `subtreeHeight`, `folderMoveProblem` (cycle / profondeur), `flattenFolders`, `folderPathLabel`. Schémas :
  `shared/schemas/folders.ts` (messages i18n : `folderNameSchema`, `folderIdSchema`, `folderFormSchema`, `createFolderSchema`,
  `updateFolderSchema`, `deleteFolderQuerySchema`, `assignFolderSchema`, `isValidFolderName`) ; API v1 dans `schemas/api.ts`
  (`apiFolderCreateSchema`, `apiFolderUpdateSchema`, `apiFolderDeleteQuerySchema`, `apiFolderSchema`, `apiFolderListSchema`,
  messages en anglais) ; `mediaListQuerySchema` + `folder`/`recursive` ; `mediaMetadataSchema` + `folderId` ; `mediaTargetSchema`
  + `folderId`.
- **Service** (`server/lib/folders/service.ts`) : `listFolders(espace)` (LRU par `scope:révision`, 5 min), `findFolder`,
  `requireFolderInSpace` (404 `FOLDER_NOT_FOUND`), `folderMediaCounts` (groupBy), `folderWhere(espace, dossier|null, récursif)`
  (condition Prisma ; racine récursive = `{}`), `createFolder` / `updateFolder` / `deleteFolder(dossier, { moveContentToParent })`
  (transactions interactives, contrôles sur l'arbre relu en base, `bumpRevision` après validation), `assignMediaFolder` (médias
  actifs de l'espace seulement, `mediaChanged`). `server/utils/folders.ts` : `folderError`, `requireFolderAccess` (404 si invisible,
  403 si portée), `toFolderSummary`.
- **Service médias** : `listMedia` filtre par dossier hors corbeille ; `createMedia` / `updateMediaMetadata` vérifient
  `folderId` dans l'espace ; `duplicateMedia(…, folderId)` et `moveMedia(…, folderId)` dans l'espace cible ; `toMediaSummary`
  expose `folderId`.
- **Routes admin** : `folders/{index.get,index.post,[id].patch,[id].delete}`, `media/index.patch` (rangement groupé) ;
  `media/index.get` (`folder`, `recursive`), `index.post` (`folderId`), `[id].patch`, `[id]/duplicate|move` (`folderId`).
- **Routes v1** : `projects/[projectId]/folders/{index.get (ETag révision, pas de clé publique), index.post, [folderId].patch,
  [folderId].delete}` ; `listApiMedia` applique `folderWhere` si `folder` ; `toMetadataInput(champs, imposed = grant.upload)`
  (visibilité et dossier imposés) ; `delegated-tokens` vérifie `upload.folderId` ; `toApiFolder` ; `problemDetail` couvre les
  codes `FOLDER_*`.
- **Interface** : `AdminMediaBrowser` (URL `folder`, `recursive=1` ; section « Dossiers » : titre focusable `#folders-title`,
  `AdminFolderActions`, fil d'Ariane `nav` + `ol` avec `aria-current="page"`, sous-dossiers en liens ; alerte « Dossier
  introuvable » ; envoi avec `fields.folderId` ; case « Inclure les sous-dossiers » ; mode sélection : `AdminMediaCard selectable
  v-model:selected` (libellé englobant 28 px, texte sr-only), barre « Ranger dans » ; message de rangement effacé au changement
  de dossier). `AdminFolderActions` : dialogues nom (création/renommage, erreur d'homonyme sur le champ), déplacement (options =
  chemins valides), suppression (texte selon le contenu, `Intl.ListFormat`, `return-focus=false` après succès puis focus sur
  `#folders-title` par le parent) ; message lié au dossier où il s'affiche. `UiDialog` : prop `returnFocus` (défaut true). Fiche
  média : ligne « Dossier », « Dossier cible » (dossiers de l'espace choisi), déplacement même espace = `PATCH { folderId }`.
  i18n : `folders.*`, `media.selection.*`, `media.filters.recursive`, `media.list.emptyFolder|emptyFilteredFolder`,
  `media.detail.folder|noFolder`, `media.organize.folder`, `validation.folderName`.

### 9.15 Documentation interactive de l'API (étape 10)

- **Génération** : `nitro.experimental.openAPI: true` (+ `openAPI.ui.scalar/swagger: false` ; `/_openapi.json` brut seulement en dev).
  Chaque route `server/api/v1/**` porte `defineRouteMeta({ openAPI })` **littéral** (Nitro l'analyse sans exécuter : `astToObject` ne
  connaît que objets, tableaux, littéraux — ni variable, ni gabarit, ni appel). `openapi.json.get.ts` importe `handlersMeta` du module virtuel
  `#nitro-internal-virtual/server-handlers-meta` (déclaré dans `server/types/nitro-handlers-meta.d.ts`, interne à Nitro 2 : à revérifier en Nitro 3).
- **`server/lib/api/openapi.ts`** (pur, testé) : `describeApi(routes, serverUrl)` → document français + `x-i18n` + `problems` ;
  `localize(doc, lang)` applique `x-i18n[lang]` (sauf fr) et retire l'extension partout ; `buildOpenApiDocument(routes, { serverUrl, lang })` ;
  `openApiProblems(routes)`. Extensions de route : `x-scopes`, `x-credentials` (ligne « **Portée** · **Identifiants** » + `security: [{ bearerAuth: scopes }]`
  — OpenAPI 3.1 admet des rôles pour http), `x-query` (`QUERY_SCHEMAS` : MediaListQuery, ProjectListQuery, FolderDeleteQuery, OpenApiQuery),
  `x-errors` (codes → réponses par statut avec exemples RFC 9457 ; d'office TOKEN_*, RATE_LIMITED, + SECRET_IN_BROWSER si secret/personal,
  ORIGIN_NOT_ALLOWED si publishable/delegated), `x-i18n`. `security: []` = publique. Composants : `schemas` (registre zod + `ErrorCatalog`),
  `parameters` (projectId, mediaId, folderId), `headers` (ETag, Location, RetryAfter, WWWAuthenticate), `requestBodies` (MediaUpload, FileReplace,
  MediaUpdate, MediaDuplicate, SignedUrlRequest, DelegatedTokenRequest, FolderCreate, FolderUpdate), `responses` (Me, ProjectList, Project, MediaList,
  Media, MediaCreated, MediaCopy, FolderList, Folder, FolderCreated, SignedUrl, DelegatedToken, ErrorCatalog, OpenApiDocument, NoContent, NotModified).
  Étiquettes : id stable + `x-displayName` traduit. Bornes ±2⁵³−1 de zod retirées. Contrôles : route sans méta (listée a minima), operationId
  manquant/double, étiquette ou code inconnu, `x-query` inconnu, paramètre de chemin non décrit, traduction anglaise manquante (partout,
  y compris les `.meta(doc(fr, en))` des schémas zod), `$ref` pendante → console en dev, `tests/openapi.test.ts` (lit les vrais fichiers).
- **`GET /api/v1/openapi.json?lang=fr|en`** : français par défaut (`apiOpenApiQuerySchema`, `.catch`), cache mémoire par (base, langue),
  `public, max-age=300`, CORS `*` (chemin public du middleware). `OPENAPI_LANGS`, `OPENAPI_DEFAULT_LANG` dans `shared/utils/api.ts`.
- **`GET /api/admin/api-docs`** (`api:docs`, `no-store`) : `{ apiBaseUrl, specUrl, projects: [{ id, name, slug, keys: null | [{ id, type,
  name, environment, prefix, publicValue }] }] }` (100 projets actifs au plus ; `keys` si `project:credentials` ; clés valables non remplacées ;
  `publicValue` seulement pour PUBLISHABLE).
- **Page `/admin/api`** : spécification chargée par le navigateur dans la langue de l'interface, clonée et enrichie (`components.parameters.projectId.examples`
  = projets, celui de la clé choisie en premier) ; `servers` = origine de la page + `/api/v1` (puis `apiBaseUrl` s'il diffère) ; clé publique
  choisie injectée (`authentication.securitySchemes.bearerAuth.token`) ; `.env` (`SURGE_MEDIA_API_URL`, `_PROJECT_ID`, `_PUBLISHABLE_KEY` réelle,
  `_SECRET_KEY` vide + nom/préfixe en commentaire). `AdminApiReference` : config Scalar `theme: 'none'`, `forceDarkModeState`, `localization.locale`,
  `withDefaultFonts: false`, `telemetry: false`, `agent.disabled` (sinon activé d'office sur localhost), `mcp.disabled`, `showDeveloperTools: 'never'`,
  `persistAuth: false`, `showSidebar` seulement ≥ 80rem ; recréé (`:key` = langue, thème, largeur, génération du jeton — jamais la valeur) ;
  retire `light-mode`/`dark-mode` de `<body>` en partant ; correctif a11y : blocs `[role=region][aria-label="Code sample"]` → `role=group` + libellé
  traduit (MutationObserver sur `<body>`, nœuds ajoutés). `scalar.css` : variables `--scalar-*` sur `body.light-mode/.dark-mode` (fenêtres de Scalar
  hors composant), fond de `<body>` rétabli, `--scalar-custom-header-height` 3.5rem sous `lg`.
- **Écarté** : « jeton de console » = jeton personnel lié à la session, admis depuis l'origine de l'installation malgré `SECRET_IN_BROWSER`
  (assouplissement du garde-fou ; refusé par le classifieur de sécurité de l'agent). Sa colonne `AccessToken.sessionId` (migration `api_console`,
  publiée) a été **retirée le 2026-10-02** par la migration `drop_api_console` (historique conservé, il ne fait qu'avancer). Piste compatible :
  jeton délégué de test émis par l'administration.

### 9.16 Transformations à la demande (phase C, C1)

Architecture validée : `.claude/architecture-phase-c.md` (CD1–CD12 ; écarts de C1 en tête). Référence d'exploitation : `setup.md` § 8.1.

- **Grammaire** (`shared/utils/transforms.ts`, pur, auto-importé, testé) : `/m/<id>/v<n>/<segment>/<nom>.<format>` ; segment avec `_` =
  paramètres `clé_valeur` séparés par `,`, sinon préréglage (`PRESET_NAME_PATTERN` `^[a-z][a-z0-9-]{0,31}$`). Formats `TRANSFORM_FORMATS`
  (`jpg`, `png`, `webp`, `avif` ; `jpeg` → 301 `jpg`), `TRANSFORM_MIME_TYPES`, `TRANSFORM_DEFAULT_QUALITY` (jpg/webp 80, avif 50, png null =
  sans perte). `BUILTIN_PRESETS` : `preview` = `w_480,h_480,fit_inside,q_72`, `full` = '' ; `RESERVED_PRESET_NAMES` = + `original`.
  `parseTransformation(segment, { maxDimension })` → `{ ok, transformation, canonical } | { ok: false, param, message }` (messages en anglais) ;
  `formatTransformation` ; `transformationSegment('')` = `full` ; `IDENTITY_TRANSFORMATION`.
- **Forme canonique** : ordre d'**exécution** `r, flip, crop, w, h, fit, g, q, bg` (écart : le document disait `crop, r, flip…`) ; défauts et
  paramètres sans effet retirés (`r_0`, `fit_cover`, `g_focal`, `fit`/`g` sans les deux dimensions, `dpr` appliqué puis retiré) ;
  **indépendante du format** (`q_`/`bg_` explicites conservés) pour qu'une signature vaille pour toutes les sources d'un `<picture>`.
- **Chemins** (`server/lib/media/delivery-path.ts`, pur) : `parseDeliveryPath(path, { maxDimension, formats })` → `target` (`original` |
  `preset` | `transform`) | `redirect` (chemin canonique, sans `/m/`) | `invalid` | null ; `deliveryVariant(target)` = `original` / nom /
  `t:<canonique>` (droit signé, sans format) ; `derivedSegment`. `delivery.ts` le réexporte.
- **Opération effective** (`server/lib/media/transform-plan.ts`, pur) : `planTransform(t, { width, height, hasAlpha, focal }, format, max)`
  → `{ rotate, flip, extract, resize { fit fill|cover|contain, position, background }, flatten, quality, width, height, key }`. Zone vérifiée
  dans l'image tournée ; **jamais d'agrandissement** (cover/fill : `k = min(1, W/w, H/h)` sur la boîte ; contain : boîte réduite tant que
  l'image y serait agrandie ; inside/outside/une dimension : échelle ≤ 1) ; borne `max` appliquée aussi sans redimensionnement ; réductions
  proportionnelles exprimées en `fill` exact ; `g_focal` + point → zone calculée (prêt pour C3), sinon `position` sharp (`centre`).
  `key` = `[r_,flip_,crop_x-y-w-h,size_WxH[,fit_cover,g_…|,fit_contain,bg_…],flatten_…,q_…]|full` + `.format` : les demandes équivalentes
  (`w_1600`, `w_4096`, `full` sur 1200 px) partagent un fichier.
- **Rendu** (`handlers/image.ts`, `transform(source, plan)` remplace `preview`) : `sharp({ limitInputPixels }).autoOrient()`, puis
  **miroir avant rotation avec axes permutés après un quart de tour** (sharp applique toujours `flip`/`flop` avant `rotate`, quel que soit
  l'ordre des appels — vérifié), `extract`, `resize`, `flatten`, encodage (jpeg mozjpeg, png palette si `q`, webp, avif effort 2).
  Testé sur une image repère (`tests/image-transform.test.ts` : 16 combinaisons, EXIF 6, 4 formats).
- **Dérivés** (`variants.ts`) : `resolveDeliverable(media, 'original' | DerivedRequest { transformation, format, free, beforeGenerate? })` ;
  `MediaVariant.transformation` = `v<n>/<key>` ; ETag `<checksum 24>-<sha256(key) 10>` ; quota (`assertVariantQuota` : lignes de la version ≥
  `maxVariants` → 429 `TRANSFORM_QUOTA`) puis `beforeGenerate` (débit) **dans** la promesse dédoublonnée ; `builtinPresetTransformation`,
  `previewRequest()` (preview en WebP), `hasDerivedFiles(media)` (remplace `handler.preview`), `transformSource(media)` (focal null jusqu'à C3).
  `transform-settings.ts` : `useTransformSettings()` (`runtimeConfig.media.transform` : `maxDimension` 4096, `formats`, `maxVariants` 50,
  `rateLimit` 60 ; valeurs invalides → défaut).
- **Route `/m/`** : 404 / 400 `INVALID_TRANSFORM` (`data.detail`) / 301 (`public, max-age=86400`, chaîne de requête conservée) → média → 302
  de version avec le même segment (`derivedPath`) → `authorizeDelivery` → préréglage inconnu 404 → `resolveDeliverable` ; débit
  `createTokenBucketLimiter` clé `gen:<ip>` seulement si `generationRateLimited(access)` (public non signé, ou `scope=derived`) ;
  `Retry-After` depuis `data.retryAfter` ; `Content-Disposition` = nom de l'URL décodé.
- **Accès** : `DeliveryAccess` = `{ mode: 'public', signed }` | `{ mode: 'signed', expires, scope }` | `{ mode: 'credential' }` ; signature
  permanente valide + média public → `public` (cache immuable) ; sinon 403 `SIGNATURE_INVALID`.
- **Signatures** : `targetGrant('t:…')` = lui-même ; `computeSignature(…, expires | null)` (`perm`) ; `buildSignatureQuery(…, null)` sans `exp`
  (lève pour l'original ou un droit élargi) ; `checkSignature` : `exp` absent = permanente, refusée avec `scope` ou pour l'original.
- **Reprise** : plugin `server/plugins/variant-keys.ts` (lignes sans `.` = anciennes `v<n>/preview` → renommées en `v<n>/<key>` du préréglage,
  fichier conservé ; orpheline ou conflit d'unicité → ligne et fichier supprimés).
- `urls.ts` : `derivedPath(media, segment, format)` ; `mediaPath(media, 'preview')` inchangé. `MEDIA_PRESETS` (API) reste `['preview']`
  jusqu'à C3. `mediaError` accepte 429. Codes `INVALID_TRANSFORM`, `TRANSFORM_QUOTA` dans `MEDIA_ERROR_CODES` (pas encore dans `API_ERRORS` : C3).

### 9.17 Politique des transformations et préréglages (phase C, C2)

Référence d'exploitation : `setup.md` § 8.2. Migration `c2_transforms`.

- **Modèle** : `Project.transformPolicy` (enum `TransformPolicy` OPEN | SIGNED | PRESETS, défaut OPEN) ; `TransformPreset { id, projectId?
  (null = global, Cascade), name, transformation (canonique, sans format), description?, createdAt, updatedAt }` (index projectId ; unicité
  par niveau dans l'application) ; `Setting { key @id, value Json, updatedAt }` (`transforms.libraryPolicy`).
- **Règles pures** (`shared/utils/transforms.ts`) : `TRANSFORM_POLICIES`, `TransformGrant` (`none|exact|derived|admin|credential`),
  `freeTransformAllowed(policy, grant)` (OPEN toujours ; SIGNED si grant ≠ none ; PRESETS seulement `admin`), `PRESETS_PER_LEVEL_MAX` 100,
  `PRESET_DESCRIPTION_MAX_LENGTH` 200, `PRESET_LEVELS`, `TRANSFORM_ERROR_CODES` (PRESET_NOT_FOUND, PRESET_NAME_TAKEN, PRESET_LIMIT_REACHED,
  INVALID_TRANSFORM), `isReservedPresetName`, `parsePresetDefinition` (refuse `crop` et la transformation vide). Schémas
  `shared/schemas/transforms.ts` : `transformPolicySchema`, `updateTransformPolicySchema`, `transformsQuerySchema`, `presetNameSchema`,
  `createPresetSchema`, `updatePresetSchema` (description vide → null), `presetFormSchema` (champs texte → nombres, `validation.integerRange`
  avec `params`, `validation.color`, `validation.presetEmpty`), `presetFieldsToDefinition`, `presetFormValues`.
- **Service** (`server/lib/transforms/service.ts`) : `getInstallationTransforms()` (politique de la bibliothèque + préréglages globaux,
  LRU 60 s, `invalidateInstallationTransforms`), `spaceTransformPolicy(projectId|null)`, `resolvePreset(projectId|null, nom)` (intégré →
  projet → global ; `transformation` null + `error` si la définition ne passe plus les bornes), `describeTransforms(projectId|null)`
  (`{ policy, presets: PresetSummary[] (shadowed), limits }`), `projectPresets` (API v1), `setTransformPolicy` (retourne l'ancienne),
  `createPreset` / `updatePreset` (transactions : limite, homonyme) / `deletePreset`, `findPreset`, `toPresetSummary`, `transformError`.
  `ProjectState` (`projects/state.ts`) porte `transformPolicy` et `presets` (même cache 60 s, `invalidateProjectState`).
- **Droits** (`server/utils/transforms.ts`) : `requireTransformsAccess(event, projectId?, write)` (projet : `project:read`/`project:settings`,
  `canEdit` = `project:settings` ; installation : permission `settings:manage`), `requirePresetAccess(event, preset)` (404 PRESET_NOT_FOUND si
  absent ou projet invisible). Nouvelle permission `settings:manage` (ADMIN seulement).
- **Diffusion** : `transformGrant(access)` (`delivery.ts`) ; la route `/m/` applique `freeTransformAllowed(spaceTransformPolicy(media.projectId),
  grant)` aux paramètres libres (403 `TRANSFORM_NOT_ALLOWED`, `data.detail`) ; préréglage via `resolvePreset` (404 inconnu, 400 si plus
  valable) ; `cacheControl(access, presetMaxAge)` pour un préréglage global/projet public (`public, max-age=604800`, ETag = opération
  effective → change avec la définition). `useTransformSettings().presetMaxAge` (`NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE`).
- **Routes admin** : `transforms/{index.get,index.patch}` (`?project=`), `presets/{index.post,[id].patch,[id].delete}` ; audit `preset.created|
  updated|deleted` (`targetType` `preset`, `data.label`, `transformation`, `changes`), `project.updated` › `changes.transformPolicy`,
  `settings.updated` › `changes.libraryPolicy` ; catégories d'audit `preset`, `settings`.
- **API v1** : `GET /projects/{projectId}/presets` (`presets.get.ts`, toute clé, ETag sur le contenu), contrat `Project.transformPolicy`
  (minuscules), schémas `apiPresetSchema`, `apiPresetListSchema` (registre `Preset`, `PresetList`, réponse `PresetList`), étiquette
  `transformations`.
- **Interface** : `AdminTransformSettings` (`projectId?`, `headingLevel`) : politique (`UiRadioCards` désactivées sans droit + indication),
  préréglages en liste (`<ul>`, badges niveau / « Masqué par le projet »), dialogue par champs (paramètres canoniques affichés, borne du
  serveur vérifiée, erreurs du serveur `data.param` → champ, `apiError(...).details`), suppression (`return-focus=false`, focus sur le titre
  de la liste ; texte différent si un global réapparaît), limites (`dl`). Pages `admin/projects/[id]/transforms` (onglet « Transformations »,
  visible pour tout membre) et `admin/settings` (`settings:manage`, entrée « Réglages » de la barre latérale). `fieldErrors` transmet les
  `params` des contrôles `custom`. i18n : `transforms.*`, `settings.*`, `validation.{presetName,presetNameReserved,presetEmpty,
  integerRange,color}`, `audit.{categories,actions}.{preset,settings}`, `audit.details.{transformation,libraryPolicy}`,
  `audit.fields.{transformPolicy,transformation}`.

### 9.18 API des transformations et point d'intérêt (phase C, C3)

Référence d'exploitation : `setup.md` § 8.3. Migration `c3_focal_point`. Écarts : en-tête de `architecture-phase-c.md`.

- **Point d'intérêt** : `Media.focalX/focalY` (fractions 0 à 1 de l'image orientée, 4 décimales : `roundFocalCoordinate`,
  `sameFocalPoint`, `FocalPoint` dans `shared/utils/transforms.ts`) ; `mediaFocalPoint(media)` et `transformSource` (`variants.ts`) le
  donnent à `planTransform` (gravité `focal` : zone la plus grande au rapport demandé, centrée sur le point, bornée à l'image ; déjà
  écrite en C1). `focalPointSchema` (`shared/schemas/media.ts`, `z.strictObject` + arrondi) dans `mediaMetadataSchema` (admin) et
  `apiMediaUpdateSchema` (v1) ; `toMetadataInput` le transmet.
- **`updateMediaMetadata`** : point différent → `updateMany where { id, version }` + `version: { increment: 1 }` (409 `VERSION_CONFLICT`),
  `deleteVersionVariants` (lignes `v<old>/…` puis fichiers `variants/<id>/v<old>-*`, aussi utilisé par `replaceMediaFile`), `mediaChanged`,
  `pregenerateVariants` ; images seulement (400 « Only images have a focal point. ») ; corbeille → 409 `IN_TRASH` ; même point → mise à jour
  ordinaire sans nouvelle version. Conservé par `replaceMediaFile`, copié par `duplicateMedia`. Non journalisé. `toMediaSummary` expose
  `focalPoint`.
- **Contrat `Media` v1** : `urlTemplate` (`derivedPathTemplate(media)` = `/m/<id>/v<n>/{transform}/<slug>.{format}`, `urls.ts` ;
  signature `{ scope: 'derived' }` jusqu'à `expires` pour un privé ; `null` sans dérivés) et `focalPoint` ; ETag inchangé (la version
  change avec le point).
- **Liens signés** : `server/lib/api/signature-plan.ts` (pur, testé) : `SignedFile` (`file` | `preset` | `transform` canonique),
  `signedVariant`, `signaturePlan(file, derived, { visibility, policy, delegated })` → `none | permanent | expiring | refused` ;
  `server/lib/api/signed-urls.ts` : `resolveSignedFile` (format activé sinon `INVALID_TRANSFORM`, `parseTransformation` → canonique,
  vide → `full`, `resolvePreset` → 404 `PRESET_NOT_FOUND`, préréglage plus valable → `INVALID_TRANSFORM`, média sans dérivés →
  `INVALID_REQUEST`), `issueSignedUrl(media, request, { base, policy, delegated, expires })` → `{ url, query, expiresAt }`.
  Routes : `media/[mediaId]/signed-url.post.ts` (réécrite) et **`projects/[projectId]/signed-urls.post.ts`** (lot de 100 :
  `findApiMediaByIds` en une requête, une échéance, erreur par lien si son code est dans `API_SIGNED_URL_ITEM_ERRORS`, sinon l'erreur
  remonte). Délégué : `expiresIn` ≤ 3600 (400) et jamais de signature permanente.
- **Schémas** : `signedUrlTargetShape` + `refineSignedUrlTarget` (partagés par l'unitaire et chaque lien du lot ; `z.strictObject`) ;
  `preset` = `PRESET_NAME_PATTERN`, `transform` ≤ 200, `format` ∈ `TRANSFORM_FORMATS` (puis formats activés à l'exécution).
- **Erreurs** : `API_ERRORS` + `INVALID_TRANSFORM` (400), `TRANSFORM_NOT_ALLOWED` (403), `PRESET_NOT_FOUND` (404), `TRANSFORM_QUOTA` (429) ;
  `problemDetail` reprend `data.detail` des erreurs métier par défaut.
- **OpenAPI** : `createSignedUrls` (requestBody `SignedUrlsRequest`, réponse `SignedUrlList`, schémas `SignedUrlError`/`SignedUrlList`) ;
  `createSignedUrl` décrit cibles, formats et politiques ; `updateMedia` + 409 ; description générale : section « Transformations
  d'images » (grammaire de `/m/`, paramètres, cache, politique, erreurs de `/m/` en `data.code`), traduite.
- **Interface** : `AdminFocalPointEditor` (`mediaId`, `src` = aperçu, `width`, `height`, `focalPoint`, `canEdit` ; `saved`) dans
  `pages/admin/media/[id].vue` (images hors corbeille ; `onFocalSaved` recharge et efface le lien temporaire) : clic sur l'image (pas de
  glisser, WCAG 2.5.7), deux `input[type=range]` 0–100 (`aria-valuetext` et `<output>` par `formatPercent` : « 35 % » insécable en
  français), repère `aria-hidden` (pointillés sans
  point), texte de l'état, aperçus 1:1 et 16:9 (`object-fit: cover` + `object-position` de `focalObjectPosition`), Effacer / Enregistrer
  (jamais désactivés : « Aucune modification à enregistrer »), message `role=status`/`alert`, note sur la nouvelle version ; curseurs
  stylés en `<style scoped>` (piste bordée `--input`, poignée `--primary`). i18n `media.focal.*`.
- `TransformSettings.vue` : `$api<TransformsState>(…)` (TS2321 apparu avec la nouvelle route Nitro).

### 9.19 Générateur d'adresses de la fiche média (phase C, C4)

Référence d'exploitation : `setup.md` § 8.4. Aucune migration. Écarts : en-tête de `architecture-phase-c.md`.

- **Résolution commune** : `resolveTransformRequest(projectId | null, { preset?, transform?, format })` (`transforms/service.ts`) → `{ kind:
  'preset', name, transformation } | { kind: 'transform', canonical, transformation }` ; erreurs métier `transformError` (400
  `INVALID_TRANSFORM` avec `param` et `detail`, dont `param: 'format'` pour un format non activé ; 404 `PRESET_NOT_FOUND`). Utilisée par
  l'aperçu, les adresses et l'API v1 : `signed-urls.ts` lève maintenant des erreurs métier (`mediaError(403, 'TRANSFORM_NOT_ALLOWED')`,
  400 sans code pour un média sans dérivés) que l'API convertit par `toProblem` (`problemDetail` : `PRESET_NOT_FOUND` reprend `data.detail`).
- **Options** : `spaceTransformOptions(projectId | null)` (politique, préréglages non masqués `{ name, transformation, description, level }`,
  formats, `maxDimension`) dans `GET /api/admin/media/:id` → `transforms` (images ; null sinon). `projectPresets` accepte null (bibliothèque).
- **Aperçu** : `GET /api/admin/media/:id/transform` (`transformPreviewQuerySchema` : `preset` **ou** `transform`, `format` webp par
  défaut) → `renderTransient(media, transformation, format)` (`variants.ts` : `planTransform` + `handler.transform` dans `runProcessing`,
  **aucun** `MediaVariant`, aucun quota) ; `Cache-Control: private, max-age=300`, nosniff, CSP sandbox, `X-Transform-Width|Height|Operation` ;
  sans politique ; 409 `IN_TRASH` ; `Retry-After` sur 503.
- **Adresses** : `POST /api/admin/media/:id/links` (`transformLinksSchema` : 1 à `TRANSFORM_LINKS_MAX` = 4, `expiresIn` 60 s–7 j, défaut 1 h)
  → `issueSignedUrl` avec `spaceTransformPolicy(media.projectId)`, `delegated: false`, base `mediaBaseUrl` ; erreur par lien
  `{ error: { code, param?, detail? } }` (toute erreur sans `data.code` remonte) ; 400 sans dérivés ; 409 `IN_TRASH`.
- **Interface** : `AdminUrlGenerator` (`mediaId`, `version`, `width`, `height`, `altText`, `visibility`, `options`, `projectId`) sous le
  point d'intérêt (images hors corbeille) : `UiRadioCards` Paramètres / Préréglage (préréglage par défaut en politique PRESETS),
  `AdminTransformFields` (validation immédiate sans déplacer le focus : `transformFieldsSchema` + borne du serveur ; largeur par défaut
  min(800, largeur)), format, validité pour un média privé ; `schedule()` 400 ms, `AbortController` ; aperçu par `fetch` → blob →
  `URL.createObjectURL` (révoqué), légende `role=status` (« Aperçu : 800 × 450 px, WebP, 24 ko. »), note de réduction ; adresse
  (`UiCopyField`) et sa nature (permanente, préréglage modifiable, signée sans échéance, lien temporaire avec date) ; refus en PRESETS
  avec lien vers l'onglet Transformations (ou Réglages avec `settings:manage`) ; adresse et alertes masquées tant qu'un champ est
  invalide ; extraits `imageSnippets` (`shared/utils/snippets.ts` : `htmlAttribute`, `withTransformFormat`) avec `UiCopyButton` (libellés
  « Copier l'exemple … »), blocs `<pre>` à retour à la ligne (pas de zone défilante à rendre focalisable). 2x : `transform + ',dpr_2'`
  seulement si l'image (orientée, rotation comprise) dépasse la dimension demandée. i18n `media.generator.*`.
- `AdminTransformFields` (`v-model` = objet de champs, `ids`, `maxDimension`, `error(field)`, `format?`, événement `edit` ; emplacements
  `size` et `area`) remplace les 8 champs du dialogue des préréglages (`AdminTransformSettings` : `:error="message" @edit="clear"`).
- **Complément du 2026-10-03** (étape 15 de `setup.md`) : groupes `<fieldset>` Taille / Cadrage / Rendu / Orientation (+ Sortie dans le
  générateur) ; ajustement affiché seulement avec largeur **et** hauteur, ancrage seulement en `cover` ; aides dynamiques
  `transforms.fitHelp.*`, `gravityHelp.*`, `qualityHelp.*` (qualité par défaut du format choisi) ; pastille de couleur de fond ; formats
  décrits (`media.generator.formats.*.label|hint`). **Densité** : `TRANSFORM_DENSITIES` [1, 1.5, 2, 2.5, 3], `atDensity(d)` = paramètres +
  `dpr_d` canonisés par `parseTransformation` (client) ; `srcsetTargets` 1x/2x/3x quand la marge (rapport source / demandé, dimension la
  plus contrainte, la plus large en `contain`) ≥ densité − 0,5 ; liens fusionnés (≤ 4) ; `displaySize` = taille demandée et **densité
  réelle** = min(densité, max(1, échelle)), à 1x les dimensions du fichier. **Zone** : `AdminCropSelector` (`src`, `width`, `height`,
  `rotate`, `flip`, `ids`, `region`, `error`) : cadre au rapport de l'image tournée, image en `translate(-50%,-50%) scale(±1,±1)
  rotate(r)` (dimensions échangées au quart de tour), deux clics → zone (≥ 1 px), surbrillance par ombre portée, `<fieldset>` imbriqué
  (légende `float-left` sous la bordure), annonce `role=status` des seules actions à la souris ; `parseCropFields(values, bounds)`
  (`validation.cropIncomplete`, `integerRange`, `cropOutside` avec `max`), `rotatedSize`, `cropParameter`. `imageSnippets({ …, densities })`
  (srcset dès deux densités, `1.5x` avec un point). Dialogue des préréglages : paramètres affichés d'après `transformFieldsSchema`.

### 9.20 Tableau de bord (étape 19)

- **Choix validés (2026-10-04)** : statistiques, raccourcis, projets, points d'attention, graphique des envois sur 30 jours, activité
  récente (audit:read) ; disposition fixe par rôle (pas de préférence enregistrée) ; « Vos permissions » replié dans « Votre compte » ;
  pas de widget « médias récents ».
- **API** : `GET /api/admin/dashboard` (session) → `dashboardData(event, user)` (`server/lib/dashboard/service.ts`) :
  - espaces : projets visibles (tous pour `projects:all`) avec `spaceScopes` ; filtre médias = `{}` (ADMIN) ou `OR` bibliothèque
    (`library:read`) + projets lisibles (archivés compris) ; `null` si aucun espace ;
  - `media` : `groupBy kind` (nombre, `_sum.size`), `groupBy visibility`, corbeille (`groupBy projectId` sur `deletedAt not null`) ;
    `variants` : `mediaVariant.aggregate` des médias actifs ; `uploads` : `{ since, hours }` = comptes par heure UTC sur
    `UPLOAD_WINDOW_HOURS` (31 jours, médias depuis mis à la corbeille compris) ;
  - `projects` : `{ active, archived, items }` (6 actifs, ordre alphabétique, `role` exercé, `mediaCount` hors corbeille) ;
  - `users` : `users:manage` → tous (`scope: 'all'`, `roles`, `invited`, `inactive`) ; `users:invite` seul → ses invités (`scope: 'invited'`) ;
  - `credentials` : jetons personnels actifs (`tokens:personal`) et clés actives des projets avec `project:credentials` (non archivés) ;
  - `attention` (`DashboardAttention`, `shared/utils/dashboard.ts`) : `siteUrl` (`settings:manage`, production seulement), jetons et
    clés secrètes (non remplacées) expirant d'ici `EXPIRING_SOON_DAYS` (7), invitations (`pending`, `expired` = sans lien valable),
    `trash` par espace, `mail` (`users:manage`, SMTP absent) ; `attentionSeverity` : warning / info ;
  - `activity` : `listAuditEvents({ page: 1 }, 8)` si `audit:read`, sinon `null`.
- **Interface** (`pages/admin/index.vue`) : cartes (`StatCard` : libellé = lien étendu `after:absolute`, contour `has-[a:focus-visible]`),
  raccourcis selon `can()`, graphique en `<ClientOnly>` (`dailyUploads` dans le fuseau du navigateur : jours calendaires calculés à
  midi UTC, sûrs aux changements d'heure ; légende = résumé, barres `aria-hidden`, tableau dans `<details>`), points d'attention
  (icône + texte « À traiter » / « Pour information » pour les lecteurs d'écran), projets, activité (`useAuditFormat`), compte
  (`Account` reprend l'appareil de confiance). Grille des cartes `repeat(auto-fit, minmax(13rem, 1fr))`.
- **Tests** : `tests/dashboard.test.ts` ; scénarios `dashboard-test.mjs` (38) : valeurs attendues recalculées en SQL avec les mêmes
  définitions pour 4 rôles (exactes malgré les données de l'utilisateur).

### 9.21 Vidéos : envoi, stockage, diffusion directe (phase D1, étape 20)

Architecture validée : `.claude/architecture-phase-d.md` (DD1–DD14, écarts de D1 en tête). Référence d'exploitation : `setup.md` § 7.7.

- **Détection** (`sniff.ts`, `detectMimeType(header)` pure) : `ftyp` (AVIF d'abord ; HEIF, audio M4A/M4B non reconnus ; `qt  ` → MOV ;
  marques MP4 vidéo connues → MP4) ; EBML `DocType` = `webm`. **Depuis D3** (§ 9.23) : marque principale `3g*` → `video/3gpp`(`2`),
  `DocType` `matroska` → `video/x-matroska`, AVI, ASF/WMV, Ogg Theora, MPEG-TS/M2TS (4 paquets de 188 ou 192 octets, examiné après GIF)
  **reconnus**, mais acceptés seulement si le traitement des vidéos est actif ; `SNIFF_HEADER_BYTES` = 1024 (256 en D1).
- **Lecteur d'en-têtes** (`server/lib/media/video/`, purs, testés) : `ByteSource` (lectures par positions ; ≤ 20 000 lectures, ≤ 1 Mio par
  lecture), `VideoProbeError` (`unreadable` | `no-video`). ISO BMFF (`isobmff.ts`) : `mvhd`, `tkhd` (identifiant, matrice → rotation,
  dimensions 16.16), `mdhd`, `hdlr` (QuickTime `mhlr` compris), `stsd` (avcC, hvcC, av1C, vpcC, esds — y compris dans `wave` —, versions
  de la description du son QuickTime), lieu (`©xyz`, `loci`, clé `location.ISO6709`, élément `©xyz` d'`ilst`) ; parcours de premier niveau
  arrêté dès que `moov` et la position des données sont connus ; `mdat` tronqué toléré ; **MP4 fragmenté** (`mvex`) : `mehd`, sinon fin
  du **dernier `moof`** (`fragmentEnds` : `tfdt` + durées des `trun`, défaut `tfhd` puis `trex`, parcours ≤ 8000 boîtes, jamais
  d'erreur → null) — les durées de `mvhd`/pistes n'y sont pas utilisées (enregistrements `MediaRecorder` : `mvhd` = 0). EBML (`ebml.ts`) :
  `Segment` de taille inconnue, `Info` (TimecodeScale, Duration), `Tracks` (CodecID, CodecPrivate, Pixel/Display), arrêt au premier
  `Cluster` (≤ 16 Mio). `codecs.ts` : chaînes RFC 6381. `probe.ts` : dimensions affichées (quart de tour → permutées), bornes
  1–16 384, durée 3 décimales, débit, `playback`.
- **Métadonnées** (`Media.metadata`, `VideoMetadata`) : `container, videoCodec, audioCodec, codecs, hasAudio, rotation, bitrate, faststart
  (null en WebM), hasLocation, playback (broad | variable)`. `Media.duration` (s, null si inconnue). Aucune migration. D2 : `prepared`,
  `durationEstimated` ; D3 : `playback` `none` (format converti), `dataTracks`, `hdr`, `rewrites`, `videoCodec` null possible (§ 9.23).
- **Envoi** : `receiveUpload(event, UploadRules)` (§ 9.4) ; `analyze` : gestionnaire `queued: false` → hors `runProcessing` ; `UNSUPPORTED_TYPE`
  d'un gestionnaire (sans piste vidéo) → 415 avec `accepted` et `detail` (`problemDetail` les combine). Remplacement : `expectedKind`
  (admin `[id]/file.put`, v1 `withApiUpload(…, media.kind)`) → 422 `KIND_MISMATCH` dès les premiers octets.
- **Diffusion** : `/m/` inchangé (original, `Range`, 304, HEAD ; dérivés → 404 sans affiche) ; `adminMediaPaths` : vidéo **6 h** (tranche 1 h).
- **API v1** : contrat inchangé en D1 (`kind`, `duration`, `previewUrl`/`urlTemplate` null ; D3 : `sources`, `processing`), OpenAPI : section « Vidéos »/« Videos » d'`INFO_FR`/`EN`,
  descriptions de `uploadMedia`, `replaceMediaFile`, champs `width`, `height`, `duration`, `url`, `previewUrl`.
- **Interface** : `AdminMediaUploader` (prop `kinds`, aide par genre `media.upload.constraintsByKind.*`, `beforeunload` pendant un envoi,
  icône `Upload`), `useMediaUpload` (`kindsOf`, `maxSizeFor`, `CLIENT_TYPE_ALIASES` `video/x-m4v`, `image/jpg` ; `FILE_TOO_LARGE` avec
  `data.maxSize`), `AdminMediaBrowser` (filtre `kind` dans l'URL et les liens de dossier, une colonne de plus à partir de `xl`), `AdminMediaCard`
  (icône `Film` sur `bg-muted`, pastille de durée `aria-hidden` + durée en toutes lettres `sr-only`), fiche (`<video controls
  preload="metadata" playsinline>`, `aria-label` = titre, `aria-describedby` = description, repli + lien ; durée `formatClock`/`formatDuration`,
  codecs `codecLabel`, débit `formatBitrate` ; avertissements `media.video.notices.*` ; « Description courte » ; extrait `videoSnippet` dans la
  section des adresses — public, ou après un lien temporaire), tableau de bord (`admin.dashboard.stats.videos`). i18n : 1250 clés (1331 après D2).
- **Écarts à la proposition** : durée des MP4 fragmentés calculée depuis les fragments (non prévu ; découvert avec `MediaRecorder`) ;
  refus anticipé aussi pour un remplacement d'un autre genre (422) ; vidange du corps refusé (connexion réutilisable en production).

## 10. Référence des API

Format d'erreur (h3) : `{ statusCode, statusMessage, message, data? }` ; **codes métier dans `data.code`** (lus côté client par
`apiError(err)` → `{ status, code, retryAfter }`). Erreurs de validation zod : 400 avec `data` = issues.

| Méthode + chemin | Accès | Entrée | Sortie / statuts |
| --- | --- | --- | --- |
| GET `/api/health` | public | — | 200/503 `{ status, checks { database, storage, imageProcessing }, videoProcessing { mode, workers, queued } }` (statuts seulement ; `videoProcessing` D3, hors `checks`, sans effet sur le statut, valeurs null en `off`) ; seule route servie par un processus de travail |
| POST `/api/auth/login` | public (CSRF) | `{ email, password }` | 200 `{ user }` + cookie · 400 · 401 · 429 |
| POST `/api/auth/logout` | cookie | — | `{ loggedOut: true }` |
| POST `/api/auth/confirm-password` | cookie (CSRF) | `{ password, trustDevice? }` | `{ verifiedUntil, trustedUntil }` (+ cookie de confiance) · 422 `PASSWORD_INCORRECT` · 429 |
| GET `/api/auth/trusted-devices` | session | — | `{ days, current: { createdAt, expiresAt } \| null, total }` |
| DELETE `/api/auth/trusted-devices` | session (CSRF) | `{ scope: 'current' \| 'all' }` | `{ revoked }` (cookie effacé) · 400 |
| DELETE `/api/admin/users/:id/trusted-devices` | `users:manage` | — | `{ revoked }` · 404 |
| GET / DELETE `/api/_auth/session` | nuxt-auth-utils | — | session (sans `secure`) ; 401 si révoquée · DELETE efface |
| GET `/api/auth/password/:token` | public | — | `{ email, purpose, expiresAt }` · 404 `TOKEN_INVALID` |
| POST `/api/auth/password/:token` | public (CSRF) | `{ password, confirmation }` | 204 · 400 · 404 `TOKEN_INVALID` |
| GET `/api/admin/status` | `users:manage` | — | `{ bootstrapCredentialsSet }` |
| GET `/api/admin/dashboard` | session | — | `{ media, variants, uploads { since, hours }, projects { active, archived, items }, users, credentials, attention, activity }` (§ 9.20) |
| GET `/api/admin/users` | `users:invite` (gestionnaire : ses invités) | `?q&role&status&page` | `{ items: UserSummary[], total, page, pageSize: 20 }` (tri e-mail) |
| POST `/api/admin/users` | `users:invite` (+ sudo si projets) | `{ email, name?, role, projectIds?, projectRole? }` | 201 `{ user, invitation { path, purpose, expiresAt } }` · 403 `ROLE_NOT_INVITABLE` · 422 `PROJECTS_REQUIRED` / `PROJECT_UNAVAILABLE` / `ROLE_NOT_ASSIGNABLE` · 409 `EMAIL_TAKEN` |
| GET `/api/admin/users/:id` | `users:invite` (gestionnaire : ses invités) | — | `{ user, activeSessions, pendingLink { purpose, expiresAt } \| null, projects: { id, name, archivedAt, role }[] }` · 404 |
| PATCH `/api/admin/users/:id` | `users:manage` | `{ name?, role?, isActive? }` | `{ user }` · 403 `SELF_ACTION` · 409 `LAST_ADMIN` |
| DELETE `/api/admin/users/:id` | `users:manage` | — | 204 · 403 · 409 |
| POST `/api/admin/users/:id/password-link/email` | `users:invite` (gestionnaire : invitation de ses invités) | `{ token, locale, timeZone? }` | `{ to }` · 404 `TOKEN_INVALID` · 409 `MAIL_NOT_CONFIGURED` / `INVITATION_ACCEPTED` · 429 · 502 `MAIL_FAILED` |
| GET `/api/admin/config/mail` | `users:invite` | — | `{ enabled }` |
| POST `/api/admin/users/:id/password-link` | `users:invite` (gestionnaire : invitation non acceptée de ses invités) | — | `{ path, purpose, expiresAt }` · 409 si inactif (sans code) · 409 `INVITATION_ACCEPTED` · 404 |
| DELETE `/api/admin/users/:id/sessions` | `users:manage` | — | `{ revoked }` |
| GET `/api/admin/config/media` | session | — | `{ maxUploadSize (la plus grande), maxUploadSizes { IMAGE, VIDEO }, acceptedTypes (D3 : + formats convertis si actif), signedUrlDurations, videoPreparation, videoProcessing { mode, active, convertedTypes, rendition, maxDuration } }` |
| GET `/api/admin/spaces` | session | `?scope=` (défaut `media:upload`) | `{ spaces: ({ type: 'library' } \| { type: 'project', id, name })[] }` |
| GET `/api/admin/media` | `media:read` (espace) | `?project&folder&recursive=1&q&kind&visibility&status=active\|trash&sort=newest\|oldest\|name\|size&page` | `{ items: MediaSummary[], total, page, pageSize: 24, space, projectRole, scopes }` · 404 |
| POST `/api/admin/media` | `media:upload` (espace) | `?project` + multipart `file` + `title?`, `altText?`, `visibility?` | 201 `{ media: MediaDetail }` · 400/403/404/413/415/422 |
| GET `/api/admin/media/:id` | `media:read` | — | `{ media: MediaDetail, publicUrl (absolue \| null), publicPosterUrl, publicTrackUrls (D2), publicSources (D3 : sources absolues permanentes d'une vidéo publique, sinon []), transforms (image ou vidéo avec affiche : { policy, presets, formats, maxDimension } \| null), space, projectRole, scopes }` (corbeille comprise) · 404 |
| GET `/api/admin/media/:id/processing` | `media:read` (corbeille comprise) | — | `{ version, processingState, processing }` (D3, suivi toutes les 5 s, `no-store`) · 404 |
| POST `/api/admin/media/:id/process` | `media:write` | — | `{ media }` (D3 : « Traiter » / « Relancer » : tâche active annulée, nouvelle tâche) · 422 `KIND_MISMATCH` · 409 `IN_TRASH` / `PROCESSING_DISABLED` / `VERSION_CONFLICT` |
| GET `/api/admin/media/:id/transform` | `media:read` | `?preset=\|transform=&format=` | image (non enregistrée) + `X-Transform-Width\|Height\|Operation` · 400 `INVALID_TRANSFORM` (`param`) · 404 `PRESET_NOT_FOUND` · 409 `IN_TRASH` · 503 |
| POST `/api/admin/media/:id/links` | `media:read` | `{ items: [{ preset? \| transform?, format }] (1–4), expiresIn? }` | `{ items: [{ url, query, expiresAt } \| { error: { code, param?, detail? } }] }` · 409 `IN_TRASH` |
| PATCH `/api/admin/media/:id` | `media:write` | `{ title?, altText?, visibility?, folderId?, focalPoint? }` | `{ media }` · `focalPoint` modifié : version + 1, 409 `VERSION_CONFLICT` / `IN_TRASH`, 400 hors images |
| PUT `/api/admin/media/:id/file` | `media:write` | multipart `file` | `{ media }` · 409 `VERSION_CONFLICT` · 415/422 |
| POST `/api/admin/media/:id/prepare` | `media:write` | — | `{ media }` (MP4/MOV : nouvelle version si modifié) · 400 · 409 `IN_TRASH`/`VERSION_CONFLICT` |
| PUT / DELETE `/api/admin/media/:id/poster` | `media:write` | multipart `file` (image) + `time?` / — | `{ media }` · 415 · 422 `KIND_MISMATCH` · 409 |
| POST `/api/admin/media/:id/tracks` | `media:write` | multipart `file` + `kind`, `language`, `label`, `isDefault` | `{ media }` · 400 · 409 `TRACK_LIMIT_REACHED` · 413 · 422 `INVALID_TEXT_TRACK` |
| PATCH / DELETE `/api/admin/media/:id/tracks/:trackId`, PUT `…/file` | `media:write` | `{ kind?, language?, label?, isDefault? }` / — / multipart `file` | `{ media }` · 404 `TRACK_NOT_FOUND` |
| DELETE `/api/admin/media/:id[?permanent=true]` | `media:delete` | — | 204 · 409 `NOT_IN_TRASH` |
| POST `/api/admin/media/:id/restore` | `media:delete` | — | `{ media }` |
| POST `/api/admin/media/:id/signed-url` | `media:read` | `{ expiresIn }` (60–604800) | `{ url (absolue), expiresAt, posterUrl, tracks: [{ id, url }], sources: VideoSource[] (D3, droit `file` de l'original, même échéance) }` (public : URL permanentes, `expiresAt: null`) · 409 `IN_TRASH` |
| POST `/api/admin/media/:id/duplicate` | `media:read` + `media:upload` (cible) | `{ projectId: string \| null }` | 201 `{ media }` · 404 · 403 · 409 `IN_TRASH` |
| POST `/api/admin/media/:id/move` | `media:delete` + `media:upload` (cible) | `{ projectId: string \| null }` | `{ media }` (même espace : inchangé) · 404 · 403 · 409 `IN_TRASH` |
| GET `/api/admin/projects` | session | `?q&status=active\|archived&page` | `{ items: ProjectSummary[], total, page, pageSize: 20 }` |
| POST `/api/admin/projects` | `projects:create` | `{ name, slug?, description? }` | 201 `{ project }` · 409 `SLUG_TAKEN` |
| GET `/api/admin/projects/:id` | `project:read` | — | `{ project, trashCount, scopes }` · 404 |
| PATCH `/api/admin/projects/:id` | `project:settings` | `{ name?, slug?, description?, archived? }` | `{ project, trashCount, scopes }` · 409 `SLUG_TAKEN` |
| DELETE `/api/admin/projects/:id` | `project:settings` (`library` : + `media:upload` bibliothèque) | `{ media: 'library' \| 'purge' }` | `{ media: n }` · 409 `PROJECT_NOT_ARCHIVED` · 403 `LIBRARY_NOT_ALLOWED` |
| GET `/api/admin/projects/:id/members` | `project:read` | — | `{ members: MemberSummary[], space, projectRole, scopes }` |
| GET `/api/admin/projects/:id/candidates` | `project:members` | `?q` | `{ candidates: { id, name, email, role, assignableRoles }[] }` (≤ 20) |
| POST `/api/admin/projects/:id/members` | `project:members` | `{ userId, role }` | 201 `{ member }` · 404 `USER_NOT_FOUND` · 409 `ALREADY_MEMBER` · 422 `ROLE_NOT_ASSIGNABLE` |
| PATCH `/api/admin/projects/:id/members/:userId` | `project:members` | `{ role }` | `{ member }` · 409 `LAST_OWNER` · 422 |
| DELETE `/api/admin/projects/:id/members/:userId` | `project:members` (soi-même : `project:read`) | — | 204 · 409 `LAST_OWNER` |
| GET `/api/admin/projects/:id/keys` | `project:credentials` | — | `{ keys: KeySummary[], apiBaseUrl }` · 403 `PROJECT_ARCHIVED` |
| POST `/api/admin/projects/:id/keys` | `project:credentials` (+ sudo si SECRET) | `{ type, name, environment, scopes?, lifetime? }` | 201 `{ key, value }` · 403 `REAUTH_REQUIRED` |
| POST `/api/admin/projects/:id/keys/:keyId/rotate` | idem | `{ overlap }` | 201 `{ key, value }` · 409 `TOKEN_NOT_ACTIVE` / `TOKEN_REPLACED` |
| POST `/api/admin/projects/:id/keys/:keyId/revoke` | `project:credentials` | — | 204 · 409 `TOKEN_NOT_ACTIVE` |
| DELETE `/api/admin/projects/:id/keys/:keyId` | `project:credentials` | — | 204 · 409 `TOKEN_ACTIVE` |
| GET / POST `/api/admin/projects/:id/origins` | `project:credentials` | `{ origin }` | `{ origins }` · 201 `{ origin }` · 409 `ORIGIN_EXISTS` / `ORIGIN_LIMIT_REACHED` |
| DELETE `/api/admin/projects/:id/origins/:originId` | `project:credentials` | — | 204 · 404 |
| GET `/api/admin/tokens` | `tokens:personal` | — | `{ tokens }` (les siens) |
| POST `/api/admin/tokens` | `tokens:personal` + sudo | `{ name, lifetime, scopes?, allProjects?, projectIds?, includeLibrary? }` | 201 `{ token, value }` · 422 `PROJECT_UNAVAILABLE` |
| POST `/api/admin/tokens/:id/revoke` · DELETE `/api/admin/tokens/:id` | `tokens:personal` | — | 204 · 404 · 409 |
| GET `/api/admin/folders?project=` | `media:read` | — | `{ folders: { id, parentId, name, mediaCount, … }[], space, projectRole, scopes }` |
| POST `/api/admin/folders?project=` | `media:write` | `{ name, parentId? }` | 201 `{ folder }` · 404/409/422 `FOLDER_*` |
| PATCH / DELETE `/api/admin/folders/:id` | `media:write` | `{ name?, parentId? }` · `?content=parent` | `{ folder }` · `{ media, folders }` |
| PATCH `/api/admin/media?project=` | `media:write` | `{ ids (≤ 100), folderId \| null }` | `{ moved }` |
| GET · PATCH `/api/admin/transforms?project=` | `project:read` · `project:settings` ; sans `project` : `settings:manage` | — · `{ policy }` | `{ level, canEdit, policy, presets, limits }` |
| POST `/api/admin/presets?project=` · PATCH / DELETE `/api/admin/presets/:id` | `project:settings` ou `settings:manage` (selon le niveau) | `{ name, transformation, description? }` | 201 `{ preset }` · `{ preset }` · 204 ; 400 `INVALID_TRANSFORM` (`param`), 404 `PRESET_NOT_FOUND`, 409 `PRESET_NAME_TAKEN` / `PRESET_LIMIT_REACHED` |
| GET `/api/admin/video-processing` | `settings:manage` | — | `{ mode, role, active, halted, settings { concurrency, threads, rendition, preset, crf, av1, maxDuration }, ffmpeg { ok, version, major, encoders, hdrFilters, av1, problems } \| null, workers: [{ id, host, seenAt, version, concurrency, active, halted }], jobs { queued, running, done, failed, cancelled }, backfill { count, totalDuration } }` (D3, `no-store` ; jamais les chemins des binaires ni la limite mémoire) |
| POST `/api/admin/video-processing/backfill` | `settings:manage` | — | `{ count }` (D3 : tâches de priorité −10 — 10 pour une vidéo à piste de données — pour les vidéos jamais traitées ; audit `media.processing_backfill`) · 409 `PROCESSING_DISABLED` |
| GET `/api/admin/audit` | `audit:read` | `?category&project&page` | `{ items, total, page, pageSize: 50, filterProject }` |
| GET\|HEAD `/m/...` | selon § 9.6 (sans cookie ; Bearer depuis B3) | `Range` | fichier en flux · 206/302/304/401/403/404/405/416 ; 503 `PROCESSING_PENDING` (D3, retenue) ; OPTIONS 204 |
| GET `/api/v1/me` | tout identifiant valable | — | `Me` (credential, user, project, access) |
| GET `/api/v1/projects` | `project:read` | `?limit&cursor` | `{ items: Project[], nextCursor }` |
| GET `/api/v1/projects/:projectId` | `project:read` | — | `Project` (dont `transformPolicy`, C2 ; `transformFormats`, `transformMaxDimension`, E1) · 404 `PROJECT_NOT_FOUND` · 403 `PROJECT_ARCHIVED` |
| GET `/api/v1/projects/:projectId/presets` | `media:read`, toute clé | — | `{ items: Preset[] }` (`name, transformation, description, level`) · ETag → 304 |
| GET `/api/v1/projects/:projectId/media` | `media:read` | `?q&kind&visibility&ids&sort&limit&cursor&withTotal` | `{ items: Media[], nextCursor, total? }` · 304 (page avec une vidéo en attente ou en cours : relue, ETag avec ses tâches, D3) · 400 `INVALID_REQUEST`/`INVALID_CURSOR` · 403 `LISTING_DISABLED` |
| GET `/api/v1/projects/:projectId/media/:mediaId` | `media:read` | — | `Media` (D3 : + `sources`, `processing` ; ETag avec l'avancement) · 304 · 404 `MEDIA_NOT_FOUND` |
| POST `/api/v1/projects/:projectId/media/:mediaId/signed-url` | `media:read`, pas une clé publique (délégué : ≤ 3600 s) | `{ target?: file\|preset\|transform\|derived\|track, preset?, transform?, format?, trackId?, expiresIn? }` | `{ url, query, expiresAt, sources? }` (`sources` : cible `file` d'une vidéo, D3) · 400 `INVALID_TRANSFORM` · 403 `CREDENTIAL_NOT_ALLOWED` / `TRANSFORM_NOT_ALLOWED` · 404 `PRESET_NOT_FOUND` |
| POST `/api/v1/projects/:projectId/signed-urls` | idem | `{ items: [{ mediaId, target?, preset?, transform?, format? }] (1–100), expiresIn? }` | `{ items: [{ url, query, expiresAt, sources? } \| { error: { code, detail? } }] }` |
| POST `/api/v1/projects/:projectId/media` | `media:upload` (secret, PAT, délégué) | multipart `file` + `title?`, `altText?`, `visibility?` | 201 `Media` + `Location` · 400/403 `UPLOAD_LIMIT_REACHED`/413/415/422/429/503 |
| PATCH `/api/v1/projects/:projectId/media/:mediaId` | `media:write` | `{ title?, altText?, visibility?, folderId?, focalPoint? }` (strict) | `Media` · 400 · 404 · 409 `VERSION_CONFLICT` |
| PUT `/api/v1/projects/:projectId/media/:mediaId/file` | `media:write` | multipart `file` | `Media` (version + 1) · 409 `VERSION_CONFLICT` · 415/422 |
| PUT / DELETE `/api/v1/projects/:projectId/media/:mediaId/poster` | `media:write` (délégué : hors `maxFiles`/`types`) | multipart `file` + `time?` / — | `Media` |
| GET / POST `/api/v1/projects/:projectId/media/:mediaId/tracks` | `media:read` / `media:write` | — / multipart `file` + `kind`, `language`, `label`, `default` | `{ items: TextTrack[] }` / 201 `TextTrack` |
| PATCH / DELETE `/api/v1/projects/:projectId/media/:mediaId/tracks/:trackId` | `media:write` | `{ kind?, language?, label?, default? }` / — | `TextTrack` / 204 · 404 `TRACK_NOT_FOUND` |
| DELETE `/api/v1/projects/:projectId/media/:mediaId` | `media:delete` | — | 204 (corbeille) · 404 |
| POST `/api/v1/projects/:projectId/media/:mediaId/duplicate` | `media:read` + `media:upload` cible (secret : son projet ; PAT) | `{ target?: { projectId } \| { library: true } }` | 201 `Media` (+ `Location` si projet) · 403 `CREDENTIAL_NOT_ALLOWED` · 404 |
| POST `/api/v1/projects/:projectId/delegated-tokens` | portées ⊆ émetteur (secret, PAT) | `{ scopes, expiresIn?, subject?, origin?, upload? }` | 201 `{ token, expiresAt, scopes }` (`no-store`) · 400 · 403 · 404 |
| GET `/api/v1/projects/:projectId/folders` | `media:read`, pas une clé publique | — | `{ items: Folder[] }` · 304 · 403 `CREDENTIAL_NOT_ALLOWED` |
| POST · PATCH · DELETE `/api/v1/projects/:projectId/folders[/:folderId]` | `media:write` | `{ name, parentId? }` · `{ name?, parentId? }` · `?content=parent` | 201 `Folder` · `Folder` · 204 · 404/409/422 `FOLDER_*` |
| GET `/api/v1/openapi.json` · `/api/v1/errors` | public | `?lang=fr\|en` (openapi) | spécification OpenAPI 3.1 générée (§ 9.15) · catalogue des codes |
| GET `/api/admin/api-docs` | `api:docs` | — | `{ apiBaseUrl, specUrl, projects }` (§ 9.15) |

Contrats de données :
- `SessionUser` : `{ id, email, name, role, locale }` ; session client : `{ user, loggedInAt }`.
- `UserSummary` (`toUserSummary`) : `{ id, email, name, role, locale, isActive, status, lastLoginAt, createdAt, invitedBy { id, name, email } | null }` (jamais d'empreinte ; `invitedBy` : étape 16).
- `MediaSummary` (`toMediaSummary`) : `{ id, projectId, folderId (B5), kind, visibility, originalName, title, altText, mimeType, extension, size, width,
  height, duration, version, processingState (D3), focalPoint (C3), url, previewUrl, poster (D2) | null, uploadedBy { id, name, email } | null, createdAt, updatedAt, deletedAt }` ;
  `MediaDetail` = + `checksum`, `metadata`, `duplicatedFromId` ; B4 : + `uploadedByToken { id, name, type, prefix } | null`, `uploadSubject` ; D2 : + `textTracks` ;
  D3 : + `processing` (dernière tâche, `status` = statut de la tâche) | null, `renditions[]`, `sources[]` (§ 9.23). `url`/`previewUrl` sont des chemins **relatifs**, signés `scope=admin`
  si privé ou en corbeille ; vidéo publique retenue (D3) : seuls `url` et les rendus sont signés « admin » (aperçu, affiche et pistes jamais
  retenus) ; les adresses à copier (`publicUrl`, `signed-url`) sont **absolues** (`mediaBaseUrl`).
- `describeAccess(access)` → `{ space: { type: 'library', project: null } | { type: 'project', project: { id, name, slug, archivedAt } },
  projectRole, scopes }` (joint aux réponses média/membres).
- Codes métier : utilisateurs `EMAIL_TAKEN, SELF_ACTION, LAST_ADMIN, TOKEN_INVALID, ROLE_NOT_INVITABLE, PROJECTS_REQUIRED,
  PROJECT_UNAVAILABLE, ROLE_NOT_ASSIGNABLE, INVITATION_ACCEPTED, MAIL_NOT_CONFIGURED, MAIL_FAILED` (`userError` accepte 422) ; médias `NO_FILE, MULTIPART_REQUIRED,
  FILE_TOO_LARGE, UNSUPPORTED_TYPE, UNREADABLE_FILE, DIMENSIONS_TOO_LARGE, KIND_MISMATCH, VERSION_CONFLICT, NOT_IN_TRASH, IN_TRASH,
  MEDIA_FORBIDDEN, SIGNATURE_INVALID, SIGNATURE_EXPIRED, UPLOAD_TIMEOUT` (408, 2026-10-05), `PROCESSING_DISABLED` (409, D3),
  `PROCESSING_PENDING` (503 + `Retry-After`, D3) ; corps des requêtes `BODY_TOO_LARGE` (413),
  `REQUEST_TIMEOUT` (408) (middleware, aussi dans `API_ERRORS` avec `UPLOAD_TIMEOUT`, ajoutés d'office par `bodyErrors` aux opérations
  OpenAPI à corps) ; projets `SLUG_TAKEN, PROJECT_ARCHIVED, PROJECT_NOT_ARCHIVED, LAST_OWNER,
  ALREADY_MEMBER, ROLE_NOT_ASSIGNABLE, USER_NOT_FOUND, LIBRARY_NOT_ALLOWED` (`projectError`, traduits `projects.errors.*`) ; identifiants `TOKEN_NOT_ACTIVE,
  TOKEN_ACTIVE, TOKEN_REPLACED, PROJECT_UNAVAILABLE, ORIGIN_EXISTS, ORIGIN_LIMIT_REACHED` (`credentialError`, `credentials.errors.*`) ;
  authentification `REAUTH_REQUIRED, PASSWORD_INCORRECT` (`authError`).
- Typage : les réponses sont inférées des routes Nitro (`useApiFetch('/api/...')`, `$api(...)`). **Éviter une route statique sœur d'une
  route dynamique** (ex. `/api/admin/media/config` à côté de `/:id`) : cela casse l'inférence des méthodes → d'où `/api/admin/config/media`,
  `/api/admin/spaces` et `/api/admin/projects/:id/candidates` (et non `…/members/candidates`).

## 11. Flux importants (résumés)

1. **Premier démarrage** : `pnpm install` → `pnpm db:init` (fournisseur, URL, migrations, secrets) → variables d'amorçage → `pnpm dev`
   → `/login` avec les identifiants d'amorçage → ADMIN créé → supprimer les variables.
2. **Rendu SSR d'une page admin** : plugin nuxt-auth-utils `fetch` → `/api/_auth/session` (hook : revalidation en base) → middleware
   `auth.global` (connexion, permission) → page → `useApiFetch` (`$api` transmet le cookie en SSR via `useRequestHeaders(['cookie'])`).
3. **Invitation** : POST users → lien → `/password/<jeton>` → POST mot de passe → `/login?passwordSet=1`.
4. **Envoi d'un média** : XHR multipart (`?project=`) → requireSpaceAccess(media:upload) → busboy → temp + SHA-256 → sniff → sharp inspect → storage.put → DB → 201 →
   la médiathèque se rafraîchit (`@done`).
5. **Affichage** : `<img src="/m/...">` → route → accès → original ou aperçu (généré à la 1re demande) → flux depuis le stockage.
6. **Changement de fournisseur de base** : `pnpm db:init` / `db:reset` → `.env` + `provider` réécrit + clients régénérés s'il le faut +
   migrations (données non transférées) ; **aucun rebuild** depuis le 2026-10-10 : la build contient les trois clients, `usePrisma`
   charge celui de `DATABASE_PROVIDER` (`server/utils/prisma.ts`, `CLIENT_MODULES`) ; redémarrer suffit.
7. **Duplication** (fiche média) : `GET /api/admin/spaces?scope=media:upload` → choix → `POST …/duplicate` (read ici + upload cible) →
   `storage.copy` + ligne → redirection vers la copie avec message flash.
8. **Fin de vie d'un projet** : archiver (`PATCH archived: true`, lecture seule) → Supprimer… (dialogue : bibliothèque ou purge +
   saisie du slug) → `DELETE` (transaction) → liste des projets avec message ; purge des fichiers en tâche de fond.
9. **Clé secrète** (B2) : `/keys/new` → `useReauth().run(() => createRequest(input))` → 403 `REAUTH_REQUIRED` ? dialogue →
   `confirm-password` → rejeu → 201 `{ key, value }` → `useFlash` (payload) → `/keys` affiche la valeur une fois (`AdminSecretPanel`, focus).
10. **Lecture par l'API v1** (B3) : middleware (requestId, CORS, Bearer → cache d'identité, garde-fous, débit) → route → `requireApiProject`
   (état du projet en cache, portées) → révision de l'espace (2 s) → ETag égal ? 304 : requête keyset → `toApiMedia` (URL signées alignées).
11. **Envoi depuis un navigateur** (B4) : backend du client (clé secrète) → `POST …/delegated-tokens` → `sm_dt_…` → composant → preflight
   (origines du projet) → `POST …/media` Bearer délégué → `resolvePrincipal` (signature, émetteur en cache) → `browserGuard` (origine) →
   `requireApiProject` (portées ∩ émetteur) → `withApiUpload` (débit « uploads », réservation `maxFiles`, taille/types) → `createMedia`
   (provenance émetteur + sujet) → aperçu pré-généré → 201.
12. **Traitement d'une vidéo** (D3, § 9.23) : envoi (traitement actif) → `createMedia` crée le média PENDING **et** sa `MediaJob` dans la
   même écriture → `notifyJobQueued` (`embedded`) ou recherche toutes les 5 s (worker) → prise atomique (PROCESSING) → `probe` → plan →
   `sanitize`/`repair` (nouvelle version, retenue 503 levée) → `transcode` (rendu H.264, sans nouvelle version s'il n'existait pas) →
   `poster` (si aucune affiche) → READY ; la fiche suit `GET …/processing` toutes les 5 s et ne recharge le média qu'à un changement de
   version ou à la fin de la tâche ; l'API v1 expose `processing` et `sources` (ETag qui suit l'avancement).

## 12. Frontend : conventions et patrons

- **Composants** : primitives maison Tailwind v4 dans `components/ui/` (inspirées de shadcn-vue : variantes typées en `Record`, prop
  `class` fusionnée par `cn()`), **ni @nuxt/ui ni shadcn-vue**, pas de cva ; Reka UI envisageable plus tard pour des primitives complexes.
  Icônes `@lucide/vue` toujours `aria-hidden="true"`. Police Inter auto-hébergée.
- **Couleurs** : uniquement via les jetons (`bg-surface`, `text-muted-foreground`, `border-input`, `bg-primary-soft`…), jamais de couleurs
  Tailwind brutes ; `border-input` = bordure de contrôle (≥ 3:1), `border-border` = décoratif.
- **Formulaires** : `<form novalidate>` + `useFormValidation(schema, { champ: 'id-du-controle' })` → `validate(form)` (null si invalide,
  focus sur le 1er champ en erreur), `message(champ)`, `clear(champ)` sur `@input`, `setError(champ, 'clé.i18n')` pour les erreurs serveur ;
  `<UiFormField v-slot="field">` + `<UiInput v-bind="field">` (le slot fournit `id`, `invalid`, `required`, `aria-describedby` **via un
  objet `v-bind`**, car les props de slot à tiret seraient converties en camelCase). Erreur serveur globale : `<UiAlert live="assertive">` ;
  confirmation : `live="polite"`. Bouton `:loading` (aria-disabled, garde le focus) + `<p class="sr-only" role="status">` pour l'annonce.
- **Appels API** : `useApiFetch()` (lecture, SSR) et `useNuxtApp().$api(...)` (actions). Ne jamais créer un autre `$fetch.create()` sans
  transmettre le cookie en SSR. Envois de fichiers : `useMediaUpload().send()` (XHR pour la progression).
- **Messages après redirection** : `useFlash().set({ variant, message, payload })` / `consume()` (mémoire uniquement ; sert aussi à
  afficher une seule fois un lien d'invitation).
- **Pages protégées** : `definePageMeta({ layout: 'admin', permission: '…' })` ; titres via `useSeoMeta({ title: () => t('…') })`
  (modèle « Titre · surgeMedia » dans `useAppHead`).
- **Erreurs fatales en navigation client** : `abortNavigation(createError({ statusCode: 403, fatal: true }))` (sans `fatal`, la page
  d'erreur n'apparaît pas côté client).
- **Dialogue** : `<UiDialog v-model:open>` (élément `<dialog>` natif, `showModal`) ; `autofocus` sur « Annuler » pour les actions destructives.
- **Barre latérale** : `aria-current="page"` (page exacte) ou `"true"` (sous-page d'une section), calculé sur `route.path`
  (les pages d'une section sont des routes sœurs, pas imbriquées).
- **Dates** : `<NuxtTime :datetime :locale date-style time-style>` (évite les écarts d'hydratation) ; tailles `formatBytes`,
  pourcentages `formatPercent` (Intl).

## 13. Multilingue

- `@nuxtjs/i18n`, stratégie `no_prefix`, cookie `surge-media-locale`, détection navigateur, repli `fr`. `useAppHead` synchronise
  `<html lang dir>`. Sélecteur `AppLocaleSwitcher` (bouton de divulgation, noms des langues dans leur langue, attribut `lang`).
- Fichiers `i18n/locales/fr.json` (référence) et `en.json` — **1528 clés** depuis D3 (D3 : `media.processing.*`, `media.video.notices.{compatPending,
  converting,convertFailed,dataTracks,hdr,hdrUnconverted}`, `media.upload.converted`, `settings.videoProcessing.*`,
  `audit.details.processingBackfill*`) ; 1331 clés après D2 (D2 : `media.poster.*`, `media.tracks.*`, `media.video.prepare.*`, `media.video.notices.{device,estimated,captions}`) (C2 : `transforms.*`, `settings.*` ; étape 10 : `apiDocs.*`, `admin.nav.apiDocs`, `permissions.api.docs`). Espaces de noms : `app, a11y, nav, footer, theme, locale, form,
  validation, auth, common, landing, login, admin, roles, permissions, errors, pagination, users, password, media, projectRoles, space,
  projects, reauth, scopes, credentials, apiKeys, origins, tokens, audit, apiDocs`. Clés de portées : `scopes.<a>.<b>.{label,short,description}`
  (`scope.replace(':', '.')`) ; statuts accordés : `credentials.status.{key,token}.*` ; actions d'audit : `audit.actions.<catégorie>.<verbe>`.
- **Aucun texte en dur** (y compris `aria-label`, `title`, `alt`, ponctuation dépendante de la langue : ex. `locale.current`
  « Langue : {name} »). Composants insérés dans une phrase : `<i18n-t keypath scope="global">` avec slot (ex. dates).
- Syntaxe vue-i18n : `{param}` ; `@` et `|` réservés (écrire `{'@'}`) ; pluriels `« zéro | un | plusieurs »` avec `t(clé, { count }, count)`.
- Messages zod = clés `validation.*` (required, email, tooLong {max}, tooShort {min}, emailTaken, passwordMismatch).
- `pnpm i18n:check` : parité des clés et paramètres entre langues, valeurs non vides, clés utilisées dans `app/` et `shared/`
  (`t('…')`, `keypath="…"`, préfixes de `` t(`préfixe.${…}`) ``). Ne détecte pas les clés inutilisées ni les `:keypath` dynamiques.
- Ajouter une langue : copier `fr.json`, ajouter l'entrée dans `nuxt.config.ts` (`dir: 'rtl'` si besoin), `pnpm i18n:check`.
- La CLI a ses propres catalogues typés (`cli/i18n/fr.ts` référence, `en.ts` : `Record<MessageKey, string>`).

## 14. Accessibilité et design system

- Cible WCAG 2.2 AA. Lien d'évitement, landmarks (header/nav/main/footer ; en admin le `<header>` englobe la barre latérale),
  un `h1` par page, **hiérarchie de titres continue** (h2 masqué ajouté si besoin), `NuxtRouteAnnouncer`, focus visible par `outline`
  (conservé en contrastes élevés), Échap ferme menus/dialogues et rend le focus, `prefers-reduced-motion`.
- Jetons (`main.css`) vérifiés par `pnpm a11y:contrast` (51 couples × 2 thèmes depuis l'étape 10 : texte ≥ 4.5:1, bordures de champ et focus ≥ 3:1 ;
  `--code-blue|orange|purple|teal` + success/destructive/warning sur background/surface/muted pour Scalar).
  Primaire clair `#3b4cc0`, sombre `#8b9cf7` (texte sombre dessus).
- Procédure d'audit : axe-core 4.13 injecté dans la page (snippet dans `setup.md` § 10.3), exclure `#nuxt-devtools-container` et
  `nuxt-error-overlay` (dev) ; pour chaque page, fr/en × clair/sombre, avec états d'erreur et dialogues ouverts. État actuel :
  **0 violation** sur toutes les pages existantes. Seul « incomplete » connu : contraste dans `<dialog>` (fond semi-transparent, couvert
  par le script de contrastes). `/admin/api` : 0 violation (page + référence Scalar, fr/en × clair/sombre) ; fenêtre « Tester la requête » de
  Scalar : écarts dans le code tiers (combobox sans aria-expanded/aria-controls, bouton role=none étiqueté, 2e `main`, région Notifications dupliquée) ;
  deux `h1` (page + titre de la spécification dans le `main` de Scalar).
- **Non testé** : lecteurs d'écran réels (NVDA, VoiceOver).

## 15. CLI `surge-media` (`apps/core/cli/`)

- citty + @clack/prompts ; build tsdown → `dist/cli/index.mjs` (bin `surge-media`) ; en dépôt : `pnpm cli …` / `pnpm db:*` (tsx).
- `init [--provider --url --yes --skip-migrate --cwd --lang]` : écrit `.env` (depuis `.env.example`, sans écraser les autres variables),
  réécrit `provider`, génère les trois clients s'il le faut, `migrate deploy`, **génère `NUXT_SESSION_PASSWORD` et `NUXT_MEDIA_SIGNING_SECRET` s'ils manquent**.
- `db migrate` : vérifie la cohérence `.env` / schéma, génère les clients s'il le faut puis `migrate deploy`.
- `db reset [--provider --url --yes]` : `migrate reset --force` (destructif, confirmation). **Prisma 7 refuse `migrate reset` lancé par un
  agent IA** : l'utilisateur doit le lancer lui-même.
- **Paquet et installation** (2026-10-10, `cli/lib/project.ts`) : `packageDir` (code : serveur construit, migrations, schémas par
  fournisseur, prisma.config.ts, .env.example) et `instanceDir` (.env, données) ; dépôt (`nuxt.config.ts` présent) : instanceDir =
  apps/core ; paquet publié : dossier courant (refusé dans un node_modules) ; `--cwd`. Prisma lancé depuis le paquet avec
  `--schema server/generated/schemas/<p>.prisma` et une URL SQLite absolue ; schéma de dev réécrit et clients générés dans le dépôt seulement.
- **`start [--port]`** et **`worker [--port 3001]`** (`cli/server.ts`, qui remplace `cli/worker.ts`) : serveur construit du paquet lancé
  depuis l'installation (`--env-file-if-exists=<installation>/.env`) ; avec SQLite, vérification préalable du module natif de better-sqlite3
  (`cli/lib/native.ts` ; npm 12 bloque les scripts d'installation des dépendances tant qu'ils ne sont pas approuvés).
  Exige la build (`.output/server/index.mjs`, sinon `error.buildMissing`) ; lance `node --env-file-if-exists=.env <entrée>` depuis le dossier
  du core avec `NUXT_SERVER_ROLE=worker`, `PORT` et `NITRO_PORT` (port 1 à 65 535, défaut 3001 pour ne pas gêner le serveur web) ; variables
  du shell prioritaires sur `.env`. POSIX : SIGINT/SIGTERM transmis (arrêt propre : ffmpeg tué, tâche rendue à la file), code de sortie
  repris. **Windows : rien n'est transmis** (`child.kill` y tuerait le processus sans crochet `close`, tâche non rendue, essai compté) ; le
  Ctrl+C de la console parvient de lui-même au processus de travail et la CLI attend sa fin — **à vérifier sur un poste Windows**. Sous
  Windows, ffmpeg n'a pas non plus de groupe de processus propre (`run.ts`) : s'il reçoit lui aussi le Ctrl+C (non établi : il est lancé avec
  `windowsHide`) et sort (code 255) avant que le crochet `close` ait arrêté la tâche (Nitro n'appelle `close` qu'après l'arrêt du serveur
  HTTP), l'échec est classé définitif (`runFailure` : ni délai, ni code null, ni erreur d'écriture) au lieu d'une tâche rendue sans essai —
  à vérifier sur un poste Windows (Ctrl+C de `surge-media worker` et de `pnpm start` en `embedded` pendant un encodage, puis état de la
  tâche). En dépôt : `pnpm cli worker`. Pas de `VAR=x commande` dans les scripts (syntaxe absente sous Windows).
- La CLI exécute la CLI Prisma installée (`prisma` est en dependencies, pas devDependencies).
- Recherche du dossier core : `--cwd`, sinon dossier courant, sinon package installé (doit contenir `prisma/schema.prisma`).

## 16. Décisions techniques (et justification)

| Décision | Justification |
| --- | --- |
| Nuxt 3.21 + compatibilité 4 | Nuxt 3 demandé, maintenu en parallèle de 4.x ; migration future = mise à jour de dépendance |
| Prisma 7 + driver adapters, client **importé dynamiquement** (`usePrisma()` async) | un import statique évalue `import.meta.url` avant l'entrée Nitro → « File URL path must be absolute » sous Windows en prod |
| Historique de migrations **par fournisseur** + instantané de schéma | SQL non portable ; génération hors ligne sans base |
| TypeScript 6 | vue-tsc incompatible avec TS 7 |
| nuxt-auth-utils + table Session | cookie scellé standard + révocation / désactivation immédiates |
| argon2id (@node-rs/argon2) | recommandation OWASP, binaires précompilés |
| Composants Tailwind maison | contrôle total de l'accessibilité et du thème, pas de dépendance de composants |
| i18n `no_prefix` | URL stables pour `/admin/*` |
| Liens d'invitation/réinitialisation au lieu de mots de passe saisis par l'admin | l'admin ne connaît jamais le mot de passe ; fonctionne sans SMTP ; envoi par e-mail facultatif (étape 18) du lien affiché, revérifié par le serveur, à l'adresse du compte seulement |
| Flydrive derrière `MediaStorage` | flux, S3/GCS, URL signées, clés sûres ; remplaçable ; validé par l'utilisateur |
| Node ≥ 24 | exigé par Flydrive 2 (Flydrive 1.3 resterait possible pour Node 22) |
| Détection de type maison (`sniff.ts`), **pas `file-type`** | `file-type` → `strtok3` (exports conditionnels) cassé après build Nitro + pnpm ; zéro dépendance |
| S3 `requestChecksumCalculation/responseChecksumValidation: WHEN_REQUIRED` | sinon encodage `aws-chunked` stocké tel quel par certains services compatibles (fichiers corrompus) |
| `sharp.cache(false)` | le cache libvips garde les fichiers ouverts (verrous Windows, EBUSY) |
| Médias diffusés via surgeMedia (objets S3 privés) | contrôle d'accès, en-têtes de sécurité, chemin physique jamais exposé |
| Liens signés HMAC sans état | utilisables dans `<img>`, vérifiables sans base, expirent seuls |
| URL versionnées + cache immuable | performances / CDN ; remplacement = nouvelle URL, anciennes redirigées |
| ~~Projet par défaut automatique~~ | remplacé en B1 par les espaces (bibliothèque = `projectId` null) |
| Un média = un seul espace, duplication (+ déplacement) | demandé par l'utilisateur en révision 2 : pas de partage, donc pas de règle de modification croisée |
| Rôles = ensembles de portées, plafond par rôle de plateforme, moteur pur `spaceScopes` | un seul vocabulaire pour sessions et futurs jetons ; testable exhaustivement (Vitest) |
| Espace invisible → 404, portée manquante → 403 | ne pas révéler l'existence des projets/médias d'autrui |
| `/m/` sans cookie, liens v2 (`kid`, `scope`, échéance alignée) | CDN et domaine dédié possibles, rotation du secret, cache navigateur des aperçus admin ; prépare la phase C |
| `Media.projectId` en `Restrict` + suppression de projet réservée aux projets archivés | aucune perte de fichiers par cascade ; choix explicite bibliothèque / purge |
| `oxc-transform` 0.141.0 forcé | Smart App Control bloque la 0.143.0 ; option choisie par l'utilisateur |
| Identifiants opaques `sm_<type>_` + CRC32 + SHA-256 (B2) | architecture § 4.3 : révocation instantanée, rejet sans base, détection de secrets ; pas d'argon2 (256 bits) |
| Mode sudo en base (`Session.passwordVerifiedAt`), 10 min, rejeu côté client (B2) | architecture § 4.4 ; étendu à la rotation d'une clé secrète ; 422 et non 401 en cas d'échec (sinon `$api` déconnecte) |
| Suppression d'un identifiant seulement inactif ; rotation aussi pour la clé publique (B2) | liste propre sans perdre la trace (journal) ; recouvrement utile aux frontends aussi |
| API v1 (B3) : identité par Bearer résolue dans un middleware, routes `defineApiHandler`, RFC 9457, curseurs keyset, ETag de liste par révision | architecture § 6 et § 9 ; aucune requête pour une liste inchangée ; contrat public indépendant de l'administration |
| Caches L1 seulement (B3), L2 Redis reporté | une instance aujourd'hui ; révisions en base déjà partagées ; limiteurs à partager plus tard |
| Colonnes de recherche normalisées + indexation au démarrage (B3) | recherche insensible aux accents portable (SQLite, PG, MySQL) sans extension |
| SQLite WAL activé au démarrage (B3) | lectures (diffusion, API) non bloquées pendant les envois |
| Jetons délégués HMAC sans état, charge lisible, émetteur relu (B4) | architecture § 4.5 ; aucune portée d'office ; sur `/m/` aussi ; seul `maxFiles` a un compteur en base |
| Identité unique `Principal` (émetteur + délégation) pour l'API et `/m/` (B4) | une seule logique d'accès ; empêche qu'un délégué hérite des droits de son émetteur par un test `credential.type` |
| File bornée des traitements (sémaphore) + pré-génération des aperçus (B4) | architecture § 9.2 ; 503 `SERVER_BUSY` plutôt qu'un serveur saturé ; premier affichage sans attente |
| Dossiers : arbre entier en mémoire par révision, filtre récursif en IN, pas de colonne de chemin (B5) | architecture § 11 ; portable, déplacement sans réécriture des médias ; unicité des noms par l'application |
| Transformations : forme canonique syntaxique (indépendante du média et du format) + opération effective calculée (C1) | une URL par résultat (301), une signature pour toutes les sources d'un `<picture>`, un fichier par résultat ; non-agrandissement calculé par nous (sharp ignore le rapport demandé avec `withoutEnlargement`) |
| AVIF effort 2 (C1) | mesuré (photo de 3000 px) : 0,5 s au lieu de 2,1 s (effort 4), fichier ~30 % plus lourd, toujours plus léger que WebP |
| Préréglages modifiables (cache 7 j revalidé) ; politique par espace sur les seuls paramètres libres ; bibliothèque réglée par l'installation (`Setting`) (C2) | CD7, CD10, CD12 ; un préréglage se corrige sans changer d'URL ; jamais de site cassé par un changement de politique |
| Point d'intérêt = nouvelle version ; liens signés décidés par une fonction pure (`signaturePlan`) ; jeton délégué jamais permanent ; lot à erreurs par lien (C3) | CD6, CD8 ; caches toujours cohérents ; un jeton de navigateur ne fabrique pas de lien durable ; une page de `srcset` en un appel même si un lien échoue |
| Générateur : aperçu rendu à la volée par l'administration (sans politique ni quota) ; adresses par la même logique que l'API (C4) | CD11 ; aucun dérivé orphelin créé en tâtonnant ; une seule source de vérité pour les adresses et leur signature |
| Reprise des anciens aperçus au démarrage (plugin), pas en migration (C1) | aucune migration en C1 ; l'identifiant dépend des dimensions (calcul applicatif, pas SQL) ; fichiers conservés |
| Journal d'audit sans clés étrangères + écran ADMIN (`audit:read`) (B2) | les entrées survivent aux suppressions ; pas d'écran de journal par projet pour les propriétaires (piste) |
| SVG exclu, originaux servis tels quels | SVG peut porter du script ; copie sans EXIF par les dérivés (`full`, C1) |
| Recherche : `textSearch` (terme + minuscules) et `mode: 'insensitive'` seulement sous PostgreSQL | portabilité ; SQLite ne gère la casse que pour l'ASCII |
| `/api/admin/config/media` (et non `/api/admin/media/config`) | inférence des types Nitro |
| OpenAPI : `defineRouteMeta` littéral par route + composants zod, français + `x-i18n` (étape 10) | doc à côté du code, route nouvelle visible d'office, une seule source de schémas ; langue de référence du projet ; contrôles en test |
| Scalar embarqué (npm, version exacte) dans `/admin/api`, pas l'UI Nitro (CDN) ni `@scalar/nuxt` | aucun script tiers dans une page authentifiée, accès par permission, données réelles injectées, thème/langue de l'admin |
| Clé injectée = **clé publique** ; secrets jamais injectés (étape 10) | valeurs des secrets non relisibles ; `SECRET_IN_BROWSER` conservé ; « jeton de console » écarté (colonne retirée le 2026-10-02) |
| DD25 : ffmpeg/ffprobe **du système** (≥ 6, `libx264` + `aac` contrôlés au démarrage), processus enfant sans shell (D3) | ni `ffmpeg-static` (70–80 Mo, GPL, traçage Nitro + pnpm, Smart App Control) ni WASM ; mis à jour par le système ; un échec désactive le traitement, jamais le serveur |
| DD26 : modes `off` (défaut) / `embedded` / `external`, processus de travail = **même build** + `NUXT_SERVER_ROLE=worker`, ffmpeg en **priorité la plus basse** | une seule image pour les deux rôles (le code des médias dépend des imports automatiques de Nitro) ; mesuré (§ 29.3) : en priorité normale, p99 du serveur web × 3 et débit − 30 % |
| DD27 : file persistante en base (`MediaJob` : prise atomique portable, bail 2 min, 3 essais, priorités) + `Media.processingState` | ni Redis ni BullMQ ; SQLite/PostgreSQL/MySQL sans `SKIP LOCKED` ; reprise après un arrêt ; listes sans jointure |
| DD28 : **sans perte → remplace l'original** (nouvelle version) ; **réencodage → rendu** à côté de l'original conservé | sinon les positions GPS resteraient publiques à l'URL de l'original ; un réencodage perd de la qualité |
| DD29 : un rendu H.264/AAC ≤ 1080p **seulement s'il sert** (`auto`), `veryfast` CRF 23, HDR → SDR ; AV1 en option désactivée | aucun calcul ni stockage pour une vidéo déjà lue partout ; plusieurs définitions n'ont d'intérêt qu'avec HLS (D4) |
| DD30 : affiche côté serveur seulement sans affiche, jamais d'écrasement | l'affiche choisie par l'utilisateur l'emporte toujours ; vignettes = dérivés de l'affiche (D2) |
| DD31 : réparation WebM et retrait des pistes de données par copie sans réencodage + filtre de D2 ; **diffusion retenue (503) jusqu'au nettoyage** | une seule règle des métadonnées ; vie privée avant disponibilité (choix délégué par l'utilisateur) |
| DD32 : MKV, AVI, 3GP, MPEG-TS/M2TS, OGV, WMV acceptés **seulement si le traitement est actif**, original en téléchargement | illisibles par `<video>` sans conversion ; refus immédiat impossible (ffprobe ne tourne jamais dans une requête) |
| DD33 : table `MediaRendition`, `/m/<id>/v<n>/renditions/<nom>.<ext>`, droit signé `file` couvrant les rendus ; clés sans version (écart) | un rendu n'est pas une transformation d'image (ni quota, ni génération à la demande) ; une signature pour toutes les `<source>` |
| DD34 : API v1 `processing` et `sources[]` **ajoutés** ; administration : relancer, traiter l'existant, état ; pas de webhooks | contrat compatible ; attente par `ETag` / `If-None-Match` |
| DD35 : défenses du § 36 (format imposé, protocole `file`, délais, priorité, fils, mémoire, réanalyse des sorties), arguments construits dans `args.ts` seulement | ffmpeg décode des fichiers de tiers : plus grande surface d'attaque du projet (attaque connue : liste HLS déguisée) |
| Configuration d'exécution partagée par requête (plugin `runtime-config.ts`, `beforeEach` de hookable), gelée pour `/m/`, `/api/`, `/_nuxt/`, copiée pour les pages (2026-10-10) | Nitro 2 la reconstruit à chaque `useRuntimeConfig(event)`, appelé par @nuxtjs/i18n sur toutes les requêtes : 80 % du processeur, × 2 à × 19 une fois corrigé ; variables lues au démarrage seulement |
| Adresse IP du client par mandataires de confiance lus de droite à gauche, posée dans `event.context.clientAddress` ; défaut réseaux privés (2026-10-10) | décision de l'utilisateur (Docker derrière mandataire) ; défaut de Rails ; ni le plus à gauche (h3, Express `true`) usurpable, ni une modification de chaque appel à `getRequestIP` |
| Un client Prisma par fournisseur dans chaque build, chargé selon `DATABASE_PROVIDER` (`cli/lib/generate.ts`, `CLIENT_MODULES` de `server/utils/prisma.ts`) (2026-10-10) | décision de l'utilisateur : une seule image Docker pour les trois bases ; plus de reconstruction pour changer de base ; coût : trois générations (≈ 2,5 s en parallèle, sautées si inchangées), types pris du client SQLite (`export type *`) |
| Image Docker Debian 13 « trixie » + Node 24, variantes complète (ffmpeg 7.1) et `slim`, utilisateur `node`, `tini`, migrations au démarrage, secrets générés dans le volume ; **installe le paquet npm** (étapes `build` → `package` → `install`, `--build-context package=…` en CI) (2026-10-10) | décisions de l'utilisateur (variantes) ; bookworm n'a que ffmpeg 5.1 ; glibc pour les binaires précompilés ; un seul artefact (npm = Docker) et aucune build Nuxt par architecture ; la CLI Prisma charge Studio dès son démarrage : l'élaguer la casse (≈ 250 Mo gardés) |
| Paquet npm `@surge-media/core` = serveur construit **sans modules natifs** (sharp, argon2, better-sqlite3 : dépendances épinglées, installées pour la plateforme de l'utilisateur), liens de Nitro remplacés par des copies (`scripts/prepack.ts`) ; dépendances d'exécution seulement ; `prepare` au lieu de `postinstall` (2026-10-10) | serveur construit sous Linux en CI, utilisé sous Windows/macOS/Linux ; l'archive npm ne garde pas les liens symboliques (absolus sous Windows) ; npm ne lance pas `prepare` chez l'utilisateur |
| Releases par script local `pnpm release` (release-it 21 + `@release-it/conventional-changelog`, preset conventionalcommits, `preMajor` avant 1.0.0), tags `vX.Y.Z`, publication par `.github/workflows/release.yml` sur `release: published` (2026-10-10) | décisions de l'utilisateur (script local, `@surge-media/core`, commitlint, première version 0.1.0) ; publication jamais depuis un poste ; `latest` (npm, Docker) réservé à la plus haute version stable, `next` (préversion), `release-X.Y` (ancienne ligne) |
| ESLint 10 + `@nuxt/eslint` (stylistic : 2 espaces, guillemets simples, sans point-virgule, stroustrup) ; `vue/max-attributes-per-line` désactivée, `max-statements-per-line` 2, `catch {}` admis (2026-10-10) | style déjà établi dans tout le code (2 000 avertissements sinon) ; commitlint (config-conventional, casse du sujet libre) et hook `commit-msg` (simple-git-hooks) |
| `responseReady` avant tout `sendStream` (2026-10-10) | h3 1.15 n'envoie rien si `res.socket` est nul (réponse en file derrière la précédente en keep-alive) |
| Alerte SQLite mesurée (extension Prisma `$allOperations`, constat partagé dans `Setting`, 24 h) plutôt qu'un simple avertissement permanent (2026-10-10) | SQLite synchrone : le temps passé dans la base = temps bloqué ; signaler les symptômes réels (verrous, lenteurs, charge) et le trafic élevé ; coût mesuré 0 sur `/m/`, 3–4 % sur l'API |
| DD36 : interface du § 37, livrée en modules A à F (étape 22) | revues indépendantes par module avant la suite |

## 17. Règles métier et contraintes

- Toute autorisation est **appliquée côté serveur** ; l'UI ne fait que masquer.
- Un ADMIN ne peut pas agir sur son propre rôle/statut/compte ; il reste toujours au moins un ADMIN actif (hors course concurrente extrême).
- Comptes créés uniquement par un administrateur ; e-mail immuable ; mot de passe 12–128 caractères ; e-mails en minuscules.
- Médias : un seul fichier par envoi ; images JPEG/PNG/WebP/AVIF/GIF, 25 Mio par défaut, 100 Mpx max ; vidéos MP4/WebM/MOV (D1), 512 Mio par
  défaut, 2 Gio − 1 au plus, avec une piste vidéo, 16 384 px par côté au plus (aperçu, transformations et point d'intérêt seulement par leur
  affiche, D2) ; type et taille contrôlés dès les premiers octets ; un remplacement garde le genre ; nom d'origine = métadonnée seulement.
- Vidéos traitées (D3, mode ≠ `off` et traitement actif) : MKV, AVI, 3GP/3G2, MPEG-TS/M2TS, OGV, WMV acceptés en plus (limite des vidéos),
  jamais lus tels quels (original en téléchargement, lecture par le rendu H.264) ; une réécriture sans perte (pistes de données, WebM) remplace
  l'original (nouvelle version), un réencodage produit un rendu à côté (original gardé) ; au plus un rendu `h264` et un `av1` par vidéo ;
  affiche du serveur seulement sans affiche ; vidéo à piste de données : original et rendus en 503 sauf lien « admin » jusqu'au nettoyage ;
  durée > `NUXT_VIDEO_MAX_DURATION` : aucun réencodage (échec `TOO_LONG` si un rendu servait, sinon READY) ; 3 essais ; « Relancer » = `media:write`, « Traiter les vidéos
  existantes » = `settings:manage` ; l'API v1 n'expose jamais le détail technique d'un échec.
- Un média en corbeille n'est plus diffusé (sauf aperçu admin) et ne peut pas recevoir de lien signé ; purge seulement depuis la corbeille.
- Lien signé lié à (média, version, dérivé, échéance) ; 7 jours maximum.
- Longueurs de texte ≤ 191 (MySQL) ; tout texte d'API validé par zod partagé.
- Un média appartient à un seul espace ; les listes partent toujours de l'espace imposé par le serveur.
- Projet : nom 1–100, slug `^[a-z0-9]+(?:-[a-z0-9]+)*$` ≤ 60 unique, description ≤ 191 ; toujours au moins un OWNER enregistré
  (sauf suppression de compte) ; archivé = lecture seule ; suppression seulement archivé.
- Un EDITOR de plateforme n'exerce jamais plus que `EDITOR` dans un projet, un DEVELOPER jamais plus que `DEVELOPER` ; un MANAGER membre est toujours OWNER ; un ADMIN est OWNER partout. Seuls ADMIN et MANAGER créent des projets ; seul l'ADMIN gère la bibliothèque (étape 16).
- Identifiants (B2) : valeur complète renvoyée **une seule fois** (création, rotation) sauf clé publique ; jamais d'empreinte dans une
  réponse ni de secret dans le journal ; portées immuables ; jeton personnel toujours à échéance (30/90/365 j) ; clé secrète 30/90/365 j
  ou sans échéance ; clé publique sans échéance ; environnement obligatoire ; 100 origines max par projet.
- API v1 (B3) : jamais de cookie ; identifiant seulement en `Authorization: Bearer` ; projet hors périmètre = 404 ; projet archivé = 403 pour
  tous les identifiants ; clé publique = médias publics, liste seulement si `publicListing` (sinon `ids`) ; URL des médias privés signées ~1 h
  (tranche de 15 min) ; aucune e-mail, clé de stockage ni empreinte dans les réponses.
- API v1 (B4) : écritures seulement via le service médias (`withApiUpload` pour les fichiers) ; jeton délégué : portées ⊆ émetteur (aucune
  d'office), projet unique, 1–60 min ≤ échéance de l'émetteur, pas d'émission ni de duplication, liens signés ≤ 1 h ; `maxFiles` compte les
  fichiers acceptés (envois et remplacements) ; visibilité imposée aux nouveaux médias ; clé publique jamais en écriture.
- Dossiers (B5) : un média est dans 0 ou 1 dossier **de son espace** ; noms uniques parmi les voisins (casse ignorée) ; 8 niveaux ;
  1 000 par espace ; suppression d'un dossier vide ou avec remontée du contenu ; `media:write` pour toute écriture.
- Transformations (C1) : jamais d'agrandissement ; sortie ≤ 4096 px ; formats jpg/png/webp/avif ; 50 dérivés par version (au-delà, plus de
  nouveaux paramètres libres, existants et préréglages toujours servis) ; 60 générations libres non signées par IP et par minute ;
  signature permanente seulement pour un dérivé précis d'un média public.
- Politique (C2) : OPEN (défaut) / SIGNED (paramètres libres signés ou identifiant d'API) / PRESETS (préréglages seulement, sauf liens
  admin) ; préréglages toujours servis ; préréglages : intégrés réservés (`preview`, `full`, `original`), projet prioritaire sur global,
  100 par niveau, pas de `crop`, pas vide ; modification = même URL, nouveau rendu.
- Point d'intérêt (C3) : images seulement, fractions 0–1 à 4 décimales ; le changer = version + 1 (anciennes URL → 302, dérivés
  supprimés) ; conservé au remplacement, copié à la duplication. Liens de l'API : transformation refusée en `PRESETS` ; signature
  permanente seulement pour une transformation d'un média public en `SIGNED` demandée par une clé secrète ou un jeton personnel ; lot
  ≤ 100 liens, une échéance.
- Générateur (C4) : `media:read` dans l'espace ; aperçu jamais enregistré ni compté, hors politique ; adresses soumises à la politique
  de l'espace (bibliothèque : réglage de l'installation) ; 4 liens au plus par appel ; rien dans la corbeille.
- Actions sensibles (sudo) : clé secrète (création, rotation), jeton personnel (création), membres (ajout, rôle, retrait d'autrui), invitation rattachée à des projets (étape 16) ;
  jamais pour une action qui retire des droits (révoquer, quitter).

## 18. Pièges, edge cases et problèmes connus

- **Windows** : verrous de fichiers (sharp) ; un `nuxt dev` lancé par l'utilisateur peut occuper le port 3000 (ne pas l'arrêter sans
  accord ; il s'est arrêté seul pendant l'étape 4) ; `prisma dev` (Postgres local) ne rend pas la main (utiliser `--detach`).
- **Build de production obligatoire après tout ajout de dépendance serveur** : le traçage Nitro (nft) + pnpm peut omettre des fichiers
  (exports conditionnels) alors que tout fonctionne en dev.
- `postinstall` : `nuxt prepare` **avant** la génération des clients (sinon `tsconfig.server.json` introuvable).
- `pnpm install` « à jour » ne relance pas `postinstall` : utiliser `pnpm db:migrate` (régénère le client) après un pull.
- Props de slot à tiret → camelCase (d'où `v-bind` d'un objet dans `UiFormField`).
- `aspect-ratio` seul se laisse étirer par une image haute (image en `absolute inset-0` dans les cartes).
- vue-i18n : `@` / `|` dans les messages ; clés numériques évitées (`hour/day/week`).
- Limiteur de connexion **en mémoire** (instance unique). Derrière un mandataire : adresse réelle par `NUXT_TRUST_PROXY` (2026-10-10,
  § 9.24) ; toujours passer par `getRequestIP(event)` **sans** `xForwardedFor` (h3 prendrait l'adresse la plus à gauche, usurpable),
  jamais `req.socket.remoteAddress`.
- Contrôle CSRF basé sur `Host` : un proxy doit transmettre l'en-tête `Host` d'origine.
- Cookie `Secure` : HTTPS obligatoire hors localhost.
- Recherche SQLite : casse ignorée seulement pour l'ASCII (atténué par la recherche en minuscules), accents non ignorés.
- Deux ADMIN se rétrogradant simultanément pourraient laisser 0 admin (pas de verrou) ; **aucune commande de secours** si le seul
  admin perd son mot de passe (l'amorçage ne marche qu'avec 0 utilisateur).
- `User.locale` stocké mais non utilisé.
- **Windows Smart App Control** peut bloquer un module natif non signé (`An Application Control policy has blocked this file`) :
  diagnostic `process.dlopen` + journal `Microsoft-Windows-CodeIntegrity/Operational` ; ne jamais modifier les réglages de sécurité,
  proposer une version voisine (cas oxc-transform) ou laisser l'utilisateur débloquer.
- Les scripts Bash avec plusieurs heredocs contenant des apostrophes/backticks ont échoué : préférer l'outil Write/Edit
  (ou un script .mjs dans le scratchpad pour les remplacements multiples ; `python` n'est pas installé).
- **TS2321 « Excessive stack depth »** quand un appel `$api('/api/…')` est passé directement à une fonction générique
  (`useReauth().run(() => $api(…))`) : isoler l'appel dans une fonction nommée (`createRequest(body)`, `rotateRequest(id, overlap)`)
  ou renvoyer `void` (`async () => { await $api(…) }`).
- **Référence de gabarit homonyme d'une prop** (`useTemplateRef('title')` + prop `title`) : le gabarit affiche l'élément
  (« [object HTMLHeadingElement] ») sans erreur de typecheck — nommer la référence autrement (`heading`).
- **Dialogues empilés** (`<dialog>` + `showModal`) : Chrome regroupe les dialogues ouverts sans activation utilisateur et un seul Échap les
  ferme tous — artefact des clics simulés en JS ; tester avec de vrais clics (`computer left_click`). Idem pour le rendu du focus.
- La fermeture d'un `<dialog>` (événement `close`) est asynchrone : `UiDialog` rend le focus à l'ouvreur **après** les mises à jour
  synchrones ; si l'action fait disparaître l'ouvreur, replacer le focus après le rechargement (`await refresh(); await nextTick()`).
- Audits axe scriptés : cibler `main input[type=radio]` — les premiers boutons radio de la page sont ceux du thème (barre latérale),
  un clic dessus change le thème en cours de test.
- Région défilante d'un tableau : la nommer par la légende (`caption` avec id), pas par le titre de la section, sinon axe
  `landmark-unique`.
- **`Sec-Fetch-Mode` n'est pas un signal de navigateur** : le fetch de Node (undici) l'envoie toujours (`cors`) ; seuls `Origin` et
  `Sec-Fetch-Site` servent au garde-fou `SECRET_IN_BROWSER`.
- **Auto-import Nitro non injecté** dans un fichier où l'identifiant suit un prédicat de type (`(scope): scope is TokenScope =>
  (TOKEN_SCOPES as …)`) : typecheck vert mais `ReferenceError` en production (Rollup renomme la vraie constante `X$1`). Dans `server/lib`,
  importer explicitement depuis `#shared/utils/*` ; contrôle : `grep -rhoE '(const|function) [A-Za-z_]+[$][0-9]+' .output/server/chunks`.
- **SSR et URL absolues** : les appels internes (`$api` côté serveur) n'ont pas l'hôte d'origine sauf s'il est transmis (fait depuis B3) ;
  avec `NUXT_SITE_URL` défini, la question ne se pose pas.
- **Cookie de session posé par script refusé** dans le navigateur intégré : un ancien cookie `surge-media-session` HttpOnly ne peut pas être
  remplacé par `document.cookie` → se connecter par le formulaire avec le compte temporaire (mot de passe généré, gardé dans le scratchpad).
- **Focus après une boîte de dialogue dont l'ouvreur survit** (ex. « Supprimer le dossier », qui désigne ensuite le dossier parent) :
  `UiDialog` rend le focus à l'ouvreur à l'événement `close` (asynchrone) → passer `:return-focus="false"` juste avant de fermer
  après succès, puis placer le focus soi-même (`document.getElementById(…)?.focus()` après `nextTick`).
- Outil `read_page`/`find` du navigateur intégré : cases à cocher et radios affichées par leur **valeur** (« on »), pas par leur nom
  accessible ; vérifier les libellés avec `input.labels` ou axe. La liste interactive s'arrête à la zone visible.
- **Axe en thème sombre** : ne pas basculer la classe `dark` à la main (thème à moitié appliqué, faux contrastes) → cookie
  `surge-media-color-mode=dark` (et `surge-media-locale`) puis rechargement de la page.
- **File des traitements avec `_QUEUE=0`** : la pré-génération d'un aperçu occupe une place ; des envois simultanés reçoivent 503 — normal ;
  avec la file par défaut (100), ils attendent.
- Le script B1 (`b1-api-test.mjs`, antérieur au journal) laissait des entrées d'audit et des `CacheRevision` : nettoyage ajouté en B4
  (libellés contenant le suffixe, révisions de projets disparus) ; B2 nettoie aussi les révisions orphelines.
- Tests de l'API v1 : le limiteur d'échecs d'authentification bloque l'IP locale 60 s après 30 refus → placer ce scénario **en dernier** ;
  le script B3 fabrique des jetons « bien formés inconnus » (base62 + `zlib.crc32`).
- Tests d'identifiants : vieillir la confirmation du mot de passe avec `node:sqlite` (`UPDATE "Session" SET "passwordVerifiedAt" = <ISO -11 min>
  WHERE "userId" = ?`) ; le module `better-sqlite3` n'est pas résolvable depuis `apps/core` (dépendance de l'adaptateur).
- Tests d'API : script Node en `scratchpad` (`b1-api-test.mjs` : comptes jetables DEVELOPER/EDITOR créés par invitation puis supprimés,
  identifiants admin lus dans `.env` sans les afficher) ; pour l'interface, cookie de session obtenu par un script puis posé dans le
  navigateur, et **déconnexion** à la fin.
- **sharp** : `flip`/`flop` s'appliquent **toujours avant** `rotate(n)`, quel que soit l'ordre des appels (après `autoOrient`) → pour
  « rotation puis miroir », permuter h/v après un quart de tour (`handlers/image.ts`). `resize({ withoutEnlargement })` en `cover` sur une
  boîte plus grande que l'image renvoie l'image entière **sans recadrage** (rapport demandé perdu) → bornage calculé dans `transform-plan.ts`.
- **Auto-import de `shared/utils` incomplet** : `TRANSFORM_FITS` n'était pas déclaré dans `.nuxt/types/imports.d.ts` (les autres
  constantes du même fichier l'étaient) → `Cannot find name` au typecheck. Importer explicitement depuis `#shared/utils/transforms` dans les
  composants (convention déjà en vigueur côté serveur).
- **axe dans une `iframe`** : impossible, les pages envoient `X-Frame-Options: DENY` → auditer la page elle-même (cookies de langue et de
  thème, rechargement, `axe.run(document)`), dialogues ouverts par script.
- `pnpm typecheck` peut dépasser 400 s : le lancer en arrière-plan.
- **TS2321 en ajoutant une route Nitro** (C3, `signed-urls.post.ts`) : `data.value = await $api('/api/admin/transforms', { method: 'PATCH' … })`
  dans `TransformSettings.vue` a dépassé la profondeur de comparaison des types de routes → donner le type de réponse explicitement
  (`$api<TransformsState>(…)`). À refaire ailleurs si l'erreur réapparaît après une nouvelle route.
- Scénarios de recadrage : vérifier un pixel **hors de la zone d'un recadrage centré** (bande rouge de 150 px sur 1200 : un recadrage
  carré centré commence à 200 px) ; une première version du script se trompait de zone.
- Contrôle B4 « envois : 429 au-delà de 60 par minute » : le seau se remplit **d'un jeton par seconde pendant la boucle** (mesuré en C4 :
  62 envois acceptés en 2,7 s, ~44 ms par envoi). La borne fixe (≤ 61) échouait sur un poste chargé ; le script calcule maintenant la
  tolérance (60 + secondes écoulées).
- Interface du point d'intérêt : un message affiché **au-dessus** des boutons déplaçait ceux-ci quand il disparaissait (clic suivant
  dans le vide) → messages d'état placés sous les boutons d'action.
- **Scénarios rejoués à la suite** : `b3-api-test.mjs` déclenche volontairement le limiteur d'échecs d'authentification par IP → toutes
  les requêtes v1 de l'IP reçoivent 429 pendant ~1 min : attendre (commande en arrière-plan) avant B4/B5. Les anciens scripts lisent
  maintenant les lignes commentées de `.env` (regex `^#? *NAME=`).
- **Rebuild** : arrêter d'abord le serveur `core-start-3100` (il verrouille `argon2…node` dans `.output` → `EPERM unlink`), puis le relancer ;
  il s'arrête aussi pendant une pause de l'agent (relancer avant de rejouer des scénarios).
- **Build de production bloquée sur ce poste (étape 10)** — absente du 2026-10-01 au 2026-10-02, **de nouveau constatée le 2026-10-03** (la build se termine, le démarrage échoue ; mon serveur de dev lancé alors sur 3000 car celui de l'utilisateur ne tournait pas, arrêté ensuite) : Smart App Control bloquait la **copie** de `argon2.win32-x64-msvc.node` dans
  `.output/server/node_modules` (l'original de `node_modules`, identique, reste autorisé) → `pnpm start` échoue au démarrage. Ne pas contourner
  (lien physique, désactivation) : laisser l'utilisateur débloquer ; tester sur le `pnpm dev` de l'utilisateur (port 3000) sans l'arrêter, et
  vérifier la build statiquement (`grep operationId .output/server/chunks`).
- **Scalar en dev** : découverte tardive → seconde copie de Vue (« Cannot define property modal, object is not extensible ») ; corrigé par
  `vite.optimizeDeps.include: ['@scalar/api-reference']`. Scalar écrit le hash d'URL (`#tag/…`) et y revient au rechargement.
- **Bootstrap admin** : variables `NUXT_BOOTSTRAP_ADMIN_*` **commentées** dans `.env` depuis le 2026-10-01 (le compte ADMIN existe) ; les
  scripts de test lisent les lignes commentées (regex `^#?\s*NAME=`), sans jamais afficher la valeur.
- Médias de l'utilisateur à préserver : une photo (« granola », envoyée le 26/09) désormais dans la bibliothèque, une image
  « landscape.jpg » (bibliothèque, envoyée le 2026-10-02 au soir, point d'intérêt, version 3) et ses deux entrées d'audit
  `media.visibility_changed`, et un compte EDITOR existant : ne jamais les supprimer dans les nettoyages de tests. Depuis le
  2026-10-03 aussi un compte **DEVELOPER** (« SM Dev », créé par l'utilisateur à 12 h 38, membre d'aucun projet) et ses entrées
  d'audit `user.created` / `user.password_link` (référence avant l'étape 16 : 7 entrées d'audit, 2 médias, 1 projet, 1 jeton, 2 adhésions).
  Activité de l'utilisateur ensuite (2026-10-03 soir et 2026-10-04), à préserver aussi : compte MANAGER « sm-ges », projet « My Phone »
  et ses clés publique et secrète, jeton personnel « test jeton », rôles et adhésions modifiés (référence avant l'étape 17 : 4 comptes,
  25 entrées d'audit, 4 médias, 2 projets, 4 jetons, 5 adhésions).
- **h3 1.15 `sendStream`** ne détruit pas le flux quand le client part (seulement `abort()` s'il existe) → toujours passer par
  `closeWithResponse` ; **`readRawBody`** n'a ni limite ni délai → borné par `body-limit.ts` (thenable dans `req.rawBody`). Banc d'essai
  isolé réutilisable : serveur h3 + requêtes abandonnées (`tests/http.test.ts` imite `sendStream`, h3 n'étant pas résolvable depuis
  `apps/core`).
- **Windows 11** : supprimer un fichier encore ouvert par Node **réussit** (libuv ouvre avec `FILE_SHARE_DELETE`, sémantique POSIX) ;
  une fuite de descripteur ne se voit donc pas par un échec de purge (mesurer `HandleCount` du processus, ou `stream.closed`).
- Délai global de Node `requestTimeout` (300 s, requête entière) toujours en place : un envoi de 25 Mio exige ≥ 0,7 Mbit/s ; à relever
  avec les vidéos (D1, `architecture-phase-d.md` § 6.2). Mesuré : un envoi de 512 Mio (busboy + SHA-256 + disque) ne retarde pas la
  boucle d'événements (pas de `worker_threads` pour les envois, DD14).
- **Relais de développement de Nitro** (`httpxy` vers le processus de travail, `nitropack/dist/core`) : après une réponse anticipée (refus d'un
  envoi avant la fin du corps), il cesse de transmettre le corps ; une connexion réutilisée reste bloquée ~6 s puis `ECONNRESET`. Dev seulement
  (Node et h3 seuls : connexion réutilisée, `h3-early-refusal-bench.mjs`). Les scénarios envoient les gros envois refusés sur une connexion
  dédiée (`agent: false`, `Connection: close`). Le relais garde aussi le délai de 300 s de Node (non relevé en dev).
- **Modifier `nuxt.config.ts` pendant un `pnpm typecheck`** (même `.nuxt`) a fait tomber le `nuxt dev` de l'utilisateur le 2026-10-05 : lancer
  typecheck et build dans la **copie isolée** quand un serveur de dev tourne.
- **MP4 de `MediaRecorder`** (Chromium) : fragmenté, `mvhd` à 0, pistes de 0,036 s → durée tirée des fragments. **WebM de `MediaRecorder`** :
  pas de durée. Chromium 152 enregistre MP4 (H.264/AAC) et WebM (VP8/VP9/Opus) : source de vraies vidéos de test sans téléchargement
  (`tests/fixtures/video/`, panneau masqué : `setInterval` + `canvas.captureStream`).
- `axe` signale `video-caption` « à vérifier » sur un `<video>` sans piste de sous-titres ; disparaît dès qu'une piste `captions` existe (D2).
- **`prisma migrate deploy` « database is locked » (SQLite)** tant qu'un `nuxt dev` tient la base, alors qu'un `BEGIN EXCLUSIVE` de `node:sqlite`
  passe : sans arrêter le serveur de l'utilisateur, appliquer le `migration.sql` dans une transaction et insérer la ligne `_prisma_migrations`
  (`checksum` = SHA-256 hexadécimal du fichier, `applied_steps_count` 1) après une copie `VACUUM INTO` ; `migrate status` doit dire « up to date ».
- **Flydrive (pilote fs)** : `deleteAll(prefix)` supprime un **dossier** ; un préfixe de nom de fichier (`variants/<id>/v3-`) n'y supprimait rien
  sans erreur → `deletePrefix` liste désormais le dossier (corrigé en D2 ; `tests/storage.test.ts`). Des dérivés d'anciennes versions restent
  sur les disques des installations antérieures (ex. `landscape.jpg` de l'utilisateur, 8 fichiers du 2026-10-02).
- **Panneau du navigateur intégré masqué** (`document.hidden`) : ni image dessinée, ni `requestVideoFrameCallback`, ni événements `close` des
  `<dialog>` (en attente jusqu'au prochain rendu ; une capture d'écran les déclenche) — ne pas les prendre pour des défauts de l'application.
- **Bash** : un `<<'EOF'` contenant des chemins `[trackId]` a tronqué un fichier ; préférer l'outil d'écriture de fichiers pour le code.
- **Tests sous Node 22** : `text-track.test.ts` échoue (le `TextDecoder('windows-1252')` de Node 22 décode en Latin-1) ; **Node 24 exigé**
  (`engines`). Module natif **`better-sqlite3`** compilé pour la version de Node de l'installation (dans le nuage, serveurs de dev sous
  Node 22 et tests sous Node 24) : en local, `pnpm install` sous Node 24 suffit ; ne pas mélanger les versions de Node sur un même
  `node_modules`.
- **Traitement des vidéos en développement** (D3) : chaque modification de fichier recharge Nitro → crochet `close` → tâche en cours rendue
  à la file sans essai (la fiche annonce « interrompu sur le serveur, sans échec ») ; modifier `fr.json`/`en.json` fait de même, et Vite a
  pu servir l'ancienne langue jusqu'au redémarrage. **Ctrl+C sur `nuxt dev`** arrête tout sans `close` : ffmpeg, laissé dans le groupe du
  terminal en dev (`detached` faux), reçoit le même signal ; au démarrage suivant, `expireDeadHolderLeases` rend échu le bail des tâches d'un
  processus disparu de la même machine, puis la reprise ordinaire les remet en file **avec un essai compté**. Production, arrêt brutal
  (SIGKILL, panne) : ffmpeg peut finir seul en priorité la plus basse (Linux : borné par `prlimit --cpu`), tâche reprise à l'expiration du bail
  (2 min, un essai compté).
- **SQLite partagé par le serveur web et un processus de travail** : une transaction interactive qui lit puis écrit peut échouer aussitôt
  (`SQLITE_BUSY` sans attente) si l'autre processus a écrit entre-temps → transactions de la file et du service **qui commencent par
  écrire** (verrou pris d'emblée, attente de 10 s : `timeout` de l'adaptateur dans `server/utils/prisma.ts`) et **aucune exception
  volontaire après une écriture** (better-sqlite3 n'a qu'une connexion par processus : une requête concurrente du même processus peut
  s'exécuter dans la transaction ouverte et partir avec son annulation).
- **Prisma `updateMany` met à jour `@updatedAt`** (vérifié avec Prisma 7 sur une copie de la base) : l'ETag v1 d'une vidéo en cours de
  traitement repose sur `MediaJob.updatedAt` (avancement, battement de 30 s) ; une écriture en SQL brut devrait le poser elle-même.
- **MPEG-TS et GIF** commencent tous deux par `0x47` : la signature TS (4 paquets complets) est examinée en dernier. `.mts`/`.m2ts` sont
  détectés `video/mp2t` mais `convertedTypes` ne liste que `ts` : l'envoi ajoute ces extensions (alias). Un MOV est annoncé `video/mp4` dans
  `sources` (`canPlayType('video/quicktime')` répond non dans Chrome et Firefox, qui ignoreraient la source).
- **Chromium du nuage** (Playwright) : ne lit pas le H.264 (`canPlayType` vide) — la lecture réelle des rendus et la capture d'affiche
  depuis un rendu restent à vérifier dans un vrai navigateur.
- **ffmpeg sous Windows** : builds courants non signés, Smart App Control peut les bloquer comme argon2 ; arrêt de l'arbre par `taskkill /T
  /F`, priorité `IDLE_PRIORITY_CLASS`, aucune limite mémoire ni processeur (`prlimit` : Linux seulement) — **à vérifier sur un poste
  Windows** (tâche en attente pour l'utilisateur, § 21). Les tests ffmpeg y sont « ignorés » si ffmpeg ou ffprobe manque ; le bloc
  `runTool : processus enfant borné` (priorité, arbre de processus, arrêt) l'est toujours (`describe.skipIf(!posix)`), même avec ffmpeg :
  la priorité se vérifie à la main ; les tests d'arrêt qui restent attendent `code: null` (sémantique POSIX ; `taskkill /F` donne
  probablement le code 1, à vérifier — la règle « ffmpeg tué par un signal → passager » repose aussi sur `code === null`).
- **Nitro 2 et `useRuntimeConfig(event)`** (2026-10-10) : configuration reconstruite à chaque requête (copie + `applyEnv`), coût
  proportionnel à sa taille (OAuth de nuxt-auth-utils compris) et aux lectures de `process.env` (lentes sous Windows) ; corrigé par
  `server/plugins/runtime-config.ts`. Les variables d'environnement ne sont plus lues qu'au démarrage.
- **hookable 5 `beforeEach`** : `hook.args` commence par le **nom** du crochet (`['request', event]`), contrairement aux types ;
  une exception dans `beforeEach` fait échouer **toutes** les requêtes — toujours protéger (try/catch) et tester sur la build.
- **h3 1.15 `sendStream`** : n'écrit rien si `res.socket` est nul (réponse en file en keep-alive) → toujours `responseReady` avant.
- **SQLite synchrone** : une écriture ou une attente de verrou (autre processus, jusqu'à 10 s) fige tout le processus, fichiers
  compris ; P1008 « Operation has timed out » quand l'attente dépasse le délai (§ 9.24).
- **Mesures de charge sur un portable** : débits × 7 entre batterie et secteur ; comparer avant/après dans la même minute (A/B
  par interrupteur temporaire dans la build de la copie), jamais d'une heure à l'autre.
- **Copie isolée** : ne jamais y lancer `pnpm <script>` — pnpm 12 vérifie les dépendances et lance un `pnpm install` qui écrit
  dans `node_modules`, c.-à-d. dans la **jonction** vers le vrai `apps/core/node_modules` (arrivé le 2026-10-10 : arrêté à temps,
  liens intacts, mais un dossier `.pnpm` de 1 177 entrées y est resté — suppression refusée par le mode automatique, signalée à
  l'utilisateur). Lancer les binaires directement : `node node_modules/nuxt/bin/nuxt.mjs build|typecheck`,
  `node node_modules/tsdown/dist/run.mjs` ; `prisma generate` y échoue sans `.nuxt` (client déjà copié). Arrêter le serveur de la
  copie avant de reconstruire (`EPERM unlink` sur argon2).
- **Windows, automatisation** : un processus lancé depuis les outils de l'agent hérite de l'attribut « ignorer Ctrl+C »
  (`SetConsoleCtrlHandler(NULL, TRUE)`) : réactiver avant de lancer (`launch-console.ps1 -EnableCtrlC`) pour un essai fidèle ;
  `spawn({ detached: true })` de Node crée un processus **sans console** (`DETACHED_PROCESS`, AttachConsole échoue) ;
  `Start-Process -RedirectStandardOutput` fait hériter les descripteurs (la commande appelante attend la fin du serveur) → passer
  par `cmd /c "… > fichier"` lancé par `Start-Process -WindowStyle Hidden`.
- **Scénarios enchaînés** : C2 à C4 juste après C1 dépassent 60 transformations libres par minute et par IP (429) — espacer.
- Pas d'outil de copie entre stockages, pas de nettoyage des fichiers orphelins ni des liens de mot de passe utilisés.
- Originaux diffusés avec leurs EXIF (GPS possible).
- Tests automatisés limités aux modules purs (Vitest, depuis B1) : API et interface vérifiées par scripts ad hoc et audits
  manuels (voir § 20).

## 19. Conventions de code à respecter

- **Commentaires et docs en français** ; identifiants en anglais. Commentaires « pourquoi », en tête de fichier pour les modules clés.
- Serveur : utilitaires transverses dans `server/utils` (auto-import) ; logique métier volumineuse dans `server/lib/**` (imports explicites).
  **Uniquement des imports de types** depuis `server/generated/prisma/client` (sinon problème `import.meta.url`) ; détecter P2002 via
  `isUniqueViolation`.
- Erreurs métier : helper par domaine (`userError`, `mediaError`, `projectError`) → `createError({ statusCode, statusMessage: CODE, data: { code, … } })`,
  codes déclarés dans `shared/utils/*.ts`, traduits côté client.
- Validation : schémas zod dans `shared/schemas/` (messages = clés i18n), `readValidatedBody` / `getValidatedQuery` côté serveur ;
  filtres de liste tolérants (`.catch()`).
- Documenter chaque endpoint en tête de fichier (méthode, chemin, entrée, statuts).
- UI : aucun texte en dur ; jetons de couleur ; composants `Ui*`/`App*`/`Admin*` ; accessibilité vérifiée à chaque page.
- Contrôle d'accès : toute route d'espace/média passe par `requireSpaceAccess` / `requireMediaAccess` ; toute règle de droits va dans
  le moteur pur `shared/utils/permissions.ts` **avec son test** (matrice de `tests/permissions.test.ts`).
- Quand une action fait disparaître l'élément qui avait le focus (ligne retirée, candidat ajouté), replacer le focus sur un titre
  (`tabindex="-1"`) et annoncer le résultat (`role=status`). Libellés `aria-label` de boutons : commencer par le texte visible (WCAG 2.5.3).
- Messages français : éviter les accords genrés sur les personnes (« {name} fait maintenant partie du projet ») ; pour les objets de genres
  différents (clé / jeton), dédoubler les clés (`credentials.status.key|token`) ou employer un nom (« Aucune utilisation »).
- Actions sensibles : `requireRecentPassword(event)` **avant** tout effet de bord ; côté client `useReauth().run()` et
  `if (isReauthCancelled(error)) return` dans le `catch` (aucun message).
- Toute action sensible réussie appelle `recordAudit` (action déclarée dans `shared/utils/audit.ts`, libellé `data.label`, jamais de secret),
  avec sa traduction `audit.actions.*` et, si utile, un cas dans `details()` de `pages/admin/audit.vue`.
- Dossiers : tout contrôle d'appartenance passe par `requireFolderInSpace` / `requireFolderAccess` ; les règles de forme dans
  `shared/utils/folders.ts` (avec leur test) ; toute écriture d'arbre incrémente la révision de l'espace.
- Accès de l'API v1 et de `/m/` : `principal.type`, `principalProjectScopes`, `browserGuard` (jamais `principal.credential.type` pour
  décider : pour un jeton délégué c'est l'émetteur). Corps d'écriture en `z.strictObject` ; fichiers via `withApiUpload`.
- Route de l'API v1 : `defineApiHandler` + `requireApiProject(event, principal, scope)` + `parseApiQuery`/`readApiBody` ; erreurs par
  `apiProblem(code, detail)` (code ajouté au catalogue `API_ERRORS` et documenté) ; réponse typée par un schéma de `shared/schemas/api.ts`
  (et ajoutée au registre OpenAPI si nouvelle).
- Transformations : tout nouveau paramètre passe par `shared/utils/transforms.ts` (analyse, bornes, forme canonique) **et**
  `transform-plan.ts` (opération effective, identifiant), avec leurs tests ; un dérivé n'est servi que par `resolveDeliverable`
  (garde-fous, dédoublonnage) ; jamais de format hors de l'extension.
- Préréglages et politique : toujours par `server/lib/transforms/service.ts` (invalidation des caches de l'installation et des projets) ;
  une nouvelle action journalisée = `AUDIT_ACTIONS` + catégorie si besoin + traduction + cas `details()`.
- Toute écriture de médias passe par le service médias (qui appelle `mediaChanged`) — jamais de `prisma.media.update` direct depuis une
  route, sinon caches de diffusion et ETag de liste deviennent faux.
- Valeur secrète à afficher une fois : `useFlash().set({ …, payload })` puis `AdminSecretPanel` sur la page suivante (disparaît au rechargement).
- Traitement des vidéos (D3) : tout nouveau code dans `server/lib/video-processing/` (jamais `server/lib/media/processing.ts`, file des
  images) ; **tous les arguments de ffmpeg et ffprobe construits dans `args.ts` seulement** (format d'entrée imposé, `-protocol_whitelist
  file`, chemins `file:` absolus), lancés par `runTool` (`run.ts`) ; règles de décision pures et testées (`plan.ts`, `deliveryHeld`,
  `videoSources`, `processing-view.ts`) ; toute écriture d'un résultat de tâche passe par le service médias, dans une transaction qui
  renouvelle d'abord le bail puis vérifie le fichier (`storageKey = sourceKey`, hors corbeille) ; transactions qui commencent par écrire ;
  l'ordre de `sources` ne se décide que dans `server/lib/media/sources.ts` ; messages de ffmpeg jamais renvoyés tels quels (codes +
  résumé sans chemin) ; textes de l'interface en `fr.json`/`en.json`, annonces seulement aux changements d'état.
- Après chaque étape : `pnpm typecheck`, `pnpm test`, `pnpm i18n:check`, `pnpm a11y:contrast` (si couleurs), `db:migration --check`, build de prod,
  audit axe fr/en × clair/sombre, **mise à jour de `setup.md`** (sections + Journal des étapes : ajouté, vérifié, limites, « après git pull »)
  et de ce fichier.
- Ne pas commiter sans demande (l'utilisateur commite lui-même entre les étapes) ; messages de commit avec
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` si demandé.

## 20. Vérification (outils et méthode)

- Commandes : `pnpm typecheck`, `pnpm test` (Vitest, **Node 24** : sous Node 22, `text-track.test.ts` échoue), `pnpm i18n:check`, `pnpm a11y:contrast`,
  `pnpm --filter @surge-media/core db:migration --check`, `pnpm build` puis `pnpm start` (config `core-start` de `.claude/launch.json`).
  Tests ffmpeg (`video-ffmpeg.test.ts`) : exécutés si ffmpeg **et** ffprobe répondent (`describe.skipIf`), sinon signalés « ignorés » ; AV1 si
  `libsvtav1`, limites `prlimit` sous Linux seulement ; le bloc `runTool : processus enfant borné` (priorité, arbre de processus, arrêt) est
  toujours ignoré sous Windows (`describe.skipIf(!posix)`) — la priorité `IDLE_PRIORITY_CLASS` se vérifie à la main ; les tests d'arrêt
  attendent `code: null` (sémantique POSIX), à vérifier sous Windows où `taskkill /F` donne probablement le code 1.
- Tests d'API faits jusqu'ici avec des scripts Node temporaires (fetch + FormData + cookie), rejoués en dev **et** en prod ;
  S3 testé contre `s3rver` (faux S3 local, `pnpm dlx s3rver@3.7.1 --port 4568 --configure-bucket surge-media`).
- Interface : navigateur intégré (pilotage par JS quand le panneau ne s'affiche pas), audits axe injectés depuis jsDelivr.
- Automatisé dans le dépôt depuis B1 : tests unitaires Vitest des modules purs (214 tests à l'étape 19, dont `mail` et `dashboard` : `tests/{permissions,signing,projects,credentials,api,openapi,delegated,processing,folders,transforms,image-transform}.test.ts` ;
  `image-transform` exécute le vrai pipeline sharp ; **526 tests en 27 fichiers depuis D3**, dont `video-ffmpeg` qui exécute le vrai ffmpeg,
  et des tests de routes Nitro appelées directement avec leurs globales simulées : `video-admin`, `video-routes`). Le reste (API, interface, axe) reste manuel
  (piste : tests d'intégration API + Playwright + @axe-core/playwright).
- Viewport du navigateur intégré : 1024 px (DPR 1,25) ; les mises en page à 5 colonnes doivent attendre `xl`.
- D3 (traitement des vidéos, session du nuage, Linux, ffmpeg 6.1.1) : **2026-10-09** `pnpm typecheck` vert, `pnpm test` **526 tests en
  27 fichiers** (Node 24), `pnpm i18n:check` 1528 clés / 1419 appels `t()`, `pnpm db:migration --check` vert (schéma inchangé depuis la
  migration de D3) ; aucune dépendance npm ajoutée. Essais réels (bases et stockages copiés, mode `embedded` en dev, build de production +
  `surge-media worker` en `external`) : HEVC, HEVC HLG → SDR, MKV → rendu + original en téléchargement, GoPro `gpmd` → 503 puis v2 sans
  piste, WebM réparé, remplacement / corbeille / restauration / duplication pendant un encodage, ffprobe retiré puis revenu, Ctrl+C,
  SIGTERM, plantage → reprise par le bail, 4 processus sur une même base SQLite (80 tâches, aucune double prise). Interface (module F) :
  Chromium de Playwright sur un serveur de dev en `embedded` avec ffmpeg réel — axe **0 violation** fr/en × clair/sombre × 375/1280 px, pas
  de défilement horizontal à 375 px, suivi toutes les 5,0 s (78 requêtes pour une tâche de 4 min) arrêté à la fin, pause onglet masqué,
  saisie conservée, focus, annonces, nouvel essai après ffmpeg tué, corbeille et restauration, extrait, dialogue de « Réglages » au clavier.
  Chaque module revu par des relecteurs indépendants avec vérification contradictoire : 13 défauts corrigés en phase B (modules A à C), 11 en
  phase C (module D), 7 dans le module E, 27 + 7 dans le module F. Détail : architecture, section « D3 — état de l'implémentation ».
- **Maintenance du 2026-10-10** (Windows 11, Node 24.20, ffmpeg 9.0.2) : `pnpm test` **539 tests en 28 fichiers** (9 ignorés : blocs
  POSIX), typecheck dans la copie isolée (erreur volontaire bien détectée), i18n 1536 clés. Méthode et scripts (bloc-notes de la
  session `37b39128`, non versionnés) : copie isolée lancée par une configuration temporaire `core-copy-3200` de `launch.json`
  (`start-copy.mjs` : `.env` de la copie, surcharges `server-env.json`, port de diagnostic 3299, profilage CPU à la demande par
  `profile.trigger`) ; `load.mjs` (générateur de charge multi-processus, connexions persistantes, journal des requêtes sans réponse),
  `load-setup.mjs` / `load-plan.mjs` (projet, clés, 40 photos, scénarios), `run-load.sh` + `sample.ps1` (processeur et mémoire du
  serveur), `profile-top.mjs` / `profile-callers.mjs` (lecture des profils), `lock-test.mjs` (verrou tenu 13 s), `d3-windows.mjs`
  (worker réel, Ctrl+C par `ctrlc.ps1`, consoles par `launch-console.ps1 -EnableCtrlC`), `ssr-crawl.mjs` (21 pages en SSR),
  `dash-check.mjs` ; scénarios d'avant copiés dans `scen/` avec chemins redirigés vers la copie (`d1-b3`, `d1-b5`, `d1-c3` : propriétaire
  MANAGER, téléversement en bibliothèque par l'ADMIN, marqués `[D1]`). Les scénarios C2 à C4 lancés juste après C1 dépassent la
  limite de 60 transformations libres par minute et par IP : les espacer d'une minute.
- D1 (vidéos) : `tests/video.test.ts` (30, fichiers fabriqués boîte par boîte + 3 enregistrements réels) ; `video-test.mjs [base]` (60
  scénarios, compte/projet/clé/jeton délégué jetables, nettoyage par identifiants) ; `keepalive-repro.mjs`, `v1-reset-repro.mjs`,
  `v1-socket-repro.mjs`, `h3-early-refusal-bench.mjs <h3 dist>`, `early-response-bench.mjs`, `request-timeout-bench.mjs` (diagnostics) ;
  `ui-account.mjs setup|cleanup [base]` + `ui-fixture-mov.mjs` (MOV HEVC privé pivoté avec lieu : tous les avertissements) ; axe fr/en ×
  clair/sombre sur médiathèque, fiche vidéo, tableau de bord. Base de référence avant D1 : 5 comptes, 30 audit, 4 médias, 6 dérivés ; un
  5e média (`18092026-dsc00532-1.jpg`, envoyé par l'utilisateur le 2026-10-05 à 17 h 48) et son aperçu sont à préserver.
- Correctifs du 2026-10-05 : `tests/http.test.ts` (11) ; `body-limit-test.mjs [base]` (8 contrôles : 413 annoncé et fragmenté, 401
  inchangé, 408 à 30 s) ; `upload-guard-test.mjs [base] [pid…]` (28 : 413 admin et v1 en RFC 9457, envois normaux, plages, 40 requêtes
  abandonnées avec `HandleCount` des processus du serveur de dev — `nuxt.mjs dev` et ses deux enfants —, envois bloqués admin et v1 en
  parallèle → 408 à 60 s, aucun dossier `surge-media-upload-*` restant, purge, base revenue à la référence) ; `ui-account.mjs
  setup|cleanup [base]` (ADMIN jetable, purge de ses médias) ; scénarios d1-roles, trusted-devices, d1-b2, d1-b4, d1-c2, dashboard
  rejoués sur le dev (copiés depuis le bloc-notes de la session 1f436366) ; build dans une copie isolée.
- Étape 18 (e-mails) : `mail-test.mjs <base SMTP> <base sans SMTP> <base SQLite>` (28 contrôles) contre une **copie isolée** de
  `apps/core` (robocopy sans node_modules/.nuxt/.output/data + jonction `node_modules` + base copiée par `VACUUM INTO`), lancée sur
  3200 par une configuration de lancement temporaire (`cwd` doit être dans le projet : `process.chdir` vers la copie dans le script),
  reliée à `smtp-sink.mjs` (faux SMTP 127.0.0.1:2525, messages dans `mails/`, destinataire « refuse » → 550) ; la même copie sert à une
  **build de production** sans toucher au `.nuxt` du serveur de l'utilisateur. Supprimer la jonction avant la copie (sinon
  `node_modules` réel en danger). Vite de la copie refuse une police hors de sa liste (sans effet sur l'API).
- Étape 17 (appareils de confiance) : `trusted-devices-test.mjs [base]` (37 contrôles ; pot à cookies multi-cookies, vieillissement de
  `Session.passwordVerifiedAt` en SQL pour dépasser la fenêtre de 10 min, action sensible = création d'un jeton personnel) ; interface avec
  `c3-ui-account.mjs` (session vieillie en SQL pour ouvrir le dialogue).
- Étape 16 (rôle Gestionnaire) : `d1-roles-test.mjs [base]` (79 contrôles : création de projets par rôle, invitations et refus,
  sudo, projet archivé, suivi, `INVITATION_ACCEPTED`, membres — plancher, plafond, `LAST_OWNER` effectif —, normalisation au
  changement de rôle, bibliothèque en lecture, suppression d'un gestionnaire → `invitedById` null) ; `d1-migration-test.mjs` (reprise
  rejouée sur une **copie** de la base) ; anciens scénarios rejoués via des copies `d1-<script>` où le propriétaire des projets de test
  est un MANAGER (attentes changées seulement là où la règle change, marquées `[D1]`) ; interface : `d1-ui-account.mjs setup|cleanup`
  (MANAGER + projet ; nettoie projets, invités, audit) et `c3-ui-account.mjs` (ADMIN) ; axe par navigation SPA
  (`$router.push` via `#__nuxt.__vue_app__`, axe reste chargé) ; panneau masqué → `innerWidth` 0 : mesurer le défilement après
  `resize_window` (mobile). L'action `computer wait` bloque quand le panneau ne s'affiche pas : attendre dans la page.
- Complément C4 (2026-10-03) : `c4-test.mjs` porté à 45 contrôles (zone, densité, zone hors image, image tournée, adresses 1x/2x/3x),
  rejoué sur `pnpm dev` (`node c4-test.mjs http://localhost:3000`) ; scripts d'interface paramétrables (`BASE=http://localhost:3000`) ;
  axe en dev : exclure `nuxt-devtools-frame` et `.nuxt-devtools-label` (violation `region` de l'outil Nuxt, absente en production).
- C4 : `c4-test.mjs` (39 contrôles : options de la fiche, aperçu dans chaque format et par préréglage, non-agrandissement,
  aucun `MediaVariant` créé, erreurs avec `param`, droits (EDITOR, non-membre, sans session), adresses dans les trois politiques et dans la
  bibliothèque — réglage rétabli —, lien privé servi, erreurs par lien, corbeille) ; interface : `c3-ui-account.mjs` + `c3-ui-fixture.mjs` ;
  C1 à C3 et B1 à B5 rejoués.
- C3 : `c3-test.mjs` (81 contrôles : contrat `Media` public/privé, gabarit rempli, point d'intérêt — pixel d'une bande rouge pour le
  recadrage, 302 des anciennes URL, dérivés supprimés, arrondi, même point, null, validation, corbeille, duplication —, liens unitaires dans
  les trois politiques avec chaque identifiant, signature permanente et cache immuable, autre format avec la même signature, lot avec
  erreurs par lien et 100 liens, OpenAPI et catalogue) ; `c3-ui-fixture.mjs create|delete` (projet et image d'essai) ; C1, C2 et B1 à B5
  rejoués.
- C2 : `c2-test.mjs` (58 contrôles : droits par rôle et niveau, validation, priorité et masquage, rendu modifié sous la même URL,
  politiques SIGNED/PRESETS avec chaque signature, bibliothèque, API v1 avec clé publique, OpenAPI, audit ; réglage de la bibliothèque
  rétabli) ; `ui-c2.mjs setup|cleanup` (compte ADMIN temporaire, projet, média ; préréglages globaux retrouvés par le journal) ; C1 et
  B1 à B5 rejoués.
- C1 : `c1-delivery-test.mjs` (66 contrôles HTTP sur la build de production : formats, 301/302, 400/404, ETag/304/HEAD/Range, EXIF,
  dérivés partagés, générations simultanées, signatures exactes/`derived`/permanentes/admin — calculées avec le secret de `.env`, jamais
  affiché —, corbeille, remplacement, quota, débit ; projet jetable purgé) ; B1 à B5 rejoués (contrôle B4 de l'aperçu adapté au nouvel
  identifiant `v1/[size_…,]q_72.webp`).
- Étape 10 : `apidocs-test.mjs setup|check|cleanup` (comptes DEVELOPER/EDITOR jetables, projet, clés publique/secrète, média ; 28 contrôles
  sur le serveur de dev ; nettoyage audit + `CacheRevision`), tests d'interface (requête d'essai réelle, réseau 100 % même origine, axe ×4) ;
  `tests/openapi.test.ts` (120 tests Vitest au total).
- B5 : `b5-api-test.mjs` (71 contrôles : administration et API v1 des dossiers, limite de 1 000 insérée en SQL, jeton délégué à dossier
  imposé ; nettoyage) ; `ui-b5.mjs setup|cleanup` (compte ADMIN, projet, dossiers, médias) ; B1 à B4 rejoués.
- B4 : `b4-api-test.mjs` (94 contrôles : écritures, duplication, jetons délégués — jetons expirés fabriqués avec le secret de `.env`, jamais
  affiché —, débit des envois ; nettoyage audit/révisions/`DelegatedTokenUsage`) ; `b4-busy-test.mjs` (serveur temporaire sur 3101 avec
  `NUXT_MEDIA_PROCESSING_CONCURRENCY=1`, `_QUEUE=0` : 503 puis succès ; configuration de lancement retirée ensuite) ; `ui-b4.mjs setup|cleanup`
  (compte ADMIN, projet, envoi par jeton délégué pour la fiche média et le journal). B1, B2, B3 rejoués.
- B3 : `b3-api-test.mjs` (97 contrôles sur la build de production, jetons inconnus bien formés, désactivation/réactivation d'un compte,
  nettoyage de l'audit et des `CacheRevision` de test) ; B1 et B2 rejoués.
- B2 : scripts `b2-api-test.mjs` (91 contrôles, comptes jetables, nettoyage des entrées d'audit de test par identifiants) et
  `b1-api-test.mjs` rejoués sur la build de production lancée par `core-start-3100` (un `nuxt dev` de l'utilisateur occupait le port 3000 ;
  ne pas l'arrêter). Tests d'interface avec un compte ADMIN temporaire (mot de passe généré, supprimé ensuite).

## 21. État d'avancement et suite

**Fait** : monorepo, CLI de base de données, schéma et migrations 3 fournisseurs, health ; UI (thèmes, i18n, a11y), auth hybride, rôles,
amorçage ; gestion des utilisateurs avec liens d'invitation/réinitialisation ; médias phase A (stockage local/S3, envoi, diffusion
publique/privée/signée, aperçus, remplacement versionné, corbeille, écrans) ; **B1** (espaces bibliothèque/projets, rôles de projet
et portées, projets et membres, duplication/déplacement, diffusion sans cookie + liens v2, `NUXT_SITE_URL`/`NUXT_MEDIA_PUBLIC_URL`, Vitest) ;
**B2** (clés publiques/secrètes par environnement avec rotation, jetons personnels, origines CORS, mode sudo, journal d'audit + écran) ;
**B3** (API publique v1 en lecture, caches et révisions, recherche normalisée, Bearer et Range sur `/m/`, OpenAPI, SQLite WAL) ;
**B4** (API v1 en écriture, jetons délégués, provenance des médias, file bornée des traitements, pré-génération des aperçus) ;
**B5** (dossiers : arborescence par espace, navigation, rangement groupé, API v1 et contrainte des jetons délégués) ; étape 10
(documentation interactive de l'API) ; **C1** (transformations à la demande : grammaire, forme canonique, opération effective, diffusion,
garde-fous, signatures de transformation et permanentes) ; **C2** (politique des transformations, préréglages globaux et de projet,
page « Réglages », onglet « Transformations », API v1 `presets`) ; **C3** (`urlTemplate`, `focalPoint` et nouvelle version, liens signés
de transformation et de préréglage, lot `signed-urls`, OpenAPI, point d'intérêt dans la fiche média) ; **C4** (générateur d'adresses :
aperçu à la volée, adresses signées si nécessaire, extraits HTML). **Phase C terminée.** **Étape 16** : rôle Gestionnaire (invitations,
administration limitée à ses projets, bibliothèque gérée par l'ADMIN). Étapes 17 à 19 (appareils de confiance, e-mails, tableau de bord).
**Phase D (vidéos)** : **D1** (envoi, stockage, diffusion directe, § 9.21), **D2** (préparation, affiche, sous-titres, § 9.22), **D3 terminée
le 2026-10-09** (traitement par ffmpeg hors du chemin des requêtes : file persistante, processus de travail, rendus, retrait des pistes GPS,
réparation des WebM, affiche du serveur, formats convertis, `sources[]` / `processing`, interface ; § 9.23).

**Licence et distribution (2026-10-10)** : licence **BSL 1.1** (`LICENSE`, seuil 500 000 USD, nom du concédant et contact encore à
compléter) ; README npm du core en anglais ; **étape 23 : image Docker** unique pour les trois bases (un client Prisma par fournisseur
dans chaque build), variantes complète et `slim`, Compose SQLite et PostgreSQL + processus de travail (`setup.md` § 12.2) ; **étape 24 :
versions et publication** — paquet npm utilisable (modules natifs installés chez l'utilisateur, CLI `start`, dossier de l'installation),
image construite depuis ce paquet, ESLint, commitlint, `pnpm release` (release-it), workflows CI et Release (npm + GHCR) (`setup.md` § 15).
**Suite** : première release (configuration npm/GitHub du § 15.4, puis `pnpm release 0.1.0`), puis D4 à proposer.
**Étape 25** (2026-10-15) : site public et documentation `apps/website` (Astro Starlight). **Phase E** (bibliothèques front) :
étude validée le 2026-10-15 (`.claude/architecture-phase-e.md`, ED1 à ED28) ; **E1 faite** le 2026-10-15 (étape 26 : espaces
`packages/client` et `packages/vue`, client HTTP et constructeurs d'URL, `SmImage`, `SmPicture`, `SmVideo`, `SmMedia`, `SmThumbnail`,
`SmProcessingStatus`, bac à sable, formats activés dans l'API v1 ; § 9.25) ; **E2 faite** le 2026-10-17 (étape 27 : règles d'envoi dans `/me`,
membres d'extension des problèmes d'envoi, affiche posée avec `media:upload`, file d'envoi et entrée `@surge-media/client/server`,
`SmUploader` ; § 9.26). **Ensuite E3 (parcours et sélection)**, à détailler et faire valider.

**Section vide** : aucune (la section « à venir » des jetons a été remplacée en B2).

### 9.22 Vidéos : préparation, image d'affiche, sous-titres (phase D2, étape 21)

Architecture validée : `.claude/architecture-phase-d.md` § 17 à § 27 (DD15–DD24 ; ajout de l'utilisateur : retirer aussi l'appareil). Référence
d'exploitation : `setup.md` § 7.7.

- **Préparation** (`video/prepare.ts`, `prepareVideo(source, mime, options)` → `prepared` | `unchanged` | `skipped`) : boîtes de premier niveau
  lues, `moov` en mémoire (≤ 64 Mio, lu par blocs de 1 Mio), arbre des conteneurs (`moov trak mdia minf stbl dinf udta edts mvex meta ilst`,
  `meta` ISO avec version ou QuickTime sans), filtres par **liste de ce qui est conservé** : premier niveau `ftyp moov mdat` (+ bourrage
  `free/skip/wide` gardé si rien d'autre ne change) ; `udta` : `name kind tsel chpl ©nam ©des ©cmt cprt ©cpy titl dscp` ; clés `mdta` :
  `com.apple.quicktime.{title,description,comment,copyright}` (éléments `ilst` renumérotés) ; `ilst` iTunes : `©nam desc ©des ldes ©cmt cprt` ;
  `uuid` retirées. Refus (`skipped`) : fragmenté (`moof`/`mvex`), plusieurs `moov`, `cmov`, `rmra`, `saio`, `dref` non autonome, décalage
  hors `mdat`. Décalages `stco`/`co64` : même position dans le `mdat` déplacé. **Vérification** : sortie virtuelle (`plannedSource`)
  réanalysée (`probeIsoBmff` + `probeVideo` : pistes, durées, dimensions, codecs identiques ; index en tête et plus de lieu si demandés) et
  32 octets comparés pour 8 blocs. Écriture : `preparedStream` (morceaux) → `storage.put` avec SHA-256 au fil de l'eau et contrôle du nombre
  d'octets. Le gestionnaire vidéo expose `prepare` (`PreparedMedia` : `inspected` + `file`), `service.ts` l'appelle dans `storeOriginal` ;
  `metadata.prepared` (`[]` = examiné, null/absent = jamais) ; `checksum`/`size` = fichier stocké. `prepareStoredMedia` (« Optimiser ») :
  copie temporaire (`temporaryCopy`), puis chemin d'un remplacement (`commitNewFile`) ou simple marquage `prepared: []`.
- **WebM** : `lastClusterEnd(tail)` (pur) + `estimatedDuration` (1, 4 puis 16 Mio de fin de fichier, à partir du début du premier
  `Cluster`) → `durationEstimated`. **Détection du lieu** : aussi XMP (`udta/XMP_`, `uuid` de premier niveau, parcours de 64 boîtes après
  `moov`+`mdat` hors fichiers fragmentés).
- **Affiche** : `setMediaPoster` / `removeMediaPoster` (`service.ts`) — image analysée et `normalizePoster` (sharp : orientation, ≤ 3840 px,
  aplatie sur noir, JPEG 90 mozjpeg) dans la file ; première affiche sans nouvelle version, sinon `version + 1` + `deleteVersionVariants` +
  ancien fichier supprimé ; retrait efface aussi le point d'intérêt ; `posterTimeField` (0 ≤ t ≤ durée + 1 s). `variants.ts` : `derivedSource`
  (image : original ; vidéo : affiche via `imageHandler.transform`, ETag tiré de `posterKey`), `hasDerivedFiles` vrai pour une vidéo avec
  affiche. URL : `posterPath` = préréglage `full` en JPEG. Duplication : `copyPoster`.
- **Pistes** : `text-track.ts` (décodage UTF-8/UTF-16/Windows-1252, VTT : en-tête, NOTE retirés, STYLE/REGION avant la première réplique,
  réglages filtrés ; SRT : numéros, virgules, i/b/u gardés, font et ASS retirés, `& < >` échappés ; limites 1 Mio, 20 000 répliques,
  2 000 caractères ; `TextTrackError(line)`) ; `tracks.ts` (transactions Prisma : une piste par défaut par groupe, `Media.updatedAt`
  touché ; remplacement = nouvelle piste ; `copyTextTracks`) ; `MEDIA_INCLUDE` et `API_MEDIA_INCLUDE` chargent `textTracks` (ordre d'ajout).
  Diffusion : `delivery-path.ts` (cible `track`, segment `tracks` réservé), `signing.ts` (`track:<id>` : ni `derived`, ni permanent ; `admin`
  oui), `resolveTrackDeliverable`. Réception : `receiveSmallUpload` (mémoire, busboy).
- **Contrats** : admin `MediaSummary.poster` (`url`, dimensions, `time`), `MediaDetail.textTracks` (URL signées « admin » si besoin),
  `GET [id]` → `publicPosterUrl`, `publicTrackUrls` ; `POST [id]/signed-url` → aussi `posterUrl` et `tracks` à la même échéance ;
  `config/media` → `videoPreparation`. v1 : `Media.poster`, `Media.textTracks`, `TextTrack`, routes `…/poster` et `…/tracks` (hors `maxFiles` et
  `types` d'un jeton délégué), cible `track` (+ `trackId`) des liens signés, erreurs `TRACK_NOT_FOUND`, `TRACK_LIMIT_REACHED`, `INVALID_TEXT_TRACK`.
- **Interface** : fiche (lecteur avec `poster` et `<track>`, section « Image d'affiche » — capture de l'image affichée, envoi, retrait —,
  `AdminTextTracksPanel`, bloc « Optimiser la vidéo », ligne « Préparation », durée « (estimée) », avertissements `device`, `captions`,
  `estimated` ; focus déplacé sur le message de résultat quand le bouton disparaît), `AdminMediaUploader` (capture d'affiche pendant l'envoi
  d'une vidéo, création seulement), `AdminMediaCard` (pastille `Play` sur la vignette d'une vidéo), extrait `videoSnippet` (`poster`, `tracks`,
  `crossorigin`). i18n : 1331 clés.
- **Écarts à la proposition** : métadonnées de l'appareil retirées (ajout de l'utilisateur) par liste de ce qui est conservé ; bourrage gardé
  quand rien d'autre ne change ; correctif `deletePrefix` du stockage local (les dérivés des anciennes versions n'étaient jamais supprimés).

### 9.23 Vidéos : traitement par ffmpeg (phase D3, étape 22)

Architecture validée le 2026-10-06 : `.claude/architecture-phase-d.md` § 28 à § 42 (DD25–DD36 ; choix délégués par l'utilisateur : DD28 tel
que proposé, DD31 avec retenue de la diffusion, DD32 liste complète) ; **état final, écarts, vérifications et limites** : section « D3 — état
de l'implémentation » du même document ; contrats entre modules : `.claude/d3-implementation-notes.md`. Référence d'exploitation : `setup.md`
étape 22 et § 7.7. Migration `d3_video_processing`. **Aucune dépendance npm** : ffmpeg ≥ 6 et ffprobe du **système**, facultatifs (mode `off`
par défaut = comportement de D2). Faite le 2026-10-09.

- **Modes et rôles** (`video-processing/settings.ts` : `resolveVideoProcessingSettings` pur, valeur invalide → défaut + avertissement ;
  `useVideoProcessingSettings` lu une fois, changement = redémarrage) : `NUXT_VIDEO_PROCESSING` = `off` (aucune tâche, `processingState`
  reste null, formats convertis refusés) | `embedded` (le serveur web exécute les tâches) | `external` (des processus de travail les
  exécutent, le serveur web ne fait que les créer). **Processus de travail** = même build lancé avec `NUXT_SERVER_ROLE=worker` (ou
  `surge-media worker [--port 3001]`, § 15) : ne sert que `/api/health` (`middleware/0.server-role.ts` : 404 texte brut ; fichiers statiques
  servis avant par Nitro), plugins `bootstrap-admin`, `site-url`, `search-backfill`, `variant-keys`, `delegated-usage` inactifs ; sur une
  autre machine : PostgreSQL/MySQL et stockage partagés (SQLite : même machine seulement).
- **Démarrage** (`plugins/0.video-processing.ts`, nommé « 0. » pour que son crochet `close` passe avant la déconnexion de Prisma) : `off`
  → rien (avertissement si rôle worker) ; web en `external` → rien ; sinon superviseur (`superviseJobRunner`, `runner.ts`) : détection
  (`ffmpeg.ts`, `detectFfmpeg` ne lève jamais : ≥ 6, `libx264`, `aac`, ffprobe exigés ; `zscale` + `tonemap` → HDR ; `libsvtav1` + `libopus`
  → AV1 ; échec → traitement désactivé avec message, jamais l'arrêt du serveur), préparation (worker : stockage partagé vérifié sur les 3
  derniers originaux ; en dev, `expireDeadHolderLeases` ; dossiers temporaires abandonnés supprimés ; rattrapage), boucle. Base indisponible
  → nouvel essai après 5 s, délai doublé jusqu'à 60 s ; ffmpeg devenu inutilisable en route (`RunnerHalt`) → boucle arrêtée, détection refaite chaque minute.
- **Actif** (`status.ts`, `videoProcessingActive()`, cache 30 s, 5 s après une erreur de lecture) : `embedded` = ffmpeg utilisable et boucle
  non arrêtée ; `external` = une présence de worker sans `halted` vue depuis moins de 5 min (`WORKER_SEEN_WINDOW_MS`). Actif → tâches créées
  à l'envoi, formats convertis acceptés, « Relancer » et « Traiter les vidéos existantes » permis (sinon 409 `PROCESSING_DISABLED`).
  `setVideoProcessingStopped` : **`halted`** (arrêtée en route, redétection chaque minute ; seul cas où l'API dit `halted: true`) ≠
  **`disabled`** (inutilisable dès le démarrage, ou stockage non partagé : corriger, puis redémarrer).
- **File** (`jobs.ts`, magasin injecté `JobStore` testé en mémoire ; constantes de `shared/utils/video-processing.ts`) : une `MediaJob` par
  **fichier** (`sourceKey`), créée **dans la même transaction** que l'écriture qui la motive (création imbriquée de `createMedia`,
  `commitFile` pour remplacement et « Optimiser », `restoreMedia`, `requestProcessing`, `backfillProcessing`, `copyProcessing` après la
  copie des rendus d'une duplication). **Prise** atomique portable sans `SKIP LOCKED`
  (lots de 5 tâches QUEUED prêtes, priorité desc puis ancienneté, `updateMany({ id, status: 'QUEUED' })`, compte 0 = prise ailleurs) + média
  PROCESSING dans la même transaction (fichier changé → tâche annulée sans calcul). **Bail** 2 min, **battement** 30 s (`renewLease`
  conditionné à `id`, `lockedBy`, `RUNNING` ; compte 0 = annulée ou reprise → signal d'arrêt, ffmpeg tué, rien écrit) ; avancement écrit au
  plus toutes les 5 s (tâche seule, sans `mediaChanged`). **Essais** : erreur passagère (délai, ffmpeg tué par un signal, disque plein,
  E/S, base ou stockage) → nouvel essai après 30 s puis 5 min (`retryDelay`), 3 essais, puis FAILED ; erreur déterministe (`NO_VIDEO_TRACK`,
  `UNREADABLE`, `TOO_LONG`, `SOURCE_MISSING`, sortie refusée par la vérification) → FAILED aussitôt ; `FFMPEG_UNAVAILABLE` → tâche rendue sans
  essai (`releaseJob`), boucle arrêtée. Arrêt propre (`close` : SIGTERM, rechargement de dev) → tâche rendue sans essai, ffmpeg tué,
  dossier supprimé (`stop` résout toujours). Entretien toutes les 30 s : baux échus (`reapExpiredLeases` : +1 essai ou FAILED), dossiers
  abandonnés (15 min), **rattrapage** toutes les 5 min (`catchUpJobs` : média PENDING/PROCESSING sans tâche active → nouvelle tâche ; deux
  rattrapages simultanés → la plus ancienne gardée). **Priorités** : 0 envoi, **10** vidéo à piste de données (`HELD_PRIORITY`,
  `jobPriority`), −10 vidéos existantes (`BACKFILL_PRIORITY`). Runner : `NUXT_VIDEO_CONCURRENCY` tâches, recherche toutes les 5 s file
  vide, réveil immédiat en `embedded` (`notifyJobQueued` après l'écriture). **Présence** d'un worker (`Setting` `videoWorker:<id>` : hôte,
  pid, version, encodeurs, concurrence, `halted`) toutes les 60 s, effacée à l'arrêt propre, purgée après 1 jour ; identifiant
  `<hôte>:<pid>:<aléa>` ≤ 179 car. (`worker-id.ts` ; l'aléa distingue les rechargements de dev et les conteneurs de pid 1). Transactions
  courtes **qui commencent par écrire** et sans exception volontaire après une écriture (SQLite partagé : délai d'attente 10 s,
  `JOB_TRANSACTION` : attente 10 s, délai 20 s).
- **États** (`Media.processingState`) : null (image, traitement inactif à l'envoi, fichier remplacé pendant l'inactivité) → PENDING (créée
  ou remise en file) → PROCESSING (prise) → READY | FAILED ; écrits dans la transaction de la tâche, seulement si `storageKey = sourceKey` et
  hors corbeille, puis `mediaChanged`. Corbeille : tâches actives CANCELLED, état gardé ; restauration : nouvelle tâche si actif et état ≠
  READY (inactif : PROCESSING → PENDING, repris par le rattrapage) ; duplication : rendus copiés (`storage.copy`), état repris (READY complet
  sans calcul, sinon tâche propre si actif, sans refaire les rendus copiés) ; un format converti reçoit toujours sa tâche (`processesFile`).
- **Pipeline** (`pipeline.ts`) : validité (média présent, hors corbeille, fichier = `sourceKey`) ; source lue en place (stockage local,
  `localPath`) ou copiée dans le dossier de la tâche (`surge-media-job-<installation>-<tâche>-<aléa>`, installation = empreinte du dossier de
  lancement et de `DATABASE_URL`) ; `probe` (ffprobe JSON) → `applyProbeResult` (format converti : dimensions, durée, codecs, son, rotation,
  débit, HDR, **sans nouvelle version** ; MP4/MOV/WebM : courbe HDR seulement) → `planVideoJob` → étapes `sanitize`, `repair`, `transcode`,
  `av1`, `poster` dans cet ordre, chaque sortie **vérifiée par le lecteur de D1** (`probeVideoFile` : codec, dimensions du plan, son, durée ±
  0,5 s ou 2 % — 2 s ou 10 % si estimée —, taille ≤ 2 Gio − 1 ; sinon `CONVERSION_FAILED`) → READY (avertissements dans `result`) ou FAILED
  (`errorCode`, `errorDetail` ≤ 191 car. sans chemin). Délais (`run.ts`) : analyse 60 s, affiche 120 s par instant essayé, copie sans
  réencodage (`sanitize`, `repair`) 10 min, encodage 10 × durée + 120 s (24 h au plus ; durée inconnue → `maxDuration`), sortie arrêtée
  au-delà de `maxDuration` + 10 s de vidéo écrite.
- **Plan** (`plan.ts`, pur) : sans flux vidéo → `NO_VIDEO_TRACK` ; dimensions hors 1–16 384 → `UNREADABLE` ; `sanitize` = MP4/MOV avec
  pistes de données (ffprobe ou `metadata.dataTracks`) ; `repair` = WebM sans durée aux codecs copiables en WebM (VP8/VP9/AV1 + Opus/Vorbis,
  `webmCopyable`) ; **rendu utile** = format converti **toujours** (même `never`), sinon `always` oui, `never` non, `auto` si lecture ≠
  `broad`, petit côté > 1080, débit > 10 Mbit/s, HDR ou images entrelacées ; `transcode` si utile et H.264 pas déjà fait par cette tâche
  (`existing` = `result.renditions` ; une relance refait tout) ; `av1` si utile + `NUXT_VIDEO_AV1` + encodeurs ; `poster` si aucune affiche ;
  durée > `maxDuration` et réencodage utile → réencodages retirés, autres étapes faites puis `TOO_LONG` sans nouvel essai (sans
  réencodage utile : READY) ; `toneMap` si HDR + filtres (avertissement `hdr_converted` / `hdr_unconverted` seulement avec un
  réencodage) ; cible `scaledDimensions` (petit côté ≤ 1080, paire, jamais agrandie).
- **Rendus** (`MediaRendition`, `RENDITION_NAMES` = `av1`, `h264`, ordre de `sources`) : clé `renditionKey` **indépendante de la version** ;
  URL `/m/<id>/v<version courante>/renditions/h264.mp4|av1.webm` (`renditionPath`, segment `renditions` réservé, autre nom → 404) ; règles
  de l'original (droit signé `file` — jamais `derived` ni permanent, `admin` oui —, `Range`, ETag = 32 hex de l'empreinte du rendu, cache
  immuable public, Bearer, corbeille → 404) ; ancienne version → 302 vers le rendu courant, sinon l'original ; rendu inconnu du cache →
  relecture en base (≤ 1 par seconde et par média) puis 404 ; `Content-Disposition: inline` au nom du média + extension du rendu. Rendu **créé** : même
  version ; rendu **remplacé** (relance) : version + 1, dérivés de l'ancienne version et ancien fichier supprimés. Supprimés quand le fichier
  change (lignes dans la transaction de `commitFile`, fichiers après) et à la purge. H.264 : MP4 « faststart », High 8 bits 4:2:0, CRF et
  préréglage réglables, petit côté ≤ 1080, `-fpsmax 60`, image clé toutes les 2 s, désentrelacement `bwdif` image par image, rotation
  appliquée, HDR → SDR BT.709 (`zscale` + `tonemap` hable), AAC 128 kbit/s stéréo 48 kHz ou sans son, aucune métadonnée d'origine. AV1 :
  WebM SVT-AV1 préréglage 10, CRF 35, Opus 96 kbit/s.
- **Réécritures sans perte** (DD28) : `sanitize` (copie de la vidéo principale et des sons seulement ; pistes `gpmd`, `camm`, `mebx`,
  `djmd`, `dbgi`, `mett`, `rtmd` ou gestionnaires `meta`/`camm`/`data`, détectées dès l'envoi par le lecteur de D1) et `repair` (copie en
  WebM : durée et `Cues` écrites) → `commitRewrittenFile` = chemin d'« Optimiser » (réanalyse D1, préparation de D2, **nouvelle version**,
  anciennes URL → 302, ancien original supprimé), `hdr` et `rewrites` (`dataTracks`, `webmIndex`) fusionnés dans `metadata` ; la tâche
  **continue** sur le nouveau fichier (`sourceKey` mis à jour dans la transaction, option `carry` de `commitFile`) ; version changée sans
  nouveau fichier (affiche, point d'intérêt) → relue, 3 essais.
- **Affiche du serveur** (DD30) : seulement si `posterKey` null ; instants `posterTimes` (10 % de la durée, 5 s au plus, puis + 1 s, + 2 s,
  ≤ 90 %), image de luminance moyenne < 16 (sharp `stats`) écartée ; extraite du rendu H.264 produit par cet essai (SDR), sinon de la
  source (conversion des couleurs si HDR) ; `normalizePoster` dans la file des images (5 essais si `SERVER_BUSY`) ; écriture conditionnelle (`posterKey` null, même
  fichier, hors corbeille) **sans nouvelle version** ; affiche choisie entre-temps par l'utilisateur → la nôtre supprimée ; échec =
  avertissement `poster_failed`, jamais un échec de tâche.
- **Formats convertis** (DD32, `CONVERTED_VIDEO_TYPES` : `video/x-matroska` mkv, `video/x-msvideo` avi, `video/3gpp` 3gp, `video/3gpp2` 3g2,
  `video/mp2t` ts — `.mts`/`.m2ts` compris —, `video/ogg` ogv, `video/x-ms-wmv` wmv) : limite des vidéos ; à l'envoi, pas d'analyse D1
  (`width`/`height`/`duration` null, métadonnées d'ébauche `playback: 'none'`, codecs null) ; format d'entrée **imposé** à ffmpeg
  (`INPUT_FORMATS` : mp4/mov/3gp → `mov`, webm/mkv → `matroska`, `avi`, ts → `mpegts`, ogv → `ogg`, wmv → `asf`) ; original servi en
  `Content-Disposition: attachment` (`originalDisposition`) ; `sources` vide tant que le rendu H.264 n'existe pas. FLV, MPEG-PS, RealMedia :
  jamais.
- **Retenue 503** (DD31, `deliveryHeld` pur + `holdApplies`) : vidéo à `metadata.dataTracks` non vide, état PENDING ou PROCESSING, mode ≠
  `off` → original et rendus répondent **503 `PROCESSING_PENDING`** (`Retry-After: 30`, `no-store`, CORS `*`, `Retry-After` exposé), après le
  contrôle d'accès et avant le 304, pour **tout accès sauf le lien « admin »** (adresse publique, lien signé, Bearer) ; affiche, dérivés et
  pistes jamais retenus ; levée par la réécriture, l'échec définitif ou le mode `off`. `adminMediaPaths` signe « admin » l'original et les
  rendus d'une vidéo publique retenue. Mode `off` : avertissement seulement.
- **Contrats v1** (ajouts seulement) : `Media.sources: MediaSource[]` (`{ url, type, width, height, bitrate, size, rendition: 'av1' | 'h264' |
  null }`, `videoSources` de `media/sources.ts`, **seul juge de l'ordre** : rendus AV1 puis H.264 ; sans H.264, l'original s'il est lisible —
  en dernier recours après un AV1 seul — ; `[]` pour une image ou un format converti sans rendu ; MOV annoncé `video/mp4` ; même signature
  `file` que `url`) ; `Media.processing: { status: pending | processing | ready | failed, progress (0–1, seulement tâche RUNNING), error (code
  connu, seulement FAILED), updatedAt } | null`, jamais `errorDetail` ; `signed-url` / `signed-urls` cible `file` d'une vidéo → `sources`
  signées à la même échéance ; `upload.types` des jetons délégués accepte les types convertis. **ETag** du détail
  `W/"<id>-<version>-<updatedAt ms>[-<état>.<id de la tâche>.<updatedAt ms de la tâche>][-<échéance>]"` (suit l'avancement, et chaque
  battement de 30 s ; échéance pour un média privé) ; **liste** : 304 sans
  requête par la révision, mais une page qui contient une vidéo PENDING/PROCESSING reçoit un ETag qui inclut ses tâches
  (`activeProcessingParts`), jamais égal à celui de la révision seule (relue à chaque revalidation). OpenAPI : composants `MediaSource`,
  `MediaProcessing`, section « Vidéos » réécrite fr/en, `PROCESSING_PENDING` dans les erreurs de `/m/` ; `PROCESSING_DISABLED` hors
  `API_ERRORS` (aucune route v1 ne le renvoie).
- **Contrats admin** : `MediaSummary.processingState` (majuscules) ; `MediaDetail.processing` (`mediaProcessingDetail` : null si
  `processingState` null ; sinon dernière tâche `{ status, step, progress, attempts, errorCode, errorDetail, warnings, createdAt, startedAt,
  finishedAt, runAfter, updatedAt }`, **`status` = statut de la tâche** QUEUED…CANCELLED — l'état du média est `processingState`),
  `renditions[]` (`name, container, mimeType, codecs, width, height, duration, bitrate, size, url`), `sources[]` (liens « admin » si privé, en
  corbeille ou retenu). **Dernière tâche** (`LATEST_JOB`, `PROCESSING_INCLUDE` de `sources.ts`) : `finishedAt` null d'abord, puis `finishedAt`
  desc, `createdAt` desc, `id` desc. Listes : `MEDIA_LIST_INCLUDE` léger (ni pistes, ni rendus, ni tâches).
- **Routes** (§ 10) : `POST /api/admin/media/:id/process` (« Traiter » / « Relancer », `media:write`, non journalisé) ; `GET
  /api/admin/media/:id/processing` (suivi léger, `media:read`, `no-store`) ; `GET /api/admin/video-processing` et `POST …/backfill`
  (`settings:manage`, audit `media.processing_backfill` `{ count[, partial] }` dès qu'une tâche est créée, même si une erreur interrompt la
  boucle) ; `GET [id]` → `publicSources` ; `POST [id]/signed-url` → `sources` ; `config/media` → `acceptedTypes` dynamique + `videoProcessing` ;
  `/api/health` → `videoProcessing { mode, workers, queued }` hors `checks` (null en `off` ou base en échec ; `workers` = présences actives +
  1 pour un serveur `embedded` dont la boucle tourne ; jamais d'effet sur le statut, ni hôte ni version).
- **Interface** : `AdminProcessingStateBadge` (`media.processing.states.*`, icône fixe : sablier, roue, coche, triangle ; échec en
  « avertissement », la vidéo restant servie) sur `AdminMediaCard` (PENDING/PROCESSING hors corbeille, FAILED partout, rien pour READY) et
  dans la fiche. `AdminVideoProcessingPanel` (section « Traitement » si état connu, rendus, ou traitement actif + `media:write` hors
  corbeille) : étape, `<progress max="1">` nommé par l'étape + pourcentage écrit (jamais indéterminé), « Essai n sur 3 » (FAILED : seulement
  « 3 sur 3 », `displayedAttempt`), dates (« Interrompu le » pour une tâche annulée par la corbeille), « Prochain essai au plus tôt », erreur
  traduite + détail technique découpé en parties `lang` fr/en (`failureDetailParts` ; masqué pour `NO_VIDEO_TRACK` et `SOURCE_MISSING`),
  remarques (HDR montré au-dessus du lecteur, `poster_failed` masqué avec une affiche), « Versions compatibles » (format, définition,
  débit, taille, téléchargement), « Traiter la vidéo » / « Relancer le traitement » (`aria-disabled` + « Demande en cours… », focus sur le
  message de résultat), annonces `role="status"` aux seules transitions (`processingTransition` : début, fin, échec, nouvel essai, remise en
  file sans échec ; rien pour une nouvelle tâche ni autour de la corbeille). **Suivi** (`useProcessingPoll`) : `GET …/processing` toutes les
  5 s, navigateur seulement, tant que PENDING/PROCESSING hors corbeille (`processingLive`), une requête à la fois, pause onglet masqué, arrêt
  sur 403/404 ; champs de tâche fusionnés sans rechargement ; rechargement complet (`$api`, page gardée en cas d'échec) seulement si la
  version change, si la tâche se termine (état READY, FAILED ou null), si elle a été annulée ailleurs, ou une fois quand la même tâche
  dépasse `transcode` sans H.264 affiché (`processingNeedsReload`) ; les passages PENDING ↔ PROCESSING ne font que reporter l'état et la
  tâche ; formulaire suivi sur l'id et les valeurs du serveur (saisie conservée). **Lecteur** : `<source>` dans l'ordre
  de `sources`, recréé seulement si leurs adresses changent, changement reporté pendant la lecture ou le focus puis repris au même instant ;
  sans source, cadre 16:9 au même emplacement + « Télécharger l'original » (« Cette vidéo sera lisible ici dès que sa version
  compatible sera prête. » pendant le traitement) ; lien temporaire abandonné seulement si la version ou les rendus changent
  (message poli) ; focus replacé si l'élément focalisé disparaît. **Avertissements** : `compatPending` (au lieu de `variable` : traitement
  actif, `rendition` ≠ `never`, durée ≤ max), `variable` masqué avec un H.264, `dataTracks` (`held` / `heldPrivate` d'après `deliveryHeld`,
  `failed`, exposé), `hdr` / `hdrUnconverted` (H.264 présent et dernière tâche DONE), `converting` / `convertFailed` ; « Optimiser » masqué
  pendant un traitement ; extrait `videoSnippet({ sources })` (`publicSources` ou `link.sources`), remplacé par une explication si la liste
  est vide. **Réglages** (`AdminVideoProcessingSettings`, section « Traitement des vidéos ») : lecture seule (état Actif / Désactivé / Arrêté
  / Inactif, mode, ffmpeg, encodage, processus de travail, tâches par statut), bouton « Actualiser l'état », aucun rafraîchissement automatique ;
  « Traiter les vidéos existantes » : nombre, durée totale, estimation « jusqu'à environ » = n × 1 s + durée × coût ÷ (fils × tâches en
  parallèle), coût = 2 × facteur du préréglage (veryfast 1, medium 1,9) + 3 si AV1, 0 en `never` ; dialogue `UiDialog`, focus sur le titre de
  la section après succès, bouton désactivé avec sa raison visible. **Envoi** : ligne `media.upload.converted` et extensions
  `.mkv,.avi,.3gp,.3g2,.ts,.mts,.m2ts,.ogv,.wmv` dans `accept` seulement si actif ; alias de types Windows (`video/vnd.dlna.mpeg-tts`,
  `video/avi`, `video/msvideo`, `video/x-ms-asf`). **Journal** : « n vidéos ajoutées à la file » (+ « Interrompu par une erreur… »).
  i18n : 1528 clés.
- **Sécurité** (DD35) : arguments construits **uniquement** dans `args.ts` (pur, testé) — format d'entrée imposé (`-f`),
  `-protocol_whitelist file` avant `-i`, chemins absolus `file:`, `-enable_drefs 0` (MOV/MP4), `-max_pixels` 16 384², `-fs` 2 Gio − 1,
  `-max_muxing_queue_size 1024`, fils ≤ 16, `-nostdin -hide_banner -loglevel error` ; `run.ts` — `spawn` sans shell, priorité 19
  (`os.setPriority`, `IDLE_PRIORITY_CLASS` sous Windows), groupe de processus POSIX tué d'un coup (`detached`, sauf en dev), `taskkill /pid
  <pid> /T /F` sous Windows, sous Linux `prlimit --as=<mémoire> --cpu=<délai × cœurs>` si l'outil existe, environnement réduit (`PATH`,
  `TEMP`… ; jamais `NUXT_*`, `DATABASE_URL`, clés S3, mandataires ; `MALLOC_ARENA_MAX=2`, `SVT_LOG=1`), durée de sortie bornée
  (`maxOutputSeconds` + 10 s), 64 Kio de fin des erreurs, 8 Mio de sortie standard ; messages de ffmpeg jamais renvoyés tels quels
  (`toolFailure` retire les chemins). Testé : liste HLS déguisée en AVI visant `file:///etc/passwd` et une URL locale → échec propre, aucune
  lecture ni requête.
- **Fichiers** (`apps/core`) : `server/lib/video-processing/*` (11 modules), `server/lib/media/{sources,renditions}.ts` (nouveaux),
  `service.ts` (file, écritures du worker, contrats), `sniff.ts`, `limits.ts`, `upload.ts`, `delivery.ts`, `delivery-path.ts`, `cache.ts`,
  `urls.ts`, `keys.ts`, `video/probe.ts`, `handlers/video.ts`, `server/lib/storage/*` (`localPath`), `server/lib/api/{serializers,signed-urls,
  openapi,problem}.ts`, `server/utils/prisma.ts` (délai SQLite 10 s), `server/plugins/0.video-processing.ts`, `server/middleware/0.server-role.ts`,
  routes (§ 10), `server/routes/m/[...path].ts`, `cli/{worker,index}.ts` + `cli/i18n/{fr,en}.ts`, `shared/utils/{video-processing,video,media,
  snippets,audit}.ts`, `shared/schemas/api.ts`, `app/components/admin/{VideoProcessingPanel,VideoProcessingSettings,ProcessingStateBadge}.vue`
  (nouveaux), `MediaCard.vue`, `MediaUploader.vue`, `app/pages/admin/media/[id].vue`, `app/pages/admin/settings.vue`,
  `app/composables/{useProcessingPoll,useMediaUpload,useAuditFormat}.ts`, `app/utils/processing-view.ts`, `nuxt.config.ts`, `.env.example`.
- **Tests** : `tests/video-processing.test.ts` (réglages, arguments, progression, ffprobe, plan, règles pures), `video-ffmpeg.test.ts` (vrai
  ffmpeg sur des vidéos fabriquées par `lavfi` ; `describe.skipIf(!hasFfmpeg)` : **ignorés sans ffmpeg ou ffprobe**, jamais réussis en
  silence ; bloc `runTool : processus enfant borné` toujours ignoré sous Windows (`describe.skipIf(!posix)`) ; AV1 si `libsvtav1` ; `prlimit`
  sous Linux ; fichier hostile), `video-queue.test.ts` (prise, bail, reprise, rattrapage, runner, superviseur),
  `renditions-delivery.test.ts`, `video.test.ts` (signatures, pistes de données, ébauches), `video-sources.test.ts`, `video-admin.test.ts`,
  `api-video.test.ts`, `video-routes.test.ts`, `processing-view.test.ts` ; `api`, `openapi`, `transforms` (extrait `<video>`) mis à jour.
  526 tests en 27 fichiers (Node 24).
- **Écarts à la proposition** (détail : section « D3 — état de l'implémentation » de l'architecture) : validité d'une tâche par fichier et
  clés de rendus sans version ; `TOO_LONG` n'empêche que les réencodages ; rendu aussi pour une source entrelacée, et toujours pour un format
  converti ; fils plafonnés à 16 ; réparation WebM limitée aux codecs WebM ; priorité 10 des vidéos retenues ; route de suivi légère ;
  `processing.status` admin = statut de la tâche ; MOV annoncé `video/mp4` ; `halted` / `disabled` ; `/api/health` compte le serveur
  `embedded` comme un processus de travail.

### 9.24 Montée en charge et alerte SQLite (maintenance du 2026-10-10)

Demande de l'utilisateur : test global sous Windows, projet prêt pour un grand nombre de requêtes, message d'alerte si
SQLite pose problème. Référence d'exploitation : `setup.md` § 12.1 (tableaux de mesures) et journal « Maintenance —
2026-10-10 ». Tout a tourné sur une copie isolée (base `VACUUM INTO`, médias copiés, build de production sur 3200).

- **Configuration d'exécution** : Nitro 2 (`useRuntimeConfig(event)`) copie `_inlineRuntimeConfig` (≈ 520 entrées, dont
  l'OAuth de nuxt-auth-utils) et applique `applyEnv` (conversion de chaque nom + 2 lectures de `process.env`, ≈ 0,7 µs chacune
  sous Windows) **à chaque requête** ; @nuxtjs/i18n l'appelle dans son crochet `request` (`initializeI18nContext`) pour toutes
  les requêtes. Profil : 80 % du processeur, ~110 req/s sur des 304 de `/m/` (portable sur batterie). Correctif :
  `server/plugins/runtime-config.ts` — `nitroApp.hooks.beforeEach` (avant tout crochet, quel que soit l'ordre des plugins)
  pose `event.context.nitro.runtimeConfig` = `useRuntimeConfig()` (calculée au démarrage, gelée) pour `/m/`, `/api/`,
  `/_nuxt/` (`sharesRuntimeConfig`), `structuredClone` pour les pages ; jamais d'exception (try/catch). **hookable 5** place
  le nom du crochet en tête de `hook.args` (contrairement à ses types) : `hookEvent(args)` cherche l'objet qui a `context`
  (une première version prenait `args[0]` : toutes les requêtes en 500 dans la build). 21 pages d'administration rendues en
  SSR avec la configuration gelée : aucune erreur. Mesures avant/après (mêmes conditions, 32 connexions) : 304 792 → 15 100,
  aperçus 729 → 6 200, health 652 → 3 000, API média 525 → 1 490, liste 390 → 750, `/login` 219 → 460 req/s.
- **`sendStream` sans connexion** : en keep-alive, Node met en file la réponse d'une requête arrivée avant la fin de la
  précédente (`res.socket` nul jusqu'à l'événement `socket`) ; h3 1.15 `sendStream` y voit un environnement « worker » et
  rend la main sans rien écrire → réponse jamais envoyée (≈ 1 sur 5 000–10 000, originaux et dérivés). Diagnostic : route
  instrumentée dans la copie (`__stage`, `socketAtSend: false` sur chaque requête bloquée). Correctif : `responseReady(req,
  res)` (`server/lib/http/stream.ts`, attend `socket` ou la fermeture de la connexion TCP) dans `sendStoredFile` de
  `routes/m/[...path].ts`, **avant** d'ouvrir le fichier ; test déterministe par pipelining (deux requêtes d'un coup sur une
  socket, première réponse retardée). 0 blocage sur ≈ 250 000 requêtes ensuite.
- **SQLite mesuré** : un seul processus tient ≈ 1 650 req/s mixtes, 590 écritures/s, 135 envois/s sans erreur ; mais tout
  accès est synchrone (le processus est figé pendant la requête et pendant l'attente du verrou d'un autre processus, 10 s
  au plus) : aperçus 4 100 → 253 req/s avec 416 écritures/s dans le même processus, 129 req/s si un second processus écrit
  aussi ; verrou tenu 13 s → un aperçu attend 12 s, l'écriture échoue en **P1008** « Operation has timed out »
  (`DriverAdapterError: SocketTimeout`). L'adaptateur better-sqlite3 de Prisma 7 sérialise les transactions par un mutex
  et **prépare chaque requête à chaque appel** (pas de cache de requêtes préparées : ≈ 11 % du temps d'une liste).
- **Alerte** : `shared/utils/database-pressure.ts` (pur) — minutes de 60 s, fenêtre de 15 ; `warning` si une attente
  dépassée, 5 opérations ≥ 500 ms, ou 3 minutes à ≥ 50 % du temps dans la base ; `info` si une minute à ≥ 300 req/s,
  ≥ 30 écritures/s ou ≥ 25 % ; constat affiché 24 h. `server/lib/database/pressure.ts` : `createPressureMonitor` (compteurs),
  `useDatabasePressureMonitor()` (null hors SQLite), `reportDatabasePressure(store)` (chaque minute ; `Setting`
  `databasePressure`, au plus toutes les 5 min sauf aggravation, jamais un `info` sur un `warning` récent d'un autre processus ;
  `console.warn` au plus toutes les 15 min), `readDatabasePressure(store)` (constat enregistré ou évaluation en cours, le plus
  grave). Le client Prisma reçu en paramètre (`PressureStore`) : pas de cycle avec `usePrisma`. `server/utils/prisma.ts` :
  `withPressureMonitor` = `client.$extends({ query: { $allOperations } })` converti en `PrismaClient` (SQLite seulement).
  Plugin `database-pressure.ts` : requêtes comptées par `beforeEach` (un crochet `request` coûtait −16 % sur les 304 :
  hookable enchaîne chaque crochet par une promesse et `task.run`), constat chaque minute (web et worker), message
  `console.info` au démarrage en production. Tableau de bord : `{ kind: 'database', level, at, busy, slow, loadedMinutes,
  peakRequests, peakWrites, peakShare }` en tête des points d'attention (`settings:manage`), `attentionSeverity` = `level`.
  Vérifié de bout en bout (vrai verrou), axe 0 fr/en × clair/sombre, 375 px sans défilement ; coût A/B : 0 sur `/m/`,
  3–4 % sur l'API.
- **D3 sous Windows** (points en attente depuis l'étape 22) : ffmpeg 9.0.2 (winget, Gyan) accepté par Smart App Control sur
  ce poste ; priorité `Idle` constatée ; `taskkill /F` → code 1 (test `video-ffmpeg` : `KILLED_CODE`) ; vrai Ctrl+C de console
  pendant un encodage, `surge-media worker` puis `pnpm start` en `embedded` : arrêt < 1 s, ffmpeg arrêté (lancé avec
  `windowsHide` → `CREATE_NO_WINDOW`, hors de la console : il ne reçoit pas le Ctrl+C), tâche `QUEUED` sans essai compté,
  reprise et terminée. Non rejoué : Ctrl+C sur `pnpm dev`.
- **Suite : adresse IP réelle** (décision de l'utilisateur : Docker derrière un mandataire inverse) — `server/lib/http/client-ip.ts`
  (`normalizeIp`, `trustedProxies` par `net.BlockList`, `resolveClientIp` : de droite à gauche, première adresse non fiable =
  client, 20 entrées au plus), plugin `client-ip.ts` (`beforeEach` → `event.context.clientAddress`, que `getRequestIP` de h3 rend
  d'abord : limiteurs, audit, sessions, appareils, `lastUsedIp` sans toucher leur code). `runtimeConfig.trustProxy` = `'true'`
  (texte : un défaut booléen typait la variable en booléen ; Nitro rend `false` booléen depuis l'environnement, géré). Vérifié de bout
  en bout (limiteur d'échecs de l'API v1, IP de session et d'audit, usurpation « A, C », modes `false` et liste). WAL : résultat du
  pragma vérifié ; `?connection_limit=1` inutile avec les « driver adapters » (une connexion par processus).
- Scénarios rejoués sur la build finale : 787 contrôles (rôles, appareils, B2 à B5, C1 à C4, corps, envois bloqués, tableau
  de bord) ; 539 tests Vitest.

### 9.25 Bibliothèques front : fondations et affichage (phase E1, étape 26)

Architecture : `.claude/architecture-phase-e.md` (ED1–ED28 ; § 11 = plan d'E1, fin du document = état et écarts). Référence
d'exploitation : `setup.md` § 17 et étape 26. Paquets publiables, **licence MIT** (2026-10-16), encore en `0.0.0` ;
**releases et publication** (`setup.md` § 17.2) : `packages/.release-it.ts` (release-it à la racine ; tags `libs-vX.Y.Z`,
commits des seuls dossiers `packages/client`, `packages/vue`, `packages/scripts`, `packages/.release-it.ts` — le core vivait
dans `packages/core` avant le 2026-10-11 —, `npm: false`, versions écrites par `packages/scripts/set-version.mjs`,
`packages/CHANGELOG.md` commun), `packages/scripts/check-release.mjs` (`--tag`), `packages/scripts/pack-smoke.mjs` (archives
dans `packages/.artifacts/`, contenu lu en Node sans `tar`, installation npm dans un dossier vide, rendu serveur) ;
`.github/workflows/release-libraries.yml` (tags `libs-v*` : client puis vue, `latest` / `next` / `release-X.Y`) ;
`release.yml` limité aux tags `v*`. Première version : `pnpm release:libs 0.1.0` (sinon `feat` → 0.0.1 avant 1.0).

- **Core** : `apiProjectSchema` + `transformFormats` (formats de sortie activés) et `transformMaxDimension` ;
  `toApiProject(project, scopes, { formats, maxDimension })` (routes `projects/index.get` et `[projectId]/index.get` passent
  `useTransformSettings()`) ; test `contrat Project v1` (`tests/api.test.ts`). `vite` **7.3.6** en devDependency du core :
  sans elle pnpm résout les « pairs » de Nuxt / `@tailwindcss/vite` / Vitest sur le Vite 8 d'Astro (`nuxt typecheck` casse).
- **`packages/client`** (`@surge-media/client`, tsdown → `dist/index.mjs` + `.d.mts`, aucune dépendance) : `createSurgeClient`
  (`baseUrl` du site ou de l'API, `projectId`, `publishableKey` **ou** `getToken`), `credentials.ts` (jeton délégué : charge
  lue sans vérifier la signature, renouvelé 60 s avant `exp`, renouvellements simultanés partagés, `identity()` stable d'un
  jeton à l'autre = clé du cache ; `sm_sk_`/`sm_pat_` refusés localement si `document` existe), `http.ts` (GET seulement en E1,
  cache ETag 200 entrées par accès, un rejeu sur 401 `TOKEN_EXPIRED`, `NETWORK_ERROR` en statut 0, aucun autre nouvel essai),
  `errors.ts` (`SurgeApiError`, `problem+json` de l'API **et** `data.code` de `/m/`, `parseRetryAfter`), ressources `me`,
  `project` (cache 5 min), `presets`, `media.get/list/getMany/iterate`, `urls/` (`buildTransform` canonique et borné,
  `outputSize` = portage de `planTransform`, `widthCandidates`/`densityCandidates`/`presetCandidates`, `pictureFormats`,
  `imageFormat`, `mediaUrl`, `posterUrl`, `focalObjectPosition`, `BUILTIN_PRESETS`), `policy.ts` (`transformMode` : `presets`
  → préréglages ; `signed` → libres seulement si le gabarit porte `sig`), `processing.ts` (`watchMedia` : 5 s, onglet visible,
  arrêt sur 401/403/404, attente doublée jusqu'à 60 s sur erreur passagère), `format.ts`, `i18n/` (fr/en de tous les codes).
  Tests (67) : `fetch` simulé, **recoupement** avec `parseTransformation` et `planTransform` du core (import via alias
  `#shared` et chemin relatif, tests seulement), **contrat** (`expectTypeOf` clés + assignabilité contre les schémas zod,
  vérifié par `tsc`).
- **`packages/vue`** (`@surge-media/vue`, Vite mode bibliothèque depuis `src/entry.ts` + `vue-tsc -p tsconfig.build.json`,
  `dist/style.css`) : `createSurgeMedia(options)` → `{ context, install }` (projet lu au démarrage dans le navigateur, sauf
  `project` fourni ou `loadProject: false`) ; `useSurgeMedia()` (contexte par défaut sans plugin) ; `createTranslate` (repli
  langue → base → `fallbackLocale` → fr, surcharges `messages`) ; `imageSourceSet` (pur : préréglage, préréglages, densités si
  taille fixe sans `sizes`, largeurs sinon ; `src` = candidat ≤ 1024 px) — **déplacé dans `@surge-media/client`
  (`src/urls/image-sources.ts`, avec `parseAspect`) le 2026-10-17** pour servir aussi React, Svelte et les librairies locales
  (guide du site « Créer une intégration pour un framework ») ; composants `SmImage`, `SmPicture` (une `<source>`
  par format × media query, repli JPEG), `SmVideo` (`useLiveMedia`, sources renouvelées hors lecture, `HEAD` sur 503, mode
  `ambient`), `SmMedia`, `SmThumbnail`, `SmProcessingStatus` ; `useImageFallback` (original puis cadre d'erreur ; au montage,
  `decode()` décide si une image « complète » de largeur nulle est cassée) ; `DEV` = `process.env.NODE_ENV` (jamais
  `import.meta.env` : figé au build d'une bibliothèque) ; styles minimaux en ligne (`VISUALLY_HIDDEN`, `max-width`,
  `aspect-ratio`) pour fonctionner sans le thème. Tests (23) : rendu serveur (`@vitest-environment node`) et happy-dom
  (qui déclare les images « complètes » : `complete` simulé à faux).
- **`apps/playground`** : Vite (5173), alias vers les sources des paquets, intergiciel `POST /api/token` (clé secrète de
  `.env.local` → `delegated-tokens`, `project:read` + `media:read`, 15 min, origine du bac à sable), `define __PLAYGROUND__`
  (sans la clé secrète). Données de test de l'étape 26 : projet **« Bac à sable (E1) »** (`e1-playground`) + compte ADMIN
  temporaire `e1-playground-admin@surge-media.test` créés par un script du scratchpad (voir la mémoire) — à supprimer avec
  l'accord de l'utilisateur.
- **Pièges vus** : volet du navigateur masqué → `decode()` en attente, images différées jamais chargées (forcer
  `loading = 'eager'` pour mesurer) ; réponses 404 JSON d'images bloquées par ORB (normal) ; `alt=""` rendu `alt` par le
  rendu serveur de Vue ; espaces insécables d'`Intl` dans les durées.

### 9.26 Envoi de fichiers (phase E2, étape 27)

- **Core** (aucune migration) : `GET /me` → champ **`upload`** (`apiUploadRulesSchema` ; `null` sans `media:upload` déclarée) =
  `apiUploadRules(principal)` (`server/lib/api/writes.ts`) : `uploadTypeRules(uploadRules(types du jeton, maxSize du jeton,
  acceptedMimeTypes(traitement actif)))` (`server/lib/media/limits.ts`, pur : `{ mimeType, extension, kind, maxSize, converted }`
  dans l'ordre de l'installation), `remaining` = `remainingDelegatedUploads` (lecture de `DelegatedTokenUsage` par `jti`),
  `visibility` / `folderId` imposés. Problèmes RFC 9457 : **membres d'extension** `maxSize` (413), `accepted` (415),
  `timeout` (408) tirés de `data` des erreurs métier (`problemExtensions`, `ProblemOptions.extensions`, schéma `Problem`).
  `requireApiProject` accepte une liste de portées (« l'une d'elles », message qui les cite). `PUT …/poster` : un jeton
  délégué avec seulement `media:upload` pose la **première** affiche d'une vidéo du même émetteur (`uploadedByTokenId`) et du
  même sujet (`uploadSubject`, null = null), créée depuis moins d'une heure (`OWN_POSTER_WINDOW_MS` = durée maximale d'un jeton
  délégué : un jeton renouvelé convient) — `canSetOwnPoster` (pur) ; sinon `media:write`. Tests : `tests/api-upload.test.ts`.
- **`@surge-media/client`** : `src/upload/` — `file-types.ts` (miroir des types du core, recoupé par le test de contrat ;
  alias annoncés par les systèmes, extensions secondaires `.m4v`, `.mts`…), `rules.ts` (`checkFile` → `SurgeApiError` statut 0
  `NO_FILE` / `UNSUPPORTED_TYPE` + `accepted` / `FILE_TOO_LARGE` + `maxSize` ; l'extension ne décide que pour un type annoncé
  vide ou générique, ou un format converti ; type inconnu sans extension connue → plus grande limite, le serveur juge ;
  `acceptAttribute`, `acceptedExtensions`, `maxSizeFor`, `uploadKinds`, `fileKind`), `request.ts` (`sendMultipart` :
  XMLHttpRequest s'il existe, `responseType: 'text'`, sinon `fetch` ; champs avant `file`), `queue.ts` (`createUploadQueue` :
  éléments immuables + `subscribe`, `queued`/`uploading`/`poster`/`done`/`error`/`canceled`, `retryAt`, envois restants
  décomptés localement — partis depuis les dernières règles + en attente —, nouveaux essais automatiques 429/503/réseau
  (`Retry-After` ou 2, 4, 8 s, 60 s au plus, 3 fois), `autoStart: false` + `start()` pour le mode « détails »,
  `captureFrame` injectable), `video-frame.ts` (`captureVideoFrame`, port d'`app/utils/video-frame.ts`). `http.upload` (un
  rejeu sur 401 `TOKEN_EXPIRED`), `client.media.upload` / `setPoster` (`time` arrondi au millième) / `uploadRules()` (`/me`,
  jamais en cache : pas d'ETag). `SurgeApiError.extensions` ; `errorMessage(code, locale, extensions)` ajoute « Taille
  maximale : 25 Mo. » / « Types acceptés : JPG, PNG. » (`details` des catalogues). **Entrée `./server`** (`src/server.ts`,
  deuxième entrée tsdown, `exports["./server"]`) : `createDelegatedToken`, `DISPLAY_SCOPES`, `UPLOAD_SCOPES` ; refuse
  `window` + `document` (`SECRET_IN_BROWSER`) ; `normalizeBaseUrl` déplacé dans `src/base-url.ts` pour que l'entrée serveur
  n'embarque pas le client (morceau partagé : erreurs + messages). Tests (95) : `upload.test.ts` (XHR simulé), `server.test.ts`.
- **`@surge-media/vue`** : `useUploadRules(enabled)` (lecture au montage, navigateur seulement), `useUploadQueue(options)`
  (file du client + `shallowRef`, détruite avec la portée), **`SmUploader`** (champ natif masqué visuellement + `<label>`
  stylé en bouton, focus visible par `:focus-visible + label` ; dépôt avec compteur `dragenter`/`dragleave` ; collage ;
  aide reliée par `aria-describedby` ; visibilité `<select>` si `chooseVisibility` et non imposée ; ligne : aperçu local
  décoratif — retiré s'il ne se charge pas —, nom, taille, `<progress>` nommé, état, erreur traduite, boutons dont le nom
  accessible commence par le libellé visible ; pas de « Réessayer » pour un refus définitif ; focus rendu à la ligne quand
  ses boutons changent, sinon au champ ; annonces `role="status"` par fichier + résumé ; `beforeunload` pendant un envoi ;
  avertissement en développement sans droit d'envoi). Textes `upload.*` fr / en, icônes `IconUpload`, `IconX`,
  `IconRotateCcw`, `IconTrash`, styles `.sm-uploader*` (jetons existants seulement). Tests (24) : `uploader.test.ts` + rendu serveur.
- **Bac à sable** : `/api/token` émis par `createDelegatedToken` (import des sources `packages/client/src/server.ts` depuis
  `vite.config.ts`), `{ "purpose": "upload" }` → `UPLOAD_SCOPES`, 20 fichiers, 50 Mio ; page **Envoi** (contexte propre :
  `createSurgeMediaContext` + `provide(SURGE_MEDIA_KEY)`). Médias d'essai d'E2 dans le projet « Bac à sable (E1) »
  (`uploadSubject = 'playground'`).
- **Pièges vus** : un refus précoce (415) du serveur de dev laisse la connexion `fetch` réutilisée inutilisable
  (`ECONNRESET` à la requête suivante : relais de Nitro) → nouvel essai sur une autre connexion dans les scripts ; un focus
  posé par script n'active pas `:focus-visible` (tester avec de vraies frappes de Tab) ; les outils d'écriture et le shell
  transforment les échappements `\u00A0` en caractères (ESLint `no-irregular-whitespace`) : écrire les échappements par
  `String.fromCharCode(92)`.


**Architecture de la phase B validée** (toutes les décisions D1–D15 confirmées le 2026-09-29) : `.claude/architecture-phase-b.md`
— contrats détaillés des sous-étapes suivantes (types de jetons et formats, API v1, CORS, cache, transformations).

**Feuille de route** :
- **B2 (faite)** : voir § 9.11 et `setup.md` étape 6.
- **B3 (faite)** : voir § 9.12 et `setup.md` étape 7.
- **B4 (faite)** : voir § 9.13 et `setup.md` étape 8.
- **B5 (faite)** : voir § 9.14 et `setup.md` étape 9.
- **Phase C (terminée)** : `.claude/architecture-phase-c.md`. C1 : § 9.16 et `setup.md` étape 11 ; C2 : § 9.17, étape 12 ; C3 : § 9.18,
  étape 13 ; C4 : § 9.19, étape 14.
- **Phase D (vidéos)** : architecture `.claude/architecture-phase-d.md` validée le 2026-10-05 ; **D1 faite** (§ 9.21, `setup.md` étape 20) ;
  **D2 faite** (§ 9.22, `setup.md` étape 21). **D3 validée le 2026-10-06 (§ 28–42, DD25–DD36), TERMINÉE le 2026-10-09** (§ 9.23,
  `setup.md` étape 22) : fondations, modules A (ffmpeg), B (diffusion), C (détection), D (file, pipeline, service, processus de travail),
  E (contrats API v1 et administration), F (interface) faits, revus et vérifiés (526 tests) — état final, écarts, vérifications et limites :
  `.claude/architecture-phase-d.md`, section « D3 — état de l'implémentation » ; contrats des modules : `.claude/d3-implementation-notes.md`.
  **Vérifications Windows faites le 2026-10-10** (§ 9.24 : ffmpeg accepté, priorité `Idle`, `taskkill`, Ctrl+C du worker et de
  `pnpm start` pendant un encodage → tâche rendue sans essai, tests ffmpeg) ; reste facultatif : scénario HTTP `d3-test.mjs` facultatif (dans le dépôt seulement avec son accord) ; décisions de
  l'utilisateur en attente (§ 22). **Ensuite D4** (streaming adaptatif HLS, planches de survol, manifestes signés) **à proposer et faire
  valider** ; transverses : envois reprenables / directs vers S3, `BigInt` au-delà de 2 Gio, délestage de la diffusion, webhooks de fin de
  traitement, accélération matérielle, filtre « État » de la médiathèque, `<SmVideo>`. Audio et documents : phases ultérieures (DD13).
  `@surge-media/client` + composants (Vue d'abord) : **phase E**, étude validée le 2026-10-15 (`.claude/architecture-phase-e.md` :
  catalogue, matrice des identifiants, évolutions du core, découpage E1 à E5) ; **E1 faite** (§ 9.25 : client, `SmImage`, `SmPicture`, `SmVideo`, `SmMedia`, `SmThumbnail`, `SmProcessingStatus`) ; **E2 faite** (§ 9.26 : envoi, `SmUploader`, `@surge-media/client/server`) ; ensuite E3 (parcours et sélection).
- Pistes étape 19 : widgets masquables / réordonnables (préférence par compte), cache des agrégats pour de très grandes
  bibliothèques, médias récents en vignettes, journal par projet pour les propriétaires.
- Pistes étape 18 : « Envoyer un e-mail de test » (Réglages ou CLI), envoi automatique à la création d'un compte, file d'envoi, alerte à
  l'ajout d'un appareil de confiance, réinitialisation demandée par l'utilisateur lui-même (« mot de passe oublié » sur la page de connexion).
- Pistes étape 17 : page « Mon compte » avec la liste des appareils de confiance (navigateur, dernière utilisation, retrait un par un),
  actions exclues de la confiance (ex. création d'une clé secrète), alerte à l'ajout d'un appareil (SMTP).
- Pistes étape 16 : recherche des comptes à ajouter limitée (aujourd'hui tous les comptes actifs, nom et e-mail, visibles par un
  propriétaire de projet), journal d'audit par projet pour un gestionnaire, envoi des invitations par e-mail (SMTP), réinitialisation du
  mot de passe d'un invité par son gestionnaire (à décider), retrait d'un compte de tous ses projets en un geste.
- Pistes C4 : aperçu dans le dialogue d'un préréglage (avec un média de référence), `srcset` en largeurs (`w`) avec `sizes`, cache
  serveur des aperçus, poignées de redimensionnement de la zone au clavier (aujourd'hui : champs).
- Pistes C3 : point d'intérêt proposé automatiquement (`attention`), journal des changements de point d'intérêt, signature locale par
  le SDK (clé dédiée par projet), `urlTemplate` signé pour un média public en politique `signed` (aujourd'hui : lien signé à la demande).
- Pistes C2 : aperçu du rendu dans le dialogue d'un préréglage (avec C4), purge des dérivés d'un préréglage modifié ou supprimé,
  unicité des noms garantie en base, préréglages par l'API (jeton personnel), politique par environnement de clé.
- Pistes C1 : sortie GIF/animations, `X-Forwarded-For` de confiance (fait le 2026-10-10 : `NUXT_TRUST_PROXY`), limiteur partagé (Redis),
  purge des dérivés jamais redemandés.
- Pistes B5 : glisser-déposer vers un dossier, arbre complet en barre latérale, déplacement d'un dossier vers un autre espace,
  étiquettes (classement transversal), journalisation des opérations sur les dossiers, unicité des noms garantie en base (colonne
  normalisée + index), nombre de médias par dossier dans l'API.
- Pistes B4 : restauration / suppression définitive / déplacement par l'API, `If-Match` sur PATCH/PUT, clé d'idempotence des envois,
  restriction des écritures d'un jeton délégué aux médias de son sujet, compteur d'envois restants dans `/me`, révocation individuelle
  (liste de `jti`), journal de l'émission (échantillonné), file des traitements partagée (multi-instances), priorité des tâches de fond.
- Pistes B3 : cache L2 Redis et limiteurs partagés, cache serveur des résultats de liste, option « liste
  publique cachable » (CDN), limitation de débit sur `/m/` (l'interface de documentation est faite : étape 10).
- Pistes étape 10 : requêtes d'essai authentifiées par un jeton délégué de test émis par l'admin (le « jeton de console » est écarté),
  signaler à Scalar ses écarts d'accessibilité (client de requêtes), `h1` de Scalar.
- Pistes B2 : révocation des jetons d'autrui par un ADMIN (fiche utilisateur), journal par projet pour les propriétaires, purge du journal,
  sudo pour les actions sensibles sur les comptes (liens de mot de passe, rôles), limiteur de confirmation partagé (Redis).
- Autres pistes notées : commande CLI de secours admin, page « Mon compte », SMTP, copie entre stockages, nettoyage des orphelins,
  tests d'intégration automatisés, limiteur partagé (Redis), modèle de distribution/publication npm,
  retrait de l'override oxc-transform.

## 22. Points incertains ou à confirmer

- **Licence BSL 1.1** (`LICENSE`, `BUSL-1.1`) **décidée par l'utilisateur le 2026-10-10** (avant : MIT par défaut, jamais publiée) ; Change Date 3 ans,
  Apache 2.0, production gratuite sauf CA du groupe > 500 000 USD ou service hébergé concurrent (`setup.md`, journal du 2026-10-10).
  Champs à compléter (concédant, contact) : **complétés** (0 occurrence de `TO BE COMPLETED` le 2026-10-16 ; concédant « Mahmoud NBET »).
  **Librairies front : licence MIT décidée par l'utilisateur le 2026-10-16** (`packages/client/LICENSE`, `packages/vue/LICENSE` ; le
  `LICENSE` BSL exclut les fichiers sous une autre licence ; README racine). Non tranchés : CLA pour les contributions externes,
  licence des futurs composants React/Svelte (MIT par cohérence, à confirmer), relecture par un avocat.
- **Distribution** (étapes 23 et 24, 2026-10-10) : image Docker et paquet npm `@surge-media/core` faits et vérifiés localement (npm 12 sous
  Windows, npm 11 sous Linux, image depuis l'archive). **Jamais exécutés sur GitHub** : workflows `ci.yml` et `release.yml` (validés par
  actionlint seulement), publication npm (organisation `surge-media`, jeton `NPM_TOKEN` puis publication de confiance, provenance =
  dépôt public) et GHCR (visibilité du paquet), arm64 (QEMU). `CHANGELOG.md` créé par la première release (`pnpm release 0.1.0`).
  Un `GITHUB_TOKEN` présent dans l'environnement de l'utilisateur n'a pas accès au dépôt : release-it échoue (« not a collaborator »)
  tant qu'il est défini (le retirer pour passer par le navigateur, ou fournir un jeton valide).
- Portées et format des jetons : **implémentés en B2** selon l'architecture validée ; écarts listés en tête de `architecture-phase-b.md`.
- **MySQL/MariaDB** : les 16 migrations ont été exécutées pour la première fois sur **MariaDB 11** (image Docker, 2026-10-10, parcours API
  complet ensuite) ; **MySQL 8 jamais**. **PostgreSQL 17** réel aussi (Docker, même parcours) ; `db reset` jamais exécuté sur ces bases.
- **S3 réel** (AWS, R2, MinIO) jamais testé (seulement `s3rver`) ; `MediaStorage.copy` (CopyObject) et la lecture par plage (`Range`) testés seulement en local.
- Lecteurs d'écran réels jamais testés.
- **D3 sous Windows vérifié le 2026-10-10** (§ 9.24) ; reste non rejoué : Ctrl+C sur `pnpm dev` pendant un encodage. Aucune limite
  mémoire ni processeur par ffmpeg hors Linux (`prlimit`). Le Contrôle intelligent des applications peut bloquer ffmpeg sur un autre
  poste (non signé). Sous Windows, un ffmpeg tué de l'extérieur sort avec le code 1 : la règle « tué par un signal → passager »
  (`runFailure`, `code === null`) ne s'y applique pas (échec définitif) — sans effet sur les arrêts faits par `runTool`.
- **Montée en charge** (§ 9.24) : seuils de l'alerte SQLite choisis d'après un portable récent (à confirmer sur un serveur réel) ;
  limites et caches par processus ; délai de verrou SQLite de 10 s (processus figé) **confirmé par l'utilisateur** le 2026-10-10.
  `NUXT_TRUST_PROXY=true` par défaut (choix fait pour un déploiement Docker derrière mandataire) : un réseau privé non maîtrisé qui
  joindrait directement le serveur pourrait usurper une adresse (documenté : `false` sans mandataire).
- D3 vérifié avec SQLite et le stockage local : aucun essai consigné avec S3 (original copié dans le dossier de la tâche), PostgreSQL ou
  MySQL (l'ordre `nulls: 'first'` de la « dernière tâche » n'a été essayé que sous SQLite). Lecture réelle des rendus H.264 dans un navigateur
  non vérifiée (Chromium du nuage sans H.264), ni le report du changement de sources pendant une lecture.
- **Décisions de l'utilisateur en attente** (D3) : sa vidéo de téléphone (Samsung, projet « My Phone », envoyée avant D2, publique) contient
  encore son lieu de tournage — l'« Optimiser », la rendre privée ou la laisser ; les 8 dérivés orphelins de `landscape.jpg` (anciennes versions,
  laissés avant le correctif `deletePrefix` de D2) — les supprimer à la main ou non.
- Démarrage de la build de production : bloqué à l'étape 10 (argon2, Smart App Control), mais **fonctionnel le 2026-10-01 en C1**.
- **Override `oxc-transform` 0.141.0** hors de la plage de Nuxt 3.21 : fonctionne (typecheck, dev, build), mais à surveiller et retirer.
- Environnement local actuel (non versionné, indicatif) : compte `admin@surge-media.test` (ADMIN, créé par amorçage ; mot de passe dans
  `apps/core/.env`, variables d'amorçage encore présentes → avertissement au tableau de bord), un compte EDITOR créé par
  l'utilisateur le 26/09, une photo dans la bibliothèque, un projet « My Shop » créé par l'utilisateur le 29/09, un jeton personnel « Jeton Test 1 » de l'ADMIN créé par l'utilisateur le 29/09 et son
  entrée d'audit `token.created` (à préserver) ; `.env` sans `NUXT_SITE_URL` (origine de la requête en dev) ;
  base SQLite `apps/core/data/surge-media.db`.
