# surgeMedia — guide de développement

Ce guide explique comment installer, lancer et faire évoluer le monorepo surgeMedia.
Il est tenu à jour à chaque étape du projet (voir le [Journal des étapes](#journal-des-étapes)).

---

## 1. Prérequis

| Outil | Version | Remarque |
| --- | --- | --- |
| Node.js | 24+ (LTS active, cf. `.nvmrc`) | exigé par Flydrive 2 (stockage des médias) ; Node 22 n'est plus accepté |
| pnpm | 12.x | `corepack enable` utilise la version du champ `packageManager` |
| Git | récent | |
| PostgreSQL / MySQL / MariaDB | optionnel | uniquement si vous n'utilisez pas SQLite |

## 2. Démarrage rapide (dépôt déjà cloné)

```bash
pnpm install        # dépendances + nuxt prepare + prisma generate
pnpm db:init        # fournisseur de base (SQLite par défaut), migrations, secret de session
```

Avant la première connexion, renseignez le compte d'amorçage dans `packages/core/.env`
(voir § 9.3), par exemple :

```dotenv
NUXT_BOOTSTRAP_ADMIN_EMAIL="vous@exemple.fr"
NUXT_BOOTSTRAP_ADMIN_PASSWORD="un-mot-de-passe-long-et-unique"
```

```bash
pnpm dev            # http://localhost:3000 — connexion sur /login
```

Vérification : <http://localhost:3000/api/health> doit renvoyer
`{"status":"ok","checks":{"database":"ok","storage":"ok","imageProcessing":"ok"}}`.

## 3. Structure du monorepo

```text
surge-media/
├─ package.json            scripts racine (délèguent au core)
├─ pnpm-workspace.yaml     workspaces + builds natifs autorisés (allowBuilds)
├─ setup.md                ce guide
└─ packages/
   └─ core/                @surge-media/core : admin + API + traitement d'images
      ├─ app/              interface Vue (structure Nuxt 4)
      │  ├─ assets/css/    Tailwind v4 + jetons de design (clair / sombre)
      │  ├─ components/
      │  │  ├─ ui/         composants de base (Button, Input, FormField, Alert, Badge, Select,
      │  │  │              Switch, PasswordInput, Dialog, Pagination, RadioCards, CopyField) → <UiButton>…
      │  │  ├─ app/        briques transverses : logo, lien d'évitement, thème, langue
      │  │  └─ admin/      barre latérale, en-tête de page, rôle, lien de mot de passe, médias (envoi, carte)…
      │  ├─ composables/   useAuth(), useApiFetch(), useFormValidation(), useFlash(), useMediaUpload(), useAppHead()
      │  ├─ plugins/       api.ts ($api : appels de l'administration, gestion des sessions expirées)
      │  ├─ layouts/       default (public) et admin (barre latérale)
      │  ├─ middleware/    auth.global.ts (protection de /admin/*)
      │  ├─ pages/         index, login, password/[token], admin/… (media/, media/[id], users/, users/new, users/[id])
      │  └─ error.vue      pages d'erreur traduites (401, 403, 404, 500)
      ├─ i18n/locales/     traductions de l'interface (fr.json = référence, en.json)
      ├─ server/
      │  ├─ api/           auth/*, auth/password/*, admin/users/*, admin/media/*, admin/config/*, health
      │  ├─ routes/m/      diffusion des médias : /m/<id>/v<version>/…
      │  ├─ lib/storage/   interface MediaStorage + adaptateur Flydrive (local, S3)
      │  ├─ lib/media/     métier des médias : service, gestionnaires par genre, envoi, signature, diffusion
      │  ├─ middleware/    csrf.ts
      │  ├─ plugins/       base, sessions, rappels d'amorçage
      │  ├─ utils/         usePrisma(), requireAuth(), utilisateurs, liens de mot de passe… (auto-importés)
      │  └─ generated/     client Prisma généré (non versionné)
      ├─ shared/           code partagé app / serveur / CLI : permissions, schémas zod, BDD
      ├─ prisma/
      │  ├─ schema.prisma
      │  └─ migrations/<fournisseur>/   un historique par fournisseur
      ├─ cli/              CLI `surge-media` (init, db migrate, db reset), i18n fr/en
      ├─ scripts/          migrations, contrôle i18n, contrôle des contrastes
      ├─ prisma.config.ts  configuration Prisma 7 (URL, dossier de migrations)
      └─ data/             base SQLite et médias locaux (non versionné)
```

À venir : `packages/vue`, `packages/react`, `packages/svelte` (composants frontend)
et `packages/docs` (documentation publiée sur GitHub Pages).

## 4. Initialisation depuis zéro (référence)

Commandes utilisées pour créer le monorepo, à connaître pour reproduire ou comprendre la base :

```bash
mkdir surge-media && cd surge-media
git init -b main
# créer package.json (racine, "private": true, "packageManager": "pnpm@12.4.2")
# et pnpm-workspace.yaml (packages: - packages/*)

# Nuxt 3 avec la structure Nuxt 4 (template officiel « v4-compat »)
pnpm dlx nuxi@3.37.0 init packages/core --template v4-compat --packageManager pnpm --gitInit false --no-install
# renommer le package en "@surge-media/core" dans packages/core/package.json

# étape 1 — base de données, images, stockage, CLI
pnpm --filter @surge-media/core add prisma@7.10.0 @prisma/client@7.10.0 \
  @prisma/adapter-better-sqlite3@7.10.0 @prisma/adapter-pg@7.10.0 @prisma/adapter-mariadb@7.10.0 \
  sharp unstorage citty @clack/prompts
pnpm --filter @surge-media/core add -D typescript@~6.0.3 vue-tsc tsx tsdown @types/node@24

# étape 2 — authentification, interface, langues
pnpm --filter @surge-media/core add nuxt-auth-utils @node-rs/argon2 zod \
  @nuxtjs/i18n @nuxtjs/color-mode tailwindcss @tailwindcss/vite \
  clsx tailwind-merge @lucide/vue @fontsource-variable/inter

# étape 4 — médias (stockage multi-backend, envoi en flux)
pnpm --filter @surge-media/core add flydrive busboy @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
pnpm --filter @surge-media/core add -D @types/busboy
pnpm --filter @surge-media/core remove unstorage   # remplacé par Flydrive pour les fichiers

# pnpm 12 bloque les scripts d'installation : autoriser les modules natifs nécessaires
pnpm approve-builds better-sqlite3 esbuild @prisma/engines prisma
```

## 5. Scripts

Depuis la racine :

| Script | Rôle |
| --- | --- |
| `pnpm dev` | serveur de développement du core |
| `pnpm build` | build de tous les packages |
| `pnpm typecheck` | vérification TypeScript (vue-tsc) |
| `pnpm i18n:check` | cohérence des traductions et des clés utilisées dans le code |
| `pnpm a11y:contrast` | contrastes WCAG AA des jetons de couleur (clair et sombre) |
| `pnpm db:init` | configure la base (fournisseur + URL), applique les migrations, génère le secret de session |
| `pnpm db:migrate` | régénère le client Prisma et applique les migrations en attente |
| `pnpm db:reset` | recrée la base (⚠ supprime les données), éventuellement avec un autre fournisseur |
| `pnpm db:studio` | Prisma Studio |
| `pnpm cli <commande>` | lance la CLI `surge-media` depuis les sources |

Dans `packages/core` uniquement : `pnpm db:generate` (client Prisma), `pnpm db:migration <nom>`
(maintenance, voir § 6.5), `pnpm build:cli` (build de la CLI), `pnpm start` (serveur de production).

**Avant chaque commit touchant l'interface** : `pnpm typecheck`, `pnpm i18n:check` et, si les
couleurs changent, `pnpm a11y:contrast`.

## 6. Base de données

### 6.1 Fournisseurs supportés

| Fournisseur | `DATABASE_PROVIDER` | Exemple de `DATABASE_URL` | Driver adapter Prisma |
| --- | --- | --- | --- |
| SQLite (défaut) | `sqlite` | `file:./data/surge-media.db` | `@prisma/adapter-better-sqlite3` |
| PostgreSQL | `postgresql` | `postgresql://user:pass@localhost:5432/surge_media` | `@prisma/adapter-pg` |
| MySQL / MariaDB | `mysql` | `mysql://user:pass@localhost:3306/surge_media` | `@prisma/adapter-mariadb` |

- Le chemin SQLite relatif est résolu depuis `packages/core` : lancez toujours le serveur depuis ce dossier
  (c'est le cas des scripts `pnpm dev` / `pnpm start`).
- Les caractères spéciaux d'un mot de passe doivent être encodés dans l'URL (`@` → `%40`, `$` → `%24`…).
- Une variable `DATABASE_*` définie dans le shell est prioritaire sur le fichier `.env` (la CLI le signale).

### 6.2 La CLI `surge-media`

Prisma impose un fournisseur écrit en dur dans `schema.prisma` et génère un client propre à ce
fournisseur. Changer de base ne se résume donc pas à modifier `.env` : la CLI met à jour le `.env`,
réécrit le `provider` du schéma, régénère le client Prisma puis migre la base.

```bash
pnpm db:init                                   # interactif
pnpm db:init --provider postgresql --url "postgresql://user:pass@localhost:5432/surge_media" --yes
pnpm db:migrate                                # après une mise à jour de surgeMedia
pnpm db:reset                                  # interactif, confirmation obligatoire
pnpm db:reset --provider mysql --url "mysql://user:pass@localhost:3306/surge_media" --yes
pnpm cli --help                                # aide (--lang en pour l'anglais)
```

| Commande | Options |
| --- | --- |
| `init` | `--provider`, `--url`, `--yes`/`-y`, `--skip-migrate`, `--cwd`, `--lang` |
| `db migrate` | `--cwd`, `--lang` |
| `db reset` | `--provider`, `--url`, `--yes`/`-y`, `--cwd`, `--lang` |

- **Langue** : français par défaut, anglais disponible (`--lang en`, variable `SURGE_MEDIA_LANG`, ou
  locale du système). Les textes sont dans `cli/i18n/fr.ts` (référence) et `cli/i18n/en.ts` : toute
  nouvelle clé doit exister dans les deux (le typage l'impose).
- **Secret de session** : `init` et `reset` génèrent `NUXT_SESSION_PASSWORD` s'il est absent du `.env`
  (jamais remplacé ensuite).
- **Changement de fournisseur** : seul le schéma est recréé, les données ne sont pas transférées.
- **Après un changement de fournisseur**, reconstruisez l'application (`pnpm build`) avant de la redéployer.
- **Distribution** : le package `@surge-media/core` expose le binaire `surge-media`
  (`dist/cli/index.mjs`, construit par `pnpm build:cli`). Une fois publié : `npx @surge-media/core init`,
  ou `npx surge-media init` depuis un projet où le package est installé.

### 6.3 Variables d'environnement

Le fichier `packages/core/.env` est créé par `pnpm db:init` à partir de `.env.example`.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `sqlite` | fournisseur de base de données |
| `DATABASE_URL` | `file:./data/surge-media.db` | URL de connexion (obligatoire hors SQLite) |
| `NUXT_SESSION_PASSWORD` | généré par `db:init` | secret des cookies de session (≥ 32 caractères ; le changer déconnecte tout le monde) |
| `NUXT_SESSION_MAX_AGE` | `43200` (12 h) | durée d'une session, en secondes |
| `NUXT_SESSION_COOKIE_SECURE` | `true` | cookie réservé à HTTPS (localhost excepté) ; `false` uniquement pour un test en HTTP |
| `NUXT_BOOTSTRAP_ADMIN_EMAIL` | — | compte d'amorçage (§ 9.3), à supprimer après la première connexion |
| `NUXT_BOOTSTRAP_ADMIN_PASSWORD` | — | mot de passe d'amorçage (12 caractères minimum) |
| `SURGE_MEDIA_LANG` | locale système, sinon `fr` | langue de la CLI |
| `NUXT_MEDIA_MAX_UPLOAD_SIZE` | `26214400` (25 Mio) | taille maximale d'un fichier envoyé, en octets |
| `NUXT_MEDIA_SIGNING_SECRET` | généré par `db:init` | secret des liens signés des médias privés (le changer invalide les liens partagés) |
| `NUXT_MEDIA_STORAGE_DRIVER` | `local` | stockage des fichiers : `local` ou `s3` (§ 7) |
| `NUXT_MEDIA_STORAGE_ROOT` | `./data/media` | dossier du pilote `local` (relatif à `packages/core` ou absolu) |
| `NUXT_MEDIA_STORAGE_PREFIX` | — | préfixe de toutes les clés (partage d'un bucket) |
| `NUXT_MEDIA_STORAGE_S3_*` | — | `BUCKET`, `REGION`, `ENDPOINT` (services compatibles), `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `FORCE_PATH_STYLE` |

### 6.4 Modèle de données (`prisma/schema.prisma`)

| Modèle | Rôle |
| --- | --- |
| `User` | comptes de l'administration (rôle `ADMIN`/`EDITOR`/`DEVELOPER`, langue préférée, actif ou non) |
| `Session` | sessions d'administration (seule l'empreinte SHA-256 du jeton est stockée) |
| `PasswordToken` | lien à usage unique d'invitation ou de réinitialisation du mot de passe (empreinte, échéance, date d'utilisation) |
| `Project` | application cliente : regroupe médias, dossiers, jetons et origines CORS |
| `AccessToken` | jeton d'API d'un projet (empreinte + préfixe lisible, portées, expiration, révocation) |
| `AllowedOrigin` | origines autorisées (CORS) pour les appels navigateur d'un projet |
| `Folder` | arborescence de dossiers d'un projet |
| `Media` | fichier original : genre, visibilité publique/privée, clé de stockage opaque, version (incrémentée à chaque remplacement), dimensions, empreinte, alt, corbeille |
| `MediaVariant` | dérivé généré à la demande puis conservé (v1 : aperçu ; bientôt crop, resize, format, qualité) |

**Règles de portabilité** (le schéma doit fonctionner sur SQLite, PostgreSQL et MySQL) :
pas d'attribut natif `@db.*`, pas de liste scalaire (`String[]`), chaînes limitées à 191 caractères
sous MySQL (longueurs validées par l'API), ne jamais modifier le `provider` à la main.

### 6.5 Modifier le schéma (mainteneurs)

Le SQL de migration dépend du fournisseur : surgeMedia livre un historique par fournisseur
(`prisma/migrations/sqlite|postgresql|mysql/`). `prisma.config.ts` choisit le dossier selon
`DATABASE_PROVIDER`.

```bash
# 1. modifier prisma/schema.prisma
# 2. générer la migration de chaque fournisseur (hors ligne, aucune base requise)
pnpm --filter @surge-media/core db:migration add_media_tags
# 3. relire le SQL généré : ajouter à la main les reprises de données (ex. valeur d'enum supprimée)
# 4. appliquer localement
pnpm db:migrate
```

Le script compare `prisma/migrations/schema.snapshot.prisma` (état à la dernière migration) au schéma
courant, écrit une migration par fournisseur puis met l'instantané à jour. En CI,
`pnpm --filter @surge-media/core db:migration --check` échoue si le schéma a changé sans migration.
Ne modifiez jamais une migration déjà publiée.

## 7. Médias

### 7.1 Architecture

```text
 Admin (cookie + media:manage)    API v1 (jeton, étape à venir)    Diffusion /m/:id/v:version/:nom
             └──────────────┬──────────────┘                                │
                            ▼                                                ▼
          server/lib/media/service.ts — métier : envoi, remplacement, corbeille, recherche
          ┌─────────────────┼──────────────────────┐
          ▼                 ▼                      ▼
  handlers/ (par genre)   Prisma : Media,      server/lib/storage — interface MediaStorage
  image (sharp) ;         MediaVariant           ├─ local : Flydrive fs → NUXT_MEDIA_STORAGE_ROOT
  vidéo, document…                               └─ s3    : Flydrive s3 → AWS, R2, MinIO, OVH…
```

- **Métier et stockage séparés** : la base porte les données métier, le fichier vit sous une
  **clé opaque générée par le serveur** (`originals/2026/09/<128 bits aléatoires>.jpg`,
  dérivés `variants/<id>/v<version>-<hash>.webp`). Jamais le nom envoyé, jamais exposée.
- **Genres extensibles** : les types acceptés sont déclarés dans `shared/utils/media.ts`
  (`ACCEPTED_MEDIA_TYPES`, v1 : JPEG, PNG, WebP, AVIF, GIF ; SVG exclu car il peut contenir du
  script). Chaque genre a son gestionnaire (`server/lib/media/handlers/`) : `inspect()`
  (dimensions, durée, métadonnées) et `preview()`. Ajouter la vidéo : signature dans `sniff.ts`,
  types dans `ACCEPTED_MEDIA_TYPES`, gestionnaire inscrit au registre.
- **Stockage interchangeable** : `MediaStorage` (put/getStream/stat/delete/deletePrefix en flux)
  implémentée au-dessus de Flydrive. Nouveau backend = un `case` dans `server/lib/storage/index.ts`.

### 7.2 Configurer le stockage

```dotenv
# Disque du serveur (défaut) : autre dossier possible, relatif à packages/core ou absolu
NUXT_MEDIA_STORAGE_DRIVER="local"
NUXT_MEDIA_STORAGE_ROOT="/var/lib/surge-media/media"

# S3 ou service compatible (exemple Cloudflare R2 ; MinIO : ajouter FORCE_PATH_STYLE="true")
NUXT_MEDIA_STORAGE_DRIVER="s3"
NUXT_MEDIA_STORAGE_S3_BUCKET="surge-media"
NUXT_MEDIA_STORAGE_S3_REGION="auto"
NUXT_MEDIA_STORAGE_S3_ENDPOINT="https://<compte>.r2.cloudflarestorage.com"
NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID="…"
NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY="…"
```

Changer de stockage ne modifie ni le code, ni les API, ni la base : copier les fichiers existants
(mêmes clés, même préfixe) vers le nouvel emplacement, puis redémarrer. Les objets S3 restent privés :
la diffusion passe toujours par surgeMedia. `GET /api/health` vérifie que le stockage répond.

### 7.3 Envoi (pipeline et sécurité)

1. Session + permission `media:manage`.
2. Lecture multipart **en flux** (busboy) : un seul fichier, taille plafonnée pendant la lecture
   (`NUXT_MEDIA_MAX_UPLOAD_SIZE`) → 413 sans jamais charger le fichier en mémoire.
3. Fichier temporaire + empreinte SHA-256 et taille calculées au fil de l'eau (toujours supprimé).
4. **Type réel** d'après la signature binaire (`server/lib/media/sniff.ts`, liste d'autorisation) ;
   nom et type annoncés par le client ignorés → 415.
5. Analyse par le gestionnaire (sharp) : fichier illisible → 422 `UNREADABLE_FILE` ; plus de
   100 Mpx (bombe de décompression) → 422 `DIMENSIONS_TOO_LARGE`.
6. Écriture dans le stockage puis en base ; l'échec de l'un annule l'autre.

Remplacement (`PUT …/file`) : nouvelle clé, version + 1, mise à jour conditionnée à la version lue
(409 `VERSION_CONFLICT` si un remplacement concurrent est passé), ancien fichier et anciens dérivés
supprimés. Corbeille : `deletedAt` (plus diffusé, restaurable) ; suppression définitive depuis la
corbeille uniquement (enregistrement, original et dérivés).

### 7.4 Diffusion, médias publics et privés

`GET|HEAD /m/<id>/v<version>/<nom>.<ext>` (original) et `/m/<id>/v<version>/preview/<nom>.webp`
(aperçu 480 px, métadonnées EXIF retirées, généré à la première demande puis conservé).
Le nom est indicatif ; une ancienne version redirige (302) vers l'URL courante.

| Accès | Condition | Cache |
| --- | --- | --- |
| Public | aucune | `public, max-age=1 an, immutable` (l'URL change à chaque remplacement) |
| Privé, lien signé | `?exp=&sig=` : HMAC-SHA256 de (id, version, dérivé, échéance), 7 jours max | `private`, jusqu'à l'échéance (1 h max) |
| Privé, administration | session avec `media:manage` (aperçus, corbeille) | `private, no-cache` (ETag → 304) |
| Privé, jeton d'accès | étape « API v1 » à venir (`Authorization: Bearer`, portée `media:read`) | — |

En-têtes systématiques : type MIME lu en base, `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition` (nom d'origine encodé),
`Cross-Origin-Resource-Policy: cross-origin`, `X-Robots-Tag: noindex` hors public.
Invalidation des liens signés : remplacer le fichier (un seul média) ou changer
`NUXT_MEDIA_SIGNING_SECRET` (tous).

**Confidentialité** : l'original est servi tel quel, métadonnées EXIF comprises (appareil, parfois
coordonnées GPS). Les dérivés (aperçu, transformations à venir) n'en contiennent pas.

### 7.5 API d'administration (`media:manage`)

| Endpoint | Rôle |
| --- | --- |
| `GET /api/admin/config/media` | règles d'envoi (taille max, types acceptés, durées de lien) pour l'interface |
| `GET /api/admin/media?q=&kind=&visibility=&status=active\|trash&sort=&page=` | médiathèque paginée (24), recherche nom/titre/alt |
| `POST /api/admin/media` | multipart `file` (+ `title`, `altText`, `visibility`) → 201 |
| `GET /api/admin/media/:id` | métadonnées complètes (empreinte, métadonnées techniques) |
| `PATCH /api/admin/media/:id` | `{ title?, altText?, visibility? }` |
| `PUT /api/admin/media/:id/file` | remplacement du fichier (mêmes contrôles que l'envoi) |
| `DELETE /api/admin/media/:id` | corbeille · `?permanent=true` : suppression définitive (409 `NOT_IN_TRASH` sinon) |
| `POST /api/admin/media/:id/restore` | sortie de la corbeille |
| `POST /api/admin/media/:id/signed-url` | `{ expiresIn }` (60 s à 7 jours) → lien temporaire (URL permanente si public) |

Codes d'erreur (`data.code`, `shared/utils/media.ts`) : `NO_FILE`, `MULTIPART_REQUIRED` (400),
`FILE_TOO_LARGE` (413), `UNSUPPORTED_TYPE` (415), `UNREADABLE_FILE`, `DIMENSIONS_TOO_LARGE`,
`KIND_MISMATCH` (422), `VERSION_CONFLICT`, `NOT_IN_TRASH` (409), `MEDIA_FORBIDDEN`,
`SIGNATURE_INVALID`, `SIGNATURE_EXPIRED` (403).

### 7.6 Interface (`/admin/media`)

Médiathèque (envoi par bouton ou glisser-déposer, progression par fichier annoncée aux lecteurs
d'écran, filtres dans l'URL, grille, corbeille) et fiche d'un média (aperçu, informations, titre,
texte alternatif, visibilité, adresse publique ou lien temporaire, remplacement, corbeille).
Projet : tant que l'écran Projets n'existe pas, tous les médias appartiennent au projet
`default`, créé automatiquement.

## 8. Traitement d'images (sharp)

`sharp` (libvips) est installé avec ses binaires précompilés ; aucun outil de compilation n'est
nécessaire sur Windows, macOS et Linux glibc. La sonde `/api/health` vérifie qu'il se charge.
Son cache d'opérations est désactivé (`sharp.cache(false)`) : il garderait les fichiers temporaires
ouverts, et donc verrouillés sous Windows.

## 9. Authentification et rôles

### 9.1 Rôles et permissions

Source unique : `shared/utils/permissions.ts` (auto-importé côté app et serveur). L'enum `Role` de
Prisma doit rester identique à `ROLES` : une vérification de type dans `server/utils/auth.ts` échoue
à la compilation sinon.

| Rôle | `media:manage` | `tokens:manage` | `api:manage` (projets, CORS) | `users:manage` |
| --- | :---: | :---: | :---: | :---: |
| `ADMIN` | ✓ | ✓ | ✓ | ✓ |
| `EDITOR` | ✓ | | | |
| `DEVELOPER` | ✓ | ✓ | ✓ | |

### 9.2 Sessions (hybride : cookie scellé + base)

- **Interface** : `nuxt-auth-utils` pose un cookie `surge-media-session` HTTP-only, `SameSite=Lax`,
  `Secure`, chiffré avec `NUXT_SESSION_PASSWORD`. Il contient un jeton aléatoire dont l'empreinte est
  enregistrée dans la table `Session`.
- **Validation côté serveur** : chaque lecture de session (`/api/_auth/session`) et chaque appel
  protégé (`requireAuth`) vérifient la session en base. Supprimer la session ou désactiver le compte
  (`User.isActive = false`) coupe l'accès immédiatement. Le rôle affiché est relu en base.
- **API applicative** (étape à venir) : les applications tierces utiliseront des jetons d'accès
  (`AccessToken`), pas de cookie.

| Endpoint | Rôle |
| --- | --- |
| `POST /api/auth/login` | `{ email, password }` → 200 + cookie · 400 invalide · 401 refusé · 429 trop de tentatives (`Retry-After`) |
| `POST /api/auth/logout` | ferme la session (cookie + base) |
| `GET /api/admin/status` | état de l'instance pour les administrateurs (`users:manage`) |
| `/api/admin/users/*`, `/api/auth/password/*` | gestion des utilisateurs, voir § 9.4 |

Protéger une nouvelle route API :

```ts
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, 'media:manage') // 401 sans session, 403 sans permission
  // …
})
```

Protéger une nouvelle page : toute page sous `/admin` exige une session (middleware
`auth.global.ts`) ; déclarer la permission requise avec
`definePageMeta({ layout: 'admin', permission: 'tokens:manage' })`. Côté interface,
`useAuth().can('…')` sert à masquer ce qui est interdit ; la sécurité reste assurée par l'API.

**Mesures de sécurité** : mots de passe hachés en argon2id (paramètres OWASP), réponse identique et
durée constante que le compte existe ou non, 5 échecs par e-mail / 50 par IP sur 15 min (limiteur en
mémoire : à partager via Redis en multi-instances), régénération du cookie à la connexion
(anti-fixation), contrôle d'origine (CSRF) sur les requêtes modifiantes authentifiées par cookie,
redirection après connexion limitée aux chemins `/admin`, en-têtes `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, et `Cache-Control: no-store` + `noindex` sur `/admin` et `/login`.

### 9.3 Première connexion (compte d'amorçage)

1. Définir `NUXT_BOOTSTRAP_ADMIN_EMAIL` et `NUXT_BOOTSTRAP_ADMIN_PASSWORD` (12 caractères minimum).
2. Se connecter sur `/login` avec ces identifiants : le compte `ADMIN` est créé en base (mot de passe haché).
3. Supprimer les deux variables et redémarrer. Elles ne servent **que tant qu'aucun utilisateur
   n'existe** ; ensuite elles sont ignorées, le serveur le rappelle au démarrage et le tableau de bord
   affiche un avertissement aux administrateurs.

Il n'y a pas d'inscription publique : les comptes sont créés par un administrateur (§ 9.4).

### 9.4 Gestion des utilisateurs (`/admin/users`, permission `users:manage`)

**Parcours** : l'administrateur crée le compte (e-mail, nom facultatif, rôle ; `EDITOR` présélectionné,
le moins privilégié). Aucun mot de passe n'est saisi : un **lien d'invitation à usage unique** (7 jours)
est affiché une seule fois, à copier et transmettre par un canal sûr (pas encore d'envoi d'e-mail).
L'utilisateur ouvre `/password/<jeton>`, choisit son mot de passe (12 caractères minimum, saisi deux
fois), puis se connecte. Mot de passe oublié : l'administrateur génère un **lien de réinitialisation**
(24 h) depuis la fiche du compte ; l'ancien mot de passe reste valable jusqu'à son utilisation, puis
toutes les sessions du compte sont fermées.

| Endpoint | Rôle |
| --- | --- |
| `GET /api/admin/users?q=&role=&status=&page=` | liste paginée (20 par page) ; recherche nom / e-mail insensible à la casse ; filtres invalides ignorés |
| `POST /api/admin/users` | création + lien d'invitation (201) · 409 `EMAIL_TAKEN` |
| `GET /api/admin/users/:id` | fiche : profil, sessions ouvertes, lien en attente (type et échéance, jamais le jeton) |
| `PATCH /api/admin/users/:id` | `{ name?, role?, isActive? }` ; désactiver ferme les sessions immédiatement |
| `DELETE /api/admin/users/:id` | suppression définitive (les médias du compte sont conservés) |
| `POST /api/admin/users/:id/password-link` | nouveau lien (invitation ou réinitialisation) ; annule le précédent · 409 si compte désactivé |
| `DELETE /api/admin/users/:id/sessions` | ferme les sessions du compte (sur son propre compte : sauf la session en cours) |
| `GET /api/auth/password/:token` | public : e-mail et type du lien · 404 `TOKEN_INVALID` |
| `POST /api/auth/password/:token` | public : `{ password, confirmation }` → enregistre le mot de passe (204) · 404 `TOKEN_INVALID` |

**Règles imposées par le serveur** (l'interface les reflète, mais ne les remplace pas) :

- un administrateur ne peut ni changer son propre rôle, ni se désactiver, ni se supprimer
  (403 `SELF_ACTION`) ;
- on ne retire jamais le dernier administrateur actif (409 `LAST_ADMIN`) ;
- un changement de rôle s'applique à la requête suivante (le rôle est relu en base) ;
- un lien est à usage unique (consommation atomique), expire, et n'est plus valable si le compte est
  désactivé ; seule son empreinte SHA-256 est stockée ;
- les erreurs métier sont renvoyées dans `data.code` (`shared/utils/users.ts`) et traduites par
  l'interface via `apiError()`.

**Statuts** : `active` (mot de passe défini), `invited` (invitation pas encore acceptée),
`inactive` (compte désactivé).

## 10. Interface d'administration

### 10.1 Pile et conventions

- **Tailwind CSS v4** (plugin Vite) et composants maison dans `app/components/ui/`, inspirés de
  shadcn-vue (variantes typées, prop `class` fusionnée par `cn()` = clsx + tailwind-merge).
  Pas de bibliothèque de composants : le code reste simple à auditer et à adapter.
- **Nommage** : `components/ui/Button.vue` → `<UiButton>`, `components/admin/Sidebar.vue` → `<AdminSidebar>`.
- **Icônes** : `@lucide/vue`, toujours décoratives (`aria-hidden="true"`), le texte porte le sens.
- **Police** : Inter, auto-hébergée (`@fontsource-variable/inter`, aucune requête externe).

Structure d'un composant de base (extrait de `UiButton`) :

```vue
<script setup lang="ts">
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'
const props = withDefaults(defineProps<{ variant?: ButtonVariant, class?: HTMLAttributes['class'] }>(), { variant: 'primary' })
const VARIANTS: Record<ButtonVariant, string> = { primary: 'bg-primary text-primary-foreground hover:bg-primary-hover' /* … */ }
const classes = computed(() => cn('inline-flex items-center …', VARIANTS[props.variant], props.class))
</script>
```

Formulaire accessible avec `<UiFormField>` (libellé, aide et erreur reliés automatiquement) et
`useFormValidation()` (schéma zod partagé avec l'API, messages traduits, focus sur le premier champ
en erreur, erreurs serveur via `setError`) :

```vue
<UiFormField v-slot="field" :label="t('login.email.label')" :error="errorMessage('email')" required>
  <UiInput v-bind="field" v-model="form.email" type="email" autocomplete="username" />
</UiFormField>
```

Appels à l'API de l'administration : `useApiFetch()` (même signature que `useFetch`) ou
`useNuxtApp().$api(…)`. En cas de 401 (session expirée ou révoquée), l'utilisateur est renvoyé vers
`/login?expired=1` et retrouve sa page après connexion. Messages après redirection (création,
suppression…) : `useFlash()`. Confirmation d'une action destructive : `<UiDialog>` (élément
`<dialog>` natif, focus sur « Annuler »).

### 10.2 Thèmes clair / sombre

`@nuxtjs/color-mode` (cookie `surge-media-color-mode`, rendu serveur sans flash) pose la classe
`.dark` sur `<html>`. Les couleurs sont des jetons CSS (`app/assets/css/main.css`) exposés à Tailwind
(`bg-surface`, `text-muted-foreground`, `border-input`…). N'utilisez pas de couleurs Tailwind brutes
(`bg-blue-600`) : passez par les jetons, puis `pnpm a11y:contrast` après toute modification.

### 10.3 Accessibilité (WCAG 2.2 AA)

Règles appliquées, à respecter pour toute nouvelle page :

- Structure : lien d'évitement, landmarks (`header`, `nav`, `main`, `footer`), un seul `h1` par page,
  titre de page traduit (`useSeoMeta`), annonce des changements de page (`<NuxtRouteAnnouncer>`).
- Clavier : tout est utilisable au clavier, focus toujours visible (`outline`, conservé en mode
  contrastes élevés), Échap ferme les menus et rend le focus au bouton d'origine.
- Formulaires : `novalidate` + validation zod traduite, erreurs reliées par `aria-describedby`,
  `aria-invalid`, focus sur le premier champ en erreur, erreurs serveur dans `role="alert"`,
  jamais d'information portée par la seule couleur (icône + texte).
- Contrastes : texte ≥ 4.5:1, bordures de champs et focus ≥ 3:1, vérifiés par script.
- Mouvement : animations désactivées si `prefers-reduced-motion`.

**Audit** : l'extension axe DevTools, ou dans la console du navigateur :

```js
await new Promise((resolve) => {
  const script = document.createElement('script')
  script.src = 'https://cdn.jsdelivr.net/npm/axe-core@4.13.0/axe.min.js'
  script.onload = resolve
  document.head.append(script)
})
;(await axe.run({ exclude: [['#nuxt-devtools-container'], ['nuxt-error-overlay']] })).violations
```

À faire pour chaque page, en fr et en, en thème clair et sombre (l'état de l'étape 2 : 0 violation).

## 11. Multilingue

- `@nuxtjs/i18n`, stratégie `no_prefix` : les URL ne changent pas (`/admin`), la langue est mémorisée
  dans le cookie `surge-media-locale` ; première visite : langue du navigateur, sinon français.
- **Aucun texte en dur** : chaque texte visible, `aria-label`, `title` et `alt` passe par `t('…')`.
  Les messages de validation zod sont des clés (`validation.*`) traduites par l'interface.
- Syntaxe vue-i18n : `{name}` est un paramètre ; `@` et `|` sont réservés (écrire `{'@'}`).
- `pnpm i18n:check` vérifie que chaque langue a exactement les clés et paramètres de `fr.json`, et
  que les clés utilisées dans `app/` et `shared/` existent.

**Ajouter une langue** (ex. allemand) :

1. copier `i18n/locales/fr.json` en `i18n/locales/de.json` et traduire les valeurs ;
2. ajouter `{ code: 'de', language: 'de-DE', name: 'Deutsch', file: 'de.json', dir: 'ltr' }` dans
   `i18n.locales` de `nuxt.config.ts` (`dir: 'rtl'` pour l'arabe ou l'hébreu) ;
3. lancer `pnpm i18n:check`. Le sélecteur de langue affiche automatiquement la nouvelle langue.

## 12. Production

```bash
pnpm build                          # prisma generate + nuxt build + build de la CLI
cd packages/core && pnpm db:migrate # appliquer les migrations sur la base de production
pnpm start                          # node --env-file-if-exists=.env .output/server/index.mjs
```

- En production, `.env` n'est lu que par le script `start` ; sinon fournissez les variables d'environnement.
- `NUXT_SESSION_PASSWORD` est obligatoire et doit rester stable ; servez l'application en **HTTPS**
  (cookie `Secure`), derrière un proxy qui transmet l'en-tête `Host` d'origine (contrôle CSRF).
- Derrière un proxy, le limiteur de connexion voit l'IP du proxy : la limite par IP (50 échecs / 15 min)
  s'applique alors à tous les utilisateurs. La prise en compte de `X-Forwarded-For` (proxy de
  confiance) est à ajouter avant un déploiement à fort trafic.
- Le client Prisma est lié au fournisseur choisi : tout changement de fournisseur impose un rebuild.
- `GET /api/health` : 200 si base, stockage et sharp répondent, 503 sinon (sonde Docker / orchestrateur).
- Stockage local : sauvegarder `NUXT_MEDIA_STORAGE_ROOT` avec la base (volume persistant en conteneur).
- Placer un CDN ou un cache devant `/m/` est possible : les URL publiques sont immuables.

## 13. Choix techniques et versions épinglées

| Choix | Pourquoi |
| --- | --- |
| Nuxt 3.21 + `future.compatibilityVersion: 4` | Nuxt 3 demandé, toujours maintenu en parallèle de Nuxt 4 ; structure `app/` et comportements Nuxt 4 déjà actifs, la migration se limitera à la mise à jour de la dépendance |
| Prisma **7.10.0** épinglé exactement | le tag npm `latest` de `prisma` pointe vers une 8.0.0-rc ; ne pas mettre à jour sans tester |
| Prisma 7 + driver adapters | client sans moteur Rust ; un adapter par fournisseur, choisi à l'exécution |
| TypeScript **~6.0** | TypeScript 7 (compilateur natif) n'est pas encore utilisable par `vue-tsc` |
| `prisma` en dépendance (pas devDependency) | la CLI `surge-media` en a besoin chez l'utilisateur final pour générer et migrer |
| Client Prisma importé dynamiquement (`usePrisma()` asynchrone) | voir Dépannage : « File URL path must be absolute » |
| CLI : citty + @clack/prompts, build tsdown | écosystème UnJS (comme Nuxt), binaire ESM autonome |
| nuxt-auth-utils + table `Session` | cookie scellé standard de l'écosystème Nuxt, complété par une session en base pour la révocation |
| argon2id via `@node-rs/argon2` | recommandation OWASP ; binaires précompilés (aucune compilation, embarqués par Nitro) |
| Tailwind v4 + composants maison (pas shadcn-vue ni @nuxt/ui) | contrôle total de l'accessibilité et du thème, zéro dépendance de composants ; Reka UI pourra être ajouté pour les primitives complexes (boîtes de dialogue, menus) |
| i18n `no_prefix` | URL stables pour l'administration (`/admin/*`), langue par cookie |
| **Flydrive** derrière notre interface `MediaStorage` (et non unstorage) | analyse de l'étape 4 : unstorage charge les fichiers entiers en mémoire (pilotes fs et s3), sans lecture partielle ni URL signées ; `@nuxtjs/universal-storage` est un module Nuxt 2 de 2021 pour cookies/localStorage ; NuxtHub impose sa plateforme. Flydrive : flux, S3/R2/MinIO/GCS, protection des clés, remplaçable |
| Node **≥ 24** | exigé par Flydrive 2 (Node 24 = LTS active) ; Flydrive 1.3 resterait possible pour Node 22 |
| Détection du type maison (`sniff.ts`) plutôt que `file-type` | aucune dépendance, liste d'autorisation explicite ; `file-type` ne fonctionnait pas après build (voir Dépannage) |
| S3 : sommes de contrôle `WHEN_REQUIRED` | les SDK récents envoient en `aws-chunked` par défaut, que certains services compatibles stockent tels quels (fichiers corrompus) |

## 14. Dépannage

| Symptôme | Cause / solution |
| --- | --- |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 12 bloque les scripts d'installation : `pnpm approve-builds <paquet>` (la liste autorisée est dans `pnpm-workspace.yaml` › `allowBuilds`) |
| Avertissement *unmet peer @nuxt/schema ^4* (via `@nuxt/cli`) | sans effet : la CLI Nuxt est partagée entre Nuxt 3 et 4 |
| `File '../.nuxt/tsconfig.server.json' not found` pendant `prisma generate` | lancer `nuxt prepare` avant `prisma generate` (ordre du `postinstall`) |
| `File URL path must be absolute` au démarrage (Windows) | ne jamais importer statiquement `server/generated/prisma` dans le code serveur : passer par `await usePrisma()` |
| `P3019` / fournisseur différent de `migration_lock.toml` | `.env` et schéma désynchronisés : relancer `pnpm db:init` |
| `prisma migrate reset` refusé (« invoked by … AI agent ») | garde-fou de Prisma quand la commande est lancée par un agent IA : lancez `pnpm db:reset` vous-même |
| Base SQLite créée au mauvais endroit | lancer les commandes depuis `packages/core` (chemin relatif) ou utiliser un chemin absolu |
| Connexion acceptée mais retour immédiat sur `/login` | cookie `Secure` refusé en HTTP (hors localhost) : servir en HTTPS, ou `NUXT_SESSION_COOKIE_SECURE=false` pour un test |
| `[nuxt-auth-utils] NUXT_SESSION_PASSWORD … was not set` | lancer `pnpm db:init` (génère le secret) ou le définir (32 caractères minimum) |
| Première connexion refusée | aucun utilisateur ET variables d'amorçage définies ? mot de passe ≥ 12 caractères ? (message au démarrage du serveur) |
| `403 Cross-origin request blocked` | requête modifiante d'une autre origine, ou proxy qui réécrit l'en-tête `Host` |
| Clé affichée à la place d'un texte (`admin.nav.xxx`) | clé absente de `fr.json` : `pnpm i18n:check` l'indique |
| Page d'administration en erreur au chargement direct, mais correcte après navigation | appel fait en rendu serveur sans le cookie de session : utiliser `useApiFetch` / `$api` (qui le transmettent) ou `useFetch`, jamais une instance `$fetch.create()` maison |
| Lien de mot de passe « invalide ou expiré » | déjà utilisé, expiré (7 j / 24 h), remplacé par un lien plus récent, ou compte désactivé : en générer un nouveau depuis la fiche du compte |
| Plus aucun administrateur ne peut se connecter | pas encore de commande de secours : voir « Limites connues » de l'étape 3 |
| `EBUSY … surge-media-upload-…` (Windows) | fichier temporaire verrouillé : cache libvips (désactivé depuis l'étape 4) ; redémarrer le serveur libère les anciens verrous |
| Fichiers S3 corrompus (entourés de `x-amz-checksum`) | service compatible S3 ne gérant pas `aws-chunked` : réglage `WHEN_REQUIRED` déjà appliqué ; vérifier la version du service |
| `Cannot find module …/strtok3/lib/index.js` après build | dépendance à exports conditionnels mal tracée par Nitro avec pnpm : c'est pourquoi `file-type` a été remplacé ; tester tout nouveau paquet **après `pnpm build`** |
| Envoi refusé 415 alors que le fichier est une image | format non accepté (HEIC, TIFF, SVG…) ou fichier renommé : seuls JPEG, PNG, WebP, AVIF et GIF sont reconnus |
| Média introuvable (404) juste après sa mise à la corbeille | normal : un média en corbeille n'est plus diffusé (sauf aperçu dans l'administration) |

---

## Journal des étapes

### Étape 1 — 2026-09-26 — Monorepo et base du core

**Ajouté**
- Monorepo pnpm (workspaces `packages/*`, Node 22.12+/24, pnpm 12, `allowBuilds` pour better-sqlite3, esbuild et Prisma).
- `packages/core` (`@surge-media/core`) : Nuxt 3.21 en mode compatibilité Nuxt 4.
- Prisma 7.10 : `schema.prisma` (utilisateurs, sessions, projets, jetons d'accès, origines CORS, dossiers,
  médias, dérivés), `prisma.config.ts`, migrations initiales pour SQLite, PostgreSQL et MySQL,
  script `db:migration` pour les suivantes.
- Serveur : `usePrisma()` (driver adapter selon le fournisseur), stockage unstorage `media`, `GET /api/health`.
- CLI `surge-media` (fr/en) : `init`, `db migrate`, `db reset`, avec mode non interactif.
- Dépendances : sharp 0.35, unstorage 1.17, citty, @clack/prompts ; outillage tsx, tsdown, vue-tsc, TypeScript 6.

**Vérifié** : typecheck, `pnpm dev`, build de production + `pnpm start`, `/api/health` sur SQLite (dev et
production) et PostgreSQL (dev), bascule SQLite → PostgreSQL → SQLite via `pnpm db:init`.
`db reset` n'a pas été exécuté sur PostgreSQL (garde-fou Prisma envers les agents IA) : à tester à la main.

**Après `git pull`**
```bash
pnpm install
pnpm db:init
```

### Étape 2 — 2026-09-26 — Socle UI, authentification et rôles

**Ajouté**
- Rôles `ADMIN`, `EDITOR`, `DEVELOPER` (migration `update_roles` pour les 3 fournisseurs ; les anciens
  comptes `VIEWER` passent `EDITOR`), permissions partagées app/serveur.
- Authentification : nuxt-auth-utils + sessions en base, argon2id, `POST /api/auth/login`,
  `POST /api/auth/logout`, `requireAuth()`, limitation des tentatives, contrôle CSRF, compte
  d'amorçage par variables d'environnement, en-têtes de sécurité.
- Interface : Tailwind v4, jetons clair/sombre, composants `UiButton`, `UiInput`, `UiFormField`,
  `UiAlert`, layouts `default` et `admin` (barre latérale filtrée par rôle, menu mobile), pages
  d'accueil, de connexion (validation zod), tableau de bord, sections protégées (médias, projets et
  API, jetons, utilisateurs — contenu à venir), pages d'erreur traduites.
- Multilingue : @nuxtjs/i18n (fr par défaut, en), sélecteur de langue, `pnpm i18n:check`.
- Accessibilité : `pnpm a11y:contrast` ; la CLI génère désormais `NUXT_SESSION_PASSWORD`,
  et `db migrate` régénère aussi le client Prisma.

**Vérifié** : typecheck, i18n, contrastes, build de production + `pnpm start` (connexion, session,
déconnexion). Dans le navigateur : accueil, connexion (validation, erreurs 401/429), tableau de bord,
filtrage de la navigation et 403 pour EDITOR et DEVELOPER, révocation immédiate d'un compte désactivé,
menu mobile au clavier ; axe-core : 0 violation WCAG 2.2 AA sur toutes les pages en fr/en × clair/sombre.
Non vérifié : lecteurs d'écran réels (NVDA, VoiceOver), à faire avant la première version publique.

**Après `git pull`**
```bash
pnpm install
pnpm db:migrate     # rôles + client Prisma
pnpm db:init --yes  # ajoute NUXT_SESSION_PASSWORD au .env s'il manque
```
Puis renseigner `NUXT_BOOTSTRAP_ADMIN_EMAIL` / `NUXT_BOOTSTRAP_ADMIN_PASSWORD` (§ 9.3) si aucun compte n'existe.

### Étape 3 — 2026-09-26 — Gestion des utilisateurs

**Ajouté**
- Modèle `PasswordToken` (migration `password_tokens` pour les 3 fournisseurs).
- API `/api/admin/users` (liste filtrée et paginée, création, fiche, modification, suppression, lien
  de mot de passe, fermeture des sessions) et API publique `/api/auth/password/:token`.
- Règles serveur : pas d'action sur son propre rôle / statut / compte, jamais sans administrateur
  actif, désactivation = sessions fermées, liens à usage unique et à durée limitée.
- Pages `/admin/users` (recherche, filtres dans l'URL, tableau, pagination), `/admin/users/new`,
  `/admin/users/[id]` (profil, accès et sécurité, suppression confirmée) et page publique
  `/password/[token]` (activation du compte ou nouveau mot de passe).
- Composants `UiBadge`, `UiSelect`, `UiSwitch`, `UiPasswordInput`, `UiDialog`, `UiPagination`,
  `AdminRoleField`, `AdminUserStatusBadge`, `AdminPasswordLinkPanel` ; composables `useFormValidation`,
  `useApiFetch`, `useFlash` ; plugin `$api` (session expirée → retour à la connexion).
- Page de connexion : messages « session expirée » et « mot de passe enregistré ».
- `pnpm i18n:check` contrôle aussi les clés de `<i18n-t keypath>`.

**Vérifié** : typecheck, i18n (199 clés), contrastes, migrations. Dans le navigateur : création
(validation, doublon d'e-mail, lien d'invitation), activation par le lien puis réutilisation refusée,
modification du rôle et désactivation, lien de réinitialisation, suppression avec boîte de dialogue au
clavier, session révoquée pendant l'utilisation → retour à `/login`. API : règles `SELF_ACTION`,
403 pour un DEVELOPER, CSRF, recherche insensible à la casse, filtres invalides. axe-core : 0 violation
WCAG 2.2 AA sur toutes les nouvelles pages (et la boîte de dialogue ouverte) en fr/en × clair/sombre.
Non refait : build de production (un `nuxt dev` tournait déjà sur le port 3000 ; aucune nouvelle
dépendance native dans cette étape).

**Limites connues**
- Pas d'envoi d'e-mail : les liens sont transmis à la main par l'administrateur.
- Pas de commande de secours si le seul administrateur perd son mot de passe (à ajouter à la CLI).
- Pas encore de page « Mon compte » pour changer soi-même son mot de passe (passer par un lien de
  réinitialisation généré par un autre administrateur).

**Après `git pull`**
```bash
pnpm install
pnpm db:migrate     # table PasswordToken + client Prisma
```

### Étape 4 — 2026-09-26 — Gestion des médias (phase A)

**Décisions validées** : Flydrive derrière notre interface `MediaStorage` ; phase A (administration,
diffusion, liens signés) avant les jetons et l'API v1 ; liens signés + jetons pour les médias privés ;
projet par défaut automatique.

**Ajouté**
- Stockage : interface `MediaStorage`, adaptateur Flydrive, pilotes `local` et `s3` (AWS et compatibles),
  préfixe de clés, configuration `NUXT_MEDIA_STORAGE_*` ; l'ancien montage unstorage est retiré.
- Métier : `MediaService` (envoi, remplacement versionné, métadonnées, corbeille, purge, recherche),
  registre de gestionnaires par genre (image : sharp), détection du type par signature, envoi en flux
  (busboy) avec plafond, clés opaques, projet `default`.
- Diffusion `/m/…` : public (cache immuable), privé (session ou lien signé HMAC), aperçus WebP générés à
  la demande (`MediaVariant`), ETag/304, HEAD, redirection des anciennes versions, en-têtes de sécurité.
- API d'administration (`/api/admin/media`, `/api/admin/config/media`) et écrans `/admin/media`
  (médiathèque, envoi accessible, corbeille) et `/admin/media/[id]` ; composants `UiRadioCards`,
  `UiCopyField` (réutilisés pour le rôle et les liens de mot de passe), `AdminMediaUploader`,
  `AdminMediaCard`.
- Migration `media_version` ; secret `NUXT_MEDIA_SIGNING_SECRET` généré par `db:init` ; Node ≥ 24.
- Recherche insensible à la casse améliorée sous SQLite (lettres accentuées), aussi pour les utilisateurs.

**Vérifié** : typecheck, i18n (296 clés), contrastes, migrations. API (dev **et build de production**) :
envois valides (JPEG, PNG, WebP, AVIF, GIF animé), refus 400/413/415/422, diffusion publique et
privée, lien signé valide, altéré et expiré, chemins malveillants (404), ETag/304, HEAD, remplacement
(redirection de l'ancienne URL, fichiers supprimés), corbeille, restauration, purge (stockage vide),
CSRF. S3 : adaptateur et application complète contre un serveur S3 local (`s3rver`) — contenu
identique octet par octet, préfixe, aperçus, purge. Interface : envoi réel (valide, faux fichier,
fichier trop lourd), fiche, lien temporaire, remplacement, corbeille et suppression au clavier ;
axe-core : 0 violation WCAG 2.2 AA sur toutes les pages médias (et la boîte de dialogue ouverte) en
fr/en × clair/sombre.
Non vérifié : un vrai compte AWS S3 / Cloudflare R2 / MinIO (seulement le serveur de test `s3rver`).

**Limites connues**
- Originaux servis avec leurs métadonnées EXIF (voir § 7.4) ; les transformations à venir les retireront.
- Pas encore de lecture partielle (`Range`) : à ajouter à `MediaStorage` avec la vidéo.
- Copie des fichiers lors d'un changement de stockage : manuelle (commande CLI à venir).
- Dossiers (`Folder`) présents dans le schéma mais pas encore dans l'interface.

**Après `git pull`**
```bash
nvm use 24          # Node 24 désormais requis
pnpm install
pnpm db:migrate     # champ Media.version + client Prisma
pnpm db:init --yes  # ajoute NUXT_MEDIA_SIGNING_SECRET au .env s'il manque
```
Dans `.env`, remplacer `NUXT_STORAGE_BASE` par `NUXT_MEDIA_STORAGE_ROOT` s'il avait été modifié.
