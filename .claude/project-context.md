# surgeMedia — contexte de référence du projet

> **Rôle de ce fichier** : mémoire technique permanente pour reprendre le développement sans
> l'historique des conversations. Complète `setup.md` (guide d'installation / d'exploitation en
> français, avec le « Journal des étapes »). En cas de divergence, **le code fait foi**, puis
> `setup.md`, puis ce fichier.
>
> **État décrit** : commit `b6deda4` (C3) + sous-étape **C4** (2026-10-02, non commitée au moment de la rédaction : vérifier
> `git log`). Étapes terminées : 1 (monorepo, core, base), 2 (UI, auth, rôles),
> 3 (utilisateurs), 4 (médias, phase A), 5 = **B1** (projets, espaces, autorisations), 6 = **B2**
> (identifiants d'API, origines, mode sudo, journal d'audit), 7 = **B3** (API publique v1 en lecture),
> 8 = **B4** (API v1 en écriture, jetons délégués `sm_dt_`, file bornée des traitements, pré-génération),
> 9 = **B5** (dossiers : arborescence, navigation et rangement dans l'admin, API v1), 10 = **documentation
> interactive de l'API** (OpenAPI généré depuis `defineRouteMeta`, page `/admin/api` avec Scalar, § 9.15),
> 11 = **C1** (transformations d'images à la demande : moteur et diffusion par `/m/`, § 9.16), 12 = **C2** (politique des
> transformations, préréglages, page « Réglages », § 9.17), 13 = **C3** (API : `urlTemplate`, `focalPoint`, liens signés de
> transformation unitaires et par lot ; point d'intérêt dans la fiche média, § 9.18), 14 = **C4** (générateur d'adresses de la
> fiche média : aperçu à la volée non enregistré, adresses signées si nécessaire, extraits HTML, § 9.19). **Les phases B et C sont
> terminées** (`.claude/architecture-phase-c.md` : décisions CD1 à CD12, écarts en tête). **Prochaine étape** : à proposer et faire
> valider — `@surge-media/client` + composants (Vue d'abord), ou phase D (vidéos et documents). Architecture de la phase B :
> `.claude/architecture-phase-b.md` (en-tête = écarts B1 à B5).
>
> Les éléments marqués **[À CONFIRMER]** sont des hypothèses ou des points non validés par
> l'utilisateur (récapitulés en § 22).

---

## 1. Produit et périmètre

- **surgeMedia** : plateforme open source, **auto-hébergée**, modulaire, de gestion et de traitement
  des médias (« mini-Cloudinary »). Déployée sur l'infrastructure du client.
- Deux faces du core : **interface d'administration** (médias, utilisateurs, jetons) et **couche
  d'API** pour les applications tierces du client (authentification, autorisations, CORS).
- Traitements d'images prévus à la demande par URL : CROP, RESIZE, OPTIMIZE (phase C, non commencée).
- Monorepo cible : `@surge-media/core` (admin + API), `@surge-media/vue` / `react` / `svelte`
  (composants : images optimisées, galeries, sélecteurs, upload), `docs` (GitHub Pages).
  **Seul `packages/core` existe aujourd'hui.**
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
| Vitest | 5.0 | tests des modules purs (`packages/core/tests/`, `vitest.config.ts`, alias `#shared`) |
| @scalar/api-reference | **1.72.3 exact** | documentation interactive (étape 10) ; `vue-demi` (dépendance) : `allowBuilds: false` ; `vite.optimizeDeps.include` |
| node:sqlite (intégré) | Node 24 | uniquement dans les scripts de test ad hoc (vieillir `Session.passwordVerifiedAt`, nettoyer l'audit) ; avertissement « experimental » |
| oxc-transform | **0.141.0 forcé** (`pnpm-workspace.yaml` › `overrides`) | Windows Smart App Control bloque le binaire 0.143.0 exigé par Nuxt 3.21 (`^0.143.0`) ; typecheck/dev/build vérifiés ; à retirer dès que possible (l'utilisateur a choisi cette option) |

Plateforme de dev de l'utilisateur : **Windows 11** (PowerShell + Git Bash). Chemin : `C:\__develop\surge-media`.

## 3. Architecture globale

```text
surge-media/                         monorepo pnpm (workspaces packages/*), dépôt git (main)
├─ package.json                      scripts racine (délèguent au core), engines, packageManager
├─ pnpm-workspace.yaml               packages + allowBuilds
├─ setup.md                          guide FR + Journal des étapes (à maintenir)
├─ README.md                         présentation courte
├─ .claude/launch.json               serveurs pour l'aperçu Claude : core (dev), core-start (prod), core-start-3100 (prod sur 3100, cwd packages/core)
├─ .claude/project-context.md        CE FICHIER
└─ packages/core                     @surge-media/core (private: true, bin surge-media)
   ├─ app/                           interface Vue/Nuxt (SSR)
   ├─ server/                        Nitro : api/, routes/, middleware/, plugins/, utils/ (auto-importés), lib/ (imports explicites), generated/ (Prisma, non versionné)
   ├─ shared/                        code partagé app/serveur/CLI (auto-import de shared/utils et shared/types)
   ├─ prisma/                        schema.prisma + migrations/<fournisseur>/ + schema.snapshot.prisma
   ├─ prisma.config.ts               config Prisma 7 (URL, dossier de migrations selon DATABASE_PROVIDER)
   ├─ cli/                           CLI surge-media (init, db migrate, db reset), i18n fr/en
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

## 4. Inventaire des fichiers importants (packages/core)

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
  **`useCredentialLabels`** (libellés d'environnement, tri, options de portées, messages d'erreur des identifiants).
- `utils/` (auto-importés) : `cn` (clsx + tailwind-merge), `redirect.ts` (`safeAdminRedirect`), `validation.ts` (`fieldErrors`), `api-error.ts` (`apiError`), `format.ts` (`formatBytes`, `formatPercent`).
- `components/ui/` (`<Ui…>`) : Button, Input, FormField, Alert, Badge, Select, Switch, PasswordInput, Dialog, Pagination, RadioCards,
  **CheckboxGroup** (cartes à cocher, fieldset/legend, `id` de la 1re case), CopyField, **CopyButton** (bouton compact + annonce `role=status`).
- `components/app/` (`<App…>`) : Logo, SkipLink, ThemeSwitcher, LocaleSwitcher.
- `components/admin/` (`<Admin…>`) : Sidebar, PageHeader, RoleField, UserStatusBadge, PasswordLinkPanel, MediaUploader, MediaCard,
  **MediaBrowser** (médias d'un espace : envoi si portée, filtres URL, grille, corbeille ; prop `projectId?`), **ProjectHeader** (retour, h1, badges,
  onglets Aperçu/Médias/Membres + Clés d'API/Origines si `project:credentials` — prop `scopes` ; `aria-current="true"` sur une sous-page ; alerte archivé),
  **FolderActions** (B5 : nouveau dossier, renommer, déplacer, supprimer), **TransformSettings** (C2 : politique, préréglages, limites),
  **FocalPointEditor** (C3 : point d'intérêt de la fiche média, clic + curseurs, aperçus 1:1 / 16:9), **UrlGenerator** (C4 : générateur
  d'adresses de la fiche média), **TransformFields** (C4 : champs structurés d'une transformation, partagés avec le dialogue des
  préréglages), **ReauthDialog** (dans `layouts/admin.vue`), **SecretPanel** (valeur affichée une fois, focus sur le titre, `defineExpose({ focus })`),
  **ScopeList**, **TokenStatusBadge** (prop `kind: key|token` pour l'accord en français). `UpcomingSection` supprimé en B2.
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
- `middleware/api-v1.ts` (entrée de l'API v1), `middleware/csrf.ts`.
- `plugins/` : `auth-session.ts` (hooks nuxt-auth-utils), `bootstrap-admin.ts` (avertissements au démarrage), `database.ts` (déconnexion Prisma à l'arrêt),
  `site-url.ts` (avertit en production si `NUXT_SITE_URL` est vide), `search-backfill.ts` (indexe la recherche des médias existants),
  `delegated-usage.ts` (purge horaire des compteurs de jetons délégués expirés).
- `utils/` (auto-importés par Nitro) : `prisma.ts` (`usePrisma`, `textContains`, `textSearch`, `isUniqueViolation`, `disconnectPrisma`), `auth.ts`, `password.ts`, `rate-limit.ts`, `users.ts`, `password-tokens.ts`,
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
  C3 : **`api/{signature-plan,signed-urls}.ts`** (liens signés de l'API, § 9.18 ; réutilisés par l'administration en C4) ; C4 : routes
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
  `utils/auth.ts` (`REAUTH_WINDOW_SECONDS` = 600, `AUTH_ERROR_CODES`, `isRecentlyVerified`), `utils/audit.ts` (`AUDIT_ACTIONS`, `AUDIT_CATEGORIES`, `auditCategory`) — auto-importés.
- `utils/users.ts` (USER_STATUSES, userStatus, USER_ERROR_CODES) — auto-importé.
- `utils/media.ts` (MEDIA_KINDS, MEDIA_VISIBILITIES, ACCEPTED_MEDIA_TYPES, ENABLED_MEDIA_KINDS, mediaKindForMime, extensionForMime, SIGNED_URL_DURATIONS, SIGNED_URL_MAX_TTL, MEDIA_ERROR_CODES) — auto-importé.
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
  `apiSignedUrlListSchema`, `apiSignedUrlErrorSchema`, `API_SIGNED_URL_ITEM_ERRORS` ; `schemas/media.ts` : `focalPointSchema`).
- `schemas/{auth,users,media,projects,credentials}.ts` (zod ; projects : `updateProjectSchema` accepte `publicListing` ; credentials : `createPersonalTokenSchema`, `createProjectKeySchema`, `rotateKeySchema`,
  `addOriginSchema` (normalise), `confirmPasswordSchema`, `auditQuerySchema`, `AUDIT_PAGE_SIZE` = 50) — import explicite `#shared/schemas/…` (media : + `spaceQuerySchema`, `mediaTargetSchema`, param `project`).
- `types/auth.d.ts` (augmentation `#auth-utils` : User, UserSession, SecureSessionData).

## 5. Modèle de données (prisma/schema.prisma)

Identifiants : `String @id @default(cuid())` partout. Horodatages `createdAt @default(now())`, `updatedAt @updatedAt`.

| Modèle | Champs clés | Relations / index |
| --- | --- | --- |
| **User** | `email @unique` (stocké en minuscules), `name?`, `passwordHash?` (null = invitation non acceptée), `role Role @default(EDITOR)`, `locale @default("fr")` (**non utilisé par l'UI**), `isActive @default(true)`, `lastLoginAt?` | sessions, projectMemberships, createdProjects (`ProjectCreatedBy`), uploadedMedia (`MediaUploadedBy`), accessTokens (`AccessTokenCreatedBy`), passwordTokens (`PasswordTokenUser`), issuedPasswordTokens (`PasswordTokenCreatedBy`) |
| **Session** | `userId`, `tokenHash @unique` (SHA-256 hex du jeton), `ipAddress?`, `userAgent?` (≤191), `expiresAt`, `lastSeenAt`, `passwordVerifiedAt` (B2 : dernière saisie du mot de passe, mode sudo) | user (Cascade) ; index userId, expiresAt |
| **PasswordToken** | `userId`, `purpose PasswordTokenPurpose`, `tokenHash @unique`, `expiresAt`, `usedAt?`, `createdById?` | user (Cascade), createdBy (SetNull) ; index userId |
| **Project** | `name`, `slug @unique`, `description?`, `archivedAt?` (lecture seule), `publicListing` (B3, défaut false), `transformPolicy` (C2, OPEN par défaut), `createdById?` | createdBy (SetNull), members, media, folders, accessTokens (clés), tokenGrants (`AccessTokenProject`), allowedOrigins, transformPresets (C2) |
| **TransformPreset** (C2) | `projectId?` (null = global), `name`, `transformation` (canonique, sans format), `description?` | projet (Cascade) ; index projectId ; unicité des noms par niveau : application (§ 9.17) |
| **Setting** (C2) | `key @id`, `value Json`, `updatedAt` | réglages de l'installation (`transforms.libraryPolicy`) |
| **ProjectMember** | `projectId`, `userId`, `role ProjectRole`, `createdAt`, `updatedAt` | `@@id([projectId, userId])`, project et user (Cascade) ; index userId |
| **AccessToken** (B2) | `type TokenType`, `name`, `projectId?` (clés), `environment?` (clés), `userId?` (PAT), `allProjects`, `includeLibrary`, `prefix`, `tokenHash @unique` (SHA-256 hex), `publicValue?` (clé publique seulement), `scopes` (espaces, ordre canonique), `expiresAt?`, `lastUsedAt?`, `lastUsedIp?` (B3), `revokedAt?`, `replacedById?` (rotation), `createdById?` | project (Cascade), user (`AccessTokenOwner`, Cascade), createdBy (`AccessTokenCreatedBy`, SetNull), replacedBy/replaces (`AccessTokenRotation`, SetNull), projects ; index projectId, userId, replacedById |
| **AccessTokenProject** (B2) | `tokenId`, `projectId` | `@@id([tokenId, projectId])`, Cascade des deux côtés ; index projectId |
| **AllowedOrigin** | `projectId`, `origin` (normalisée, joker `https://*.x.y` possible) | project (Cascade) ; `@@unique([projectId, origin])` |
| **DelegatedTokenUsage** (B4) | `jti @id`, `uploads Int`, `expiresAt` | aucune relation ; index expiresAt ; purgé toutes les heures |
| **CacheRevision** (B3) | `scope @id` (`project:<id>` \| `library`), `revision Int`, `updatedAt` | aucune relation |
| **AuditEvent** (B2) | `at`, `actorUserId?`, `tokenId?` (B3), `projectId?`, `action`, `targetType?`, `targetId?`, `ipAddress?`, `data Json?` (`label` lisible + détails) | **aucune clé étrangère** (survit aux suppressions) ; index (projectId, at), (actorUserId, at), at |
| **Folder** | `projectId?` (null = bibliothèque), `parentId?`, `name` | projet (Cascade), arbre (`FolderTree`, Cascade : jamais déclenché, la suppression exige un dossier vide ou remonte le contenu), media (SetNull) ; index (projectId, parentId) — utilisé depuis B5 (§ 9.14) |
| **Media** | `projectId?` (**null = bibliothèque** ; un seul espace), `folderId?`, `kind MediaKind`, `visibility Visibility @default(PUBLIC)`, `storageKey @unique` (clé opaque), `version Int @default(1)`, `originalName`, `mimeType`, `size Int` (octets, ≤ 2 Gio sous PG/MySQL), `checksum` (SHA-256 hex), `width?`, `height?`, `duration?`, `title?`, `altText?`, `searchTitle?`, `searchName` (défaut `''` = à indexer), `searchAlt?` (B3, normalisées), `metadata Json?`, `focalX?`, `focalY?` (C3 : point d'intérêt, fractions 0 à 1, 4 décimales), `uploadedById?`, `uploadedByTokenId?` (B4, identifiant d'API ou émetteur d'un jeton délégué), `uploadSubject?` (B4, sujet final d'un jeton délégué), `duplicatedFromId?` (provenance d'une copie), `deletedAt?` (corbeille) | project (**Restrict** : un projet n'emporte jamais ses médias), folder (SetNull), uploadedBy (SetNull), uploadedByToken (`MediaUploadedByToken`, SetNull ; index), duplicatedFrom/duplicates (`MediaDuplicates`, SetNull), variants ; index (projectId, deletedAt, createdAt), (projectId, checksum), folderId, deletedAt, duplicatedFromId |
| **MediaVariant** | `mediaId`, `transformation` (`v<n>/<opération effective>.<format>` depuis C1, ex. `v3/size_480x320,q_72.webp`), `storageKey @unique`, `format` (webp…), `size`, `width`, `height` | media (Cascade) ; `@@unique([mediaId, transformation])` |

Enums : `Role { ADMIN EDITOR DEVELOPER }`, `ProjectRole { OWNER DEVELOPER EDITOR }`, `TokenType { PERSONAL SECRET PUBLISHABLE }`, `PasswordTokenPurpose { INVITATION RESET }`,
`MediaKind { IMAGE VIDEO AUDIO DOCUMENT OTHER }`, `Visibility { PUBLIC PRIVATE }`.

**Migrations** (une par fournisseur : `prisma/migrations/{sqlite,postgresql,mysql}/`) :
`20260926142611_init`, `20260926151906_update_roles` (VIEWER → EDITOR avec reprise de données ajoutée
à la main), `20260926163647_password_tokens`, `20260926203012_media_version`,
`20260928222702_projects_spaces` (B1 ; reprise à la main : médias et dossiers du projet `default` → bibliothèque,
projet `default` supprimé ; vérifiée sur SQLite, SQL PG/MySQL non exécuté), `20260929112748_b3_api_read` (B3 ; colonnes remplies au démarrage, rien à la main), `20260929155037_b4_api_write` (B4 ; SQLite
recrée la table Media, rien à la main), `20260929103323_b2_credentials` (B2 ; reprises à la
main : `DELETE FROM AccessToken` en tête — ancien format jamais utilisable — et `UPDATE Session SET passwordVerifiedAt = createdAt` en fin ;
vérifiée sur SQLite ; la reprise de fin a été ajoutée après application locale : somme de contrôle mise à jour à la main dans
`_prisma_migrations` de la base de dev), `20261001154517_api_console` (colonne inutilisée, retirée par `20261002180128_drop_api_console`),
`20261001205756_c2_transforms` (C2), `20261002181734_c3_focal_point` (C3 : `Media.focalX`, `focalY`, rien à la main).

**Règles de portabilité** (schéma commun SQLite / PostgreSQL / MySQL) : pas d'attribut `@db.*`, pas de
`String[]`, chaînes ≤ 191 caractères sous MySQL (validées par zod/API), enums et Json acceptés
(Prisma ≥ 6.2 pour SQLite), ne jamais modifier le `provider` à la main (la CLI le réécrit).

**Workflow de modification du schéma** : modifier `schema.prisma` → `pnpm --filter @surge-media/core
db:migration <nom>` (diff hors ligne contre `prisma/migrations/schema.snapshot.prisma`, écrit la
migration des 3 fournisseurs et met l'instantané à jour) → relire le SQL (ajouter les reprises de
données) → `pnpm db:migrate`. `db:migration --check` échoue si le schéma a changé sans migration (CI).
Ne jamais modifier une migration publiée.

## 6. Configuration

### 6.1 Variables d'environnement (`packages/core/.env`, modèle `.env.example`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `sqlite` | `sqlite` \| `postgresql` \| `mysql` (MariaDB = mysql) |
| `DATABASE_URL` | `file:./data/surge-media.db` | schéma d'URL validé contre le fournisseur (`file:`, `postgres(ql):`, `mysql:`) |
| `NUXT_SESSION_PASSWORD` | généré par `db:init` | secret des cookies scellés (≥ 32 car.) |
| `NUXT_SESSION_MAX_AGE` | 43200 (12 h) | durée de session (cookie + base) |
| `NUXT_SESSION_COOKIE_SECURE` | true | `false` seulement pour tester en HTTP hors localhost |
| `NUXT_BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` | — | compte d'amorçage (§ 7.5) |
| `NUXT_SITE_URL` | demandée par `db:init` (`--site-url`) | URL publique de l'installation ; vide = origine de la requête (avertissement en prod) |
| `NUXT_MEDIA_PUBLIC_URL` | vide (= `NUXT_SITE_URL`) | base des URL de diffusion (CDN, sous-domaine) ; `mediaBaseUrl(event)` |
| `NUXT_MEDIA_MAX_UPLOAD_SIZE` | 26214400 (25 Mio) | taille max d'un envoi |
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
**Chemins relatifs** (SQLite, stockage local) résolus depuis le **dossier de lancement** : lancer depuis `packages/core`.

### 6.2 nuxt.config.ts (points notables)

- `modules`: `@nuxtjs/i18n`, `@nuxtjs/color-mode`, `nuxt-auth-utils`. `css`: `~/assets/css/main.css`. `vite.plugins`: tailwindcss().
- `optimization.keyedComposables: [{ name: 'useApiFetch', argumentLength: 3 }]`.
- `runtimeConfig`: `siteUrl`, `api { rateLimit { publishable, secret, personal, delegated, uploads, authFailures } }`, `session { name: 'surge-media-session', password: '', maxAge: 43200, cookie { sameSite: 'lax', secure: true } }`,
  `bootstrapAdmin { email, password }`, `media { maxUploadSize, signingSecret, previousSigningSecret, publicUrl, processing { concurrency, queue }, storage { driver, root, prefix, s3 {…} } }`.
- `routeRules` : `'/**'` → `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` ;
  `'/admin/**'`, `'/login'`, `'/password/**'` → `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`.
- `colorMode { classSuffix: '', storage: 'cookie', storageKey: 'surge-media-color-mode' }`.
- `i18n { defaultLocale: 'fr', strategy: 'no_prefix', locales: [fr (fr-FR, Français), en (en-US, English)], detectBrowserLanguage { useCookie, cookieKey: 'surge-media-locale', redirectOn: 'root', fallbackLocale: 'fr' } }`.
- **Pas** de `nitro.externals` (retiré avec `file-type`).

### 6.3 Scripts

Racine : `dev`, `build`, `typecheck`, `test`, `cli`, `db:init`, `db:migrate`, `db:reset`, `db:studio`, `i18n:check`, `a11y:contrast` (tous délégués au core).
Core : `test` = `vitest run`.
Core : `dev` / `build` / `typecheck` lancent d'abord `prisma generate` ; `build` = `prisma generate && nuxt build && tsdown` ;
`start` = serveur de prod ; `postinstall` = `nuxt prepare && prisma generate` (**cet ordre est obligatoire**) ;
`cli`, `db:init|migrate|reset` (via tsx), `db:generate`, `db:studio`, `db:migration`, `i18n:check`, `a11y:contrast`.

## 7. Authentification, sessions, rôles

### 7.1 Rôles, permissions et portées (source : `shared/utils/permissions.ts`, testée)

Permissions de **plateforme** (`User.role`) :

| Rôle | `library:manage` | `projects:create` | `projects:all` | `tokens:personal` | `api:docs` (étape 10) | `users:manage` | `audit:read` (B2) | `settings:manage` (C2) |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| ADMIN | ✓ | ✓ | ✓ (OWNER implicite partout) | ✓ | ✓ | ✓ | ✓ | ✓ |
| DEVELOPER | ✓ | ✓ | | ✓ | ✓ | | | |
| EDITOR (défaut, moindre privilège) | ✓ | | | | | | | |

Portées d'**espace** : `media:read|upload|write|delete` (bibliothèque ou projet) et `project:read|credentials|members|settings`.
- Bibliothèque : `library:manage` → toutes les portées `media:*`.
- Projet : rôle de membre `OWNER` (`project:*` + `media:*`), `DEVELOPER` (`project:read`, `project:credentials`, `media:*`),
  `EDITOR` (`project:read`, `media:*`) ; **plafond** `PROJECT_ROLE_CEILING` : ADMIN/DEVELOPER → OWNER, EDITOR → EDITOR ;
  rôle exercé = `effectiveProjectRole(platformRole, memberRole)` (ADMIN → OWNER même non membre ; non membre → null = projet invisible).
- Projet archivé : `ARCHIVED_PROJECT_SCOPES` = `project:read`, `project:settings`, `media:read`.
- `spaceScopes(role, { type: 'library' } | { type: 'project', memberRole, archived })` est la seule source des droits.
- Vérifications de type : `ROLES` ↔ enum `Role` (`server/utils/auth.ts`), `PROJECT_ROLES` ↔ enum `ProjectRole` (`server/utils/access.ts`).
- Côté serveur : `requireAuth(event, permission?)` (plateforme) ; `requireSpaceAccess(event, space, scope?)` et
  `requireMediaAccess(event, () => findMedia(id), scope)` → **404** si l'espace/le média est invisible, **403** si la portée manque
  (`PROJECT_ARCHIVED` si c'est l'archivage). Côté UI : `useAuth().can()`, `definePageMeta({ permission })` et les `scopes`
  renvoyés par l'API (ergonomie uniquement).
- Portées des identifiants d'API (B2) : `TOKEN_SCOPES` = `project:read` + `media:*` ; `TOKEN_BASE_SCOPES` (`project:read`, `media:read`)
  toujours incluses ; `tokenScopes(optionnelles)` rend l'ensemble canonique. Jamais de portée de gestion (membres, clés, réglages).
- Barre latérale : Tableau de bord (tous), Bibliothèque (`library:manage`), Projets (tous), Jetons personnels (`tokens:personal`),
  Utilisateurs (`users:manage`), Journal d'audit (`audit:read`), Documentation de l'API (`api:docs`).

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
  rotation), jeton personnel (création), membres (ajout, rôle, retrait d'autrui). Client : `useReauth().run(() => …)` + `<AdminReauthDialog>`.

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

## 8. Gestion des utilisateurs (étape 3)

- Pages : `/admin/users` (recherche nom/e-mail, filtres rôle et statut dans l'URL, tableau, pagination 20), `/admin/users/new`,
  `/admin/users/[id]` (profil, accès et sécurité, suppression dans `<UiDialog>`). Permission `users:manage`.
- **Pas de mot de passe saisi par l'administrateur** : création → **lien d'invitation** à usage unique (7 jours) affiché une fois
  (`AdminPasswordLinkPanel`, focus sur son titre), transmis à la main (pas de SMTP). Réinitialisation : lien de 24 h depuis la fiche.
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
- Détection du type réel : `server/lib/media/sniff.ts` (256 premiers octets, signatures JPEG, PNG, GIF87a/89a, RIFF…WEBP, boîte ISO `ftyp`
  avec marque avif/avis). Liste d'autorisation stricte ; nom et Content-Type client ignorés.
- Gestionnaires (`server/lib/media/handlers/`) : interface `MediaTypeHandler { kind, inspect(path, mime) → { width, height, duration,
  metadata }, preview?(Readable) → { data, mimeType, extension, width, height } }` ; registre `handlerFor(kind)`.
- Image (`handlers/image.ts`) : `sharp.cache(false)` (verrous Windows) ; en-tête lu sans limite puis contrôle `largeur × hauteur de page
  × pages ≤ 100 Mpx` → `DIMENSIONS_TOO_LARGE` ; illisible → `UNREADABLE_FILE` ; orientation EXIF 5–8 = dimensions permutées ;
  metadata JSON : `format, orientation, space, hasAlpha, pages, animated, density, hasExif, hasIccProfile`.
  Aperçu : première image, `rotate()`, `resize` 480×480 `inside` sans agrandissement, WebP q72, **sans métadonnées**.
- Ajouter un genre (vidéo, document) : signature dans `sniff.ts` + types dans `ACCEPTED_MEDIA_TYPES` + gestionnaire au registre
  (+ Range dans `MediaStorage` pour la vidéo).

### 9.4 Envoi (`server/lib/media/upload.ts` + `service.ts`)

1. `requireSpaceAccess(event, spaceFor(?project), 'media:upload')` (avant de lire le corps).
2. `receiveUpload(event, maxSize)` : exige `multipart/form-data` (sinon 400 `MULTIPART_REQUIRED`) ; refus immédiat si `Content-Length` >
   max + 64 Kio (413) ; busboy (`defParamCharset: utf8`, limites : 1 fichier champ `file`, 10 champs, 4096 o/champ, 12 parties) ;
   écriture dans un dossier temporaire `surge-media-upload-*` avec SHA-256 et taille au fil de l'eau ; dépassement → 413 `FILE_TOO_LARGE`
   (`data.maxSize`) ; fichier vide ou absent → 400 `NO_FILE` ; `cleanup()` ne lève jamais (retries, simple avertissement).
3. `sanitizeFilename` : basename, NFC, sans caractères de contrôle, ≤ 191 (extension préservée), défaut `media`.
4. Champs texte (`title`, `altText`, `visibility`) validés par `mediaMetadataSchema` (400 avec issues zod si invalide).
5. `analyze` : `sniffMimeType` → genre → gestionnaire, sinon 415 `UNSUPPORTED_TYPE` (`data.accepted`) ; `inspect`.
6. `storage.put` puis `prisma.media.create` (espace de la requête, visibilité PUBLIC par défaut) ; échec base → suppression du fichier.

**Duplication** (`duplicateMedia(media, target, actor)`) : refus si corbeille (409 `IN_TRASH`) ; `storage.copy` vers une nouvelle
clé `originals/…` ; nouvelle ligne (version 1, mêmes kind/visibility/originalName/mimeType/size/checksum/dimensions/title/altText/metadata,
`duplicatedFromId`, `uploadedById` = acteur) ; échec base → fichier copié supprimé ; dérivés non copiés. Même espace permis.
**Déplacement** (`moveMedia`) : `projectId` changé, `folderId` remis à null, id/URL/fichiers inchangés ; même espace = aucun changement.
**Purge en lot** : `deleteStoredFiles(items)` (original + `variants/<id>/`), ne lève jamais (utilisée par la purge et la suppression de projet).

### 9.5 Remplacement, métadonnées, corbeille

- `PUT /file` : mêmes contrôles ; genre différent → 422 `KIND_MISMATCH` (en pratique un non-image échoue avant, en 415) ; nouvelle clé ;
  `updateMany where { id, version }` avec `version: { increment: 1 }` → 0 ligne = 409 `VERSION_CONFLICT` (nouvelle clé supprimée) ;
  puis suppression de l'ancien original, des `MediaVariant` de l'ancienne version (`transformation startsWith v<old>/`) et des fichiers
  `variants/<id>/v<old>-*`. Titre, texte alternatif, visibilité conservés ; `originalName` = nouveau fichier.
- PATCH : `title`, `altText` (texte vide → null), `visibility`.
- Corbeille : `deletedAt` ; restauration ; suppression définitive **uniquement depuis la corbeille** (409 `NOT_IN_TRASH`) : ligne supprimée
  d'abord (variants en cascade), puis original + `variants/<id>/` (échec physique = fichier orphelin journalisé).

### 9.6 Diffusion (`server/routes/m/[...path].ts`, `server/lib/media/delivery.ts`)

- URL : `/m/<id>/v<version>/<nom>.<ext>` (original) · `/m/<id>/v<version>/<préréglage|paramètres>/<nom>.<format>` (dérivé, C1 :
  § 9.16 ; aperçu = `preview/<nom>.webp`). `<nom>` = slug ASCII de `title || originalName` (≤ 80), **purement indicatif**. Grammaire :
  3–4 segments, id `^[a-z0-9]{8,64}$`, version `v\d{1,9}` ; sinon 404. Méthodes GET/HEAD (autres → 405 + `Allow`). HEAD : 200 avec en-têtes seuls.
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

- Visibilité : ADMIN (`projects:all`) → tous ; sinon projets dont l'utilisateur est membre. `toProjectSummary` : id, name, slug,
  description, archivedAt, dates, `role` (exercé), `memberRole`, `mediaCount` (hors corbeille), `memberCount`.
- Création (`projects:create`) : slug fourni → 409 `SLUG_TAKEN` s'il est pris ; sinon `slugify(name) || 'project'` suffixé `-2…-20`
  en cas de collision ; le créateur devient `OWNER` (membre).
- Réglages / archivage : `PATCH { name?, slug?, description?, archived? }` (`project:settings`, permis aussi archivé).
- Suppression : projet **archivé** seulement (409 `PROJECT_NOT_ARCHIVED`), `{ media: 'library' | 'purge' }` :
  `library` = transaction `updateMany(projectId → null, folderId → null)` + delete ; `purge` = transaction `deleteMany` + delete, puis
  `deleteStoredFiles` **sans attendre**. Membres, dossiers, jetons, origines partent en cascade.
- Membres : ajout (comptes actifs, 404 `USER_NOT_FOUND`, 409 `ALREADY_MEMBER`, 422 `ROLE_NOT_ASSIGNABLE` au-delà du plafond),
  changement de rôle et retrait (409 `LAST_OWNER` : le dernier `OWNER` enregistré ne peut être ni rétrogradé ni retiré ; la
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
  `shared/utils/audit.ts` (25). Choix : `member.role_changed` seulement si le rôle change (`{ from, to }`) ; `project.updated` avec
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
- `AdminTransformFields` (`v-model` = objet de champs, `ids`, `maxDimension`, `error(field)`, événement `edit`) remplace les 8 champs du
  dialogue des préréglages (`AdminTransformSettings` : `:error="message" @edit="clear"`).

## 10. Référence des API

Format d'erreur (h3) : `{ statusCode, statusMessage, message, data? }` ; **codes métier dans `data.code`** (lus côté client par
`apiError(err)` → `{ status, code, retryAfter }`). Erreurs de validation zod : 400 avec `data` = issues.

| Méthode + chemin | Accès | Entrée | Sortie / statuts |
| --- | --- | --- | --- |
| GET `/api/health` | public | — | 200/503 `{ status, checks { database, storage, imageProcessing } }` (statuts seulement) |
| POST `/api/auth/login` | public (CSRF) | `{ email, password }` | 200 `{ user }` + cookie · 400 · 401 · 429 |
| POST `/api/auth/logout` | cookie | — | `{ loggedOut: true }` |
| POST `/api/auth/confirm-password` | cookie (CSRF) | `{ password }` | `{ verifiedUntil }` · 422 `PASSWORD_INCORRECT` · 429 |
| GET / DELETE `/api/_auth/session` | nuxt-auth-utils | — | session (sans `secure`) ; 401 si révoquée · DELETE efface |
| GET `/api/auth/password/:token` | public | — | `{ email, purpose, expiresAt }` · 404 `TOKEN_INVALID` |
| POST `/api/auth/password/:token` | public (CSRF) | `{ password, confirmation }` | 204 · 400 · 404 `TOKEN_INVALID` |
| GET `/api/admin/status` | `users:manage` | — | `{ bootstrapCredentialsSet }` |
| GET `/api/admin/users` | `users:manage` | `?q&role&status&page` | `{ items: UserSummary[], total, page, pageSize: 20 }` (tri e-mail) |
| POST `/api/admin/users` | `users:manage` | `{ email, name?, role }` | 201 `{ user, invitation { path, purpose, expiresAt } }` · 409 `EMAIL_TAKEN` |
| GET `/api/admin/users/:id` | `users:manage` | — | `{ user, activeSessions, pendingLink { purpose, expiresAt } \| null }` · 404 |
| PATCH `/api/admin/users/:id` | `users:manage` | `{ name?, role?, isActive? }` | `{ user }` · 403 `SELF_ACTION` · 409 `LAST_ADMIN` |
| DELETE `/api/admin/users/:id` | `users:manage` | — | 204 · 403 · 409 |
| POST `/api/admin/users/:id/password-link` | `users:manage` | — | `{ path, purpose, expiresAt }` · 409 si inactif (sans code) |
| DELETE `/api/admin/users/:id/sessions` | `users:manage` | — | `{ revoked }` |
| GET `/api/admin/config/media` | session | — | `{ maxUploadSize, acceptedTypes, signedUrlDurations }` |
| GET `/api/admin/spaces` | session | `?scope=` (défaut `media:upload`) | `{ spaces: ({ type: 'library' } \| { type: 'project', id, name })[] }` |
| GET `/api/admin/media` | `media:read` (espace) | `?project&folder&recursive=1&q&kind&visibility&status=active\|trash&sort=newest\|oldest\|name\|size&page` | `{ items: MediaSummary[], total, page, pageSize: 24, space, projectRole, scopes }` · 404 |
| POST `/api/admin/media` | `media:upload` (espace) | `?project` + multipart `file` + `title?`, `altText?`, `visibility?` | 201 `{ media: MediaDetail }` · 400/403/404/413/415/422 |
| GET `/api/admin/media/:id` | `media:read` | — | `{ media: MediaDetail, publicUrl (absolue \| null), transforms (image : { policy, presets, formats, maxDimension } \| null), space, projectRole, scopes }` (corbeille comprise) · 404 |
| GET `/api/admin/media/:id/transform` | `media:read` | `?preset=\|transform=&format=` | image (non enregistrée) + `X-Transform-Width\|Height\|Operation` · 400 `INVALID_TRANSFORM` (`param`) · 404 `PRESET_NOT_FOUND` · 409 `IN_TRASH` · 503 |
| POST `/api/admin/media/:id/links` | `media:read` | `{ items: [{ preset? \| transform?, format }] (1–4), expiresIn? }` | `{ items: [{ url, query, expiresAt } \| { error: { code, param?, detail? } }] }` · 409 `IN_TRASH` |
| PATCH `/api/admin/media/:id` | `media:write` | `{ title?, altText?, visibility?, folderId?, focalPoint? }` | `{ media }` · `focalPoint` modifié : version + 1, 409 `VERSION_CONFLICT` / `IN_TRASH`, 400 hors images |
| PUT `/api/admin/media/:id/file` | `media:write` | multipart `file` | `{ media }` · 409 `VERSION_CONFLICT` · 415/422 |
| DELETE `/api/admin/media/:id[?permanent=true]` | `media:delete` | — | 204 · 409 `NOT_IN_TRASH` |
| POST `/api/admin/media/:id/restore` | `media:delete` | — | `{ media }` |
| POST `/api/admin/media/:id/signed-url` | `media:read` | `{ expiresIn }` (60–604800) | `{ url (absolue), expiresAt }` (public : URL permanente, `expiresAt: null`) · 409 `IN_TRASH` |
| POST `/api/admin/media/:id/duplicate` | `media:read` + `media:upload` (cible) | `{ projectId: string \| null }` | 201 `{ media }` · 404 · 403 · 409 `IN_TRASH` |
| POST `/api/admin/media/:id/move` | `media:delete` + `media:upload` (cible) | `{ projectId: string \| null }` | `{ media }` (même espace : inchangé) · 404 · 403 · 409 `IN_TRASH` |
| GET `/api/admin/projects` | session | `?q&status=active\|archived&page` | `{ items: ProjectSummary[], total, page, pageSize: 20 }` |
| POST `/api/admin/projects` | `projects:create` | `{ name, slug?, description? }` | 201 `{ project }` · 409 `SLUG_TAKEN` |
| GET `/api/admin/projects/:id` | `project:read` | — | `{ project, trashCount, scopes }` · 404 |
| PATCH `/api/admin/projects/:id` | `project:settings` | `{ name?, slug?, description?, archived? }` | `{ project, trashCount, scopes }` · 409 `SLUG_TAKEN` |
| DELETE `/api/admin/projects/:id` | `project:settings` | `{ media: 'library' \| 'purge' }` | `{ media: n }` · 409 `PROJECT_NOT_ARCHIVED` |
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
| GET `/api/admin/audit` | `audit:read` | `?category&project&page` | `{ items, total, page, pageSize: 50, filterProject }` |
| GET\|HEAD `/m/...` | selon § 9.6 (sans cookie ; Bearer depuis B3) | `Range` | fichier en flux · 206/302/304/401/403/404/405/416 ; OPTIONS 204 |
| GET `/api/v1/me` | tout identifiant valable | — | `Me` (credential, user, project, access) |
| GET `/api/v1/projects` | `project:read` | `?limit&cursor` | `{ items: Project[], nextCursor }` |
| GET `/api/v1/projects/:projectId` | `project:read` | — | `Project` (dont `transformPolicy`, C2) · 404 `PROJECT_NOT_FOUND` · 403 `PROJECT_ARCHIVED` |
| GET `/api/v1/projects/:projectId/presets` | `media:read`, toute clé | — | `{ items: Preset[] }` (`name, transformation, description, level`) · ETag → 304 |
| GET `/api/v1/projects/:projectId/media` | `media:read` | `?q&kind&visibility&ids&sort&limit&cursor&withTotal` | `{ items: Media[], nextCursor, total? }` · 304 · 400 `INVALID_REQUEST`/`INVALID_CURSOR` · 403 `LISTING_DISABLED` |
| GET `/api/v1/projects/:projectId/media/:mediaId` | `media:read` | — | `Media` · 304 · 404 `MEDIA_NOT_FOUND` |
| POST `/api/v1/projects/:projectId/media/:mediaId/signed-url` | `media:read`, pas une clé publique (délégué : ≤ 3600 s) | `{ target?: file\|preset\|transform\|derived, preset?, transform?, format?, expiresIn? }` | `{ url, query, expiresAt }` · 400 `INVALID_TRANSFORM` · 403 `CREDENTIAL_NOT_ALLOWED` / `TRANSFORM_NOT_ALLOWED` · 404 `PRESET_NOT_FOUND` |
| POST `/api/v1/projects/:projectId/signed-urls` | idem | `{ items: [{ mediaId, target?, preset?, transform?, format? }] (1–100), expiresIn? }` | `{ items: [{ url, query, expiresAt } \| { error: { code, detail? } }] }` |
| POST `/api/v1/projects/:projectId/media` | `media:upload` (secret, PAT, délégué) | multipart `file` + `title?`, `altText?`, `visibility?` | 201 `Media` + `Location` · 400/403 `UPLOAD_LIMIT_REACHED`/413/415/422/429/503 |
| PATCH `/api/v1/projects/:projectId/media/:mediaId` | `media:write` | `{ title?, altText?, visibility?, folderId?, focalPoint? }` (strict) | `Media` · 400 · 404 · 409 `VERSION_CONFLICT` |
| PUT `/api/v1/projects/:projectId/media/:mediaId/file` | `media:write` | multipart `file` | `Media` (version + 1) · 409 `VERSION_CONFLICT` · 415/422 |
| DELETE `/api/v1/projects/:projectId/media/:mediaId` | `media:delete` | — | 204 (corbeille) · 404 |
| POST `/api/v1/projects/:projectId/media/:mediaId/duplicate` | `media:read` + `media:upload` cible (secret : son projet ; PAT) | `{ target?: { projectId } \| { library: true } }` | 201 `Media` (+ `Location` si projet) · 403 `CREDENTIAL_NOT_ALLOWED` · 404 |
| POST `/api/v1/projects/:projectId/delegated-tokens` | portées ⊆ émetteur (secret, PAT) | `{ scopes, expiresIn?, subject?, origin?, upload? }` | 201 `{ token, expiresAt, scopes }` (`no-store`) · 400 · 403 · 404 |
| GET `/api/v1/projects/:projectId/folders` | `media:read`, pas une clé publique | — | `{ items: Folder[] }` · 304 · 403 `CREDENTIAL_NOT_ALLOWED` |
| POST · PATCH · DELETE `/api/v1/projects/:projectId/folders[/:folderId]` | `media:write` | `{ name, parentId? }` · `{ name?, parentId? }` · `?content=parent` | 201 `Folder` · `Folder` · 204 · 404/409/422 `FOLDER_*` |
| GET `/api/v1/openapi.json` · `/api/v1/errors` | public | `?lang=fr\|en` (openapi) | spécification OpenAPI 3.1 générée (§ 9.15) · catalogue des codes |
| GET `/api/admin/api-docs` | `api:docs` | — | `{ apiBaseUrl, specUrl, projects }` (§ 9.15) |

Contrats de données :
- `SessionUser` : `{ id, email, name, role, locale }` ; session client : `{ user, loggedInAt }`.
- `UserSummary` (`toUserSummary`) : `{ id, email, name, role, locale, isActive, status, lastLoginAt, createdAt }` (jamais d'empreinte).
- `MediaSummary` (`toMediaSummary`) : `{ id, projectId, folderId (B5), kind, visibility, originalName, title, altText, mimeType, extension, size, width,
  height, duration, version, focalPoint (C3), url, previewUrl, uploadedBy { id, name, email } | null, createdAt, updatedAt, deletedAt }` ;
  `MediaDetail` = + `checksum`, `metadata`, `duplicatedFromId` ; B4 : + `uploadedByToken { id, name, type, prefix } | null`, `uploadSubject`. `url`/`previewUrl` sont des chemins **relatifs**, signés `scope=admin`
  si privé ou en corbeille ; les adresses à copier (`publicUrl`, `signed-url`) sont **absolues** (`mediaBaseUrl`).
- `describeAccess(access)` → `{ space: { type: 'library', project: null } | { type: 'project', project: { id, name, slug, archivedAt } },
  projectRole, scopes }` (joint aux réponses média/membres).
- Codes métier : utilisateurs `EMAIL_TAKEN, SELF_ACTION, LAST_ADMIN, TOKEN_INVALID` ; médias `NO_FILE, MULTIPART_REQUIRED,
  FILE_TOO_LARGE, UNSUPPORTED_TYPE, UNREADABLE_FILE, DIMENSIONS_TOO_LARGE, KIND_MISMATCH, VERSION_CONFLICT, NOT_IN_TRASH, IN_TRASH,
  MEDIA_FORBIDDEN, SIGNATURE_INVALID, SIGNATURE_EXPIRED` ; projets `SLUG_TAKEN, PROJECT_ARCHIVED, PROJECT_NOT_ARCHIVED, LAST_OWNER,
  ALREADY_MEMBER, ROLE_NOT_ASSIGNABLE, USER_NOT_FOUND` (`projectError`, traduits `projects.errors.*`) ; identifiants `TOKEN_NOT_ACTIVE,
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
6. **Changement de fournisseur de base** : `pnpm db:init` / `db:reset` → `.env` + `provider` réécrit + `prisma generate` + migrations
   (données non transférées ; rebuild nécessaire car le client Prisma dépend du fournisseur).
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
- Fichiers `i18n/locales/fr.json` (référence) et `en.json` — 961 clés (C2 : `transforms.*`, `settings.*` ; étape 10 : `apiDocs.*`, `admin.nav.apiDocs`, `permissions.api.docs`). Espaces de noms : `app, a11y, nav, footer, theme, locale, form,
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

## 15. CLI `surge-media` (`packages/core/cli/`)

- citty + @clack/prompts ; build tsdown → `dist/cli/index.mjs` (bin `surge-media`) ; en dépôt : `pnpm cli …` / `pnpm db:*` (tsx).
- `init [--provider --url --yes --skip-migrate --cwd --lang]` : écrit `.env` (depuis `.env.example`, sans écraser les autres variables),
  réécrit `provider`, `prisma generate`, `migrate deploy`, **génère `NUXT_SESSION_PASSWORD` et `NUXT_MEDIA_SIGNING_SECRET` s'ils manquent**.
- `db migrate` : vérifie la cohérence `.env` / schéma, `prisma generate` puis `migrate deploy`.
- `db reset [--provider --url --yes]` : `migrate reset --force` (destructif, confirmation). **Prisma 7 refuse `migrate reset` lancé par un
  agent IA** : l'utilisateur doit le lancer lui-même.
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
| Liens d'invitation/réinitialisation au lieu de mots de passe saisis par l'admin | l'admin ne connaît jamais le mot de passe ; fonctionne sans SMTP |
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

## 17. Règles métier et contraintes

- Toute autorisation est **appliquée côté serveur** ; l'UI ne fait que masquer.
- Un ADMIN ne peut pas agir sur son propre rôle/statut/compte ; il reste toujours au moins un ADMIN actif (hors course concurrente extrême).
- Comptes créés uniquement par un administrateur ; e-mail immuable ; mot de passe 12–128 caractères ; e-mails en minuscules.
- Médias : un seul fichier par envoi, 25 Mio par défaut, 100 Mpx max, types JPEG/PNG/WebP/AVIF/GIF ; nom d'origine = métadonnée seulement.
- Un média en corbeille n'est plus diffusé (sauf aperçu admin) et ne peut pas recevoir de lien signé ; purge seulement depuis la corbeille.
- Lien signé lié à (média, version, dérivé, échéance) ; 7 jours maximum.
- Longueurs de texte ≤ 191 (MySQL) ; tout texte d'API validé par zod partagé.
- Un média appartient à un seul espace ; les listes partent toujours de l'espace imposé par le serveur.
- Projet : nom 1–100, slug `^[a-z0-9]+(?:-[a-z0-9]+)*$` ≤ 60 unique, description ≤ 191 ; toujours au moins un OWNER enregistré
  (sauf suppression de compte) ; archivé = lecture seule ; suppression seulement archivé.
- Un EDITOR de plateforme n'exerce jamais plus que `EDITOR` dans un projet ; un ADMIN est OWNER partout.
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
- Actions sensibles (sudo) : clé secrète (création, rotation), jeton personnel (création), membres (ajout, rôle, retrait d'autrui) ;
  jamais pour une action qui retire des droits (révoquer, quitter).

## 18. Pièges, edge cases et problèmes connus

- **Windows** : verrous de fichiers (sharp) ; un `nuxt dev` lancé par l'utilisateur peut occuper le port 3000 (ne pas l'arrêter sans
  accord ; il s'est arrêté seul pendant l'étape 4) ; `prisma dev` (Postgres local) ne rend pas la main (utiliser `--detach`).
- **Build de production obligatoire après tout ajout de dépendance serveur** : le traçage Nitro (nft) + pnpm peut omettre des fichiers
  (exports conditionnels) alors que tout fonctionne en dev.
- `postinstall` : `nuxt prepare` **avant** `prisma generate` (sinon `tsconfig.server.json` introuvable).
- `pnpm install` « à jour » ne relance pas `postinstall` : utiliser `pnpm db:migrate` (régénère le client) après un pull.
- Props de slot à tiret → camelCase (d'où `v-bind` d'un objet dans `UiFormField`).
- `aspect-ratio` seul se laisse étirer par une image haute (image en `absolute inset-0` dans les cartes).
- vue-i18n : `@` / `|` dans les messages ; clés numériques évitées (`hour/day/week`).
- Limiteur de connexion **en mémoire** (instance unique) ; derrière un proxy, l'IP vue est celle du proxy (X-Forwarded-For non géré).
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
  WHERE "userId" = ?`) ; le module `better-sqlite3` n'est pas résolvable depuis `packages/core` (dépendance de l'adaptateur).
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
- **Build de production bloquée sur ce poste (étape 10)** — **plus constaté le 2026-10-01 en C1** (la build démarre) : Smart App Control bloquait la **copie** de `argon2.win32-x64-msvc.node` dans
  `.output/server/node_modules` (l'original de `node_modules`, identique, reste autorisé) → `pnpm start` échoue au démarrage. Ne pas contourner
  (lien physique, désactivation) : laisser l'utilisateur débloquer ; tester sur le `pnpm dev` de l'utilisateur (port 3000) sans l'arrêter, et
  vérifier la build statiquement (`grep operationId .output/server/chunks`).
- **Scalar en dev** : découverte tardive → seconde copie de Vue (« Cannot define property modal, object is not extensible ») ; corrigé par
  `vite.optimizeDeps.include: ['@scalar/api-reference']`. Scalar écrit le hash d'URL (`#tag/…`) et y revient au rechargement.
- **Bootstrap admin** : variables `NUXT_BOOTSTRAP_ADMIN_*` **commentées** dans `.env` depuis le 2026-10-01 (le compte ADMIN existe) ; les
  scripts de test lisent les lignes commentées (regex `^#?\s*NAME=`), sans jamais afficher la valeur.
- Médias de l'utilisateur à préserver : une photo (« granola », envoyée le 26/09) désormais dans la bibliothèque, et un compte EDITOR
  existant : ne jamais les supprimer dans les nettoyages de tests.
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
- Après chaque étape : `pnpm typecheck`, `pnpm test`, `pnpm i18n:check`, `pnpm a11y:contrast` (si couleurs), `db:migration --check`, build de prod,
  audit axe fr/en × clair/sombre, **mise à jour de `setup.md`** (sections + Journal des étapes : ajouté, vérifié, limites, « après git pull »)
  et de ce fichier.
- Ne pas commiter sans demande (l'utilisateur commite lui-même entre les étapes) ; messages de commit avec
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` si demandé.

## 20. Vérification (outils et méthode)

- Commandes : `pnpm typecheck`, `pnpm test` (Vitest), `pnpm i18n:check`, `pnpm a11y:contrast`,
  `pnpm --filter @surge-media/core db:migration --check`, `pnpm build` puis `pnpm start` (config `core-start` de `.claude/launch.json`).
- Tests d'API faits jusqu'ici avec des scripts Node temporaires (fetch + FormData + cookie), rejoués en dev **et** en prod ;
  S3 testé contre `s3rver` (faux S3 local, `pnpm dlx s3rver@3.7.1 --port 4568 --configure-bucket surge-media`).
- Interface : navigateur intégré (pilotage par JS quand le panneau ne s'affiche pas), audits axe injectés depuis jsDelivr.
- Automatisé dans le dépôt depuis B1 : tests unitaires Vitest des modules purs (179 tests depuis C4 : `tests/{permissions,signing,projects,credentials,api,openapi,delegated,processing,folders,transforms,image-transform}.test.ts` ;
  `image-transform` exécute le vrai pipeline sharp). Le reste (API, interface, axe) reste manuel
  (piste : tests d'intégration API + Playwright + @axe-core/playwright).
- Viewport du navigateur intégré : 1024 px (DPR 1,25) ; les mises en page à 5 colonnes doivent attendre `xl`.
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
aperçu à la volée, adresses signées si nécessaire, extraits HTML). **Phase C terminée.**

**Section vide** : aucune (la section « à venir » des jetons a été remplacée en B2).

**Architecture de la phase B validée** (toutes les décisions D1–D15 confirmées le 2026-09-29) : `.claude/architecture-phase-b.md`
— contrats détaillés des sous-étapes suivantes (types de jetons et formats, API v1, CORS, cache, transformations).

**Feuille de route** :
- **B2 (faite)** : voir § 9.11 et `setup.md` étape 6.
- **B3 (faite)** : voir § 9.12 et `setup.md` étape 7.
- **B4 (faite)** : voir § 9.13 et `setup.md` étape 8.
- **B5 (faite)** : voir § 9.14 et `setup.md` étape 9.
- **Phase C (terminée)** : `.claude/architecture-phase-c.md`. C1 : § 9.16 et `setup.md` étape 11 ; C2 : § 9.17, étape 12 ; C3 : § 9.18,
  étape 13 ; C4 : § 9.19, étape 14.
- **Suite (à proposer et faire valider avant de commencer)** : `@surge-media/client` + composants (Vue d'abord) ; **Phase D** : vidéos et
  documents (gestionnaires, signatures, Range).
- Pistes C4 : zone de recadrage (`crop`) et densité dans le générateur (sélection à la souris + champs), aperçu dans le dialogue d'un
  préréglage (avec un média de référence), `srcset` en largeurs (`w`) avec `sizes`, cache serveur des aperçus.
- Pistes C3 : point d'intérêt proposé automatiquement (`attention`), journal des changements de point d'intérêt, signature locale par
  le SDK (clé dédiée par projet), `urlTemplate` signé pour un média public en politique `signed` (aujourd'hui : lien signé à la demande).
- Pistes C2 : aperçu du rendu dans le dialogue d'un préréglage (avec C4), purge des dérivés d'un préréglage modifié ou supprimé,
  unicité des noms garantie en base, préréglages par l'API (jeton personnel), politique par environnement de clé.
- Pistes C1 : sortie GIF/animations, `X-Forwarded-For` de confiance (débit par IP derrière un CDN), limiteur partagé (Redis),
  purge des dérivés jamais redemandés.
- Pistes B5 : glisser-déposer vers un dossier, arbre complet en barre latérale, déplacement d'un dossier vers un autre espace,
  étiquettes (classement transversal), journalisation des opérations sur les dossiers, unicité des noms garantie en base (colonne
  normalisée + index), nombre de médias par dossier dans l'API.
- Pistes B4 : restauration / suppression définitive / déplacement par l'API, `If-Match` sur PATCH/PUT, clé d'idempotence des envois,
  restriction des écritures d'un jeton délégué aux médias de son sujet, compteur d'envois restants dans `/me`, révocation individuelle
  (liste de `jti`), journal de l'émission (échantillonné), file des traitements partagée (multi-instances), priorité des tâches de fond.
- Pistes B3 : cache L2 Redis et limiteurs partagés, `X-Forwarded-For` de confiance, cache serveur des résultats de liste, option « liste
  publique cachable » (CDN), limitation de débit sur `/m/` (l'interface de documentation est faite : étape 10).
- Pistes étape 10 : requêtes d'essai authentifiées par un jeton délégué de test émis par l'admin (le « jeton de console » est écarté),
  signaler à Scalar ses écarts d'accessibilité (client de requêtes), `h1` de Scalar.
- Pistes B2 : révocation des jetons d'autrui par un ADMIN (fiche utilisateur), journal par projet pour les propriétaires, purge du journal,
  sudo pour les actions sensibles sur les comptes (liens de mot de passe, rôles), limiteur de confirmation partagé (Redis).
- Autres pistes notées : commande CLI de secours admin, page « Mon compte », SMTP, copie entre stockages, nettoyage des orphelins,
  tests d'intégration automatisés, limiteur partagé (Redis), X-Forwarded-For de confiance, modèle de distribution/publication npm,
  retrait de l'override oxc-transform.

## 22. Points incertains ou à confirmer

- **Licence MIT** inscrite dans les `package.json` et le README par défaut, **jamais confirmée** par l'utilisateur.
- **Modèle de distribution** non décidé : `@surge-media/core` est `private: true` ; le client Prisma dépend du fournisseur (rebuild
  nécessaire) ; `npx surge-media init` ne fonctionne tel quel qu'une fois le package installé (ou via `npx @surge-media/core init`) —
  paquet non scopé `surge-media` ? image Docker ? build chez le client ?
- Portées et format des jetons : **implémentés en B2** selon l'architecture validée ; écarts listés en tête de `architecture-phase-b.md`.
- **MySQL/MariaDB** : SQL de migration généré mais **jamais exécuté** sur une vraie base (y compris `projects_spaces`, `b2_credentials`, `b3_api_read` et `b4_api_write`) ; PostgreSQL
  testé seulement via `prisma dev` (PGlite) jusqu'à l'étape 1, et `db reset` jamais exécuté dessus.
- **S3 réel** (AWS, R2, MinIO) jamais testé (seulement `s3rver`) ; `MediaStorage.copy` (CopyObject) et la lecture par plage (`Range`) testés seulement en local.
- Lecteurs d'écran réels jamais testés.
- Démarrage de la build de production : bloqué à l'étape 10 (argon2, Smart App Control), mais **fonctionnel le 2026-10-01 en C1**.
- **Override `oxc-transform` 0.141.0** hors de la plage de Nuxt 3.21 : fonctionne (typecheck, dev, build), mais à surveiller et retirer.
- Environnement local actuel (non versionné, indicatif) : compte `admin@surge-media.test` (ADMIN, créé par amorçage ; mot de passe dans
  `packages/core/.env`, variables d'amorçage encore présentes → avertissement au tableau de bord), un compte EDITOR créé par
  l'utilisateur le 26/09, une photo dans la bibliothèque, un projet « My Shop » créé par l'utilisateur le 29/09, un jeton personnel « Jeton Test 1 » de l'ADMIN créé par l'utilisateur le 29/09 et son
  entrée d'audit `token.created` (à préserver) ; `.env` sans `NUXT_SITE_URL` (origine de la requête en dev) ;
  base SQLite `packages/core/data/surge-media.db`.
