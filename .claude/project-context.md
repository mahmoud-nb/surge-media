# surgeMedia — contexte de référence du projet

> **Rôle de ce fichier** : mémoire technique permanente pour reprendre le développement sans
> l'historique des conversations. Complète `setup.md` (guide d'installation / d'exploitation en
> français, avec le « Journal des étapes »). En cas de divergence, **le code fait foi**, puis
> `setup.md`, puis ce fichier.
>
> **État décrit** : commit `c505758` (branche `main`, arbre propre), 2026-09-28.
> Étapes terminées : 1 (monorepo, core, base), 2 (UI, auth, rôles), 3 (utilisateurs), 4 (médias,
> phase A). **Prochaine étape prévue** : phase B — projets, jetons d'accès, API v1, CORS.
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

Plateforme de dev de l'utilisateur : **Windows 11** (PowerShell + Git Bash). Chemin : `C:\__develop\surge-media`.

## 3. Architecture globale

```text
surge-media/                         monorepo pnpm (workspaces packages/*), dépôt git (main)
├─ package.json                      scripts racine (délèguent au core), engines, packageManager
├─ pnpm-workspace.yaml               packages + allowBuilds
├─ setup.md                          guide FR + Journal des étapes (à maintenir)
├─ README.md                         présentation courte
├─ .claude/launch.json               serveurs pour l'aperçu Claude : core (dev), core-start (prod)
├─ .claude/project-context.md        CE FICHIER
└─ packages/core                     @surge-media/core (private: true, bin surge-media)
   ├─ app/                           interface Vue/Nuxt (SSR)
   ├─ server/                        Nitro : api/, routes/, middleware/, plugins/, utils/ (auto-importés), lib/ (imports explicites), generated/ (Prisma, non versionné)
   ├─ shared/                        code partagé app/serveur/CLI (auto-import de shared/utils et shared/types)
   ├─ prisma/                        schema.prisma + migrations/<fournisseur>/ + schema.snapshot.prisma
   ├─ prisma.config.ts               config Prisma 7 (URL, dossier de migrations selon DATABASE_PROVIDER)
   ├─ cli/                           CLI surge-media (init, db migrate, db reset), i18n fr/en
   ├─ scripts/                       db-migration.ts, i18n-check.ts, check-contrast.ts
   ├─ i18n/locales/                  fr.json (référence), en.json
   ├─ tsdown.config.ts               build de la CLI → dist/cli/index.mjs
   └─ data/                          (non versionné) base SQLite + médias du pilote local
```

Couches serveur :

```text
 Navigateur (admin, SSR + client)          Applications tierces (phase B)          Visiteurs / <img>
        │ cookie de session                         │ Bearer (à venir)                   │
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
- `plugins/api.ts` (`$api`), `types/page-meta.d.ts` (`PageMeta.permission`).
- `composables/` : `useAuth`, `useApiFetch`, `useFormValidation`, `useFlash`, `useMediaUpload`, `useAppHead`.
- `utils/` (auto-importés) : `cn` (clsx + tailwind-merge), `redirect.ts` (`safeAdminRedirect`), `validation.ts` (`fieldErrors`), `api-error.ts` (`apiError`), `format.ts` (`formatBytes`, `formatPercent`).
- `components/ui/` (`<Ui…>`) : Button, Input, FormField, Alert, Badge, Select, Switch, PasswordInput, Dialog, Pagination, RadioCards, CopyField.
- `components/app/` (`<App…>`) : Logo, SkipLink, ThemeSwitcher, LocaleSwitcher.
- `components/admin/` (`<Admin…>`) : Sidebar, PageHeader, UpcomingSection, RoleField, UserStatusBadge, PasswordLinkPanel, MediaUploader, MediaCard.
- `pages/` : `index` (accueil), `login`, `password/[token]`, `admin/index` (tableau de bord), `admin/users/{index,new,[id]}`, `admin/media/{index,[id]}`, `admin/projects` et `admin/tokens` (**sections « à venir »**, `AdminUpcomingSection`).
- `assets/css/main.css` : Tailwind v4, jetons de couleur `:root` / `.dark`, `@theme inline`, focus `outline`, `@utility bg-checker`, reduced-motion.

**server/**
- `api/health.get.ts`, `api/auth/{login.post,logout.post}.ts`, `api/auth/password/[token].{get,post}.ts`,
  `api/admin/status.get.ts`, `api/admin/users/**`, `api/admin/media/**`, `api/admin/config/media.get.ts`.
- `routes/m/[...path].ts` (diffusion des médias).
- `middleware/csrf.ts`.
- `plugins/` : `auth-session.ts` (hooks nuxt-auth-utils), `bootstrap-admin.ts` (avertissements au démarrage), `database.ts` (déconnexion Prisma à l'arrêt).
- `utils/` (auto-importés par Nitro) : `prisma.ts` (`usePrisma`, `textContains`, `textSearch`, `isUniqueViolation`, `disconnectPrisma`), `auth.ts`, `password.ts`, `rate-limit.ts`, `users.ts`, `password-tokens.ts`.
- `lib/` (**imports explicites**, pas d'auto-import) : `storage/{types,flydrive,index}.ts`, `media/{service,delivery,upload,sniff,keys,urls,signing,errors}.ts`, `media/handlers/{types,image,index}.ts`.

**shared/**
- `database.ts` (fournisseurs, URL par défaut, `readDatabaseEnv`, `sqliteFilePath`) — importé explicitement (`#shared/database`).
- `utils/permissions.ts` (ROLES, PERMISSIONS, ROLE_PERMISSIONS, hasPermission) — auto-importé.
- `utils/users.ts` (USER_STATUSES, userStatus, USER_ERROR_CODES) — auto-importé.
- `utils/media.ts` (MEDIA_KINDS, MEDIA_VISIBILITIES, ACCEPTED_MEDIA_TYPES, ENABLED_MEDIA_KINDS, mediaKindForMime, extensionForMime, SIGNED_URL_DURATIONS, SIGNED_URL_MAX_TTL, MEDIA_ERROR_CODES) — auto-importé.
- `schemas/{auth,users,media}.ts` (zod) — import explicite `#shared/schemas/…`.
- `types/auth.d.ts` (augmentation `#auth-utils` : User, UserSession, SecureSessionData).

## 5. Modèle de données (prisma/schema.prisma)

Identifiants : `String @id @default(cuid())` partout. Horodatages `createdAt @default(now())`, `updatedAt @updatedAt`.

| Modèle | Champs clés | Relations / index |
| --- | --- | --- |
| **User** | `email @unique` (stocké en minuscules), `name?`, `passwordHash?` (null = invitation non acceptée), `role Role @default(EDITOR)`, `locale @default("fr")` (**non utilisé par l'UI**), `isActive @default(true)`, `lastLoginAt?` | sessions, uploadedMedia (`MediaUploadedBy`), accessTokens (`AccessTokenCreatedBy`), passwordTokens (`PasswordTokenUser`), issuedPasswordTokens (`PasswordTokenCreatedBy`) |
| **Session** | `userId`, `tokenHash @unique` (SHA-256 hex du jeton), `ipAddress?`, `userAgent?` (≤191), `expiresAt`, `lastSeenAt` | user (Cascade) ; index userId, expiresAt |
| **PasswordToken** | `userId`, `purpose PasswordTokenPurpose`, `tokenHash @unique`, `expiresAt`, `usedAt?`, `createdById?` | user (Cascade), createdBy (SetNull) ; index userId |
| **Project** | `name`, `slug @unique`, `description?` | media, folders, accessTokens, allowedOrigins |
| **AccessToken** | `projectId`, `name`, `prefix`, `tokenHash @unique`, `scopes` (chaîne séparée par espaces, style OAuth), `expiresAt?`, `lastUsedAt?`, `revokedAt?`, `createdById?` | project (Cascade), createdBy (SetNull) — **modèle présent, rien d'implémenté** |
| **AllowedOrigin** | `projectId`, `origin` | project (Cascade) ; `@@unique([projectId, origin])` — **non implémenté** |
| **Folder** | `projectId`, `parentId?`, `name` | arbre (`FolderTree`, Cascade), media ; index (projectId, parentId) — **non utilisé par l'UI** |
| **Media** | `projectId`, `folderId?`, `kind MediaKind`, `visibility Visibility @default(PUBLIC)`, `storageKey @unique` (clé opaque), `version Int @default(1)`, `originalName`, `mimeType`, `size Int` (octets, ≤ 2 Gio sous PG/MySQL), `checksum` (SHA-256 hex), `width?`, `height?`, `duration?`, `title?`, `altText?`, `metadata Json?`, `uploadedById?`, `deletedAt?` (corbeille) | project (Cascade), folder (SetNull), uploadedBy (SetNull), variants ; index (projectId, createdAt), (projectId, checksum), folderId, deletedAt |
| **MediaVariant** | `mediaId`, `transformation` (ex. `v3/preview`), `storageKey @unique`, `format` (webp…), `size`, `width`, `height` | media (Cascade) ; `@@unique([mediaId, transformation])` |

Enums : `Role { ADMIN EDITOR DEVELOPER }`, `PasswordTokenPurpose { INVITATION RESET }`,
`MediaKind { IMAGE VIDEO AUDIO DOCUMENT OTHER }`, `Visibility { PUBLIC PRIVATE }`.

**Migrations** (une par fournisseur : `prisma/migrations/{sqlite,postgresql,mysql}/`) :
`20260926142611_init`, `20260926151906_update_roles` (VIEWER → EDITOR avec reprise de données ajoutée
à la main), `20260926163647_password_tokens`, `20260926203012_media_version`.

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
| `NUXT_MEDIA_MAX_UPLOAD_SIZE` | 26214400 (25 Mio) | taille max d'un envoi |
| `NUXT_MEDIA_SIGNING_SECRET` | généré par `db:init` | HMAC des liens signés ; repli : dérivé du secret de session |
| `NUXT_MEDIA_STORAGE_DRIVER` | `local` | `local` \| `s3` |
| `NUXT_MEDIA_STORAGE_ROOT` | `./data/media` | racine du pilote local (relative au dossier de lancement ou absolue) |
| `NUXT_MEDIA_STORAGE_PREFIX` | vide | préfixe de toutes les clés |
| `NUXT_MEDIA_STORAGE_S3_BUCKET/REGION/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE` | vides / false | pilote S3 (endpoint vide = AWS) |
| `SURGE_MEDIA_LANG` | locale système, sinon fr | langue de la CLI |

`NUXT_STORAGE_BASE` (étape 1) **n'existe plus** (remplacée par `NUXT_MEDIA_STORAGE_ROOT`).
Prisma 7 ne charge pas `.env` : `prisma.config.ts` fait `process.loadEnvFile` (les variables du shell priment).
En production, `.env` n'est lu que par le script `start` (`node --env-file-if-exists=.env`).
**Chemins relatifs** (SQLite, stockage local) résolus depuis le **dossier de lancement** : lancer depuis `packages/core`.

### 6.2 nuxt.config.ts (points notables)

- `modules`: `@nuxtjs/i18n`, `@nuxtjs/color-mode`, `nuxt-auth-utils`. `css`: `~/assets/css/main.css`. `vite.plugins`: tailwindcss().
- `optimization.keyedComposables: [{ name: 'useApiFetch', argumentLength: 3 }]`.
- `runtimeConfig`: `session { name: 'surge-media-session', password: '', maxAge: 43200, cookie { sameSite: 'lax', secure: true } }`,
  `bootstrapAdmin { email, password }`, `media { maxUploadSize, signingSecret, storage { driver, root, prefix, s3 {…} } }`.
- `routeRules` : `'/**'` → `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` ;
  `'/admin/**'`, `'/login'`, `'/password/**'` → `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`.
- `colorMode { classSuffix: '', storage: 'cookie', storageKey: 'surge-media-color-mode' }`.
- `i18n { defaultLocale: 'fr', strategy: 'no_prefix', locales: [fr (fr-FR, Français), en (en-US, English)], detectBrowserLanguage { useCookie, cookieKey: 'surge-media-locale', redirectOn: 'root', fallbackLocale: 'fr' } }`.
- **Pas** de `nitro.externals` (retiré avec `file-type`).

### 6.3 Scripts

Racine : `dev`, `build`, `typecheck`, `cli`, `db:init`, `db:migrate`, `db:reset`, `db:studio`, `i18n:check`, `a11y:contrast` (tous délégués au core).
Core : `dev` / `build` / `typecheck` lancent d'abord `prisma generate` ; `build` = `prisma generate && nuxt build && tsdown` ;
`start` = serveur de prod ; `postinstall` = `nuxt prepare && prisma generate` (**cet ordre est obligatoire**) ;
`cli`, `db:init|migrate|reset` (via tsx), `db:generate`, `db:studio`, `db:migration`, `i18n:check`, `a11y:contrast`.

## 7. Authentification, sessions, rôles

### 7.1 Rôles et permissions (source : `shared/utils/permissions.ts`)

| Rôle | `media:manage` | `tokens:manage` | `api:manage` (projets, CORS) | `users:manage` |
| --- | :---: | :---: | :---: | :---: |
| ADMIN | ✓ | ✓ | ✓ | ✓ |
| EDITOR (défaut, moindre privilège) | ✓ | | | |
| DEVELOPER | ✓ | ✓ | ✓ | |

- Une vérification de type (`server/utils/auth.ts`) échoue à la compilation si `ROLES` et l'enum Prisma divergent.
- Côté serveur : `requireAuth(event, permission?)` → 401 / 403. Côté UI : `useAuth().can()` et `definePageMeta({ permission })` (ergonomie uniquement).
- Navigation de la barre latérale filtrée par permission : Tableau de bord (tous), Médias (`media:manage`), Projets et API (`api:manage`), Jetons d'accès (`tokens:manage`), Utilisateurs (`users:manage`).

### 7.2 Sessions hybrides (cookie scellé + base)

- nuxt-auth-utils : cookie `surge-media-session` (HTTP-only, SameSite=Lax, Secure), chiffré avec `NUXT_SESSION_PASSWORD`.
  Contenu : `user { id, email, name, role, locale }`, `loggedInAt`, `secure { token }` (jamais envoyé au client).
- `startSession` (`server/utils/auth.ts`) : jeton aléatoire 32 octets (base64url), `Session.tokenHash = sha256(token)`, expiration = maxAge,
  IP / user-agent tronqués à 191, purge des sessions expirées de l'utilisateur, `lastLoginAt`, puis `replaceUserSession` (anti-fixation).
- `resolveSession` : session en base existante, non expirée, utilisateur actif ; met à jour `lastSeenAt` au plus toutes les 5 min.
- Hook `fetch` (`GET /api/_auth/session`) : si session invalide → `clearUserSession` + 401 ; sinon **rafraîchit `session.user` depuis la base** (rôle, nom).
- Hook `clear` : supprime la session en base (`revokeSession`).
- Conséquence : désactiver un compte, supprimer ses sessions ou changer son rôle prend effet immédiatement côté serveur.
- `requireAuth` met l'utilisateur en cache dans `event.context.authUser`.

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

Flydrive derrière notre interface `MediaStorage` · phase A d'abord (admin, diffusion, liens signés), jetons / API v1 ensuite ·
médias privés accessibles par **liens signés + jetons** · **projet par défaut automatique**.

Analyse comparative faite (résumé) : `@nuxtjs/universal-storage` = module Nuxt 2 (2021) de synchronisation cookies/localStorage,
hors sujet ; `unstorage` = KV sans flux (fichiers entiers en mémoire, pas de Range, pas d'URL signées) → gardé pour cache/KV seulement,
plus en dépendance directe ; NuxtHub blob = plateforme trop couplante ; `nuxt-file-storage` = base64 local ; Flydrive = flux, fs/S3/GCS,
URL signées, visibilité, normalisation des clés anti-traversée.

### 9.2 Stockage physique (`server/lib/storage/`)

- Interface `MediaStorage` : `driver`, `put(key, Readable, { contentType, size })`, `getStream(key)`, `stat(key) → { size } | null`,
  `delete(key)` (sans erreur si absent), `deletePrefix(prefix)`, `healthcheck()`. **Pas encore de lecture partielle (Range).**
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

1. `requireAuth(event, 'media:manage')`.
2. `receiveUpload(event, maxSize)` : exige `multipart/form-data` (sinon 400 `MULTIPART_REQUIRED`) ; refus immédiat si `Content-Length` >
   max + 64 Kio (413) ; busboy (`defParamCharset: utf8`, limites : 1 fichier champ `file`, 10 champs, 4096 o/champ, 12 parties) ;
   écriture dans un dossier temporaire `surge-media-upload-*` avec SHA-256 et taille au fil de l'eau ; dépassement → 413 `FILE_TOO_LARGE`
   (`data.maxSize`) ; fichier vide ou absent → 400 `NO_FILE` ; `cleanup()` ne lève jamais (retries, simple avertissement).
3. `sanitizeFilename` : basename, NFC, sans caractères de contrôle, ≤ 191 (extension préservée), défaut `media`.
4. Champs texte (`title`, `altText`, `visibility`) validés par `mediaMetadataSchema` (400 avec issues zod si invalide).
5. `analyze` : `sniffMimeType` → genre → gestionnaire, sinon 415 `UNSUPPORTED_TYPE` (`data.accepted`) ; `inspect`.
6. `storage.put` puis `prisma.media.create` (projet par défaut, visibilité PUBLIC par défaut) ; échec base → suppression du fichier.

### 9.5 Remplacement, métadonnées, corbeille

- `PUT /file` : mêmes contrôles ; genre différent → 422 `KIND_MISMATCH` (en pratique un non-image échoue avant, en 415) ; nouvelle clé ;
  `updateMany where { id, version }` avec `version: { increment: 1 }` → 0 ligne = 409 `VERSION_CONFLICT` (nouvelle clé supprimée) ;
  puis suppression de l'ancien original, des `MediaVariant` de l'ancienne version (`transformation startsWith v<old>/`) et des fichiers
  `variants/<id>/v<old>-*`. Titre, texte alternatif, visibilité conservés ; `originalName` = nouveau fichier.
- PATCH : `title`, `altText` (texte vide → null), `visibility`.
- Corbeille : `deletedAt` ; restauration ; suppression définitive **uniquement depuis la corbeille** (409 `NOT_IN_TRASH`) : ligne supprimée
  d'abord (variants en cascade), puis original + `variants/<id>/` (échec physique = fichier orphelin journalisé).

### 9.6 Diffusion (`server/routes/m/[...path].ts`, `server/lib/media/delivery.ts`)

- URL : `/m/<id>/v<version>/<nom>.<ext>` (original) · `/m/<id>/v<version>/preview/<nom>.webp` (aperçu). `<nom>` = slug ASCII de
  `title || originalName` (≤ 80), **purement indicatif**. Grammaire : 3–4 segments, id `^[a-z0-9]{8,64}$`, version `v\d{1,9}`,
  dérivés connus `['preview']` ; sinon 404. Méthodes GET/HEAD (autres → 405 + `Allow`). HEAD : 200 avec en-têtes seuls.
- Version différente de la courante → **302** vers l'URL courante (`Cache-Control: no-cache`).
- Accès (`authorizeDelivery`) :

| Situation | Règle | Cache-Control |
| --- | --- | --- |
| Média en corbeille | session admin (`media:manage`) seulement, sinon 404 | `private, no-cache` |
| PUBLIC | libre | `public, max-age=31536000, immutable` |
| PRIVATE + `?exp&sig` | signature valide → OK ; expirée → 403 `SIGNATURE_EXPIRED` ; invalide → 403 `SIGNATURE_INVALID` | `private, max-age=min(échéance, 3600)` |
| PRIVATE + session admin | OK | `private, no-cache` |
| PRIVATE sinon | 403 `MEDIA_FORBIDDEN` (phase B : jeton Bearer `media:read`) | — |

- En-têtes : `Content-Type` (base), `ETag` (original : 32 premiers hex du SHA-256 ; dérivé : 24 hex + `-preview`), 304 sur `If-None-Match`,
  `Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cross-Origin-Resource-Policy: cross-origin`, `Content-Disposition: inline; filename="ascii"; filename*=UTF-8''…` (nom d'origine pour
  l'original), `X-Robots-Tag: noindex` hors public ; plus les en-têtes globaux (`X-Frame-Options: DENY`…).
- Dérivés : `resolveDeliverable` → ligne `MediaVariant (mediaId, "v<version>/<variant>")` sinon génération par le gestionnaire
  (dédoublonnée par processus via une Map de promesses), `put` puis `create` (violation d'unicité ignorée).

### 9.7 Liens signés (`server/lib/media/signing.ts`, `urls.ts`)

- `sig = base64url(HMAC-SHA256(secret, "<mediaId>:<version>:<variant>:<exp>"))`, `exp` = secondes Unix. Variante `original` par défaut
  (un lien signé de l'original ne donne pas l'aperçu).
- Secret : `NUXT_MEDIA_SIGNING_SECRET`, sinon dérivé `HMAC(sessionSecret, 'surge-media:media-signing')`.
- Durée : 60 s à 7 jours (`signedUrlSchema`) ; l'UI propose 1 h / 24 h / 7 jours (`SIGNED_URL_DURATIONS` → clés i18n `hour/day/week`).
- Invalidation : remplacer le fichier (version) ou changer le secret (tous les liens).

### 9.8 Projet par défaut

`defaultProjectId()` : `upsert` du projet `slug: 'default'`, `name: 'Default project'` (mis en cache par processus). Tous les médias et
listes sont restreints à ce projet tant que l'écran Projets n'existe pas.

### 9.9 Interface médias

- `/admin/media` : section d'envoi (`AdminMediaUploader` : champ fichier natif + glisser-déposer, visibilité des envois, file de 20 entrées,
  envois séquentiels via XMLHttpRequest avec `<progress>`, pré-contrôle taille/type côté navigateur, annonces `role=status`), filtres
  (recherche, visibilité, tri, Médiathèque/Corbeille) dans l'URL (`sort=newest` omis), `h2` masqué « Résultats », grille de
  `AdminMediaCard` (lien étiré, aperçu décoratif `alt=""`, damier), pagination 24.
- `/admin/media/[id]` : aperçu (original, `alt` = texte alternatif), informations, formulaire (titre, texte alternatif avec aide,
  visibilité en `UiRadioCards`), adresse publique (`UiCopyField`) ou lien temporaire (durée + génération), remplacement (uploader PUT),
  mise à la corbeille (sans confirmation, réversible) ; en corbeille : bandeau + Restaurer + Supprimer définitivement (`UiDialog`).

## 10. Référence des API

Format d'erreur (h3) : `{ statusCode, statusMessage, message, data? }` ; **codes métier dans `data.code`** (lus côté client par
`apiError(err)` → `{ status, code, retryAfter }`). Erreurs de validation zod : 400 avec `data` = issues.

| Méthode + chemin | Accès | Entrée | Sortie / statuts |
| --- | --- | --- | --- |
| GET `/api/health` | public | — | 200/503 `{ status, checks { database, storage, imageProcessing } }` (statuts seulement) |
| POST `/api/auth/login` | public (CSRF) | `{ email, password }` | 200 `{ user }` + cookie · 400 · 401 · 429 |
| POST `/api/auth/logout` | cookie | — | `{ loggedOut: true }` |
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
| GET `/api/admin/config/media` | `media:manage` | — | `{ maxUploadSize, acceptedTypes, signedUrlDurations }` |
| GET `/api/admin/media` | `media:manage` | `?q&kind&visibility&status=active\|trash&sort=newest\|oldest\|name\|size&page` | `{ items: MediaSummary[], total, page, pageSize: 24 }` |
| POST `/api/admin/media` | `media:manage` | multipart `file` + `title?`, `altText?`, `visibility?` | 201 `{ media: MediaDetail }` · 400/413/415/422 |
| GET `/api/admin/media/:id` | `media:manage` | — | `{ media: MediaDetail }` (corbeille comprise) · 404 |
| PATCH `/api/admin/media/:id` | `media:manage` | `{ title?, altText?, visibility? }` | `{ media }` |
| PUT `/api/admin/media/:id/file` | `media:manage` | multipart `file` | `{ media }` · 409 `VERSION_CONFLICT` · 415/422 |
| DELETE `/api/admin/media/:id[?permanent=true]` | `media:manage` | — | 204 · 409 `NOT_IN_TRASH` |
| POST `/api/admin/media/:id/restore` | `media:manage` | — | `{ media }` |
| POST `/api/admin/media/:id/signed-url` | `media:manage` | `{ expiresIn }` (60–604800) | `{ path, expiresAt }` (public : URL permanente, `expiresAt: null`) · 409 si en corbeille |
| GET\|HEAD `/m/...` | selon § 9.6 | — | fichier en flux · 302/304/403/404/405 |

Contrats de données :
- `SessionUser` : `{ id, email, name, role, locale }` ; session client : `{ user, loggedInAt }`.
- `UserSummary` (`toUserSummary`) : `{ id, email, name, role, locale, isActive, status, lastLoginAt, createdAt }` (jamais d'empreinte).
- `MediaSummary` (`toMediaSummary`) : `{ id, kind, visibility, originalName, title, altText, mimeType, extension, size, width, height,
  duration, version, url, previewUrl, uploadedBy { id, name, email } | null, createdAt, updatedAt, deletedAt }` ;
  `MediaDetail` = + `checksum`, `metadata`. Les chemins (`url`, `path`) sont **relatifs** : le client les préfixe par
  `useRequestURL().origin`.
- Codes métier : utilisateurs `EMAIL_TAKEN, SELF_ACTION, LAST_ADMIN, TOKEN_INVALID` ; médias `NO_FILE, MULTIPART_REQUIRED,
  FILE_TOO_LARGE, UNSUPPORTED_TYPE, UNREADABLE_FILE, DIMENSIONS_TOO_LARGE, KIND_MISMATCH, VERSION_CONFLICT, NOT_IN_TRASH,
  MEDIA_FORBIDDEN, SIGNATURE_INVALID, SIGNATURE_EXPIRED`.
- Typage : les réponses sont inférées des routes Nitro (`useApiFetch('/api/...')`, `$api(...)`). **Éviter une route statique sœur d'une
  route dynamique** (ex. `/api/admin/media/config` à côté de `/:id`) : cela casse l'inférence des méthodes → d'où `/api/admin/config/media`.

## 11. Flux importants (résumés)

1. **Premier démarrage** : `pnpm install` → `pnpm db:init` (fournisseur, URL, migrations, secrets) → variables d'amorçage → `pnpm dev`
   → `/login` avec les identifiants d'amorçage → ADMIN créé → supprimer les variables.
2. **Rendu SSR d'une page admin** : plugin nuxt-auth-utils `fetch` → `/api/_auth/session` (hook : revalidation en base) → middleware
   `auth.global` (connexion, permission) → page → `useApiFetch` (`$api` transmet le cookie en SSR via `useRequestHeaders(['cookie'])`).
3. **Invitation** : POST users → lien → `/password/<jeton>` → POST mot de passe → `/login?passwordSet=1`.
4. **Envoi d'un média** : XHR multipart → requireAuth → busboy → temp + SHA-256 → sniff → sharp inspect → storage.put → DB → 201 →
   la médiathèque se rafraîchit (`@done`).
5. **Affichage** : `<img src="/m/...">` → route → accès → original ou aperçu (généré à la 1re demande) → flux depuis le stockage.
6. **Changement de fournisseur de base** : `pnpm db:init` / `db:reset` → `.env` + `provider` réécrit + `prisma generate` + migrations
   (données non transférées ; rebuild nécessaire car le client Prisma dépend du fournisseur).

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
- Fichiers `i18n/locales/fr.json` (référence) et `en.json` — ~296 clés. Espaces de noms : `app, a11y, nav, footer, theme, locale, form,
  validation, auth, common, landing, login, admin, roles, permissions, errors, pagination, users, password, media`.
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
- Jetons (`main.css`) vérifiés par `pnpm a11y:contrast` (30 couples × 2 thèmes : texte ≥ 4.5:1, bordures de champ et focus ≥ 3:1).
  Primaire clair `#3b4cc0`, sombre `#8b9cf7` (texte sombre dessus).
- Procédure d'audit : axe-core 4.13 injecté dans la page (snippet dans `setup.md` § 10.3), exclure `#nuxt-devtools-container` et
  `nuxt-error-overlay` (dev) ; pour chaque page, fr/en × clair/sombre, avec états d'erreur et dialogues ouverts. État actuel :
  **0 violation** sur toutes les pages existantes. Seul « incomplete » connu : contraste dans `<dialog>` (fond semi-transparent, couvert
  par le script de contrastes).
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
| Projet par défaut automatique | `Media.projectId` obligatoire, cloisonnement conservé pour la phase B |
| SVG exclu, originaux servis tels quels | SVG peut porter du script ; retrait EXIF prévu via les dérivés (phase C) |
| Recherche : `textSearch` (terme + minuscules) et `mode: 'insensitive'` seulement sous PostgreSQL | portabilité ; SQLite ne gère la casse que pour l'ASCII |
| `/api/admin/config/media` (et non `/api/admin/media/config`) | inférence des types Nitro |

## 17. Règles métier et contraintes

- Toute autorisation est **appliquée côté serveur** ; l'UI ne fait que masquer.
- Un ADMIN ne peut pas agir sur son propre rôle/statut/compte ; il reste toujours au moins un ADMIN actif (hors course concurrente extrême).
- Comptes créés uniquement par un administrateur ; e-mail immuable ; mot de passe 12–128 caractères ; e-mails en minuscules.
- Médias : un seul fichier par envoi, 25 Mio par défaut, 100 Mpx max, types JPEG/PNG/WebP/AVIF/GIF ; nom d'origine = métadonnée seulement.
- Un média en corbeille n'est plus diffusé (sauf aperçu admin) et ne peut pas recevoir de lien signé ; purge seulement depuis la corbeille.
- Lien signé lié à (média, version, dérivé, échéance) ; 7 jours maximum.
- Longueurs de texte ≤ 191 (MySQL) ; tout texte d'API validé par zod partagé.

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
- `User.locale` stocké mais non utilisé ; `Folder`, `AccessToken`, `AllowedOrigin` non implémentés.
- Pas de Range (vidéo), pas d'outil de copie entre stockages, pas de nettoyage des fichiers orphelins ni des liens de mot de passe utilisés.
- Originaux diffusés avec leurs EXIF (GPS possible).
- Pas de suite de tests automatisés (unitaires / e2e) dans le dépôt : les vérifications ont été faites par scripts ad hoc et audits
  manuels (voir § 20).

## 19. Conventions de code à respecter

- **Commentaires et docs en français** ; identifiants en anglais. Commentaires « pourquoi », en tête de fichier pour les modules clés.
- Serveur : utilitaires transverses dans `server/utils` (auto-import) ; logique métier volumineuse dans `server/lib/**` (imports explicites).
  **Uniquement des imports de types** depuis `server/generated/prisma/client` (sinon problème `import.meta.url`) ; détecter P2002 via
  `isUniqueViolation`.
- Erreurs métier : helper par domaine (`userError`, `mediaError`) → `createError({ statusCode, statusMessage: CODE, data: { code, … } })`,
  codes déclarés dans `shared/utils/*.ts`, traduits côté client.
- Validation : schémas zod dans `shared/schemas/` (messages = clés i18n), `readValidatedBody` / `getValidatedQuery` côté serveur ;
  filtres de liste tolérants (`.catch()`).
- Documenter chaque endpoint en tête de fichier (méthode, chemin, entrée, statuts).
- UI : aucun texte en dur ; jetons de couleur ; composants `Ui*`/`App*`/`Admin*` ; accessibilité vérifiée à chaque page.
- Après chaque étape : `pnpm typecheck`, `pnpm i18n:check`, `pnpm a11y:contrast` (si couleurs), `db:migration --check`, build de prod,
  audit axe fr/en × clair/sombre, **mise à jour de `setup.md`** (sections + Journal des étapes : ajouté, vérifié, limites, « après git pull »).
- Ne pas commiter sans demande (l'utilisateur commite lui-même entre les étapes) ; messages de commit avec
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` si demandé.

## 20. Vérification (outils et méthode)

- Commandes : `pnpm typecheck`, `pnpm i18n:check`, `pnpm a11y:contrast`, `pnpm --filter @surge-media/core db:migration --check`,
  `pnpm build` puis `pnpm start` (config `core-start` de `.claude/launch.json`).
- Tests d'API faits jusqu'ici avec des scripts Node temporaires (fetch + FormData + cookie), rejoués en dev **et** en prod ;
  S3 testé contre `s3rver` (faux S3 local, `pnpm dlx s3rver@3.7.1 --port 4568 --configure-bucket surge-media`).
- Interface : navigateur intégré (pilotage par JS quand le panneau ne s'affiche pas), audits axe injectés depuis jsDelivr.
- Rien de tout cela n'est encore automatisé dans le dépôt (piste : Vitest + Playwright + @axe-core/playwright).

## 21. État d'avancement et suite

**Fait** : monorepo, CLI de base de données, schéma et migrations 3 fournisseurs, health ; UI (thèmes, i18n, a11y), auth hybride, rôles,
amorçage ; gestion des utilisateurs avec liens d'invitation/réinitialisation ; médias phase A (stockage local/S3, envoi, diffusion
publique/privée/signée, aperçus, remplacement versionné, corbeille, écrans).

**Sections vides** : `/admin/projects` (`api:manage`), `/admin/tokens` (`tokens:manage`) → `AdminUpcomingSection`.

**Proposition d'architecture de la phase B** : `.claude/architecture-phase-b.md` (**en attente de validation** ;
décisions D1–D12 en § 13 de ce document). Tant qu'elle n'est pas validée, la description ci-dessous reste l'intention
initiale.

**Feuille de route** :
- **Phase B (prochaine)** : écran Projets (remplacer l'usage implicite du projet `default`), jetons d'accès (`AccessToken` : préfixe
  lisible, empreinte, portées `media:read` / `media:write` / `media:delete` envisagées, expiration, révocation, affichage unique du
  jeton), API v1 pour applications tierces (`Authorization: Bearer`), accès aux médias privés par jeton dans `authorizeDelivery`,
  CORS par projet (`AllowedOrigin`).
- **Phase C** : transformations à la demande (crop, resize, format, qualité) via `MediaVariant` et la grammaire `/m/<id>/v<n>/<transform>/<nom>`
  (déjà prévue par `parseDeliveryPath`, `MEDIA_VARIANTS`), retrait des EXIF.
- **Phase D** : vidéos et documents (gestionnaires, signatures, Range).
- Autres pistes notées : commande CLI de secours admin, page « Mon compte », SMTP, copie entre stockages, nettoyage des orphelins,
  dossiers (`Folder`), tests automatisés, limiteur partagé (Redis), X-Forwarded-For de confiance, modèle de distribution/publication npm.

## 22. Points incertains ou à confirmer

- **Licence MIT** inscrite dans les `package.json` et le README par défaut, **jamais confirmée** par l'utilisateur.
- **Modèle de distribution** non décidé : `@surge-media/core` est `private: true` ; le client Prisma dépend du fournisseur (rebuild
  nécessaire) ; `npx surge-media init` ne fonctionne tel quel qu'une fois le package installé (ou via `npx @surge-media/core init`) —
  paquet non scopé `surge-media` ? image Docker ? build chez le client ?
- **Portées exactes des jetons** et format du jeton (préfixe `sm_…` évoqué, rien de figé).
- **MySQL/MariaDB** : SQL de migration généré mais **jamais exécuté** sur une vraie base ; PostgreSQL testé seulement via `prisma dev`
  (PGlite) et `db reset` jamais exécuté dessus.
- **S3 réel** (AWS, R2, MinIO) jamais testé (seulement `s3rver`).
- Lecteurs d'écran réels jamais testés.
- Le nom du projet par défaut en base est en anglais (`Default project`) : donnée, pas texte d'interface — à revoir avec l'écran Projets.
- Environnement local actuel (non versionné, indicatif) : compte `admin@surge-media.test` (ADMIN, créé par amorçage ; mot de passe dans
  `packages/core/.env`, variables d'amorçage encore présentes → avertissement au tableau de bord) ; médiathèque vide ; base SQLite
  `packages/core/data/surge-media.db`.
