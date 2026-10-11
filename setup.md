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
| ffmpeg et ffprobe | 6+ (optionnel) | traitement des vidéos (phase D3, désactivé par défaut) : binaires du système, avec les encodeurs `libx264` et `aac` (§ 7.7) |

## 2. Démarrage rapide (dépôt déjà cloné)

```bash
pnpm install        # dépendances + nuxt prepare + clients Prisma (un par fournisseur)
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
`{"status":"ok","checks":{"database":"ok","storage":"ok","imageProcessing":"ok"},"videoProcessing":{"mode":"off","workers":null,"queued":null}}`
(`videoProcessing` : traitement des vidéos, désactivé par défaut, § 7.7).

## 3. Structure du monorepo

```text
surge-media/
├─ package.json            scripts racine (délèguent au core)
├─ pnpm-workspace.yaml     workspaces + builds natifs autorisés (allowBuilds)
├─ setup.md                ce guide
└─ packages/
   └─ core/                @surge-media/core : admin + API + traitement d'images et de vidéos
      ├─ app/              interface Vue (structure Nuxt 4)
      │  ├─ assets/css/    Tailwind v4 + jetons de design (clair / sombre)
      │  ├─ components/
      │  │  ├─ ui/         composants de base (Button, Input, FormField, Alert, Badge, Select,
      │  │  │              Switch, PasswordInput, Dialog, Pagination, RadioCards, CheckboxGroup, CopyField,
      │  │  │              CopyButton) → <UiButton>…
      │  │  ├─ app/        briques transverses : logo, lien d'évitement, thème, langue
      │  │  └─ admin/      barre latérale, en-tête de page, rôle, lien de mot de passe, médias (envoi, carte,
      │  │                  navigation par dossiers, actions sur les dossiers), projet (en-tête à onglets),
      │  │                  confirmation du mot de passe, identifiants d'API…
      │  ├─ composables/   useAuth(), useApiFetch(), useFormValidation(), useFlash(), useMediaUpload(), useAppHead(),
      │  │                 useAdminSection(), useReauth(), useCredentialLabels()
      │  ├─ plugins/       api.ts ($api : appels de l'administration, gestion des sessions expirées)
      │  ├─ layouts/       default (public) et admin (barre latérale)
      │  ├─ middleware/    auth.global.ts (protection de /admin/*)
      │  ├─ pages/         index, login, password/[token], admin/… (media/, users/, projects/[id]/{media,members,keys,origins},
      │  │                 tokens/, audit)
      │  └─ error.vue      pages d'erreur traduites (401, 403, 404, 500)
      ├─ i18n/locales/     traductions de l'interface (fr.json = référence, en.json)
      ├─ server/
      │  ├─ api/           auth/*, admin/users/*, admin/media/*, admin/projects/* (membres, clés, origines),
      │  │                 admin/tokens/*, admin/audit, admin/config/*, health, v1/* (API publique)
      │  ├─ routes/m/      diffusion des médias : /m/<id>/v<version>/…
      │  ├─ lib/storage/   interface MediaStorage + adaptateur Flydrive (local, S3)
      │  ├─ lib/media/     métier des médias : service, gestionnaires par genre, envoi, signature, diffusion,
      │  │                 transformations (chemins, opération effective), dérivés (pré-génération),
      │  │                 file bornée des traitements d'images, rendus et sources des vidéos
      │  ├─ lib/video-processing/ traitement des vidéos par ffmpeg (D3) : détection, lancement borné,
      │  │                 arguments, ffprobe, plan, file persistante, boucle, pipeline, état
      │  ├─ lib/projects/  projets, membres, origines autorisées
      │  ├─ lib/folders/   dossiers d'un espace : arbre (cache par révision), écritures, filtre des listes
      │  ├─ lib/transforms/ politique des transformations, préréglages globaux et de projet
      │  ├─ lib/access/    identifiants d'API : format (CRC), résolution, jetons délégués, identité de l'appelant
      │  ├─ lib/credentials/  clés de projet et jetons personnels (création, rotation, révocation)
      │  ├─ lib/audit/     lecture du journal d'audit
      │  ├─ lib/api/       API v1 : contexte (Bearer, débit), erreurs RFC 9457, requêtes, écritures, contrats, liens signés, OpenAPI
      │  ├─ lib/cache/     cache mémoire (LRU) et compteurs de révision
      │  ├─ lib/http/      lecture bornée des corps de requête, fermeture des flux interrompus
      │  ├─ middleware/    0.server-role.ts (processus de travail : /api/health seulement), api-v1.ts (CORS,
      │  │                 identité, débit), body-limit.ts (corps ≤ 1 Mio, 30 s), csrf.ts
      │  ├─ plugins/       traitement des vidéos (0.video-processing.ts), base, sessions, rappels d'amorçage,
      │  │                 indexation de la recherche, purge des compteurs des jetons délégués
      │  ├─ utils/         usePrisma(), requireAuth(), requireSpaceAccess(), requireRecentPassword(),
      │  │                 recordAudit(), utilisateurs, liens de mot de passe… (auto-importés)
      │  └─ generated/     clients Prisma générés, un par fournisseur, et leurs schémas (non versionnés)
      ├─ shared/           code partagé app / serveur / CLI : permissions et portées, identifiants, origines,
      │                    dossiers (règles de l'arborescence), transformations (grammaire, forme
      │                    canonique), journal d'audit, schémas zod, BDD
      ├─ prisma/
      │  ├─ schema.prisma
      │  └─ migrations/<fournisseur>/   un historique par fournisseur
      ├─ cli/              CLI `surge-media` (init, db migrate, db reset, worker), i18n fr/en
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

# étape B1 — tests unitaires
pnpm --filter @surge-media/core add -D vitest
# étape B2 — aucune nouvelle dépendance (CRC32 : node:zlib ; SQLite des scripts de test : node:sqlite)
# étapes B3, B4 et B5 — aucune nouvelle dépendance
# étape 10 — documentation interactive de l'API (Scalar, version épinglée)
pnpm --filter @surge-media/core add @scalar/api-reference@1.72.3
# vue-demi (dépendance de Scalar) : script d'installation refusé (allowBuilds › vue-demi: false)
# étape 18 — envoi d'e-mails (SMTP)
pnpm --filter @surge-media/core add nodemailer
pnpm --filter @surge-media/core add -D @types/nodemailer
# phases C et D — aucune nouvelle dépendance npm ; D3 : ffmpeg ≥ 6 du système, facultatif (§ 7.7)

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
| `pnpm test` | tests unitaires Vitest (`packages/core/tests/` : rôles et portées, liens signés, projets, identifiants et origines, API v1, jetons délégués, file des traitements, dossiers, transformations, vidéos et leur traitement — `video-ffmpeg.test.ts` lance le vrai ffmpeg, signalé « ignoré » s'il est absent —, HTTP (flux, connexions persistantes) et alerte de pression SQLite) ; **Node 24** exigé (sous Node 22, les tests des sous-titres Windows-1252 échouent) |
| `pnpm i18n:check` | cohérence des traductions et des clés utilisées dans le code |
| `pnpm a11y:contrast` | contrastes WCAG AA des jetons de couleur (clair et sombre) |
| `pnpm db:init` | configure la base (fournisseur + URL), applique les migrations, génère le secret de session |
| `pnpm db:migrate` | régénère les clients Prisma s'ils ne sont plus à jour et applique les migrations en attente |
| `pnpm db:reset` | recrée la base (⚠ supprime les données), éventuellement avec un autre fournisseur |
| `pnpm db:studio` | Prisma Studio |
| `pnpm cli <commande>` | lance la CLI `surge-media` depuis les sources |
| `pnpm lint` / `pnpm lint:fix` | ESLint (`@nuxt/eslint`) : vérification / correction automatique (§ 15.1) |
| `pnpm release` / `pnpm release:dry` | release de `@surge-media/core` : version, CHANGELOG, tag, release GitHub (§ 15.3) ; `:dry` n'écrit rien |

Dans `packages/core` uniquement : `pnpm db:generate` (régénère les trois clients Prisma), `pnpm db:migration <nom>`
(maintenance, voir § 6.5), `pnpm build:cli` (build de la CLI), `pnpm start` (serveur de production),
`pnpm pack` (archive du paquet npm, § 15.5), `pnpm smoke:package <archive>` (essai de l'archive),
`pnpm changelog:preview` (notes de la prochaine version).

**Avant chaque commit** : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm i18n:check` et, si les
couleurs changent, `pnpm a11y:contrast` (la CI refait les quatre premiers, § 15.1). Message de commit au format
Conventional Commits, vérifié par le hook `commit-msg` (§ 15.1).

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
- **SQLite** convient à **un seul serveur** et à un **trafic modéré** : chaque accès à la base bloque le processus, et
  les écritures de plusieurs processus s'attendent. Pour un trafic soutenu, plusieurs processus ou plusieurs
  serveurs : PostgreSQL ou MySQL (mesures et seuils : § 12.1 ; le tableau de bord signale une base sous pression).
  Le serveur passe la base en **WAL** au démarrage et le vérifie (avertissement si SQLite le refuse : partage réseau,
  fichier en lecture seule) ; attente d'un verrou : 10 s. Une seule connexion par processus avec Prisma 7 :
  `?connection_limit=1` (réglage du moteur Rust de Prisma ≤ 6) est inutile, et les paramètres de l'URL sont ignorés.

### 6.2 La CLI `surge-media`

Prisma impose un fournisseur écrit en dur dans le schéma et génère un client propre à ce fournisseur.
surgeMedia génère donc **un client par fournisseur** (`server/generated/prisma/sqlite|postgresql|mysql/`,
depuis des copies de `prisma/schema.prisma` où seuls le fournisseur et le dossier de sortie changent :
`server/generated/schemas/`), avant `dev`, `build`, `typecheck` et à l'installation, seulement si le schéma ou
la version de Prisma a changé (`cli/lib/generate.ts`). Le serveur charge au démarrage le client de
`DATABASE_PROVIDER` : **une même build sert les trois bases**, l'image Docker comprise (§ 12.2). La CLI met à
jour le `.env`, réécrit le `provider` de `prisma/schema.prisma` (lu par les commandes Prisma lancées à la main :
Studio, état des migrations), régénère les clients s'il le faut, puis migre la base.

```bash
pnpm db:init                                   # interactif
pnpm db:init --provider postgresql --url "postgresql://user:pass@localhost:5432/surge_media" --yes
pnpm db:migrate                                # après une mise à jour de surgeMedia
pnpm db:reset                                  # interactif, confirmation obligatoire
pnpm db:reset --provider mysql --url "mysql://user:pass@localhost:3306/surge_media" --yes
pnpm cli worker --port 3001                    # processus de travail des vidéos (après pnpm build, § 7.7)
pnpm cli --help                                # aide (--lang en pour l'anglais)
```

| Commande | Options |
| --- | --- |
| `init` | `--provider`, `--url`, `--site-url`, `--yes`/`-y`, `--skip-migrate`, `--cwd`, `--lang` |
| `start` | `--port` (variable `PORT`, sinon `3000`), `--cwd`, `--lang` |
| `worker` | `--port` (`3001` par défaut), `--cwd`, `--lang` |
| `db migrate` | `--cwd`, `--lang` |
| `db reset` | `--provider`, `--url`, `--yes`/`-y`, `--cwd`, `--lang` |

- **Paquet et installation** (`cli/lib/project.ts`) : la CLI distingue le **paquet** (serveur construit,
  migrations, schémas par fournisseur, `prisma.config.ts`, `.env.example`) et le **dossier de l'installation**
  (`.env` et données : base SQLite, médias en stockage local). Dans le dépôt des sources, l'installation est
  `packages/core` (rien ne change pour le développement) ; avec le paquet publié, c'est le **dossier courant**
  (refusé s'il est dans un `node_modules` : ses données y seraient effacées) ; `--cwd` en désigne un autre.
  Les commandes Prisma sont lancées depuis le paquet, avec le schéma du fournisseur
  (`server/generated/schemas/<fournisseur>.prisma`) et une URL SQLite rendue absolue ; dans le dépôt seulement,
  `init` réécrit aussi le `provider` de `prisma/schema.prisma` et régénère les clients s'il le faut.
- **`start`** : lance le serveur construit du paquet depuis le dossier de l'installation, avec son `.env` ;
  avec SQLite, vérifie d'abord que le pilote better-sqlite3 a son module natif (sinon, message expliquant
  l'approbation des scripts d'installation par npm 12 et plus, § 15.5).

- **Langue** : français par défaut, anglais disponible (`--lang en`, variable `SURGE_MEDIA_LANG`, ou
  locale du système). Les textes sont dans `cli/i18n/fr.ts` (référence) et `cli/i18n/en.ts` : toute
  nouvelle clé doit exister dans les deux (le typage l'impose).
- **Secrets** : `init` et `reset` génèrent `NUXT_SESSION_PASSWORD` et `NUXT_MEDIA_SIGNING_SECRET`
  s'ils sont absents du `.env` (jamais remplacés ensuite).
- **URL publique** : `init` demande aussi l'URL publique de l'installation (`NUXT_SITE_URL`, valeur
  actuelle ou `http://localhost:3000` proposée ; `--site-url` en mode non interactif).
- **Changement de fournisseur** : seul le schéma est recréé, les données ne sont pas transférées.
- **Après un changement de fournisseur**, redémarrez le serveur et les processus de travail : aucune
  reconstruction n'est nécessaire (la build contient les trois clients).
- **Processus de travail** (`worker`, phase D3) : lance le serveur **construit** (`.output/server/index.mjs` :
  `pnpm build` d'abord dans le dépôt, sinon la commande s'arrête) depuis le dossier de l'installation, avec son `.env`
  (`--env-file-if-exists`, les variables du shell restant prioritaires) et `NUXT_SERVER_ROLE=worker`. Il
  exécute les tâches vidéo du mode `external` et ne sert que `/api/health` sur son port (3001 par défaut,
  distinct de celui du serveur web). Ctrl+C ou SIGTERM : arrêt propre (§ 7.7 ; vérifié aussi sous Windows le 2026-10-10).
- **Distribution** : le paquet npm `@surge-media/core` (§ 15.5) expose le binaire `surge-media`
  (`dist/cli/index.mjs`, construit par `pnpm build:cli`) : `npm install @surge-media/core` dans le dossier de
  l'installation, puis `npx surge-media init` et `npx surge-media start`.

### 6.3 Variables d'environnement

Le fichier `packages/core/.env` est créé par `pnpm db:init` à partir de `.env.example`.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `sqlite` | fournisseur de base de données |
| `DATABASE_URL` | `file:./data/surge-media.db` | URL de connexion (obligatoire hors SQLite) |
| `NUXT_SESSION_PASSWORD` | généré par `db:init` | secret des cookies de session (≥ 32 caractères ; le changer déconnecte tout le monde) |
| `NUXT_SESSION_MAX_AGE` | `43200` (12 h) | durée d'une session, en secondes |
| `NUXT_SESSION_COOKIE_SECURE` | `true` | cookie réservé à HTTPS (localhost excepté) ; `false` uniquement pour un test en HTTP (s'applique aussi au cookie des appareils de confiance) |
| `NUXT_SMTP_HOST` / `NUXT_SMTP_FROM` | — | envoi d'e-mails (§ 9.4) : serveur SMTP et expéditeur (« surgeMedia <no-reply@example.com> ») ; les deux sont requis, sinon le bouton « Envoyer par e-mail » n'est pas proposé |
| `NUXT_SMTP_PORT` / `NUXT_SMTP_SECURE` | `587` / `false` | 587 avec STARTTLS si le serveur le propose, ou 465 avec `NUXT_SMTP_SECURE=true` (TLS dès la connexion) |
| `NUXT_SMTP_USER` / `NUXT_SMTP_PASSWORD` | — | identifiants SMTP, facultatifs (relais sans authentification) |
| `NUXT_PUBLIC_TRUSTED_DEVICE_DAYS` | `15` | appareils de confiance : jours sans ressaisie du mot de passe pour les actions sensibles (365 au plus) ; `0` désactive l'option et ignore les appareils déjà de confiance (§ 9.7) |
| `NUXT_BOOTSTRAP_ADMIN_EMAIL` | — | compte d'amorçage (§ 9.3), à supprimer après la première connexion |
| `NUXT_BOOTSTRAP_ADMIN_PASSWORD` | — | mot de passe d'amorçage (12 caractères minimum) |
| `SURGE_MEDIA_LANG` | locale système, sinon `fr` | langue de la CLI |
| `NUXT_SITE_URL` | demandée par `db:init` | URL publique de l'installation ; sans valeur, déduite de chaque requête (avertissement au démarrage en production) |
| `NUXT_TRUST_PROXY` | `true` | mandataires inverses de confiance pour `X-Forwarded-For` (adresse IP réelle du client : limites de débit, journal d'audit, sessions) : `true` = boucle locale et réseaux privés (Docker), `false` = en-tête ignoré, ou liste d'adresses / plages CIDR avec `loopback` et `private` (§ 12) |
| `NUXT_MEDIA_PUBLIC_URL` | — (= `NUXT_SITE_URL`) | base des adresses de diffusion `/m/…` si elle diffère : CDN, sous-domaine dédié (§ 7.4) |
| `NUXT_MEDIA_MAX_UPLOAD_SIZE` | `26214400` (25 Mio) | taille maximale d'une **image** envoyée, en octets |
| `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE` | `536870912` (512 Mio) | taille maximale d'une **vidéo** envoyée, en octets ; `2147483647` (2 Gio − 1) au plus, plafond de la colonne `Media.size` (§ 7.7) |
| `NUXT_MEDIA_UPLOAD_TIMEOUT` | `3600` | délai (secondes) pour recevoir un envoi entier ; Node coupe sinon toute requête non reçue en 300 s (§ 7.7) |
| `NUXT_MEDIA_VIDEO_PREPARE` | `faststart,metadata` | préparation des MP4/MOV à l'envoi, sans réencodage : `faststart` (index en tête du fichier), `metadata` (lieu de tournage et informations de l'appareil retirés), les deux, ou `none` (§ 7.7) |
| `NUXT_MEDIA_SIGNING_SECRET` | généré par `db:init` | secret des liens signés des médias privés (le changer invalide les liens partagés) |
| `NUXT_MEDIA_PREVIOUS_SIGNING_SECRET` | — | ancien secret, encore accepté pendant une rotation (7 jours suffisent) |
| `NUXT_MEDIA_STORAGE_DRIVER` | `local` | stockage des fichiers : `local` ou `s3` (§ 7) |
| `NUXT_MEDIA_STORAGE_ROOT` | `./data/media` | dossier du pilote `local` (relatif à `packages/core` ou absolu) |
| `NUXT_MEDIA_STORAGE_PREFIX` | — | préfixe de toutes les clés (partage d'un bucket) |
| `NUXT_MEDIA_STORAGE_S3_*` | — | `BUCKET`, `REGION`, `ENDPOINT` (services compatibles), `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `FORCE_PATH_STYLE` |
| `NUXT_API_RATE_LIMIT_*` | 300 / 1200 / 1200 / 300 / 60 / 30 | par minute, API v1 : requêtes `PUBLISHABLE` (par clé et IP), `SECRET`, `PERSONAL`, `DELEGATED` (par émetteur et IP) ; `UPLOADS` (fichiers envoyés par identifiant) ; `AUTH_FAILURES` (identifiants refusés par IP) |
| `NUXT_MEDIA_PROCESSING_CONCURRENCY` | `0` (= nombre de cœurs) | traitements d'images simultanés (analyse des envois, aperçus) ; sans rapport avec le traitement des vidéos (`NUXT_VIDEO_*`) |
| `NUXT_MEDIA_PROCESSING_QUEUE` | `100` | traitements en attente au-delà ; file pleine → 503 `SERVER_BUSY` + `Retry-After` |
| `NUXT_MEDIA_TRANSFORM_MAX_DIMENSION` | `4096` | largeur et hauteur maximales d'une image transformée (§ 8.1) |
| `NUXT_MEDIA_TRANSFORM_FORMATS` | `jpg,png,webp,avif` | formats de sortie activés |
| `NUXT_MEDIA_TRANSFORM_MAX_VARIANTS` | `50` | dérivés par version de média ; au-delà, plus de nouveaux paramètres libres (429 `TRANSFORM_QUOTA`) |
| `NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE` | `604800` (7 jours) | cache des URL d'un préréglage global ou de projet (modifiable, donc revalidé) ; préréglages intégrés : 1 an, immuable |
| `NUXT_MEDIA_TRANSFORM_RATE_LIMIT` | `60` | nouvelles transformations libres non signées par IP et par minute ; `0` = sans limite (à relever derrière un CDN) |
| `NUXT_VIDEO_PROCESSING` | `off` | traitement des vidéos par ffmpeg (§ 7.7) : `off` (aucun), `embedded` (le serveur web exécute les tâches) ou `external` (processus de travail séparés) |
| `NUXT_SERVER_ROLE` | `web` | `worker` : processus de travail du traitement des vidéos (exécute les tâches, ne sert que `/api/health`) ; posée par `surge-media worker` |
| `NUXT_FFMPEG_PATH` / `NUXT_FFPROBE_PATH` | `ffmpeg` / `ffprobe` | binaires du système (cherchés dans le `PATH`, ou chemin complet) |
| `NUXT_VIDEO_CONCURRENCY` | `1` | tâches vidéo simultanées par processus (1 à 16) ; un encodage 1080p occupe 0,4 à 0,75 Gio |
| `NUXT_VIDEO_THREADS` | `0` (= moitié des cœurs) | fils de calcul par ffmpeg ; 16 au plus par usage, quelle que soit la valeur |
| `NUXT_VIDEO_RENDITION` | `auto` | version compatible H.264 : `auto` (seulement si elle sert), `always`, `never` (sauf formats convertis) |
| `NUXT_VIDEO_PRESET` / `NUXT_VIDEO_CRF` | `veryfast` / `23` | préréglage x264 (`ultrafast` … `veryslow`) et qualité (0 à 51, plus bas = meilleure qualité, plus lourd) |
| `NUXT_VIDEO_AV1` | `off` | version AV1/Opus en WebM en plus (`on` ; encodeurs `libsvtav1` et `libopus` exigés) |
| `NUXT_VIDEO_MAX_DURATION` | `10800` (3 h) | durée maximale réencodée, en secondes ; au-delà, aucun réencodage (échec `TOO_LONG` si un rendu servait) ; borne aussi la durée écrite par un encodage |
| `NUXT_VIDEO_MEMORY_LIMIT` | `4096` | Mio d'espace d'adressage (mémoire virtuelle) par ffmpeg (Linux, `prlimit --as`) ; `0` = sans limite |

Une valeur `NUXT_VIDEO_*` invalide reprend sa valeur par défaut avec un avertissement au démarrage ; un
changement demande un redémarrage (et vaut pour chaque processus : un processus de travail applique ses propres
variables).

### 6.4 Modèle de données (`prisma/schema.prisma`)

| Modèle | Rôle |
| --- | --- |
| `User` | comptes de l'administration (rôle `ADMIN`/`MANAGER`/`DEVELOPER`/`EDITOR`, langue préférée, actif ou non, auteur de l'invitation `invitedById`) |
| `Session` | sessions d'administration (seule l'empreinte SHA-256 du jeton est stockée) ; dernière saisie du mot de passe (`passwordVerifiedAt`, « mode sudo ») |
| `TrustedDevice` | appareil de confiance : empreinte du jeton de son cookie, échéance, navigateur et IP, dernière utilisation (§ 9.7) |
| `PasswordToken` | lien à usage unique d'invitation ou de réinitialisation du mot de passe (empreinte, échéance, date d'utilisation) |
| `Project` | application cliente et ses environnements : médias, dossiers, membres, jetons et origines CORS ; archivage (`archivedAt`) ; liste publique pour la clé publique (`publicListing`) |
| `ProjectMember` | membre d'un projet et son rôle (`OWNER`, `DEVELOPER`, `EDITOR`) |
| `AccessToken` | identifiant d'API (`type` : jeton personnel `PERSONAL`, clé `SECRET` ou `PUBLISHABLE` d'un projet) : empreinte SHA-256 + préfixe lisible, valeur en clair pour la seule clé publique, environnement (clés), portées immuables, échéance, révocation, clé remplaçante (`replacedById`), dernière utilisation (B3) |
| `AccessTokenProject` | sélection de projets d'un jeton personnel (s'il ne couvre pas « tous mes projets ») |
| `AllowedOrigin` | origines autorisées (CORS) pour les appels navigateur d'un projet (tous environnements) |
| `AuditEvent` | journal d'audit des actions sensibles (sans clés étrangères : survit aux suppressions ; libellé lisible dans `data.label`) |
| `DelegatedTokenUsage` | envois consommés par un jeton délégué limité en nombre de fichiers (`jti`, compteur, échéance) ; purgé après échéance |
| `CacheRevision` | compteur de révision par espace (`project:<id>`, `library`), incrémenté par toute écriture de médias : ETag des listes de l'API |
| `TransformPreset` | préréglage de transformation : global (`projectId` vide) ou d'un projet ; nom unique par niveau (application), paramètres canoniques sans format (§ 8.2) |
| `Setting` | réglage de l'installation (clé-valeur JSON), ex. `transforms.libraryPolicy` ; présence des processus de travail du traitement des vidéos (`videoWorker:<id>`, réécrite toutes les 60 s) |
| `Folder` | dossier d'un espace (projet, ou bibliothèque si `projectId` est vide) et son parent ; nom unique parmi les voisins (casse ignorée, contrôlé par l'application), 8 niveaux, 1 000 par espace (§ 9.11) |
| `Media` | fichier original, dans **un seul espace** (`projectId` vide = bibliothèque) : genre, visibilité publique/privée, clé de stockage opaque, version (incrémentée à chaque remplacement, changement d'affiche ou de point d'intérêt, réécriture du fichier ou rendu remplacé par le traitement des vidéos), dimensions, empreinte, alt, point d'intérêt (`focalX`, `focalY`, § 8.3), corbeille, média d'origine s'il est une copie ; colonnes de recherche normalisées (`searchTitle`, `searchName`, `searchAlt`) ; provenance API (`uploadedByTokenId`, sujet final `uploadSubject`) ; vidéo : image d'affiche (`poster*`, D2) et état du traitement (`processingState` : `PENDING`, `PROCESSING`, `READY`, `FAILED`, null = non concerné ; D3) |
| `MediaVariant` | dérivé généré à la demande puis conservé : `v<n>/<opération effective>.<format>` (préréglage ou paramètres, § 8.1) |
| `MediaTextTrack` | piste de texte WebVTT d'une vidéo (sous-titres, descriptions, chapitres ; D2, § 7.7) |
| `MediaJob` | tâche de la file persistante du traitement des vidéos (D3) : fichier visé (`sourceKey`), statut (`QUEUED`, `RUNNING`, `DONE`, `FAILED`, `CANCELLED`), priorité, essais, reprise différée (`runAfter`), processus et bail (`lockedBy`, `leaseUntil`), étape et avancement, résultat (avertissements), code et résumé d'erreur (§ 7.7) |
| `MediaRendition` | rendu d'une vidéo produit par réencodage (`h264` en MP4, `av1` en WebM) : codecs, dimensions, durée, débit, taille, empreinte, clé `variants/<média>/rendition-<nom>-<aléa>.<ext>` ; un par nom et par média, supprimé quand le fichier change (D3) |

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
 Admin (cookie + portées)         API v1 (jetons, B3–B4)           Diffusion /m/:id/v:version/:nom
             └──────────────┬──────────────┘                                │
                            ▼                                                ▼
          server/lib/media/service.ts — métier : envoi, remplacement, corbeille, recherche
          ┌─────────────────┼──────────────────────┐
          ▼                 ▼                      ▼
  handlers/ (par genre)   Prisma : Media,      server/lib/storage — interface MediaStorage
  image (sharp) ;         MediaVariant,          ├─ local : Flydrive fs → NUXT_MEDIA_STORAGE_ROOT
  vidéo (en-têtes)        MediaJob,              └─ s3    : Flydrive s3 → AWS, R2, MinIO, OVH…
          │               MediaRendition
          ▼
  server/lib/video-processing (D3) — file MediaJob → ffmpeg / ffprobe en processus enfant
  (serveur web en mode embedded, ou processus de travail NUXT_SERVER_ROLE=worker)
```

- **Métier et stockage séparés** : la base porte les données métier, le fichier vit sous une
  **clé opaque générée par le serveur** (`originals/2026/09/<128 bits aléatoires>.jpg`,
  dérivés `variants/<id>/v<version>-<hash>.webp`). Jamais le nom envoyé, jamais exposée.
- **Genres extensibles** : les types acceptés sont déclarés dans `shared/utils/media.ts`
  (`ACCEPTED_MEDIA_TYPES` : images JPEG, PNG, WebP, AVIF, GIF — SVG exclu car il peut contenir du
  script — et, depuis la phase D1, **vidéos MP4, WebM, QuickTime** ; depuis D3, MKV, AVI, 3GP, MPEG-TS, OGV
  et WMV quand le traitement des vidéos est actif : `CONVERTED_VIDEO_TYPES`). Chaque genre a son gestionnaire
  (`server/lib/media/handlers/`) : `inspect()` (dimensions, durée, métadonnées) et, pour les images,
  `transform()` (aperçu, dérivés). Une limite d'envoi par genre. Ajouter un genre : signature dans
  `sniff.ts`, types et limite dans `shared/utils/media.ts`, gestionnaire inscrit au registre.
- **Traitement des vidéos** (D3, facultatif) : ffmpeg ne tourne jamais dans une requête ; l'envoi crée une
  tâche dans une file en base (`MediaJob`), exécutée par le serveur web (`embedded`) ou par des processus de
  travail séparés (`external`), qui écrivent leurs résultats par le même service (§ 7.7).
- **Stockage interchangeable** : `MediaStorage` (put/getStream/copy/stat/delete/deletePrefix en flux)
  implémentée au-dessus de Flydrive. Nouveau backend = un `case` dans `server/lib/storage/index.ts`.
- **Espaces** : chaque média appartient à un seul espace, la **bibliothèque de l'organisation** ou
  **un projet** (§ 9.5). Le réutiliser ailleurs = le **dupliquer** (copie indépendante : nouvel
  identifiant, fichier copié dans le stockage — côté service sous S3 —, métadonnées reprises,
  provenance `duplicatedFromId`). Le **déplacer** change son espace sans changer son adresse.
- **Dossiers** : dans son espace, un média est rangé dans 0 ou 1 dossier (arborescence de 8 niveaux,
  § 9.11) ; le changer de dossier ne change pas non plus son adresse.

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

1. Session + portée `media:upload` dans l'espace visé (`?project=<id>`, sinon bibliothèque).
2. Lecture multipart **en flux** (busboy) : un seul fichier, jamais chargé en mémoire. Le **type est reconnu
   dès les 1 024 premiers octets** (`SNIFF_HEADER_BYTES` : plusieurs paquets MPEG-TS) : type non accepté → 415
   aussitôt (aucun type admis, par exemple un jeton délégué limité aux formats convertis pendant que le
   traitement des vidéos est inactif → 415 avant toute lecture) ; puis la **limite du genre** s'applique
   pendant la lecture (images `NUXT_MEDIA_MAX_UPLOAD_SIZE`, vidéos `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE`) → 413
   (`data.maxSize` = limite du genre). Après un refus, la suite du corps est lue sans être écrite (la réponse
   part aussitôt, la connexion reste utilisable). Aucune donnée reçue pendant **60 s** (réseau perdu sans
   fermeture) → 408 `UPLOAD_TIMEOUT`, connexion fermée, fichier temporaire supprimé.
3. Fichier temporaire + empreinte SHA-256 et taille calculées au fil de l'eau (toujours supprimé).
4. **Type réel** d'après la signature binaire (`server/lib/media/sniff.ts`, liste d'autorisation) ;
   nom et type annoncés par le client ignorés → 415. Types acceptés : ceux de l'installation, plus les formats
   vidéo convertis (MKV, AVI…) tant que le traitement des vidéos est actif (§ 7.7).
5. Analyse par le gestionnaire : image (sharp) illisible → 422 `UNREADABLE_FILE`, plus de 100 Mpx (bombe
   de décompression) → 422 `DIMENSIONS_TOO_LARGE` ; vidéo : lecture des seuls en-têtes (§ 7.7), structure
   incohérente → 422 `UNREADABLE_FILE`, sans piste vidéo → 415. Format converti : ni lu ni préparé dans la
   requête (ffprobe ne tourne jamais dans une requête) ; un fichier sans vidéo ou illisible échoue ensuite dans
   sa tâche, avec un code affiché dans la fiche.
6. Écriture dans le stockage puis en base ; l'échec de l'un annule l'autre. Vidéo, traitement actif : la
   tâche de traitement (`MediaJob`) est créée dans la même transaction que le média (§ 7.7).
7. **Aperçu pré-généré** en tâche de fond (le premier affichage n'attend pas), aussi après un
   remplacement ou une duplication ; ignoré si des traitements attendent déjà (généré alors à la
   première demande).

L'analyse d'une image (étape 5) et la génération des dérivés passent par une **file bornée** (§ 8) : au-delà,
503 `SERVER_BUSY` avec `Retry-After` (l'analyse d'une vidéo, quelques lectures, n'y passe pas). Les mêmes étapes servent l'administration et l'API v1 (§ 9.10).

Remplacement (`PUT …/file`) : même genre seulement (422 `KIND_MISMATCH` dès les premiers octets ; une vidéo
peut être remplacée par un format converti quand le traitement est actif), nouvelle clé, version + 1, mise à
jour conditionnée à la version lue (409 `VERSION_CONFLICT` si un remplacement concurrent est passé), ancien
fichier et anciens dérivés supprimés ; vidéo : tâche en cours annulée, rendus de l'ancien fichier supprimés,
nouvelle tâche si le traitement est actif. Corbeille : `deletedAt` (plus diffusé, restaurable ; vidéo : tâche
annulée, reprise à la restauration) ; suppression définitive depuis la corbeille uniquement (enregistrement,
original et dérivés).

### 7.4 Diffusion, médias publics et privés

`GET|HEAD /m/<id>/v<version>/<nom>.<ext>` (original) et `/m/<id>/v<version>/preview/<nom>.webp`
(aperçu 480 px, métadonnées EXIF retirées, pré-généré après l'envoi — sinon généré à la première
demande — puis conservé). Toute autre transformation (taille, recadrage, format…) : § 8.1. Vidéo : pistes de
texte `/m/<id>/v<version>/tracks/<piste>.vtt` (D2) et rendus `/m/<id>/v<version>/renditions/h264.mp4|av1.webm`
(D3, § 7.7).
Le nom est indicatif ; une ancienne version redirige (302) vers l'URL courante (même transformation ; un rendu
absent de la version courante renvoie vers l'original).

**La diffusion n'utilise jamais de cookie** : elle ne dépend que de l'URL (publique ou signée),
ce qui la rend cachable par un CDN et indépendante des projets.

| Accès | Condition | Cache |
| --- | --- | --- |
| Public | aucune | `public, max-age=1 an, immutable` (l'URL change à chaque remplacement) |
| Privé, lien de partage | `?exp&kid&sig` pour un fichier précis (original, préréglage ou transformation), 7 jours max | `private`, jusqu'à l'échéance (1 h max) |
| Privé ou corbeille, aperçu d'administration | `?exp&kid&scope=admin&sig` : tout fichier de la version, ~1 h, échéance alignée sur le quart d'heure (même URL pendant 15 min → cache navigateur) | `private`, jusqu'à l'échéance |
| Privé, identifiant d'API | `Authorization: Bearer` : clé secrète ou jeton personnel ayant `media:read` dans l'espace du média (jamais une clé publique, jamais depuis un navigateur), ou jeton délégué `media:read` de son projet (depuis une origine autorisée) | `private, no-cache` + `Vary: Authorization` |
| Corbeille, autre accès | 404 (existence non révélée, pas de redirection de version) | — |

Liens signés (v2, `server/lib/media/signing.ts`) : HMAC-SHA256 de `v2:<id>:<version>:<droit>:<échéance>`,
où le droit est le fichier exact (`file`, `preset:<nom>`, `t:<transformation canonique>` — sans le format)
ou un droit élargi (`scope=derived` : tout dérivé, jamais l'original ; `scope=admin`). Sans `exp`, la
signature est **permanente** (`perm`) : réservée à un dérivé précis d'un média public (§ 8.1). `kid` = empreinte courte du secret : pour changer
`NUXT_MEDIA_SIGNING_SECRET` sans casser les liens en cours, placer l'ancien dans
`NUXT_MEDIA_PREVIOUS_SIGNING_SECRET` pendant 7 jours. Invalidation : remplacer le fichier (un média),
ou retirer l'ancien secret (tous).

En-têtes systématiques : type MIME lu en base, `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition` (nom d'origine encodé),
`Cross-Origin-Resource-Policy: cross-origin`, `Access-Control-Allow-Origin: *` (l'URL est la preuve
d'accès), `X-Robots-Tag: noindex` hors public.

**Domaine de diffusion** : par défaut celui de l'application (`NUXT_SITE_URL`). Selon l'infrastructure :

| Infrastructure | Configuration |
| --- | --- |
| Serveur seul | rien à faire |
| Cache ou CDN devant l'application (Cloudflare, Nginx `proxy_cache`, Varnish) | même domaine ; mettre en cache `/m/*` en respectant `Cache-Control` (les réponses `/m/` ne posent jamais de cookie) |
| Sous-domaine dédié vers la même application | `NUXT_MEDIA_PUBLIC_URL=https://media.example.com` (aucun cookie d'administration envoyé avec les images) |
| CDN à domaine propre dont l'origine est l'application | `NUXT_MEDIA_PUBLIC_URL=https://cdn.example.com` |

**Requêtes partielles** : `Range: bytes=…` (une plage) → 206 + `Content-Range`, plage hors du fichier → 416,
`If-Range` respecté, `Accept-Ranges: bytes` ; sous S3, seule la plage est lue dans le bucket. `OPTIONS`
répond au preflight (lecture par script avec `Authorization` ou `Range`). Les métadonnées de diffusion
sont gardées 60 s en mémoire (invalidées à chaque écriture locale ; autres instances : ≤ 60 s).
Un client qui interrompt une réponse (page quittée pendant le chargement des aperçus, déplacement dans
une vidéo) fait **fermer le flux du stockage** (`server/lib/http/stream.ts`) : aucun descripteur de fichier
ni connexion S3 ne reste ouvert (h3 ne le faisait pas : voir « Correctifs — 2026-10-05 »).

Les chemins renvoyés à l'interface d'administration restent relatifs ; les adresses à copier
(adresse publique, lien de partage) sont absolues, construites sur cette base.

**Confidentialité** : l'original est servi tel quel, métadonnées EXIF comprises (appareil, parfois
coordonnées GPS). Les dérivés (aperçu, transformations) n'en contiennent pas : `full` en donne une copie
entière sans métadonnées. Vidéos : § 7.7 (préparation à l'envoi, retrait des pistes de données de l'appareil).

**Vidéos traitées** (D3, § 7.7) :

- **Rendus** : `/m/<id>/v<n>/renditions/h264.mp4` et `…/av1.webm`, mêmes règles que l'original (plages, ETag,
  cache immuable si public, Bearer, corbeille → 404) ; le droit signé `file` de l'original **couvre ses
  rendus** (un lien signé d'une vidéo donne les URL signées de ses rendus à la même échéance ; ni `derived`
  ni signature permanente). Rendu inconnu du cache : le média est relu en base une fois, puis 404 (non mis en
  cache : le rendu peut arriver).
- **Retenue** : tant qu'une piste de données de l'appareil (positions GPS…) n'est pas retirée par le
  traitement, l'original et les rendus répondent **503 `PROCESSING_PENDING`** (`Retry-After: 30`,
  `Cache-Control: no-store`) à toute demande autorisée — URL publique, lien de partage, identifiant d'API —
  sauf aux liens « admin » de l'administration (le contrôle d'accès passe avant : un média privé sans droit
  reste 403) ; l'affiche, ses dérivés et les pistes de texte restent servis.
- **Original illisible** par `<video>` (format converti : MKV, AVI… ; ou `playback: none`) : servi en
  téléchargement (`Content-Disposition: attachment`), la lecture passe par le rendu H.264.
- Nom de préréglage `renditions` réservé (comme `tracks`).

### 7.5 API d'administration (portées par espace)

Chaque route vérifie la portée requise **dans l'espace du média** (ou de l'espace visé) : un média ou
un projet invisible pour l'utilisateur répond **404** (son existence n'est pas révélée), une portée
manquante **403** (`PROJECT_ARCHIVED` si c'est l'archivage du projet qui la retire).

| Endpoint | Portée | Rôle |
| --- | --- | --- |
| `GET /api/admin/config/media` | session | règles d'envoi (taille max, types acceptés en ce moment, durées de lien) pour l'interface ; `videoProcessing` : mode, traitement actif, extensions des formats convertis, `rendition`, `maxDuration` (D3) |
| `GET /api/admin/media?project=&q=&kind=&visibility=&status=active\|trash&sort=&page=` | `media:read` | médias d'un espace (`project` absent = bibliothèque), 24 par page, + espace et portées de l'utilisateur |
| `POST /api/admin/media?project=` | `media:upload` | multipart `file` (+ `title`, `altText`, `visibility`) → 201 |
| `GET /api/admin/media/:id` | `media:read` | métadonnées complètes, adresse publique absolue, espace et portées ; vidéo (D3) : `processing` (dernière tâche), `renditions`, `sources` (liens « admin » si privé, en corbeille ou retenu), `publicSources` (adresses absolues d'une vidéo publique, pour l'extrait `<video>`) |
| `PATCH /api/admin/media/:id` | `media:write` | `{ title?, altText?, visibility?, folderId?, focalPoint? }` (point d'intérêt : nouvelle version, § 8.3) |
| `PUT /api/admin/media/:id/file` | `media:write` | remplacement du fichier (mêmes contrôles que l'envoi) |
| `DELETE /api/admin/media/:id` | `media:delete` | corbeille · `?permanent=true` : suppression définitive (409 `NOT_IN_TRASH` sinon) |
| `POST /api/admin/media/:id/restore` | `media:delete` | sortie de la corbeille |
| `POST /api/admin/media/:id/signed-url` | `media:read` | `{ expiresIn }` (60 s à 7 jours) → lien temporaire absolu (URL permanente si public) ; vidéo : aussi l'affiche, les pistes et `sources` (rendus), à la même échéance · 409 `IN_TRASH` |
| `POST /api/admin/media/:id/process` | `media:write` | traiter ou relancer le traitement d'une vidéo (échec, rendus à refaire avec les réglages actuels, vidéo jamais traitée) → `{ media }` · 422 `KIND_MISMATCH` · 409 `IN_TRASH` / `PROCESSING_DISABLED` / `VERSION_CONFLICT` |
| `GET /api/admin/media/:id/processing` | `media:read` | `{ version, processingState, processing }` : avancement, interrogé toutes les 5 s par la fiche pendant le traitement (`no-store`) |
| `GET /api/admin/video-processing` | `settings:manage` | état pour « Réglages » : mode, rôle, `active`, `halted`, réglages d'encodage (`concurrency`, `threads`, `rendition`, `preset`, `crf`, `av1`, `maxDuration` ; ni la limite de mémoire ni les chemins des binaires), ffmpeg détecté (null sur le serveur web en mode `external`), processus de travail, tâches par statut, vidéos jamais traitées (nombre, durée totale) |
| `POST /api/admin/video-processing/backfill` | `settings:manage` | « Traiter les vidéos existantes » → `{ count }` (journalisé) · 409 `PROCESSING_DISABLED` |
| `POST /api/admin/media/:id/duplicate` | `media:read` + `media:upload` dans la cible | `{ projectId \| null }` → copie indépendante (201) · 409 `IN_TRASH` |
| `POST /api/admin/media/:id/move` | `media:delete` + `media:upload` dans la cible | `{ projectId \| null }` → même média, même adresse, autre espace |
| `GET /api/admin/spaces?scope=media:upload` | session | espaces où l'utilisateur a la portée (cibles de duplication / déplacement) |
| Dossiers et rangement | `media:read` / `media:write` | § 9.11 (`folder`, `recursive` et `folderId` sur les routes ci-dessus) |
| Politique des transformations, préréglages | `project:read` / `project:settings` ; installation : `settings:manage` | § 8.2 |
| Générateur d'adresses : aperçu, adresses | `media:read` | § 8.4 (`/api/admin/media/:id/transform`, `/api/admin/media/:id/links`) |

Codes d'erreur (`data.code`, `shared/utils/media.ts`) : `NO_FILE`, `MULTIPART_REQUIRED` (400),
`FILE_TOO_LARGE` (413), `UNSUPPORTED_TYPE` (415), `UNREADABLE_FILE`, `DIMENSIONS_TOO_LARGE`,
`KIND_MISMATCH` (422), `VERSION_CONFLICT`, `NOT_IN_TRASH`, `IN_TRASH`, `PROCESSING_DISABLED` (409),
`MEDIA_FORBIDDEN`, `SIGNATURE_INVALID`, `SIGNATURE_EXPIRED` (403), `SERVER_BUSY` (503), `PROCESSING_PENDING` (503,
sur `/m/` seulement), `INVALID_TRANSFORM` (400) et `TRANSFORM_QUOTA` (429), `TRANSFORM_NOT_ALLOWED` (403) sur `/m/` ;
préréglages : `PRESET_NOT_FOUND` (404), `PRESET_NAME_TAKEN`, `PRESET_LIMIT_REACHED` (409), `INVALID_TRANSFORM`
(400) ; dossiers (`shared/utils/folders.ts`) : `FOLDER_NOT_FOUND` (404), `FOLDER_NAME_TAKEN`, `FOLDER_NOT_EMPTY`,
`FOLDER_LIMIT_REACHED` (409), `FOLDER_DEPTH_EXCEEDED`, `FOLDER_CYCLE` (422).

### 7.6 Interface

- `/admin/media` : **bibliothèque** de l'organisation ; `/admin/projects/:id/media` : médias d'un
  projet. Même composant (`AdminMediaBrowser`) : **dossiers** (fil d'Ariane, sous-dossiers, créer,
  renommer, déplacer, supprimer), envoi par bouton ou glisser-déposer dans le dossier affiché (si la
  portée le permet ; formats et taille maximale indiqués par genre ; quitter la page pendant un envoi demande
  confirmation), progression annoncée aux lecteurs d'écran, filtres dans l'URL (dont « Type » : images ou
  vidéos, et « Inclure les sous-dossiers »), grille (vidéo : vignette tirée de l'affiche, sinon icône, et
  durée ; pastille d'état du traitement « Traitement en attente », « Traitement en cours » ou « Échec du
  traitement », D3), sélection pour ranger plusieurs médias, corbeille. Traitement des vidéos actif : une ligne
  d'aide de l'envoi annonce les formats convertis (MKV, AVI, 3GP, 3G2, TS, MTS, M2TS, OGV, WMV), acceptés par
  le sélecteur de fichiers.
- `/admin/media/:id` : fiche d'un média (aperçu, informations dont l'espace et la provenance — compte,
  identifiant d'API, utilisateur de l'application pour un envoi par jeton délégué —, titre, texte alternatif,
  visibilité, **point d'intérêt** et **générateur d'adresses** d'une image (§ 8.3, § 8.4), adresse publique ou
  lien temporaire, remplacement,
  **dupliquer ou déplacer** vers un espace et un dossier, corbeille). Vidéo : lecteur natif (sans lecture
  automatique) avec un `<source>` par entrée de `sources`, durée, codecs, débit, avertissements (§ 7.7),
  « Description courte » à la place du texte alternatif, image d'affiche, sous-titres, extrait `<video>` à
  copier ; section **Traitement** (D3, § 7.7).
- `/admin/projects/:id/transforms` : onglet **Transformations** d'un projet (politique, préréglages,
  limites du serveur) ; `/admin/settings` : **Réglages** de l'installation (ADMIN : politique de la
  bibliothèque, préréglages globaux — § 8.2 ; section **Traitement des vidéos** — § 7.7).
  Sans droit d'écriture (ou projet archivé), la fiche passe en lecture seule.

### 7.7 Vidéos (phases D1 à D3)

Architecture : `.claude/architecture-phase-d.md` (D1 : DD1 à DD14 ; D2 : DD15 à DD24 ; D3 : § 28 à § 42, DD25 à
DD36, et sa dernière section « D3 — état de l'implémentation »). Les vidéos sont des médias comme les autres
(espaces, dossiers, visibilité, corbeille, remplacement, duplication, API v1). Sans traitement (mode `off`, défaut),
elles sont servies **sans réencodage** : un MP4 ou un MOV est seulement **préparé** à l'envoi (D2), une image
d'affiche et des sous-titres peuvent leur être associés. Le **traitement des vidéos** (D3, facultatif : ffmpeg du
système) y ajoute, en tâche de fond après l'envoi, le retrait des pistes de données de l'appareil, la réparation
des WebM, une affiche extraite par le serveur et une version compatible H.264 quand elle sert.

| Point | Règle |
| --- | --- |
| Formats | **MP4**, **WebM**, **QuickTime (MOV)** toujours, reconnus d'après le contenu (`server/lib/media/sniff.ts`). **MKV, AVI, 3GP/3G2, MPEG-TS/M2TS, OGV (Theora), WMV** : acceptés **seulement pendant que le traitement est actif** (sinon 415, même pour un jeton délégué qui les cite) ; l'original est conservé et proposé en téléchargement, la lecture passe par le rendu H.264. Audio seul (M4A, Ogg sans vidéo), FLV, MPEG-PS, RealMedia, QuickTime ancien sans `ftyp` : 415 |
| Analyse | lecteur d'en-têtes maison, sans ffmpeg (`server/lib/media/video/` : ISO BMFF pour MP4/MOV, EBML pour WebM) : dimensions affichées (rotation des vidéos de téléphone appliquée), durée (MP4 fragmenté : fin du dernier fragment), codecs (chaîne RFC 6381), son, débit, « faststart », lieu de tournage, **pistes de données de l'appareil** (`metadata.dataTracks` : `gpmd` GoPro, `camm` caméras 360°, `mebx` iPhone, `djmd`/`dbgi` DJI, `mett`, `rtmd` Sony). Quelques Kio lus, hors file des traitements. Formats convertis : non lus à l'envoi (dimensions, durée et codecs inconnus jusqu'à l'étape `probe` de leur tâche) |
| Taille | `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE` (512 Mio), aussi pour les formats convertis, 2 Gio − 1 au plus (colonne `Media.size` sur 32 bits : au-delà, migration en `BigInt` à prévoir) |
| Préparation (D2) | MP4/MOV non fragmentés : index (`moov`) placé en tête et **métadonnées d'origine retirées** (lieu de tournage, appareil, logiciel, réglages de la caméra, décalage horaire ; une liste de ce qui est **conservé** : noms et rôles des pistes, chapitres, titre, description, commentaire, droits d'auteur), sans réencodage, pendant la copie vers le stockage (`server/lib/media/video/prepare.ts`) ; sortie **réanalysée et comparée octet par octet** avant écriture, sinon fichier gardé tel qu'envoyé (journal serveur) ; `NUXT_MEDIA_VIDEO_PREPARE`. Empreinte et taille = celles du fichier servi ; vidéos envoyées avant D2 : bouton « Optimiser la vidéo » de la fiche (nouvelle version) |
| Affiche (D2) | image associée à la vidéo (`PUT …/poster`) : **capturée dans le navigateur** à l'envoi (10 % de la durée, 5 s au plus, en évitant une image noire) ou depuis le lecteur de la fiche, ou image envoyée ; normalisée en JPEG (orientation, 3840 px au plus, sans métadonnées), stockée dans `variants/<média>/poster-….jpg`, **source des dérivés** de la vidéo (vignette, `previewUrl`, préréglages, transformations, point d'intérêt) ; attribut `poster` : préréglage `full` en JPEG. Première affiche : même version ; nouvelle affiche ou retrait : nouvelle version. Traitement actif : affiche **extraite par le serveur** quand il n'y en a pas (D3) |
| Sous-titres (D2) | pistes WebVTT (`MediaTextTrack`, 20 par vidéo) : sous-titres, sous-titres pour sourds et malentendants, descriptions, chapitres ; fichiers **VTT ou SRT** (converti), UTF-8, UTF-16 avec BOM ou Windows-1252, 1 Mio au plus, **vérifiés puis réécrits** (`server/lib/media/text-track.ts`, refus avec le numéro de ligne) ; une piste par défaut par groupe ; fichier immuable (le remplacer crée une nouvelle piste) |
| Diffusion | `/m/<id>/v<n>/<nom>.mp4\|webm\|mov` : requêtes partielles (`Range` → 206), cache immuable si public, liens signés si privé. Pistes : `/m/<id>/v<n>/tracks/<piste>.vtt` (`text/vtt`, droit signé `track:<piste>`, nom de préréglage `tracks` réservé). Rendus (D3) : `/m/<id>/v<n>/renditions/h264.mp4` ou `av1.webm`, droit signé de l'original. Original d'un format converti : téléchargement (`Content-Disposition: attachment`). Sans affiche, aperçus et transformations : 404 |
| Administration | liens signés des vidéos privées valables **6 h** (tranche d'1 h) : une longue vidéo ne s'arrête pas en cours de lecture ; vidéo publique dont la diffusion est retenue (D3) : liens signés « admin » |
| API v1 | `kind: "video"`, `width`, `height`, `duration` ; D2 ajoute `poster` et `textTracks` (`previewUrl` et `urlTemplate` tirés de l'affiche, `null` sans affiche) et les routes `…/poster` (PUT, DELETE) et `…/tracks` (GET, POST, PATCH, DELETE) ; lien signé d'une piste : cible `track` ; D3 ajoute `processing` et `sources` (§ 9.9) ; pour une longue vidéo privée, demander un lien (`signed-url`) d'une durée au moins égale à celle de la vidéo (la réponse contient aussi `sources`) |
| Compatibilité | aucun codec refusé ; « lecture variable » signalée hors H.264 (MP4, MOV) et VP8/VP9 (WebM) : HEVC des iPhone, AV1, ProRes… Traitement actif (mode `auto`) : une version H.264 est produite pour ces vidéos, la fiche annonce « Version compatible en préparation », puis le lecteur l'utilise |
| Confidentialité | MP4/MOV préparés : lieu et appareil retirés (D2). Pistes de données de l'appareil (positions GPS des GoPro, drones, `mebx` des iPhone) : signalées dans la fiche dès l'envoi ; traitement actif : **retirées** par une copie sans réencodage (nouvelle version) et, d'ici là, original et rendus **retenus** (503, § 7.4). Non couverts : WebM (seul le nom du logiciel d'enregistrement y figure) ; original d'un format converti (3GP, MKV…), gardé tel quel : un lieu de tournage n'y est ni détecté ni retiré (le rendu H.264, lui, ne reprend aucune métadonnée) |
| Durée des WebM (D2) | enregistrements de navigateur sans durée : **estimée** d'après le dernier `Cluster` (fin du fichier, 16 Mio lus au plus), signalée « estimée » dans la fiche ; traitement actif : fichier **réparé** (durée et index écrits, D3) |

**Envois longs** : Node coupe toute requête non reçue en entier en 300 s ; le greffon `server/plugins/http-timeouts.ts`
porte ce délai à `NUXT_MEDIA_UPLOAD_TIMEOUT` (3600 s) — les en-têtes restent limités à 60 s, les corps JSON à
30 s, et un envoi sans donnée pendant 60 s est arrêté. **Espace temporaire** : chaque envoi est écrit dans le
dossier temporaire du système (`TMPDIR`/`TEMP`) avant d'aller au stockage : prévoir (envois simultanés × taille
maximale) d'espace libre, plus celui du traitement des vidéos (voir plus bas).

**Mandataire inverse** (nginx) pour les vidéos :

```nginx
client_max_body_size 520m;        # au moins NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE (1 Mo par défaut !)
proxy_request_buffering off;      # transmettre l'envoi au fil de l'eau (sinon tout est stocké par nginx d'abord)
client_body_timeout 120s;         # inactivité côté client
proxy_read_timeout 3600s;         # envoi long jusqu'à la réponse
proxy_send_timeout 3600s;
```

Traitement des vidéos : rien d'autre à régler, sinon laisser passer telles quelles les réponses 503 de
l'application (`PROCESSING_PENDING` avec `Retry-After`, `SERVER_BUSY`) : pas de page d'erreur substituée
(`proxy_intercept_errors` + `error_page 503`), pas de nouvel essai sur un autre serveur
(`proxy_next_upstream http_503`). Un processus de travail n'a pas à être placé derrière le mandataire (seule sa
sonde `/api/health` répond, en interne).

Un **CDN** ou un cache devant `NUXT_MEDIA_PUBLIC_URL` est fortement recommandé en production : servir de la vidéo
depuis Node consomme connexions et bande passante ; les URL publiques sont immuables et les CDN gèrent les plages.
Les rendus suivent les mêmes règles ; la réponse de retenue (503) est marquée `no-store`.

**Traitement des vidéos par ffmpeg (D3)** : facultatif, **désactivé par défaut** ; sans lui, une installation se
comporte exactement comme après D2. ffmpeg et ffprobe du système (version 6 ou plus) sont toujours lancés comme
**processus enfants** (jamais un shell, jamais dans une requête) : un envoi crée une **tâche** dans une file en
base, exécutée en tâche de fond. Code : `server/lib/video-processing/` (détection, lancement, arguments, ffprobe,
plan, file, boucle, pipeline, état) et `server/lib/media/service.ts` (toute écriture d'un résultat passe par le
service des médias).

**Ce que fait une tâche** (plan calculé par une fonction pure, `plan.ts` ; chaque étape inutile est sautée) :

| Étape (fiche) | Quand | Résultat |
| --- | --- | --- |
| `probe` « Analyse du fichier » (ffprobe) | toujours | flux, durée, couleurs (HDR), entrelacement, pistes de données ; format converti : dimensions, durée et codecs enregistrés (même version) |
| `sanitize` « Retrait des pistes de données » | MP4/MOV avec une piste de données de l'appareil | copie **sans réencodage** de la vidéo et du son seulement, puis préparation de D2 (liste de ce qui est conservé, `faststart`, selon `NUXT_MEDIA_VIDEO_PREPARE`) : **l'original est remplacé** (nouvelle version, anciennes URL → 302) ; chapitres et sous-titres intégrés non repris (les pistes de texte de D2 les remplacent) |
| `repair` « Réparation de l'index (WebM) » | WebM sans durée (enregistrement d'un navigateur), en VP8/VP9/AV1 avec Opus/Vorbis | copie sans réencodage qui écrit la durée et l'index des repères (`Cues`) : **original remplacé** (nouvelle version) |
| `transcode` « Conversion H.264 » | rendu utile (voir plus bas) | **rendu** H.264/AAC en MP4, à côté de l'original |
| `av1` « Conversion AV1 » | `NUXT_VIDEO_AV1=on`, `libsvtav1` et `libopus` présents, rendu utile | rendu AV1/Opus en WebM, en plus |
| `poster` « Extraction de l'image d'affiche » | aucune affiche | affiche enregistrée, sans nouvelle version |
| `verify` « Vérification du résultat » | après chaque sortie vidéo | réanalyse par le lecteur de D1 : codec, dimensions, son, durée (± 0,5 s ou 2 % ; 2 s ou 10 % pour un WebM réparé, dont la durée doit être écrite), plus aucune piste de données après `sanitize`, taille ≤ 2 Gio − 1 ; sinon sortie jetée (`CONVERSION_FAILED`) |

- **Sans perte → original ; réencodage → rendu** : une copie sans réencodage remplace le fichier stocké (comme
  « Optimiser » : nouvelle version, sinon les positions GPS resteraient publiques à l'URL de l'original) ; un
  réencodage perd de la qualité, l'original reste donc tel quel (téléchargement, nouveau rendu plus tard).
  `sanitize` et `repair` passent avant les réencodages, l'affiche en dernier.
- **Rendu compatible** (`NUXT_VIDEO_RENDITION`) : `auto` (défaut) le produit **seulement s'il sert** —
  compatibilité qui n'est pas « large » (HEVC, AV1, ProRes…), format converti, petit côté de plus de 1080 px,
  débit moyen de plus de 10 Mbit/s, HDR, ou vidéo entrelacée ; une vidéo H.264 1080p raisonnable n'en reçoit pas
  (ni calcul ni stockage en plus). `always` : pour chaque vidéo ; `never` : jamais, **sauf pour un format
  converti** (sans rendu, il ne serait jamais lisible). Réglages : H.264 High, `yuv420p`, CRF `NUXT_VIDEO_CRF`
  (23), préréglage `NUXT_VIDEO_PRESET` (`veryfast` ; `medium` coûte environ 1,7 fois plus), petit côté ramené à
  1080 px au plus (jamais agrandi), cadence plafonnée à 60 i/s, image clé toutes les 2 s, rotation appliquée aux
  pixels, images entrelacées désentrelacées, AAC 128 kbit/s stéréo 48 kHz (sans son : sans piste son), index en
  tête (`faststart`), aucune métadonnée d'origine. **HDR** (HLG ou PQ des téléphones récents) converti en SDR
  (filtres `zscale` + `tonemap`) ; filtres absents : rendu fait sans correction, signalé. **AV1** (option) :
  `libsvtav1` préréglage 10, CRF 35, Opus 96 kbit/s ; proposé avant le H.264 dans `sources`. Un seul rendu
  H.264 (plusieurs définitions : avec le HLS de D4).
- **Affiche côté serveur** : seulement si la vidéo **n'a aucune affiche** (envoi par l'API, codec que le
  navigateur ne décode pas), jamais par-dessus une affiche choisie ; 10 % de la durée (5 s au plus), puis 1 s et
  2 s plus loin si l'image est presque noire ; extraite du rendu H.264 produit par le même essai (couleurs SDR),
  sinon de la source (couleurs HDR converties quand `zscale` et `tonemap` sont présents), puis normalisée comme
  une affiche envoyée.
- **Formats convertis** : `width`, `height` et `duration` restent inconnus jusqu'à l'étape `probe` ; la fiche
  affiche « Format converti après l'envoi » puis le lecteur sur le rendu ; sans piste vidéo ou illisible, la
  tâche échoue (`NO_VIDEO_TRACK`, `UNREADABLE`, `CONVERSION_FAILED`) et seul le téléchargement de l'original
  reste possible.
- **Durée maximale** (`NUXT_VIDEO_MAX_DURATION`, 3 h) : au-delà, aucun réencodage ; si un rendu aurait servi, le
  retrait des pistes de données, la réparation et l'affiche sont faits quand même, puis la tâche finit en échec
  `TOO_LONG` (une vidéo trop longue qui n'a besoin d'aucun rendu finit « Traitée »). Durée inconnue : l'encodage
  est arrêté dès que sa sortie dépasse la limite (`TOO_LONG`).
- **Versions** : `sanitize` et `repair` créent une nouvelle version (anciennes URL → 302) ; un premier rendu et la
  première affiche ne la changent pas ; un rendu **remplacé** (relance) la change (cache immuable : jamais
  d'autres octets à une ancienne URL). Une tâche vaut pour un **fichier** (`MediaJob.sourceKey`) : changer
  l'affiche ou le point d'intérêt ne l'annule pas.

**Modes** (`NUXT_VIDEO_PROCESSING`) :

| Mode | Qui exécute les tâches | Usage |
| --- | --- | --- |
| `off` (défaut) | personne : aucune tâche créée, `processingState` reste null | installation sans ffmpeg ; comportement de D2 |
| `embedded` | le serveur web lui-même (boucle de fond, ffmpeg en priorité la plus basse) | une seule machine, développement |
| `external` | des **processus de travail** séparés (`NUXT_SERVER_ROLE=worker`, ou `surge-media worker`) ; le serveur web ne fait que créer les tâches | production chargée, machine ou conteneur dédié aux calculs |

- **Traitement actif** : en `embedded`, ffmpeg détecté utilisable et boucle en route ; en `external`, un processus
  de travail en état de traiter s'est signalé dans les **5 dernières minutes** (présence réécrite toutes les 60 s ;
  réponse gardée 30 s par le serveur web). Inactif : formats convertis refusés (415), aucune tâche créée à l'envoi
  (la vidéo est servie comme en D2 ; à traiter plus tard par « Traiter les vidéos existantes »), « Relancer » →
  409 `PROCESSING_DISABLED`.
- **Contrôle au démarrage** de chaque processus qui exécute des tâches : `ffmpeg -version` (6 ou plus),
  `-encoders` (`libx264` et `aac` exigés ; `libsvtav1` + `libopus` pour l'AV1), `-filters` (`zscale` + `tonemap`
  pour le HDR), `ffprobe -version`. Un échec désactive le traitement de ce processus avec un message (journal de
  ce processus ; en mode `embedded`, aussi « Réglages »), jamais l'arrêt du serveur : corriger, puis redémarrer.
  ffmpeg devenu inutilisable en cours de route (binaire supprimé ou déplacé) : tâche rendue sans essai compté,
  boucle arrêtée, nouvelle détection chaque minute, reprise d'elle-même.

**File** (`MediaJob`, `jobs.ts`) :

- une tâche active par vidéo, créée dans la même transaction que l'envoi, le remplacement, « Optimiser » ou la
  restauration ; priorité **10** pour une vidéo dont la diffusion est retenue (piste de données à retirer), **0**
  pour un envoi, **−10** pour « Traiter les vidéos existantes » ;
- **prise atomique** (`updateMany` conditionné au statut `QUEUED`, portable SQLite, PostgreSQL, MySQL) : plusieurs
  processus de travail possibles, jamais deux sur la même tâche ; `NUXT_VIDEO_CONCURRENCY` tâches à la fois par
  processus (1 par défaut) ; file vide : une requête indexée toutes les 5 s (mode `embedded` : réveil immédiat) ;
- **bail** de 2 min renouvelé toutes les 30 s : un processus arrêté net (SIGKILL, panne) rend sa tâche à la file
  à l'expiration du bail, un essai compté ; **3 essais** au plus, reprises après 30 s puis 5 min (échecs
  passagers : délai dépassé, ffmpeg tué par un signal, disque plein, base ou stockage indisponibles) ; un échec
  déterministe (pas de vidéo, fichier illisible ou refusé par ffmpeg, trop long, original absent, sortie refusée
  par la vérification) est définitif d'emblée ;
- **arrêt propre** (SIGTERM, ou Ctrl+C sur `pnpm start` / `surge-media worker` ; rechargement à chaud en
  développement) : ffmpeg arrêté avec ses descendants, tâche rendue à la file **sans compter d'essai**, dossier
  temporaire supprimé (20 s au plus). Ctrl+C sur `pnpm dev` n'est pas un arrêt propre : ffmpeg s'arrête avec le
  terminal et la tâche est reprise au démarrage suivant, un essai compté (voir « Arrêt ») ;
- **rattrapage** au démarrage puis toutes les 5 min : une vidéo « en attente » sans tâche (base restaurée,
  restauration faite pendant que le traitement était inactif) en reçoit une ; dossiers temporaires abandonnés
  supprimés (au démarrage puis toutes les 15 min, ceux de cette installation seulement) ;
- **cycle de vie** : remplacement ou « Optimiser » → tâche de l'ancien fichier annulée, rendus supprimés, nouvelle
  tâche ; corbeille → tâche annulée (état gardé) ; restauration → nouvelle tâche si le traitement n'était pas
  terminé ; duplication → rendus copiés dans le stockage et état repris (tâche propre à la copie si le traitement
  n'était pas terminé) ; suppression définitive → tâches et rendus supprimés avec le média.

**Rendus et sources** : table `MediaRendition`, fichiers `variants/<média>/rendition-<nom>-<aléa>.<ext>`
(supprimés quand le fichier change, et à la purge), diffusés sous la version courante :
`/m/<id>/v<n>/renditions/h264.mp4` et `/m/<id>/v<n>/renditions/av1.webm`. Le droit signé `file` de l'original
**couvre ses rendus**. `sources` (API v1, fiche, extrait `<video>`) est la liste prête pour
`<video><source src type>` : les rendus quand ils existent (AV1 d'abord, H.264 ensuite), sinon l'original s'il est
lisible ; vide pour un format converti tant que son rendu H.264 n'existe pas. Un changement de réglage
(`NUXT_VIDEO_RENDITION`, `_PRESET`, `_CRF`, `_AV1`) ne touche pas les vidéos déjà traitées : « Relancer le
traitement » refait leurs rendus avec les réglages actuels.

**Retenue de la diffusion (503)** : tant que le traitement d'une vidéo qui contient une piste de données de
l'appareil est en attente ou en cours, son original et ses rendus répondent `503 PROCESSING_PENDING`
(`Retry-After: 30`), sauf aux liens « admin » (§ 7.4) ; le média reste visible et modifiable. Levée dès que
l'étape `sanitize` a enregistré la copie sans la piste (en général quelques secondes, la tâche passant en
priorité 10), ou en échec définitif (l'avertissement reste dans la fiche : rendre la vidéo privée ou la
supprimer). Traitement désactivé (`off`), ou inactif à l'envoi (aucune tâche) : jamais de retenue, seulement
l'avertissement de la fiche (« Piste de données de l'appareil »). La retenue ne dépend pas de l'activité du
traitement : tant qu'aucun processus ne traite la file (mode `external` sans processus de travail actif, boucle
arrêtée ou désactivée en `embedded`), une vidéo à piste de données en attente — y compris restaurée pendant
l'inactivité — reste indisponible hors liens « admin » jusqu'à son traitement ou le passage en `off`.

**Fichiers hostiles** (ffmpeg décode des fichiers envoyés par des tiers ; arguments construits au seul
`args.ts`, lancement par `run.ts`) : **format d'entrée imposé** d'après la détection (`-f mov|matroska|avi|…` :
ffmpeg ne devine jamais, aucun démultiplexeur `hls`, `concat`, `dash`), **protocoles** limités aux fichiers
(`-protocol_whitelist file`, références externes des MOV refusées), image décodée de 16 384 × 16 384 px au plus,
sortie de 2 Gio − 1 au plus, **priorité la plus basse** (`os.setPriority` 19), **fils** bornés
(`NUXT_VIDEO_THREADS`, 16 au plus), **délais** (analyse 60 s, affiche 120 s, copie 10 min, encodage 10 × la
durée + 120 s) puis arrêt de l'arbre de processus, durée de sortie bornée par `NUXT_VIDEO_MAX_DURATION`, sous
Linux **`prlimit`** (mémoire `NUXT_VIDEO_MEMORY_LIMIT`, temps processeur), environnement réduit (ni secrets ni
mandataires HTTP transmis à ffmpeg), **sorties réanalysées** avant d'être enregistrées, messages de ffmpeg jamais
montrés tels quels (un code et un résumé sans chemin du serveur, 191 caractères au plus). Testé avec un faux AVI
qui est une liste HLS visant `/etc/passwd` et une URL locale (`tests/video-ffmpeg.test.ts`).

**Ressources** (mesures de l'architecture, § 29.2, sur 4 processeurs virtuels : ordres de grandeur) :

- **Processeur** : un rendu H.264 1080p `veryfast` coûte environ 1,7 s de processeur par seconde de vidéo (une
  vidéo de téléphone d'une minute ≈ 30 s sur 4 cœurs, une heure ≈ 30 min) ; l'AV1 environ 1,5 fois plus. En mode
  `embedded`, la priorité la plus basse garde le serveur web réactif (mesuré, § 29.3).
- **Mémoire** : 0,4 à 0,75 Gio par encodage 1080p, davantage en 4K (`NUXT_VIDEO_CONCURRENCY`, 1 par défaut ;
  une source 8K HDR peut demander de relever `NUXT_VIDEO_MEMORY_LIMIT`).
- **Espace temporaire** (dossier temporaire du système, `TMPDIR`/`TEMP`), par tâche simultanée : les sorties
  (rendus, copie sans réencodage), plus une copie de l'original sous S3 (stockage local : original lu en place).
- **Stockage** : un rendu (deux avec l'AV1) en plus de l'original pour les vidéos concernées.

**Installer ffmpeg** — contrôle : `ffmpeg -version` et `ffprobe -version` (version 6 ou plus), puis « Réglages ›
Traitement des vidéos » après redémarrage (mode `embedded` : version, encodeurs utiles, conversion HDR, AV1,
problèmes détectés ; mode `external` : machine, version de ffmpeg et tâches simultanées de chaque processus de
travail signalé — un processus de travail dont ffmpeg est inutilisable dès le démarrage n'y apparaît pas : voir
son journal).
Préférer le paquet du système, qui reçoit les correctifs de sécurité :

- **Debian / Ubuntu** : `sudo apt install ffmpeg`. Le paquet d'Ubuntu 24.04 (ffmpeg 6.1.1) a tout ce qui sert
  (`libx264`, `aac`, `libsvtav1` + `libopus`, `zscale` + `tonemap` : vérifié) ; Debian 13 livre ffmpeg 7.1.
  Debian 12 (ffmpeg 5.1) et Ubuntu 22.04 (4.4) sont trop anciens (« ffmpeg trop ancien » : traitement
  désactivé). `prlimit` vient du paquet `util-linux` (présent sur une installation standard) : sans lui, ffmpeg
  tourne sans limite de mémoire ni de temps processeur, sans message.
- **macOS** : `brew install ffmpeg`. Pas de `prlimit` (Linux seulement) : ni limite de mémoire ni limite de temps
  processeur ; priorité et arrêt du groupe de processus comme sous Linux.
- **Windows** : `winget install Gyan.FFmpeg`, puis une **nouvelle** console (le `PATH` n'est mis à jour que pour
  les consoles ouvertes ensuite) : `ffmpeg -version`. Si le serveur ne le trouve pas (console plus ancienne,
  autre compte, service), indiquer les chemins complets donnés par `where ffmpeg` et `where ffprobe` :
  `NUXT_FFMPEG_PATH='C:\…\ffmpeg.exe'` et `NUXT_FFPROBE_PATH='C:\…\ffprobe.exe'` (entre apostrophes dans `.env` :
  entre guillemets, un `\n` du chemin deviendrait un retour à la ligne). Le code y applique la classe de priorité
  la plus basse (`os.setPriority` 19), arrête l'arbre de processus par `taskkill /T /F` et n'a ni `prlimit` ni
  limite de mémoire. **Vérifié sous Windows 11 le 2026-10-10** (ffmpeg 9.0.2 de Gyan, accepté par le « Contrôle
  intelligent des applications » sur ce poste) : priorité « Inactive » (`Idle`) constatée pendant un encodage,
  arbre arrêté par `taskkill` (code de sortie 1 au lieu d'un signal), tests ffmpeg passés. Sur un autre poste, ce
  contrôle peut encore bloquer `ffmpeg.exe` (binaire non signé) comme il a bloqué `argon2` et `oxc-transform`
  (§ 14) : le traitement est alors désactivé au démarrage (« ffmpeg introuvable ou inutilisable »).

**Processus de travail** (mode `external`) : **la même build** que le serveur web, lancée avec
`NUXT_SERVER_ROLE=worker` ; il exécute les tâches et ne sert que `/api/health` (toute autre route : 404 en texte
brut, sans administration, API ni diffusion). Il reçoit **les mêmes variables que le serveur web** (base,
stockage, `NUXT_VIDEO_*`, avec `NUXT_VIDEO_PROCESSING=external` des deux côtés) ; les réglages d'encodage
appliqués sont les siens.

Sur la **même machine** (SQLite possible : même fichier, écritures courtes, attente des verrous de 10 s) :

```bash
pnpm build                     # depuis la racine : une seule build pour les deux rôles
cd packages/core               # .env : NUXT_VIDEO_PROCESSING="external"
pnpm start                     # serveur web (port 3000)
pnpm cli worker                # autre terminal : processus de travail (port 3001, /api/health seulement)
```

Hors du dépôt, `surge-media worker [--port 3001]` (binaire du package, `dist/cli/index.mjs`) fait la même chose ;
sans la CLI : `NUXT_SERVER_ROLE=worker PORT=3001 node .output/server/index.mjs` depuis `packages/core` (variables
fournies par l'environnement : en production, `.env` n'est lu que par `pnpm start` et `surge-media worker`).
Plusieurs processus de travail peuvent partager la file.

Dans un **autre conteneur ou sur une autre machine** :

- **même image** (même build), commande `node .output/server/index.mjs` (image Docker : commande `worker`, § 12.2) avec
  `NUXT_SERVER_ROLE=worker` ;
- **base partagée** : PostgreSQL ou MySQL/MariaDB (SQLite : même machine seulement) ;
- **stockage partagé** : S3 (même bucket, même `NUXT_MEDIA_STORAGE_PREFIX`) ou disque monté **au même endroit**
  (`NUXT_MEDIA_STORAGE_ROOT`, en écriture : rendus et réécritures y sont enregistrés). Vérifié au démarrage : si
  aucun des fichiers des derniers médias n'est lisible, le traitement n'est pas démarré (message « fichiers des
  médias introuvables dans le stockage configuré ») ;
- **ffmpeg ≥ 6 dans cette image** (et `prlimit`) : attention aux images construites sur Debian 12 « bookworm »,
  dont ffmpeg est en 5.1 ;
- **sonde** : `GET /api/health` sur son port (200 si base, stockage et sharp répondent ; `videoProcessing.workers`
  compte les processus en état de traiter) ; ne pas l'exposer publiquement.

Durcissement recommandé d'un conteneur de travail (surtout si des tiers envoient des vidéos : API, jetons
délégués) — non vérifié dans un conteneur à ce jour : utilisateur non root ; système de fichiers en lecture seule
(`--read-only`), sauf le dossier temporaire (`TMPDIR` sur un volume assez grand, pas un `tmpfs` en mémoire pour
des vidéos de 512 Mio) et, en stockage local, le dossier des médias ; aucune capacité (`--cap-drop=ALL`,
`--security-opt no-new-privileges`) ; aucun port publié ; réseau limité à la base et au stockage (ffmpeg n'a
besoin d'aucun réseau) ; limites de processeur et de mémoire du conteneur en plus de `NUXT_VIDEO_CONCURRENCY`,
`NUXT_VIDEO_THREADS` et `NUXT_VIDEO_MEMORY_LIMIT`. Sonde sans `curl` :
`node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"`
(port 3000 avec `node .output/server/index.mjs` ; 3001, ou la valeur de `--port`, avec `surge-media worker`).

**Arrêt** : SIGTERM ou Ctrl+C → arrêt propre (tâche rendue sans essai compté, présence effacée : le serveur web
cesse de le compter dans les 30 s). Arrêt brutal : ffmpeg peut finir seul en priorité la plus basse (borné sous
Linux par la limite de temps processeur), la tâche est reprise à l'expiration du bail (2 min, un essai compté).
Windows : `surge-media worker` ne retransmet pas les signaux (le Ctrl+C de la console atteint directement le
processus de travail, qui s'arrête proprement). **Vérifié sous Windows le 2026-10-10**, par un vrai Ctrl+C de
console pendant un encodage, avec `surge-media worker` comme avec `pnpm start` en `embedded` : arrêt en moins d'une
seconde, ffmpeg arrêté (lancé sans fenêtre, il ne reçoit pas le Ctrl+C de la console), tâche rendue sans essai
compté puis reprise jusqu'au bout par le processus suivant.
En développement (`pnpm dev`, mode `embedded`), ffmpeg reste dans le groupe du terminal : Ctrl+C l'arrête aussi
(vérifié sous Linux ; non rejoué sous Windows), et le bail de sa tâche est rendu échu au démarrage suivant
(reprise, un essai compté).

**Caches entre processus** (mode `external`) : le serveur web garde ses métadonnées de diffusion 60 s. Une version
plus récente, un rendu ou l'affiche d'une vidéo sans affiche qu'il ne connaît pas sont relus en base avant de
répondre ; le reste (fin d'une retenue demandée à l'ancienne URL, par exemple) suit en 60 s au plus.

**Administration** (D3) :

- **Médiathèque** : pastille d'état sur la carte (« Traitement en attente », « Traitement en cours », « Échec du
  traitement » ; icône fixe, sans animation).
- **Fiche d'une vidéo**, section **Traitement** : état (« Traitée » une fois fini), étape en cours, barre de
  progression avec le pourcentage écrit, essai (« 2 sur 3 » après un échec passager), dates, « Prochain essai au
  plus tôt », erreur traduite et détail technique, remarques, **Versions compatibles** (format, définition,
  débit, taille, durée, téléchargement) et bouton **« Traiter la vidéo »** (jamais traitée) ou **« Relancer le
  traitement »** (`media:write`). Rafraîchie toutes les 5 s **seulement** tant que la tâche est en attente ou en
  cours (navigateur, onglet visible, hors corbeille ; `GET …/processing`), sans effacer une saisie en cours ni
  interrompre la lecture ; seuls les changements d'état sont annoncés aux lecteurs d'écran.
- **Lecteur** : un `<source>` par entrée de `sources` ; sans source lisible (format converti en attente), un encadré
  l'explique et propose « Télécharger l'original ». **Avertissements** : « Version compatible en préparation » (à la
  place de la « lecture variable », masquée dès qu'une version H.264 existe), « Format converti après l'envoi » /
  « Format non lisible », « Piste de données de l'appareil » (retrait en cours et diffusion retenue, retrait en
  échec, ou traitement inactif), « Couleurs HDR converties » / « non converties ». « Optimiser la vidéo » est masqué
  pendant le traitement ; l'extrait `<video>` reprend `sources`, remplacé par une explication tant qu'aucune
  source n'est lisible.
- **Réglages** (`/admin/settings`, ADMIN) › **Traitement des vidéos**, en lecture seule (« Actualiser l'état ») :
  état (Actif, Désactivé, Arrêté, Inactif, avec la raison), mode, ffmpeg détecté (version, encodeurs utiles,
  conversion HDR, AV1, problèmes), réglages d'encodage, processus de travail (signalés depuis moins d'un jour,
  actifs à moins de 5 min), tâches par statut. **« Traiter les vidéos existantes »** : nombre de vidéos jamais
  traitées (envoyées avant D3 ou pendant que le traitement était inactif, hors corbeille), durée totale,
  estimation grossière du temps, confirmation ; les tâches passent après les nouveaux envois (sauf celles des
  vidéos à piste de données, en premier et retenues jusqu'au nettoyage) ; journal d'audit
  `media.processing_backfill`.

## 8. Traitement d'images (sharp)

`sharp` (libvips) est installé avec ses binaires précompilés ; aucun outil de compilation n'est
nécessaire sur Windows, macOS et Linux glibc. La sonde `/api/health` vérifie qu'il se charge.
Son cache d'opérations est désactivé (`sharp.cache(false)`) : il garderait les fichiers temporaires
ouverts, et donc verrouillés sous Windows.

**Concurrence bornée** (`server/lib/media/processing.ts`) : au plus `NUXT_MEDIA_PROCESSING_CONCURRENCY`
traitements simultanés (0 = nombre de cœurs), les suivants attendent dans une file de
`NUXT_MEDIA_PROCESSING_QUEUE` places ; file pleine → 503 `SERVER_BUSY` + `Retry-After: 5` (envoi,
remplacement, aperçu demandé à `/m/`) plutôt qu'un serveur saturé en mémoire. La pré-génération des
aperçus s'efface devant les demandes en attente.

### 8.1 Transformations à la demande

Toute image se transforme par son URL de diffusion (architecture : `.claude/architecture-phase-c.md`) :

```text
/m/<id>/v<n>/w_800,h_450,q_70/affiche.avif   paramètres libres
/m/<id>/v<n>/preview/affiche.webp           préréglage intégré : aperçu 480 px (URL inchangée)
/m/<id>/v<n>/full/affiche.jpg               préréglage intégré : image entière réencodée
```

- **Le format de sortie est l'extension** : `jpg`, `png`, `webp`, `avif` (`NUXT_MEDIA_TRANSFORM_FORMATS`) ;
  `jpeg` est redirigé vers `jpg`. GIF et images animées en sortie : pas encore (première image seulement).
- Un segment sans `_` est un **préréglage** (`preview`, `full`, ou préréglage global ou du projet :
  § 8.2), un segment avec `_` une liste de **paramètres** `clé_valeur` séparés par des virgules.
- Toute sortie est **sans métadonnées** (EXIF, GPS, profil : conversion en sRVB), orientation EXIF appliquée.

| Paramètre | Valeurs | Défaut | Effet |
| --- | --- | --- | --- |
| `r` | `90`, `180`, `270` | 0 | rotation horaire |
| `flip` | `h`, `v`, `hv` | — | miroir horizontal, vertical, les deux |
| `crop` | `x-y-largeur-hauteur` (pixels) | — | zone extraite, dans l'image orientée **et tournée** |
| `w`, `h` | 1 à 4096 (`NUXT_MEDIA_TRANSFORM_MAX_DIMENSION`) | — | dimensions cibles |
| `dpr` | 1 à 3, pas de 0,5 | 1 | multiplie `w` et `h` (dans la borne), puis disparaît de l'URL |
| `fit` | `cover`, `contain`, `fill`, `inside`, `outside` | `cover` | avec `w` **et** `h` seulement ; une seule dimension : réduction proportionnelle |
| `g` | `center`, `north` … `northwest`, `attention`, `entropy`, `focal` | `focal` | ancrage de `fit_cover` ; `focal` = point d'intérêt du média (§ 8.3), centre à défaut |
| `q` | 1 à 100 | JPEG 80, WebP 80, AVIF 50 | qualité ; PNG sans perte, sauf `q_` (palette) |
| `bg` | `rrggbb` | transparent, blanc en JPEG | fond de `fit_contain` et de la transparence convertie en JPEG |

- **Ordre d'exécution fixe** : orientation EXIF → rotation → miroir → zone → taille → fond → encodage.
- **Forme canonique** (sinon **301** vers elle, `Cache-Control: public, max-age=86400`, signature conservée) :
  clés dans l'ordre d'exécution `r, flip, crop, w, h, fit, g, q, bg` ; valeurs par défaut et paramètres
  sans effet retirés (`r_0`, `fit_cover`, `g_focal`, `fit` ou `g` sans les deux dimensions) ; nombres sans
  zéro initial ; `dpr` appliqué ; transformation vide → `full`. Elle ne dépend pas du format : un `q_` ou
  un `bg_` explicite est conservé (une signature vaut alors pour toutes les sources d'un `<picture>`).
- **Jamais d'agrandissement** : une demande plus grande que l'image est réduite en **gardant le rapport
  demandé** (`w_2000,h_1000` sur 1200 × 800 → 1200 × 600 recadré). Toute sortie est bornée à 4096 px,
  image entière comprise.
- **Un fichier par opération effective** : `w_1600`, `w_4096` et `full` sur une image de 1200 px de large
  produisent le même dérivé. Dérivés générés à la première demande (file bornée, § 8), conservés
  (`MediaVariant` : `v<n>/<opération>.<format>`, fichier `variants/<id>/v<n>-<empreinte>.<format>`),
  servis avec le cache des médias publics (1 an, immuable) et supprimés au remplacement du fichier.
- **Accès** : mêmes règles que l'original (§ 7.4). Signature d'une transformation : droit
  `t:<transformation canonique>`, **sans le format** ; **signature permanente** (sans `exp`) acceptée
  pour un dérivé précis d'un **média public** seulement (jamais l'original, jamais un droit élargi).

| Garde-fou | Défaut | Au-delà |
| --- | --- | --- |
| Transformation invalide, zone hors de l'image, `w`/`h` au-delà de la borne, format non activé | — | 400 `INVALID_TRANSFORM` (`data.detail` en anglais) |
| Dérivés par version de média (`NUXT_MEDIA_TRANSFORM_MAX_VARIANTS`) | 50 | 429 `TRANSFORM_QUOTA` pour un nouveau dérivé libre |
| Nouvelles générations libres non signées par IP et par minute (`NUXT_MEDIA_TRANSFORM_RATE_LIMIT`, 0 = sans limite) | 60 | 429 `TRANSFORM_QUOTA` + `Retry-After` |
| Traitements simultanés | § 8 | 503 `SERVER_BUSY` + `Retry-After` |

Les dérivés déjà générés et les préréglages restent toujours servis. Le débit par IP ne s'applique ni
aux URL signées pour une cible précise, ni aux identifiants d'API, ni aux liens de l'administration (il
s'applique au droit élargi `derived`). **Derrière un CDN**, toutes les requêtes arrivent de quelques
adresses : relever `NUXT_MEDIA_TRANSFORM_RATE_LIMIT` ou le mettre à 0.

Au démarrage, les aperçus générés avant les transformations sont repris sous leur nouvel identifiant
(fichier conservé, rien n'est régénéré). Ce que chaque espace accepte (paramètres libres ou
préréglages seulement) : § 8.2.

### 8.2 Politique des transformations et préréglages

**Politique** d'un espace : ce que les **paramètres libres** de l'URL ont le droit de faire. Les
préréglages sont servis quelle que soit la politique.

| Politique | Paramètres libres (`w_800,h_450…`) | Usage |
| --- | --- | --- |
| `OPEN` (défaut) | acceptés, dans les bornes du § 8.1 | site public qui construit ses `srcset` côté client |
| `SIGNED` | seulement avec une URL signée (exacte, permanente pour un média public, ou droit `derived`) ou un identifiant d'API ; sinon 403 `TRANSFORM_NOT_ALLOWED` | installation exposée à fort trafic |
| `PRESETS` | refusés (403 `TRANSFORM_NOT_ALLOWED`), sauf pour les liens de l'administration | contrôle exact des fichiers générés |

- Projet : `Project.transformPolicy`, réglée dans l'onglet **Transformations** du projet (`project:settings`,
  propriétaires ; lecture pour tout membre). Bibliothèque : réglage de l'installation
  (`Setting` « `transforms.libraryPolicy` »), page **Réglages** (`/admin/settings`, permission
  `settings:manage` : ADMIN).
- **Préréglages**, par ordre de priorité dans un espace :
  1. **intégrés** (`preview`, `full`, non modifiables ; `original` est aussi réservé) ;
  2. **du projet** (onglet Transformations, `project:settings`) ;
  3. **globaux** (page Réglages, ADMIN) : utilisables dans la bibliothèque et dans tous les projets,
     sauf quand un préréglage du projet porte le même nom (il le **masque**).
- Un préréglage = un nom (`^[a-z][a-z0-9-]{0,31}$`) + des paramètres enregistrés sous forme canonique,
  **sans format** (l'extension de l'URL le choisit) ni zone fixe (`crop`, propre à chaque image), et
  une description facultative. 100 préréglages au plus par niveau ; noms uniques par niveau (contrôlés
  par l'application). L'interface les saisit par champs (largeur, hauteur, ajustement, ancrage, qualité,
  fond, rotation, miroir) et affiche les paramètres produits.
- **Modifier un préréglage change le contenu de ses URL** : nouveau fichier généré à la demande ; les
  URL d'un préréglage global ou de projet sont donc mises en cache `public, max-age=604800`
  (`NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE`) et revalidées par l'ETag, au lieu d'`immutable` (les
  préréglages intégrés, eux, restent immuables). Le supprimer : ses URL répondent 404 (ou servent de
  nouveau le préréglage global qu'il masquait).
- Créations, modifications et suppressions de préréglages, changements de politique : **journal
  d'audit** (`preset.*`, `project.updated` › `transformPolicy`, `settings.updated` › `libraryPolicy`).
- API v1 : `GET /api/v1/projects/:projectId/presets` (toute clé, y compris publique ; ETag → 304) et
  `transformPolicy` dans le contrat `Project` (§ 9.9).

| Endpoint (administration) | Droit | Rôle |
| --- | --- | --- |
| `GET /api/admin/transforms?project=` | `project:read` ; sans `project` : `settings:manage` | `{ level, policy, presets, limits, canEdit }` (préréglages intégrés, globaux avec `shadowed`, du projet) |
| `PATCH /api/admin/transforms?project=` | `project:settings` ; sans `project` : `settings:manage` | `{ policy: OPEN \| SIGNED \| PRESETS }` |
| `POST /api/admin/presets?project=` | idem | `{ name, transformation, description? }` → 201 · 400 `INVALID_TRANSFORM` (`data.param`) · 409 `PRESET_NAME_TAKEN` / `PRESET_LIMIT_REACHED` |
| `PATCH` / `DELETE /api/admin/presets/:id` | idem, selon le niveau du préréglage | `{ name?, transformation?, description? }` · 204 · 404 `PRESET_NOT_FOUND` |

### 8.3 Point d'intérêt et liens de l'API

**Point d'intérêt** d'une image : le point qui doit rester dans le cadre quand une transformation recadre
(`fit_cover` avec l'ancrage `focal`, celui par défaut). Le recadrage garde la plus grande zone au rapport
demandé, **centrée sur le point** et bornée à l'image ; sans point, il est centré ; un ancrage explicite
(`g_north`, `g_center`…) l'ignore.

- Valeur : `{ x, y }`, fractions (0 à 1) de la largeur et de la hauteur de l'image orientée depuis le coin
  haut gauche, arrondies à 4 décimales (`Media.focalX`, `focalY`) ; `null` = aucun.
- Réglage : fiche du média (section **Point d'intérêt** : clic sur l'image ou deux curseurs au clavier, aperçu
  des recadrages carré et 16:9), `PATCH /api/admin/media/:id` ou API v1 `PATCH …/media/:mediaId` avec
  `{ "focalPoint": { "x": 0.3, "y": 0.4 } }` (ou `null`). Images seulement.
- **Le changer crée une nouvelle version** du média, comme un remplacement : toutes ses URL changent (les
  anciennes redirigent en 302, transformation comprise), les dérivés de l'ancienne version sont supprimés et
  régénérés à la demande : aucun cache ne sert un recadrage périmé. Le même point (à 4 décimales près) ne
  change rien. 409 `VERSION_CONFLICT` si le média a changé entre-temps, 409 `IN_TRASH` dans la corbeille.
- Conservé au remplacement du fichier (comme le titre et le texte alternatif), repris par la duplication.

**Contrat `Media` de l'API v1** : `focalPoint` et `urlTemplate`, gabarit des URL de dérivés à compléter par
l'application :

```text
https://media.example.com/m/<id>/v3/{transform}/affiche-ete.{format}
  {transform} : préréglage (preview, full, ceux du projet) ou paramètres (w_800,h_450)
  {format}    : jpg, png, webp ou avif
```

Pour un média privé, le gabarit porte une signature `derived` (tout dérivé de la version) valable jusqu'à
`urlExpiresAt` ; `null` hors images.

**Liens à la demande** : `POST /api/v1/projects/:projectId/media/:mediaId/signed-url` (un lien) et
`POST /api/v1/projects/:projectId/signed-urls` (lot de 100 liens au plus, par exemple tout un `srcset`).

| Cible (`target`) | Champs | URL renvoyée |
| --- | --- | --- |
| `file` (défaut) | — | l'original |
| `preset` | `preset` (intégré, du projet ou global), `format` (`webp` par défaut) | `…/<préréglage>/<nom>.<format>` |
| `transform` | `transform` (paramètres dans n'importe quel ordre), `format` | forme canonique (`h_450,w_800` → `w_800,h_450`, `dpr` replié ; vide → `full`) |
| `derived` | `preset` ou `transform` facultatif (aperçu par défaut) | ce dérivé ; la signature (`query`) vaut pour **tout** dérivé de la version |

Signature délivrée selon le média et la politique du projet (§ 8.2) :

| | Média privé | Média public |
| --- | --- | --- |
| `file`, `preset` | à échéance (`expiresIn`, 60 s à 7 jours) | aucune (URL permanente) |
| `transform` | à échéance ; refusée en `PRESETS` | `OPEN` : aucune ; `SIGNED` : **permanente** (sans `exp`, cache immuable), à échéance pour un jeton délégué ; `PRESETS` : 403 `TRANSFORM_NOT_ALLOWED` |
| `derived` | à échéance | `SIGNED` : à échéance ; sinon aucune |

- La signature d'une transformation couvre tous les formats : la même `query` sert aux sources AVIF, WebP et
  JPEG d'un `<picture>`.
- Erreurs : 400 `INVALID_TRANSFORM` (paramètre fautif dans `detail`, format non activé), 404
  `PRESET_NOT_FOUND`, 403 `TRANSFORM_NOT_ALLOWED`, 400 `INVALID_REQUEST` (combinaison incohérente : format avec
  l'original, `preset` et `transform` ensemble, champ inconnu). Dans un lot, un lien impossible reçoit
  `{ "error": { "code", "detail" } }` à sa place, les autres sont délivrés ; une seule échéance pour le lot.
- Clé publique : 403 `CREDENTIAL_NOT_ALLOWED` ; jeton délégué : 1 h au plus, jamais de lien permanent.
- La spécification OpenAPI décrit ces routes et, dans sa description générale, la grammaire de `/m/`
  (paramètres, cache, politique, erreurs) ; le catalogue `GET /api/v1/errors` contient les codes
  `INVALID_TRANSFORM`, `TRANSFORM_NOT_ALLOWED`, `PRESET_NOT_FOUND` et `TRANSFORM_QUOTA`.

Exemple (serveur du client, une page entière) :

```bash
curl -X POST -H "Authorization: Bearer $SURGE_MEDIA_SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"items":[{"mediaId":"<id>","target":"transform","transform":"w_400","format":"avif"},{"mediaId":"<id>","target":"transform","transform":"w_800","format":"avif"}],"expiresIn":3600}' \
  "https://media.example.com/api/v1/projects/<projectId>/signed-urls"
```


### 8.4 Générateur d'adresses (fiche média)

La fiche d'une image (`/admin/media/:id`) propose un **générateur d'adresses** : on choisit un préréglage de
l'espace ou des paramètres, regroupés par thème — **Taille** (largeur, hauteur, densité de pixels 1x à 3x),
**Cadrage** (ajustement et ancrage, affichés quand largeur et hauteur sont indiquées ; **zone de recadrage**),
**Rendu** (qualité, couleur de fond), **Orientation** (rotation, miroir) — puis un format de sortie. Chaque
aide décrit l'effet du choix courant (mode d'ajustement, ancrage, qualité par défaut du format…). Les champs
de taille, de cadrage, de rendu et d'orientation sont ceux du dialogue des préréglages.

- **Zone de recadrage** (`crop`) : cliquer sur deux coins opposés de l'image (pas de glisser-déposer) ou
  saisir sa position et sa taille en pixels ; l'image est montrée avec la rotation et le miroir choisis (la
  zone s'entend dans l'image tournée), le reste est assombri. Une zone qui dépasse est signalée sur le champ.
- **Densité** (`dpr`) : multiplie largeur et hauteur ; l'adresse porte les dimensions multipliées (forme
  canonique) et l'extrait `<img>` garde la taille d'affichage demandée. Si l'image (ou la zone) est trop
  petite pour atteindre la densité, l'aperçu indique la **densité réelle** (ex. « 800 × 300 px : densité
  réelle 1,2x »).

L'interface affiche :

- un **aperçu** rendu à la volée par l'administration, avec les dimensions, le format et le poids réels du
  résultat (et un avertissement quand l'image d'origine est trop petite : jamais d'agrandissement).
  L'aperçu **n'est jamais enregistré** et ne compte pas dans le quota de dérivés ; le fichier sera généré à
  la première visite de l'adresse ;
- l'**adresse** à copier, construite comme celles de l'API (§ 8.3) avec la politique de l'espace : permanente,
  signée sans échéance (paramètres libres d'un média public en politique `SIGNED`), ou lien temporaire
  (média privé : validité 1 h, 24 h ou 7 jours) ; en politique `PRESETS`, des paramètres libres sont
  refusés (lien vers les préréglages de l'espace) ;
- des **extraits HTML** : `<img>` avec sa taille d'affichage, `<picture>` (sources AVIF et WebP, repli JPEG)
  et `srcset` 1x/2x/3x pour les écrans haute densité (chaque densité seulement si l'image, ou la zone,
  permet d'en approcher d'au moins une demi-densité : sinon le serveur rendrait presque le même fichier).

L'aperçu et l'adresse se mettent à jour après une courte pause de saisie. Droit nécessaire : `media:read`
dans l'espace du média (tout membre du projet) ; pas de générateur dans la corbeille.

| Endpoint (administration) | Portée | Rôle |
| --- | --- | --- |
| `GET /api/admin/media/:id` | `media:read` | + `transforms` (image) : politique de l'espace, préréglages utilisables, formats, dimension maximale |
| `GET /api/admin/media/:id/transform?preset=\|transform=&format=` | `media:read` | aperçu (image) ; en-têtes `X-Transform-Width`, `X-Transform-Height`, `X-Transform-Operation` · 400 `INVALID_TRANSFORM` (`data.param`) · 404 `PRESET_NOT_FOUND` · 409 `IN_TRASH` · 503 `SERVER_BUSY` |
| `POST /api/admin/media/:id/links` | `media:read` | `{ items: [{ preset? \| transform?, format }] (1 à 4), expiresIn? }` → `{ items: [{ url, query, expiresAt } \| { error: { code, param?, detail? } }] }` · 409 `IN_TRASH` |

## 9. Authentification et rôles

### 9.1 Rôles et permissions

Source unique : `shared/utils/permissions.ts` (auto-importé côté app et serveur), testée par
`tests/permissions.test.ts`. Les enums Prisma `Role` et `ProjectRole` doivent rester identiques à
`ROLES` et `PROJECT_ROLES` : des vérifications de type (`server/utils/auth.ts`, `server/utils/access.ts`)
échouent à la compilation sinon.

Deux niveaux : le **rôle de plateforme** (`User.role`) donne des permissions globales et les droits
sur la bibliothèque ; le **rôle de projet** (`ProjectMember.role`) donne les droits dans ce projet,
**encadrés** par le rôle de plateforme (plafond, et plancher pour le gestionnaire). Un rôle n'est
qu'un ensemble de **portées** : les identifiants d'API (§ 9.6) utilisent le même vocabulaire.

| Rôle de plateforme | Bibliothèque | Projets | `projects:create` | `tokens:personal` | `api:docs` | Comptes | `audit:read` | `settings:manage` |
| --- | --- | --- | :---: | :---: | :---: | --- | :---: | :---: |
| `ADMIN` (Administrateur) | gestion (`library:manage`) | **tous** (`projects:all`), comme propriétaire | ✓ | ✓ | ✓ | tous (`users:manage`) | ✓ | ✓ |
| `MANAGER` (Gestionnaire) | lecture (`library:read`) | ceux dont il est membre, **toujours propriétaire** | ✓ | ✓ | ✓ | invite des `DEVELOPER` / `EDITOR` (`users:invite`) | | |
| `DEVELOPER` (Développeur) | lecture | ceux dont il est membre ; rôle de projet `DEVELOPER` au plus | | ✓ | ✓ | | | |
| `EDITOR` (Éditeur) | lecture | ceux dont il est membre ; rôle de projet `EDITOR` | | | | | | |

- **Rôle exercé** : `clampProjectRole` ramène le rôle de membre entre le **plancher**
  (`PROJECT_ROLE_FLOOR` : `OWNER` pour un gestionnaire) et le **plafond** (`PROJECT_ROLE_CEILING`)
  du rôle de plateforme ; `assignableProjectRoles` donne les rôles proposés (gestionnaire : `OWNER`
  seulement ; développeur : `DEVELOPER` ou `EDITOR` ; éditeur : `EDITOR`). Changer le rôle de
  plateforme d'un compte ramène ses adhésions dans ces bornes, dans la même transaction : le rôle
  enregistré est toujours le rôle exercé (sauf pour l'ADMIN, propriétaire partout).
- **Bibliothèque** : seul l'ADMIN y envoie, modifie, range, déplace et supprime des médias ; les autres
  rôles la consultent et dupliquent ses médias dans leurs projets (`spaceScopes` → `media:read`).
- **Invitations** : `invitableRoles` (ADMIN : tous les rôles ; MANAGER : `DEVELOPER`, `EDITOR`) — § 9.4.

`api:docs` : documentation interactive de l'API (§ 9.12). `settings:manage` : réglages de
l'installation (`/admin/settings` : politique des transformations de la bibliothèque, préréglages
globaux, § 8.2).

| Rôle de projet | Portées |
| --- | --- |
| `OWNER` | `project:read`, `project:credentials`, `project:members`, `project:settings` + `media:read`, `media:upload`, `media:write`, `media:delete` |
| `DEVELOPER` | `project:read`, `project:credentials` + portées `media:*` |
| `EDITOR` | `project:read` + portées `media:*` |

Projet archivé : seules `project:read`, `project:settings` et `media:read` restent (lecture seule,
désarchivage, suppression).

### 9.2 Sessions (hybride : cookie scellé + base)

- **Interface** : `nuxt-auth-utils` pose un cookie `surge-media-session` HTTP-only, `SameSite=Lax`,
  `Secure`, chiffré avec `NUXT_SESSION_PASSWORD`. Il contient un jeton aléatoire dont l'empreinte est
  enregistrée dans la table `Session`.
- **Validation côté serveur** : chaque lecture de session (`/api/_auth/session`) et chaque appel
  protégé (`requireAuth`) vérifient la session en base. Supprimer la session ou désactiver le compte
  (`User.isActive = false`) coupe l'accès immédiatement. Le rôle affiché est relu en base.
- **API applicative** (API v1, étape B3) : les applications tierces s'identifient par clé de projet ou
  jeton personnel (`Authorization: Bearer`, § 9.6), jamais par cookie.
- **Actions sensibles** : la session retient la dernière saisie du mot de passe (connexion ou
  confirmation) ; au-delà de 10 minutes, l'API répond 403 `REAUTH_REQUIRED` (§ 9.7).

| Endpoint | Rôle |
| --- | --- |
| `POST /api/auth/login` | `{ email, password }` → 200 + cookie · 400 invalide · 401 refusé · 429 trop de tentatives (`Retry-After`) |
| `POST /api/auth/logout` | ferme la session (cookie + base) |
| `POST /api/auth/confirm-password` | `{ password, trustDevice? }` → 200 `{ verifiedUntil, trustedUntil }` · 422 `PASSWORD_INCORRECT` (la session reste ouverte) · 429 après 5 échecs en 15 min |
| `GET /api/auth/trusted-devices` | durée configurée, confiance de ce navigateur, nombre d'appareils de confiance du compte |
| `DELETE /api/auth/trusted-devices` | `{ scope: 'current' \| 'all' }` → 200 `{ revoked }` : ne plus faire confiance à ce navigateur, ou à tous ses appareils |
| `GET /api/admin/status` | état de l'instance pour les administrateurs (`users:manage`) |
| `/api/admin/users/*`, `/api/auth/password/*` | gestion des utilisateurs et invitations, voir § 9.4 |

Protéger une nouvelle route API (`server/utils/auth.ts`, `server/utils/access.ts`, auto-importés) :

```ts
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, 'users:manage')       // permission de plateforme : 401 / 403
  const access = await requireSpaceAccess(event, spaceFor(projectId), 'media:upload') // espace : 404 / 403
  const { media } = await requireMediaAccess(event, () => findMedia(id), 'media:write') // média : 404 / 403
  await requireRecentPassword(event)                           // action sensible : 403 REAUTH_REQUIRED
  // …
  await recordAudit(event, { action: 'key.created', projectId, targetType: 'token', targetId, data: { label } })
})
```

Les listes partent toujours de l'espace imposé par le serveur ; les filtres de la requête ne font
que s'y ajouter.

Protéger une nouvelle page : toute page sous `/admin` exige une session (middleware
`auth.global.ts`) ; déclarer une permission de plateforme avec
`definePageMeta({ layout: 'admin', permission: 'tokens:personal' })`. Les pages d'un projet ou d'un
média s'appuient sur l'API (404 si l'espace est invisible) et sur les portées qu'elle renvoie
(`scopes`) pour masquer les actions. Côté interface, `useAuth().can('…')` sert à masquer ce qui est
interdit ; la sécurité reste assurée par l'API.

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

### 9.4 Gestion des utilisateurs et invitations (`/admin/users`, `users:manage` ou `users:invite`)

**Parcours** : l'administrateur crée le compte (e-mail, nom facultatif, rôle ; `EDITOR` présélectionné,
le moins privilégié). Aucun mot de passe n'est saisi : un **lien d'invitation à usage unique** (7 jours)
est affiché une seule fois, à copier et transmettre par un canal sûr, ou à **envoyer par e-mail** (bouton à côté de
« Copier le lien », proposé seulement si l'envoi SMTP est configuré : voir plus bas).
L'utilisateur ouvre `/password/<jeton>`, choisit son mot de passe (12 caractères minimum, saisi deux
fois), puis se connecte. Mot de passe oublié : l'administrateur génère un **lien de réinitialisation**
(24 h) depuis la fiche du compte ; l'ancien mot de passe reste valable jusqu'à son utilisation, puis
toutes les sessions du compte sont fermées.

**Envoi par e-mail** (étape 18) : avec `NUXT_SMTP_HOST` et `NUXT_SMTP_FROM` (§ 6), le panneau du lien
propose « Envoyer par e-mail ». Le navigateur renvoie le jeton affiché ; le serveur vérifie que c'est
bien le lien encore valable de ce compte, puis l'envoie **à l'adresse du compte, jamais ailleurs**, dans
la langue de l'interface de l'expéditeur, avec l'échéance dans son fuseau horaire (version texte et
HTML). Le jeton n'est toujours stocké qu'en empreinte. 5 envois par heure et par compte ; un refus du
serveur SMTP répond 502 `MAIL_FAILED` (détail dans les journaux du serveur) ; chaque envoi est journalisé
(`user.link_emailed`). Mêmes droits que l'émission du lien : un gestionnaire n'envoie que l'invitation
de ses invités. Sans configuration SMTP, rien ne change : le lien se copie et se transmet à la main.

L'administrateur peut rattacher le compte à des projets dès sa création (facultatif, avec un rôle de
projet permis par le rôle choisi) ; la liste indique qui a invité chaque compte (`User.invitedById`).

**Gestionnaire** (`users:invite`) : la même page s'intitule « Mes invitations ». Il invite un
développeur ou un éditeur en le rattachant à **au moins un** des projets actifs dont il gère les
membres. Il voit les comptes qu'il a invités, leur fiche en lecture (statut, projets qu'il partage
avec eux) et régénère le lien tant que l'invitation n'est pas acceptée. Modifier, désactiver ou
supprimer un compte, fermer ses sessions ou réinitialiser son mot de passe restent réservés à
l'administrateur ; un compte que le gestionnaire n'a pas invité lui répond 404.

| Endpoint | Rôle |
| --- | --- |
| `GET /api/admin/users?q=&role=&status=&page=` | `users:invite` : tous les comptes (administrateur) ou ses invités (gestionnaire) ; 20 par page ; recherche nom / e-mail insensible à la casse ; filtres invalides ignorés ; `invitedBy` |
| `POST /api/admin/users` | `{ email, name?, role, projectIds?, projectRole? }` → compte + adhésions + lien d'invitation (201) · 403 `ROLE_NOT_INVITABLE` · 422 `PROJECTS_REQUIRED` (gestionnaire sans projet) / `PROJECT_UNAVAILABLE` / `ROLE_NOT_ASSIGNABLE` · 409 `EMAIL_TAKEN` ; mot de passe récent si des projets sont choisis (§ 9.7) |
| `GET /api/admin/users/:id` | fiche : profil, sessions ouvertes, lien en attente (type et échéance, jamais le jeton), projets (parmi ceux que voit l'auteur) ; gestionnaire : ses invités seulement |
| `PATCH /api/admin/users/:id` | `{ name?, role?, isActive? }` ; désactiver ferme les sessions immédiatement |
| `DELETE /api/admin/users/:id` | suppression définitive (les médias du compte sont conservés) |
| `POST /api/admin/users/:id/password-link` | nouveau lien (invitation ou réinitialisation) ; annule le précédent · 409 si compte désactivé ; gestionnaire : invitation non acceptée de ses invités (409 `INVITATION_ACCEPTED` sinon) |
| `POST /api/admin/users/:id/password-link/email` | `{ token, locale, timeZone? }` → envoie le lien encore valable du compte à son adresse (200 `{ to }`) · 404 `TOKEN_INVALID` · 409 `MAIL_NOT_CONFIGURED` / `INVITATION_ACCEPTED` · 429 · 502 `MAIL_FAILED` |
| `GET /api/admin/config/mail` | `{ enabled }` : envoi d'e-mails configuré (`users:invite`) ; aucun paramètre SMTP renvoyé |
| `DELETE /api/admin/users/:id/sessions` | ferme les sessions du compte (sur son propre compte : sauf la session en cours) |
| `GET /api/auth/password/:token` | public : e-mail et type du lien · 404 `TOKEN_INVALID` |
| `POST /api/auth/password/:token` | public : `{ password, confirmation }` → enregistre le mot de passe (204) · 404 `TOKEN_INVALID` |

**Règles imposées par le serveur** (l'interface les reflète, mais ne les remplace pas) :

- un administrateur ne peut ni changer son propre rôle, ni se désactiver, ni se supprimer
  (403 `SELF_ACTION`) ;
- on ne retire jamais le dernier administrateur actif (409 `LAST_ADMIN`) ;
- un gestionnaire n'attribue que les rôles `DEVELOPER` et `EDITOR`, et seulement sur ses projets ;
- un changement de rôle s'applique à la requête suivante (le rôle est relu en base) ;
- un lien est à usage unique (consommation atomique), expire, et n'est plus valable si le compte est
  désactivé ; seule son empreinte SHA-256 est stockée ;
- les erreurs métier sont renvoyées dans `data.code` (`shared/utils/users.ts`) et traduites par
  l'interface via `apiError()`.

**Statuts** : `active` (mot de passe défini), `invited` (invitation pas encore acceptée),
`inactive` (compte désactivé).

### 9.5 Projets et membres (`/admin/projects`)

Une installation sert **une organisation cliente** et tous ses projets. Un projet = une application
et ses environnements (développement, test, staging, production) : ils partagent ses médias, et
chaque environnement a ses propres clés d'API (§ 9.6). Un environnement qui produit des envois
jetables (tests automatisés) utilise plutôt un projet distinct, alimenté par duplication.

- **Visibilité** : un ADMIN voit tous les projets ; les autres (gestionnaires compris) ne voient que
  ceux dont ils sont membres (un projet invisible répond 404).
- **Création** (`projects:create` : ADMIN, MANAGER) : nom, identifiant lisible (déduit du nom et
  suffixé `-2`, `-3`… s'il est pris ; saisi et déjà pris → 409 `SLUG_TAKEN`), description. Le
  créateur devient propriétaire.
- **Membres** (`project:members` + confirmation récente du mot de passe) : ajout parmi les comptes
  actifs non membres, rôle compris entre le plancher et le plafond du rôle de plateforme
  (422 `ROLE_NOT_ASSIGNABLE` : un gestionnaire est toujours propriétaire, un développeur jamais), un
  projet garde toujours un propriétaire effectif parmi ses membres (409 `LAST_OWNER`) ; chacun peut
  quitter un projet de lui-même (sans confirmation).
- **Archivage** (`project:settings`) : lecture seule (aucun envoi ni modification ; clés et origines
  non gérables, clés refusées par l'API v1), réversible.
- **Suppression** : projet archivé uniquement (409 `PROJECT_NOT_ARCHIVED`), confirmation par saisie de
  l'identifiant, avec un choix pour ses médias : **les déplacer vers la bibliothèque** (adresses
  conservées ; administrateur seulement, 403 `LIBRARY_NOT_ALLOWED` sinon — l'interface ne propose
  alors que la suppression) ou **les supprimer définitivement** (fichiers effacés en tâche de fond). `Media.projectId`
  est en `onDelete: Restrict` : un projet ne peut jamais emporter ses médias par cascade.

| Endpoint | Portée | Rôle |
| --- | --- | --- |
| `GET /api/admin/projects?q=&status=active\|archived&page=` | session | projets visibles (20 par page) avec rôle, nombre de médias et de membres |
| `POST /api/admin/projects` | `projects:create` | `{ name, slug?, description? }` → 201 |
| `GET /api/admin/projects/:id` | `project:read` | projet, rôle et portées de l'utilisateur, médias en corbeille |
| `PATCH /api/admin/projects/:id` | `project:settings` | `{ name?, slug?, description?, archived? }` |
| `DELETE /api/admin/projects/:id` | `project:settings` | `{ media: 'library' \| 'purge' }` |
| `GET /api/admin/projects/:id/members` | `project:read` | membres, rôle enregistré, rôle exercé, rôles attribuables |
| `GET /api/admin/projects/:id/candidates?q=` | `project:members` | comptes actifs non membres (20 au plus) |
| `POST /api/admin/projects/:id/members` | `project:members` | `{ userId, role }` → 201 · 404 `USER_NOT_FOUND` · 409 `ALREADY_MEMBER` |
| `PATCH /api/admin/projects/:id/members/:userId` | `project:members` | `{ role }` |
| `DELETE /api/admin/projects/:id/members/:userId` | `project:members` (ou soi-même) | retrait |

Pages : `/admin/projects` (liste, filtres), `/admin/projects/new`, puis pour chaque projet `Aperçu`
(résumé, réglages, archivage, suppression, lien vers le journal pour un ADMIN), `Médias`, `Membres`,
`Clés d'API` et `Origines autorisées` (ces deux onglets avec `project:credentials`).

### 9.6 Identifiants d'API : clés de projet, jetons personnels, origines

Les applications tierces s'identifient auprès de l'API v1 (§ 9.9) avec l'un de ces identifiants,
créés et gérés dans l'administration (un composant dans un navigateur utilise en plus des **jetons
délégués** `sm_dt_` de quelques minutes, émis par une clé secrète ou un jeton personnel : § 9.10). **Aucun identifiant ne gère les accès** : ses portées se limitent
à `project:read` et `media:*` (jamais membres, clés, origines ni réglages).

| Identifiant | Préfixe | Pour | Portées | Échéance | Affichage |
| --- | --- | --- | --- | --- | --- |
| Clé publique d'un projet | `sm_pk_` | un frontend (site, application mobile) | lecture des médias **publics** (fixe) | aucune (révocable) | réaffichable, copiable |
| Clé secrète d'un projet | `sm_sk_` | un serveur du client, jamais un navigateur | lecture + envoi / modification / suppression au choix | 30 j, 90 j, 1 an (défaut) ou aucune | **une seule fois** |
| Jeton personnel | `sm_pat_` | scripts, CI, outils d'un utilisateur | lecture + portées au choix, **∩ droits actuels de son propriétaire** | 30, 90 (défaut) ou 365 j, obligatoire | **une seule fois** |

- **Format** : `sm_<type>_` + 32 octets aléatoires en base62 (43 caractères) + CRC32 en base62
  (6 caractères, calculé sur tout ce qui précède). Le CRC permet de rejeter un identifiant mal formé
  sans accès à la base et aide les outils de détection de secrets ; la sécurité vient des 256 bits
  aléatoires. Seule l'empreinte SHA-256 est stockée ; le préfixe lisible (`sm_sk_4fQ9Zt…`) sert à
  reconnaître l'identifiant. Module pur et testé : `server/lib/access/tokens.ts`.
- **Clés de projet** (onglet « Clés d'API », portée `project:credentials` : propriétaires et
  développeurs du projet) : nom, **environnement** (`production`, `staging`, `development`, `test` ou
  étiquette libre `[a-z0-9-]`), type ; liste groupée par environnement. Elles appartiennent au projet :
  elles restent actives si leur créateur est désactivé (l'écran le signale).
- **Renouvellement (rotation)** : nouvelle clé avec les mêmes nom, environnement, portées et durée ;
  l'ancienne est révoquée tout de suite ou reste valable 1 h, 24 h ou 7 jours (« Remplacée »), le temps
  de déployer la nouvelle.
- **Révocation** immédiate ; **suppression** possible seulement une fois révoquée ou expirée
  (409 `TOKEN_ACTIVE` sinon). Portées immuables : pour en changer, créer un nouvel identifiant.
- **Jetons personnels** (`/admin/tokens`, permission `tokens:personal` : ADMIN, MANAGER et DEVELOPER) :
  « tous mes projets » (y compris ceux rejoints plus tard) ou une sélection de projets actifs
  (422 `PROJECT_UNAVAILABLE` sinon), bibliothèque en option (en lecture seule hors ADMIN : le jeton
  n'a jamais plus de droits que son propriétaire). Chacun ne voit et ne gère que les siens ;
  supprimer un compte supprime ses jetons, le désactiver les rend inutilisables.
- **Origines autorisées** (onglet « Origines autorisées », `project:credentials`) : origines exactes
  `schéma://hôte[:port]` normalisées (minuscules, port par défaut et « / » final retirés) ou joker de
  sous-domaine `https://*.example.com` (couvre `a.example.com`, jamais `example.com`) ; 100 au plus
  par projet ; valables pour tous les environnements. Elles servent au CORS de l'API v1 (§ 9.9).
  Fonctions pures et testées : `shared/utils/origins.ts` (`normalizeOrigin`, `isOriginAllowed`).
- **Dernière utilisation** (date, IP) : enregistrée par l'API v1 et la diffusion, au plus toutes les 5 minutes.

| Endpoint | Accès | Rôle |
| --- | --- | --- |
| `GET /api/admin/projects/:id/keys` | `project:credentials` | clés du projet (sans empreinte ; valeur des seules clés publiques) |
| `POST /api/admin/projects/:id/keys` | `project:credentials` (+ mot de passe récent pour une clé secrète) | `{ type, name, environment, scopes?, lifetime? }` → 201 `{ key, value }` |
| `POST /api/admin/projects/:id/keys/:keyId/rotate` | idem | `{ overlap: 'now' \| '1h' \| '24h' \| '7d' }` → 201 `{ key, value }` · 409 `TOKEN_NOT_ACTIVE` / `TOKEN_REPLACED` |
| `POST /api/admin/projects/:id/keys/:keyId/revoke` | `project:credentials` | 204 · 409 `TOKEN_NOT_ACTIVE` |
| `DELETE /api/admin/projects/:id/keys/:keyId` | `project:credentials` | 204 · 409 `TOKEN_ACTIVE` |
| `GET` / `POST /api/admin/projects/:id/origins` | `project:credentials` | liste · `{ origin }` → 201 · 409 `ORIGIN_EXISTS` / `ORIGIN_LIMIT_REACHED` |
| `DELETE /api/admin/projects/:id/origins/:originId` | `project:credentials` | 204 |
| `GET /api/admin/tokens` | `tokens:personal` | ses jetons personnels |
| `POST /api/admin/tokens` | `tokens:personal` + mot de passe récent | `{ name, lifetime, scopes?, allProjects?, projectIds?, includeLibrary? }` → 201 `{ token, value }` |
| `POST /api/admin/tokens/:id/revoke` · `DELETE /api/admin/tokens/:id` | `tokens:personal` (ses jetons) | 204 · 409 |

Un projet archivé répond 403 `PROJECT_ARCHIVED` sur ses clés et origines.

### 9.7 Confirmation du mot de passe (« mode sudo »)

Créer une clé secrète ou un jeton personnel, renouveler une clé secrète, ajouter un membre, changer
son rôle ou le retirer, inviter un compte en le rattachant à des projets exigent une saisie du mot de passe datant de **moins de 10 minutes**
(`REAUTH_WINDOW_SECONDS`, `shared/utils/auth.ts`) ; la connexion compte comme une saisie
(`Session.passwordVerifiedAt`). Sinon l'API répond 403 `REAUTH_REQUIRED` : l'interface
(`useReauth().run(action)` + `<AdminReauthDialog>` dans la mise en page) demande le mot de passe puis
rejoue l'action ; « Annuler » ou Échap l'abandonnent sans message d'erreur. Côté serveur, appeler
`requireRecentPassword(event)` **avant** tout effet de bord. Les actions qui retirent des droits
(révoquer, quitter un projet) ne demandent pas de confirmation.

**Appareils de confiance** (étape 17) : la case « Faire confiance à cet appareil pendant 15 jours »
du dialogue (décochée à chaque ouverture) dispense ce navigateur de ressaisir le mot de passe pour les
actions sensibles pendant `NUXT_PUBLIC_TRUSTED_DEVICE_DAYS` jours (15 par défaut, durée fixe, `0`
désactive l'option). Elle ne remplace jamais la connexion (sessions de 12 h) et survit à la
déconnexion.

- **Mécanisme** (`server/utils/trusted-devices.ts`) : jeton aléatoire de 256 bits dans le cookie
  `surge-media-trusted-device` (HTTP-only, `Secure` comme la session, `SameSite=Lax`, chemin `/`) ;
  seule son empreinte SHA-256 est enregistrée (`TrustedDevice`), liée au compte. Le cookie présenté par
  un autre compte ne sert à rien. Cocher de nouveau la case remplace le jeton de ce navigateur.
- **La confiance tombe** à son échéance, au changement de mot de passe (lien d'invitation ou de
  réinitialisation), à la désactivation du compte, à sa suppression, ou sur demande : tableau de bord
  (« Votre compte » › « Appareil de confiance » : ne plus faire confiance à cet appareil, ou à tous ses
  appareils) et fiche d'un compte pour l'administrateur (« Retirer la confiance des appareils »).
- **Journal** : `user.device_trusted` (durée) et `user.devices_revoked` (cet appareil ou tous, nombre).
- À ne pas cocher sur un ordinateur partagé : l'interface le rappelle sous la case.

| Endpoint | Accès | Rôle |
| --- | --- | --- |
| `DELETE /api/admin/users/:id/trusted-devices` | `users:manage` | retire la confiance de tous les appareils d'un compte → `{ revoked }` ; la fiche (`GET /api/admin/users/:id`) donne leur nombre (`trustedDevices`) |

### 9.8 Journal d'audit (`/admin/audit`, permission `audit:read` : ADMIN)

`recordAudit(event, { action, projectId?, targetType?, targetId?, data })` (`server/utils/audit.ts`)
enregistre l'auteur (session), l'adresse IP et un libellé lisible de la cible (`data.label`) ; un échec
d'écriture est journalisé sans faire échouer l'action. La table n'a pas de clés étrangères : les
entrées survivent aux comptes, projets et identifiants supprimés (affichés « supprimés »). Aucun secret
n'y est écrit.

Actions (`shared/utils/audit.ts`) : projets (création, modification, archivage, réactivation,
suppression), membres (ajout, changement de rôle, retrait), clés (création, renouvellement,
révocation, suppression), jetons personnels, origines, médias (changement de visibilité, déplacement,
suppression définitive, « Traiter les vidéos existantes » : `media.processing_backfill`, nombre de vidéos mises
en file, `partial` si une erreur a interrompu la mise en file), comptes (création, modification du rôle ou du
statut, suppression, lien de mot de passe, fermeture des sessions). L'écran filtre par catégorie et par projet
(lien « Voir les actions sur ce projet » de l'aperçu d'un projet). Pas encore de purge automatique des anciennes entrées.

### 9.9 API publique v1 (`/api/v1`)

API REST pour les applications du client (sites, applications mobiles, serveurs, scripts), distincte
de l'administration. Spécification **OpenAPI 3.1** : `GET /api/v1/openapi.json[?lang=fr|en]` (publique,
générée depuis le code des routes et les schémas zod, § 9.12) ; catalogue des erreurs : `GET /api/v1/errors`.
Documentation interactive : `/admin/api` (ADMIN, MANAGER, DEVELOPER).
L'onglet « Clés d'API » d'un projet affiche son adresse et le lien vers la spécification.

- **Authentification** : `Authorization: Bearer <identifiant>` (§ 9.6), **jamais de cookie** (la
  session d'administration est ignorée) ni de jeton dans l'URL (`?access_token=` → 400).
  Identifiant absent, invalide, expiré, révoqué (ou compte propriétaire désactivé) → 401 `TOKEN_*`
  avec `WWW-Authenticate: Bearer`. Clé secrète ou jeton personnel envoyé par un navigateur (en-tête
  `Origin` ou `Sec-Fetch-Site`) → 403 `SECRET_IN_BROWSER`. Clé publique ou jeton délégué avec une
  `Origin` non autorisée pour son projet → 403 `ORIGIN_NOT_ALLOWED` (sans `Origin` : serveur,
  application mobile).
- **Périmètre** : le projet est explicite dans l'URL. Projet inexistant ou hors du périmètre de
  l'identifiant → 404 (existence non révélée) ; projet archivé → 403 `PROJECT_ARCHIVED` (tous les
  identifiants, `/me` restant lisible). Droits effectifs : clé secrète = ses portées dans son projet ;
  clé publique = lecture des médias **publics** ; jeton personnel = ses portées ∩ droits actuels de
  son propriétaire, dans sa sélection ; jeton délégué = ses portées ∩ droits actuels de son émetteur,
  dans son projet (moteur pur `credentialScopes`, testé).
- **Erreurs RFC 9457** (`application/problem+json`) : `{ type, title, status, code, detail?,
  instance, requestId, errors? }` ; `code` est stable (catalogue `shared/utils/api.ts`), `requestId`
  = en-tête `X-Request-Id`, `errors` détaille les paramètres invalides (400 `INVALID_REQUEST`).
- **Corps des requêtes** : JSON de **1 Mio** au plus (413 `BODY_TOO_LARGE`), reçu en **30 s** au plus
  (408 `REQUEST_TIMEOUT`) ; envoi de fichier arrêté après **60 s** sans donnée (408 `UPLOAD_TIMEOUT`). Ces
  codes sont ajoutés d'office aux opérations concernées de la spécification.
- **CORS** : sous `/api/v1/projects/<id>/…`, seules les origines autorisées du projet reçoivent les
  en-têtes (preflight `OPTIONS` sans authentification, `Max-Age` 2 h) ; `/me` et `/projects` : toute
  origine (aucun cookie). Jamais `Access-Control-Allow-Credentials`.
- **Limitation de débit** (seau à jetons, par minute, `NUXT_API_RATE_LIMIT_*`) : clé publique 300 par
  (clé, IP), clé secrète et jeton personnel 1 200, jeton délégué 300 par (émetteur, IP), envois de
  fichiers 60 par identifiant (§ 9.10), échecs d'authentification 30 par IP (au-delà,
  toutes les requêtes de l'IP reçoivent 429 pendant la fenêtre). En-têtes `RateLimit-Policy` /
  `RateLimit` (brouillon IETF) et `Retry-After`.
- **Représentations** : valeurs en minuscules, dates ISO, URL **absolues** ; un média privé reçoit
  des URL signées (~1 h, échéance alignée sur le quart d'heure, `urlExpiresAt`) ; ni e-mail, ni clé
  de stockage, ni empreinte. Une image a aussi `urlTemplate` (gabarit des dérivés) et `focalPoint` (§ 8.3).
  Une vidéo a `poster` et `textTracks` (D2), `sources` et `processing` (D3, ci-dessous).
- **Cache HTTP** : `Cache-Control: private, no-cache` + `ETag` faible → `If-None-Match` → 304. L'ETag
  d'une liste combine la **révision de l'espace** (table `CacheRevision`, incrémentée par toute
  écriture de médias), la requête, l'audience (clé publique ou non) et la tranche des URL signées :
  une liste inchangée répond 304 **sans exécuter la requête** — sauf une page qui contient une vidéo en
  attente ou en cours de traitement, dont l'ETag inclut aussi l'avancement de ses tâches : sa revalidation
  relit la page (304 si rien n'a bougé). L'ETag d'un média suit de même l'avancement de son traitement (il
  change aussi au renouvellement du bail, toutes les 30 s).

**Vidéos traitées** (D3, § 7.7), champs ajoutés au contrat `Media` (rien de retiré ni de renommé) :

- `processing` : `{ status: pending | processing | ready | failed, progress, error, updatedAt }`, état de la
  dernière tâche ; `progress` (0 à 1, par rendu) seulement pendant `processing`, `error` (code, jamais le détail
  technique) seulement à `failed` ; `null` pour une image ou une vidéo jamais traitée.
- `sources` : liste ordonnée prête pour `<video><source src type>` (`url`, `type` avec ses codecs, `width`,
  `height`, `bitrate`, `size`, `rendition` : `av1`, `h264` ou `null` pour l'original) — rendus quand ils existent,
  sinon l'original s'il est lisible ; `[]` pour une image et pour un format converti pas encore converti. Média
  privé : chaque source porte la signature de `url` (même échéance). `url` reste l'original.
- `width`, `height`, `duration` : `null` pour un format converti tant que sa tâche ne l'a pas analysé ;
  `version` augmente aussi quand le traitement réécrit le fichier ou remplace un rendu.
- Attendre la fin d'un traitement : relire le média avec `If-None-Match`, pas plus d'une fois toutes les 5 s,
  tant que `processing.status` vaut `pending` ou `processing` (aucun webhook en D3). Diffusion retenue :
  `503 PROCESSING_PENDING` sur l'original et les rendus (§ 7.4).

| Endpoint | Portée | Rôle |
| --- | --- | --- |
| `GET /api/v1/me` | — | identifiant utilisé : type, nom, préfixe, environnement, portées, échéance ; propriétaire, projet ou sélection |
| `GET /api/v1/projects?limit&cursor` | `project:read` | projets actifs accessibles, avec les portées effectives |
| `GET /api/v1/projects/:projectId` | `project:read` | projet (dont `publicListing` et `transformPolicy` : `open` \| `signed` \| `presets`, § 8.2) |
| `GET /api/v1/projects/:projectId/presets` | `media:read` (toute clé, y compris publique) | préréglages utilisables : intégrés, du projet, globaux non masqués (`{ items: [{ name, transformation, description, level }] }`), ETag → 304 |
| `GET /api/v1/projects/:projectId/media` | `media:read` | `?q&kind&visibility&ids&sort&limit&cursor&withTotal` → `{ items, nextCursor, total? }` |
| `GET /api/v1/projects/:projectId/media/:mediaId` | `media:read` | un média actif (clé publique : public seulement) |
| `POST /api/v1/projects/:projectId/media/:mediaId/signed-url` | `media:read` (clé secrète, jeton personnel ; jeton délégué : 1 h au plus) | `{ target: 'file' \| 'preset' \| 'transform' \| 'derived', preset?, transform?, format?, expiresIn? }` → `{ url, query, expiresAt }` (§ 8.3) ; cible `file` d'une vidéo : aussi `sources`, signées jusqu'à la même échéance |
| `POST /api/v1/projects/:projectId/signed-urls` | idem | lot : `{ items: [{ mediaId, target?, preset?, transform?, format? }] (100 au plus), expiresIn? }` → `{ items: [{ url, query, expiresAt, sources? } \| { error }] }` (§ 8.3) |
| Écritures et jetons délégués | — | § 9.10 |
| Dossiers | — | § 9.11 |

**Listes** : pagination par **curseur** (opaque, lié au tri ; `sort` = `newest`, `oldest`, `name`,
`size`), `limit` 1–100 (24 par défaut), `total` seulement avec `withTotal=true`. `ids=a,b,c`
(100 au plus) renvoie ces médias dans cet ordre (réhydratation d'une sélection). `folder=<id>|root`
(+ `recursive=true`) limite la liste à un dossier (§ 9.11). La **recherche** `q`
porte sur le titre, le nom de fichier et le texte alternatif, **insensible à la casse et aux accents**
sur les trois bases (colonnes normalisées `Media.search*`, remplies à l'écriture et, pour les médias
existants, au démarrage par `server/plugins/search-backfill.ts` ; l'administration en profite aussi).
Avec une **clé publique**, la liste et la recherche ne sont permises que si le projet a activé la
**liste publique** (réglage du projet) ; sinon seul `ids` est accepté (403 `LISTING_DISABLED`).

**Diffusion `/m/` avec un identifiant** (§ 7.4) : un média privé est aussi servi à une clé secrète, un
jeton personnel ou un jeton délégué ayant `media:read` dans son espace (jamais à une clé publique), réponse
`private, no-cache` + `Vary: Authorization`.

Exemple :

```bash
curl -H "Authorization: Bearer $SURGE_MEDIA_SECRET_KEY" \
  "https://media.example.com/api/v1/projects/<projectId>/media?q=affiche&limit=10"
```

### 9.10 API v1 : écritures et jetons délégués

Les écritures passent par le même service que l'administration (mêmes contrôles de fichier, mêmes
caches invalidés, aperçu pré-généré). Toutes exigent la portée indiquée **dans le projet de l'URL**
(404 hors périmètre, 403 `PROJECT_ARCHIVED` si le projet est archivé). Une clé publique n'écrit jamais.

| Endpoint | Portée | Identifiants | Rôle |
| --- | --- | --- | --- |
| `POST /api/v1/projects/:projectId/media` | `media:upload` | clé secrète, jeton personnel, jeton délégué | multipart : `file` + `title?`, `altText?`, `visibility?` (`public` par défaut), `folderId?` → 201 `Media` + `Location` |
| `PATCH /api/v1/projects/:projectId/media/:mediaId` | `media:write` | idem | `{ title?, altText?, visibility?, folderId?, focalPoint? }` (`null` ou texte vide efface ; `focalPoint` : nouvelle version, § 8.3) → `Media` |
| `PUT /api/v1/projects/:projectId/media/:mediaId/file` | `media:write` | idem | multipart `file` : nouveau fichier, version + 1 (nouvelles URL) → `Media` |
| `DELETE /api/v1/projects/:projectId/media/:mediaId` | `media:delete` | idem | corbeille → 204 (restauration et suppression définitive : administration) |
| `POST /api/v1/projects/:projectId/media/:mediaId/duplicate` | `media:read` ici + `media:upload` dans la cible | clé secrète (son projet), jeton personnel | `{ target?: { projectId } \| { library: true }, folderId? }` (défaut : le projet du média, hors dossier) → 201 `Media` (`projectId` null = bibliothèque) |
| `POST /api/v1/projects/:projectId/delegated-tokens` | portées ⊆ celles de l'émetteur | clé secrète, jeton personnel | émet un jeton délégué → 201 `{ token, expiresAt, scopes }` |

- **Champs stricts** : un champ inconnu (formulaire ou JSON) → 400 `INVALID_REQUEST` ; visibilité en
  minuscules. Erreurs de fichier : `MULTIPART_REQUIRED`, `NO_FILE` (400), `FILE_TOO_LARGE` (413),
  `UNSUPPORTED_TYPE` (415, types acceptés dans `detail`), `UNREADABLE_FILE`, `DIMENSIONS_TOO_LARGE`,
  `KIND_MISMATCH` (422), `VERSION_CONFLICT` (409), `SERVER_BUSY` (503 + `Retry-After`).
- **Débit des envois** : en plus des limites de requêtes, 60 fichiers par minute et par identifiant
  (`NUXT_API_RATE_LIMIT_UPLOADS` ; jeton délégué : par émetteur et par IP ; une duplication compte comme
  un envoi), politique « uploads » ajoutée aux en-têtes `RateLimit`.
- **Provenance** : un média créé par l'API garde l'identifiant utilisé (`Media.uploadedByTokenId`, celui
  de l'émetteur pour un jeton délégué), le compte propriétaire d'un jeton personnel et le **sujet final**
  d'un jeton délégué (`uploadSubject`) ; la fiche du média les affiche. Le journal d'audit enregistre les
  changements de visibilité faits par l'API avec l'identifiant (`tokenId`), le type (`via`) et le sujet.
- Le contrat `Media` gagne `projectId` (ajout sans rupture).

**Jetons délégués** (`sm_dt_…`) : pour un composant dans le navigateur (envoi depuis un formulaire,
sélecteur ou médiathèque d'un back-office client), sans jamais y placer un secret durable.

```text
Navigateur                    Serveur du client (sm_sk_…)                 surgeMedia
   │ « puis-je envoyer ? » ──►│ authentifie SON utilisateur                 │
   │                          │ POST …/projects/P/delegated-tokens ────────►│ portées ⊆ émetteur
   │◄──────── sm_dt_… ────────│◄──────────── { token, expiresAt } ─────────│
   │ POST /api/v1/projects/P/media (Bearer sm_dt_…, depuis une origine autorisée) ──►│ contraintes, fichier
```

- Demande : `{ scopes, expiresIn? (60–3600 s, 900 par défaut), subject?, origin?, upload? }`, avec
  `upload = { maxFiles?, maxSize?, types?, visibility?, folderId? }` (exige `media:upload` ou `media:write`).
  Chaque portée doit être détenue **aujourd'hui** par l'émetteur dans ce projet (403
  `INSUFFICIENT_SCOPE` sinon) ; `origin` doit être une origine exacte parmi celles du projet ; l'échéance
  ne dépasse jamais celle de l'émetteur. Émission non journalisée (fréquente) ; les écritures faites avec
  le jeton le sont.
- **Aucune portée d'office** : un jeton `["media:upload"]` envoie mais ne liste rien (formulaire public).
- Format : `sm_dt_<charge base64url>.<signature>` ; la charge (JSON : `project`, `scopes`, `sub`,
  `origin`, `upload`, `iat`, `exp`, `kid`, `jti`, `iss`) est **lisible** par le composant (échéance,
  contraintes) ; signature HMAC-SHA256 avec une clé dérivée de `NUXT_MEDIA_SIGNING_SECRET` (même `kid`
  et même rotation que les liens signés). Sans état : aucune ligne en base, sauf le compteur de
  `maxFiles` (`DelegatedTokenUsage`, purgé chaque heure après échéance).
- Utilisation : droits = portées du jeton ∩ portées actuelles de l'émetteur, dans son seul projet ;
  **révoquer l'émetteur** (ou désactiver le propriétaire d'un jeton personnel émetteur) les invalide
  aussitôt (401 `TOKEN_REVOKED`). Depuis un navigateur, l'`Origin` doit être une origine autorisée du
  projet et, si le jeton en fixe une, celle-ci (403 `ORIGIN_NOT_ALLOWED`) ; sans `Origin` (application
  mobile, serveur) : accepté. Débit : 300 requêtes par minute par émetteur et par IP
  (`NUXT_API_RATE_LIMIT_DELEGATED`).
- Contraintes d'envoi, vérifiées côté serveur : `maxFiles` (fichiers acceptés, envois et remplacements ;
  un envoi refusé n'est pas décompté ; 403 `UPLOAD_LIMIT_REACHED` au-delà), `maxSize` (bornée par la
  limite du genre détecté), `types` (détectés d'après le contenu, vidéos comprises), `visibility` et `folderId`
  imposés aux nouveaux médias. `types` peut citer les formats vidéo convertis (`video/x-matroska`,
  `video/x-msvideo`, `video/3gpp`, `video/3gpp2`, `video/mp2t`, `video/ogg`, `video/x-ms-wmv`) : ils ne sont
  reçus que pendant que le traitement des vidéos est actif ; sinon 415 `UNSUPPORTED_TYPE` (un jeton qui ne cite
  qu'eux ne peut rien envoyer, refusé avant toute lecture, sans décompter `maxFiles`).
- Interdit avec un jeton délégué : émettre d'autres jetons, dupliquer (403 `CREDENTIAL_NOT_ALLOWED`),
  lien signé de plus d'une heure (400). Permis : lecture des médias privés du projet s'il a
  `media:read` (URL signées dans les réponses, et `/m/` avec `Authorization: Bearer`).
- `GET /api/v1/me` avec un jeton délégué : type `delegated`, `jti`, portées, échéance, sujet, origine et
  contraintes, sans rien révéler de l'émetteur.

Exemple (serveur du client) :

```bash
curl -X POST -H "Authorization: Bearer $SURGE_MEDIA_SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"scopes":["media:upload"],"subject":"user-42","origin":"https://app.example.com","upload":{"maxFiles":5,"types":["image/jpeg","image/png"],"visibility":"private"}}' \
  "https://media.example.com/api/v1/projects/<projectId>/delegated-tokens"
```

### 9.11 Dossiers

Chaque espace (bibliothèque, projet) a son arborescence de dossiers, pour regrouper, filtrer et
naviguer. Un média est dans **0 ou 1 dossier de son espace** ; changer de dossier ne change jamais
son adresse. Règles (module pur `shared/utils/folders.ts`, testé) :

- nom de 1 à 100 caractères, sans `/`, `\` ni caractère de contrôle, ni `.` / `..` ; **unique parmi
  les dossiers voisins, sans tenir compte de la casse** (409 `FOLDER_NAME_TAKEN`) ;
- **8 niveaux** au plus (422 `FOLDER_DEPTH_EXCEEDED`), jamais déplacé dans lui-même ou l'un de ses
  sous-dossiers (422 `FOLDER_CYCLE`), **1 000 dossiers** par espace (409 `FOLDER_LIMIT_REACHED`) ;
- suppression d'un dossier **vide** seulement (409 `FOLDER_NOT_EMPTY`), ou avec `content=parent` :
  sous-dossiers et médias (corbeille comprise) remontent d'abord dans le dossier parent (409
  `FOLDER_NAME_TAKEN` si un sous-dossier y trouve un homonyme). Les médias de la corbeille n'empêchent
  pas la suppression : restaurés, ils reviennent hors dossier ;
- droits : `media:read` pour lire l'arbre, `media:write` pour créer, renommer, déplacer, supprimer et
  ranger des médias ; un projet archivé est en lecture seule ;
- chaque changement d'arbre incrémente la **révision de l'espace** : les ETag des listes (y compris
  récursives) changent d'eux-mêmes. L'arbre est gardé en mémoire par révision (`server/lib/folders/service.ts`).

**Administration** (`AdminMediaBrowser`) : fil d'Ariane (« Racine › Campagnes › Été 2026 »), sous-dossiers
avec leur nombre de médias, actions « Nouveau dossier », « Renommer », « Déplacer », « Supprimer »
(boîtes de dialogue ; suppression avec remontée du contenu proposée si le dossier n'est pas vide), envoi
dans le dossier affiché, case « Inclure les sous-dossiers », mode **sélection** pour ranger plusieurs
médias d'un coup. La fiche d'un média indique son dossier et permet de le déplacer vers un autre
dossier (ou un autre espace et l'un de ses dossiers) ; la duplication choisit aussi le dossier cible.

| Endpoint (administration) | Portée | Rôle |
| --- | --- | --- |
| `GET /api/admin/folders?project=` | `media:read` | dossiers de l'espace, à plat, avec le nombre de médias actifs de chacun |
| `POST /api/admin/folders?project=` | `media:write` | `{ name, parentId? }` → 201 `{ folder }` |
| `PATCH /api/admin/folders/:id` | `media:write` | `{ name?, parentId? }` (null = racine) → `{ folder }` |
| `DELETE /api/admin/folders/:id[?content=parent]` | `media:write` | → `{ media, folders }` (éléments remontés) |
| `PATCH /api/admin/media?project=` | `media:write` | `{ ids (1 à 100), folderId \| null }` : rangement groupé → `{ moved }` |
| `GET /api/admin/media?…&folder=&recursive=1` | `media:read` | médias du dossier (absent = racine), sous-dossiers compris avec `recursive=1` ; la corbeille ignore le dossier |

`POST /api/admin/media` accepte le champ `folderId`, `PATCH /api/admin/media/:id` `{ folderId }`,
`…/duplicate` et `…/move` `{ projectId, folderId? }` (dossier de l'espace cible, racine par défaut).

| Endpoint (API v1) | Portée | Rôle |
| --- | --- | --- |
| `GET /api/v1/projects/:projectId/folders` | `media:read` (jamais une clé publique : 403 `CREDENTIAL_NOT_ALLOWED`) | `{ items: Folder[] }` à plat (`id`, `parentId`, `name`, dates), ETag → 304 |
| `POST /api/v1/projects/:projectId/folders` | `media:write` | `{ name, parentId? }` → 201 `Folder` |
| `PATCH /api/v1/projects/:projectId/folders/:folderId` | `media:write` | `{ name?, parentId? }` → `Folder` |
| `DELETE /api/v1/projects/:projectId/folders/:folderId[?content=parent]` | `media:write` | → 204 |

Dans l'API v1 : liste des médias `?folder=<id>|root&recursive=true` (sans `folder` : tout le projet,
comme avant) ; `folderId` à l'envoi, au `PATCH` (`null` = hors dossier) et à la duplication ; contrainte
`upload.folderId` d'un jeton délégué (dossier **imposé** à ses envois, vérifié à l'émission ; supprimé
entre-temps → 404 `FOLDER_NOT_FOUND`, envoi non décompté). Une clé publique peut filtrer par `folder`
(médias publics, liste publique activée). Dossier d'un autre espace → 404 `FOLDER_NOT_FOUND`.

### 9.12 Documentation interactive de l'API (`/admin/api`, permission `api:docs`)

**Génération de la spécification** (aucun fichier à maintenir à la main) :

1. Chaque route de `server/api/v1/**` décrit son opération avec `defineRouteMeta({ openAPI: { … } })`,
   en tête de fichier. Nitro l'extrait **à la compilation** (`nitro.experimental.openAPI: true` dans
   `nuxt.config.ts`) : la méthode et le chemin viennent du nom du fichier.
2. `GET /api/v1/openapi.json` (`server/api/v1/openapi.json.get.ts`) lit ces métadonnées (module
   virtuel `#nitro-internal-virtual/server-handlers-meta`) et `server/lib/api/openapi.ts` assemble le
   document : schémas, corps et paramètres de requête **dérivés des schémas zod** de
   `shared/schemas/api.ts` (ceux qui valident les requêtes), paramètres de chemin, erreurs groupées par
   statut avec un exemple RFC 9457 par code, portées et identifiants admis, puis traduction.
3. Une route sans métadonnées apparaît quand même (a minima) ; toute incohérence (route non décrite,
   `operationId` en double, code d'erreur inconnu, traduction manquante, référence pendante) est
   signalée dans la console en développement (`[surge-media] OpenAPI — …`) et fait échouer
   `tests/openapi.test.ts`, qui lit les vrais fichiers de routes.

Les interfaces intégrées de Nitro (`/_scalar`, `/_swagger`, chargées depuis un CDN) sont désactivées ;
`/_openapi.json` (toutes les routes, brutes) n'existe qu'en développement.

**Documenter une nouvelle route** : copier le bloc d'une route voisine. **Littéraux seulement** (Nitro
lit l'objet sans exécuter le fichier : ni variable, ni gabarit `${…}`, ni appel de fonction) :

| Clé de `openAPI` | Rôle |
| --- | --- |
| `operationId`, `tags`, `summary`, `description` | standard OpenAPI ; textes en **français** (référence) ; étiquettes : `identity`, `projects`, `media`, `folders`, `delegated-tokens`, `reference` |
| `x-i18n: { en: { summary, description } }` | traduction anglaise (obligatoire) |
| `x-scopes`, `x-credentials` | portée(s) exigée(s), types d'identifiants admis (`publishable`, `secret`, `personal`, `delegated`) : ligne « Portée · Identifiants » et `security` générées |
| `x-query` | paramètres de requête : nom d'un schéma zod déclaré dans `QUERY_SCHEMAS` (`openapi.ts`) |
| `x-errors` | codes propres à l'opération (catalogue `API_ERRORS`, statut déduit) ; les erreurs d'authentification et de débit sont ajoutées d'office |
| `requestBody`, `responses` | références aux composants (`#/components/requestBodies/…`, `#/components/responses/…`) définis dans `openapi.ts` |
| `security: []` | route publique |

Descriptions des champs : `.meta(doc('français', 'English'))` dans `shared/schemas/api.ts`. Les
extensions `x-*` sont retirées du document servi ; `?lang=en` applique les traductions (français par
défaut, langue inconnue → français).

**La page** (`app/pages/admin/api.vue`, composant `AdminApiReference`) :

- **Scalar** (`@scalar/api-reference`, composant Vue) **embarqué** dans l'application et chargé à la
  demande (≈ 3 Mo, uniquement sur cette page) : aucun script tiers ni CDN, agent IA, télémétrie, outils
  de développement et mémorisation de l'authentification **désactivés** (seul le choix du client des
  exemples de code est mémorisé dans le navigateur). Langue (fr/en) et thème (clair/sombre) suivent
  l'administration ; couleurs reprises des jetons (`app/assets/css/scalar.css`, `theme: 'none'`).
- **Données réelles** (`GET /api/admin/api-docs`) : serveur = cette installation (puis `NUXT_SITE_URL`
  s'il diffère), projets de l'utilisateur proposés comme exemples de `projectId` (ceux de la clé injectée
  en premier), exemples de code (curl, JS, Python…) prêts à copier.
- **Clé injectée** : une **clé publique** valide d'un projet dont l'utilisateur gère les identifiants
  (choix dans une liste) est placée dans l'en-tête `Authorization` des requêtes d'essai, qui partent du
  navigateur vers cette installation (même origine, sans CORS). Elle lit les médias publics (liste si le
  projet l'autorise). Les **clés secrètes et jetons personnels** ne sont jamais relisibles (empreinte
  seule) et restent **refusés depuis un navigateur** (`SECRET_IN_BROWSER`, garde-fou inchangé) : pour
  essayer une écriture, saisir un jeton délégué émis par son serveur ; sinon utiliser les exemples de
  code depuis un terminal.
- **Variables d'environnement** : fichier `.env` de l'application cliente, par projet et
  environnement : `SURGE_MEDIA_API_URL`, `SURGE_MEDIA_PROJECT_ID`, `SURGE_MEDIA_PUBLISHABLE_KEY`
  (valeur réelle), `SURGE_MEDIA_SECRET_KEY` (vide : nom et préfixe de la clé en commentaire). Ce sont
  des conventions pour les applications clientes, pas des variables du serveur surgeMedia.
- Mise en page : barre latérale de Scalar à partir de 1280 px seulement (en dessous, recherche
  ⌘K/Ctrl+K) ; la page fournit le repère `main` de Scalar (`definePageMeta({ providesMain: true })`).

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

Documentation de l'API (`/admin/api`, Scalar) : 0 violation sur la page et la référence ; la fenêtre
« Tester la requête » de Scalar (code tiers) garde des écarts signalés par axe (éditeurs `combobox` sans
`aria-expanded`, bouton de menu `role="none"` étiqueté, second `main`, région de notifications
dupliquée). Un correctif local requalifie les blocs « Code sample » de Scalar en groupes traduits
(`AdminApiReference`).

### 10.4 Tableau de bord (`/admin`)

Disposition fixe ; chaque widget n'apparaît que si le compte a les droits correspondants, et ses
chiffres se limitent à **ce que ce compte peut voir** (bibliothèque en lecture et projets visibles,
selon `spaceScopes`). Une seule requête : `GET /api/admin/dashboard` (`server/lib/dashboard/service.ts`,
agrégats en base).

| Widget | Contenu | Qui |
| --- | --- | --- |
| Statistiques | médias (nombre, poids, images, privés), projets actifs (archivés), dérivés en cache (nombre, poids), comptes (invitations en attente, désactivés) ou comptes invités, identifiants d'API actifs (jetons personnels, clés de projet) | tous ; comptes : `users:manage` / `users:invite` ; identifiants : `tokens:personal` ou `project:credentials` |
| Raccourcis | envoyer dans la bibliothèque ou la parcourir, créer un projet ou voir ses projets, inviter, créer un jeton, tester l'API, journal, réglages | selon les permissions |
| Envois des 30 derniers jours | barres par jour dans le fuseau du navigateur, résumé (total, journée la plus chargée), tableau « Voir les données » | tous |
| Points d'attention | base SQLite sous pression (ADMIN, § 12.1), jetons personnels et clés secrètes qui expirent d'ici 7 jours (hors clés déjà remplacées), invitations en attente ou expirées, corbeille par espace, adresse du site absente (production) et envoi d'e-mails non configuré | selon les droits |
| Projets / Mes projets | 6 projets actifs (ordre alphabétique), rôle exercé, nombre de médias | tous |
| Activité récente | 8 dernières entrées du journal | `audit:read` |
| Votre compte | identité, rôle et sa description, connexion, détail des permissions (replié), appareil de confiance | tous |

Graphique : le rendu serveur ignore le fuseau du visiteur ; l'API compte les envois **par heure UTC**
sur 31 jours (liste creuse) et le navigateur les regroupe par jour local (`dailyUploads`,
`shared/utils/dashboard.ts`, testé : changements d'heure, fuseaux). Le graphique est donc rendu dans
le navigateur (`<ClientOnly>`). Les envois comptés incluent les médias depuis mis à la corbeille.
Mise en forme du journal partagée avec `/admin/audit` : `useAuditFormat()`.

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
pnpm build                          # clients Prisma + nuxt build + build de la CLI
cd packages/core && pnpm db:migrate # appliquer les migrations sur la base de production
pnpm start                          # node --env-file-if-exists=.env .output/server/index.mjs
```

- En production, `.env` n'est lu que par le script `start` ; sinon fournissez les variables d'environnement.
- Définissez `NUXT_SITE_URL` (URL publique) ; `NUXT_MEDIA_PUBLIC_URL` si les médias sont servis par
  un CDN ou un domaine dédié (§ 7.4).
- `NUXT_SESSION_PASSWORD` est obligatoire et doit rester stable ; servez l'application en **HTTPS**
  (cookie `Secure`), derrière un proxy qui transmet l'en-tête `Host` d'origine (contrôle CSRF).
- **Derrière un mandataire inverse** (Docker + nginx, Traefik, Caddy…) : l'adresse IP réelle du client est lue dans
  `X-Forwarded-For` quand la connexion vient d'un mandataire de confiance (`NUXT_TRUST_PROXY`, défaut `true` : boucle
  locale et réseaux privés, dont les réseaux de Docker). Elle sert aux limites de débit (connexion, API v1,
  transformations de `/m/`), au journal d'audit, aux sessions et aux appareils de confiance. Lecture de droite à
  gauche : la première adresse qui n'est pas un mandataire de confiance est le client, une adresse ajoutée par le
  client lui-même est ignorée, et un client qui joint directement le serveur depuis Internet ne peut rien usurper.
  Le mandataire doit **ajouter** l'adresse de son client (nginx : `proxy_set_header X-Forwarded-For
  $proxy_add_x_forwarded_for;` ; Traefik et Caddy le font d'office) et transmettre `Host`. Mandataire sur une
  adresse publique, ou CDN devant lui : lister ses adresses (`NUXT_TRUST_PROXY="private,203.0.113.10"`, plages
  CIDR acceptées). Ne publiez pas le port du conteneur de l'application : seul le mandataire doit l'atteindre (le
  proxy de Docker peut présenter un client extérieur avec l'adresse privée de la passerelle) ; sans mandataire,
  `NUXT_TRUST_PROXY=false`.
- La build contient les clients Prisma des trois fournisseurs : changer de base demande de migrer la nouvelle
  base (`init`) et de redémarrer, pas de reconstruire. **Docker** : § 12.2.
- `GET /api/health` : 200 si base, stockage et sharp répondent, 503 sinon (sonde Docker / orchestrateur). Le
  bloc `videoProcessing: { mode, workers, queued }` est une information hors `checks`, qui ne change jamais le
  statut : `workers` = processus en état de traiter la file (processus de travail signalés depuis moins de 5 min,
  plus ce serveur en mode `embedded` quand sa boucle tourne), `queued` = tâches en attente ; `null` en mode `off`
  ou si la base ne répond pas. Alerte utile : `workers` à 0 alors que `queued` grandit. Ni hôte ni version.
- Stockage local : sauvegarder `NUXT_MEDIA_STORAGE_ROOT` avec la base (volume persistant en conteneur).
- Le journal d'audit (`AuditEvent`) n'a pas encore de purge automatique : prévoir un nettoyage des
  entrées anciennes selon votre politique de conservation.
- **SQLite** passe en mode **WAL** au démarrage (lectures non bloquées pendant une écriture) : sauvegarder
  `surge-media.db` avec ses fichiers `-wal` et `-shm`, ou utiliser `sqlite3 surge-media.db ".backup copie.db"`.
  Un serveur unique et un trafic modéré seulement (§ 12.1) ; un message le rappelle au démarrage en production.
- **Variables d'environnement** : lues au démarrage seulement (configuration calculée une fois par processus,
  § 12.1) ; redémarrer après tout changement de `.env`.
- API v1 : définir `NUXT_SITE_URL` (adresses absolues de l'API et de la spécification) ; limitation de
  débit et caches en mémoire du processus (plusieurs instances : prévoir Redis, pas encore branché) ;
  derrière un mandataire, les limiteurs voient l'adresse réelle du client (`NUXT_TRUST_PROXY`, voir plus haut).
- Traitements d'images : ajuster `NUXT_MEDIA_PROCESSING_CONCURRENCY` (défaut : nombre de cœurs) à la
  mémoire disponible (une image de 100 Mpx décodée occupe plusieurs centaines de Mo) ; une file pleine
  répond 503 avec `Retry-After`.
- Jetons délégués : signés avec une clé dérivée de `NUXT_MEDIA_SIGNING_SECRET` ; changer ce secret sans
  garder l'ancien (`NUXT_MEDIA_PREVIOUS_SIGNING_SECRET`) invalide aussi les jetons délégués en cours
  (au plus 1 h).
- **Corps des requêtes** (`server/middleware/body-limit.ts`) : JSON et formulaires lus en mémoire limités à
  1 Mio et 30 s (413 `BODY_TOO_LARGE`, 408 `REQUEST_TIMEOUT`, connexion fermée) ; les envois de fichiers ont
  leurs propres limites (`NUXT_MEDIA_MAX_UPLOAD_SIZE`, 60 s sans donnée). Un mandataire inverse applique
  souvent une limite plus basse aux envois : nginx refuse par défaut les corps de plus de 1 Mo
  (`client_max_body_size`, à porter au moins à la taille maximale d'un envoi).
- **Vidéos** (§ 7.7) : régler le mandataire (`client_max_body_size`, `proxy_request_buffering off`, délais), l'espace
  du dossier temporaire et, idéalement, un CDN devant les adresses de diffusion.
- **Traitement des vidéos** (§ 7.7, facultatif) : ffmpeg ≥ 6 du système, tenu à jour avec lui (correctifs de
  sécurité ; version affichée dans « Réglages ») ; `NUXT_VIDEO_PROCESSING=embedded` sur une seule machine, ou
  `external` avec un ou plusieurs **processus de travail** (`surge-media worker`, ou
  `NUXT_SERVER_ROLE=worker node .output/server/index.mjs`) supervisés comme le serveur web (redémarrage
  automatique, arrêt par SIGTERM) ;
  sur une autre machine : PostgreSQL ou MySQL et stockage partagé. Recommandé pour une installation ouverte aux
  envois de tiers : processus de travail dans un conteneur durci (§ 7.7). Prévoir l'espace temporaire des tâches
  et le processeur (≈ 1,7 s de calcul par seconde de vidéo 1080p).
- Placer un CDN ou un cache devant `/m/` est possible : les URL publiques sont immuables et la
  diffusion n'utilise pas de cookie. Limite : passer un média public en privé ou le mettre à la
  corbeille n'efface pas les copies déjà en cache (navigateurs, CDN).

### 12.1 Montée en charge (test du 2026-10-10)

**Banc** : build de production sur une **copie** de la base et des médias, un seul processus Node, SQLite, stockage
local, Windows 11, Node 24.20, portable Intel i7-11850H (8 cœurs / 16 fils), 32 Go, sur secteur ; générateur de
charge sans dépendance (plusieurs processus, connexions persistantes), 32 connexions, 10 s par scénario.

| Scénario | Débit | Latence p50 / p99 |
| --- | --- | --- |
| `/m/` revalidé (`If-None-Match` → 304) | 15 100 req/s | 2 / 4 ms |
| Aperçu WebP (`preview`) | 6 200 req/s (1,1 Gbit/s) | 4 / 15 ms |
| Transformation déjà générée (`w_400`, WebP / `w_800`, AVIF) | 6 400 / 5 800 req/s | 4 / 14 ms |
| Original d'environ 1 Mo (public ou lien signé) | 1 060 req/s (8 Gbit/s) | 29 / 55 ms |
| API v1 : un média / liste de 24 / liste revalidée (304) / recherche | 1 490 / 750 / 11 100 / 760 req/s | 23 / 35 ms ; 42 / 77 ms |
| API v1 : modification (écriture) / envoi d'une image de 69 Ko | 590 / 135 req/s | 55 / 79 ms ; 241 / 290 ms |
| Page rendue côté serveur (`/login`) | 460 req/s | 70 / 98 ms |
| `/api/health` | 3 000 req/s | 10 / 21 ms |

**Trafic mixte** (aperçus 30 %, transformations 30 %, originaux 10 %, API 25 %, écritures 5 %) : ≈ **1 650
requêtes/s et 1,5 Gbit/s par processus**, de 16 à 512 connexions simultanées ; seule la latence augmente (p99 de
52 ms à 1,5 s), **aucune erreur**, mémoire stable (≈ 570 Mo). Un processus Node n'utilise qu'un cœur pour le code
de l'application (sharp et la lecture des fichiers ont leurs propres fils) : c'est la limite d'un processus.

**Deux correctifs faits pendant ce test** (avant / après, mêmes conditions) :

| Mesure | Avant | Après |
| --- | --- | --- |
| `/m/` 304 · aperçus · `/api/health` | 790 · 730 · 650 req/s | 15 100 · 6 200 · 3 000 req/s |
| API v1 un média · liste · page `/login` | 525 · 390 · 220 req/s | 1 490 · 750 · 460 req/s |
| Requêtes de `/m/` restées sans réponse (connexions persistantes) | ≈ 1 sur 5 000 à 10 000 | 0 sur ≈ 250 000 |

- **Configuration d'exécution recalculée à chaque requête** : Nitro 2 reconstruit toute la configuration
  (≈ 520 entrées, dont celles des fournisseurs OAuth de nuxt-auth-utils) dès qu'un code appelle
  `useRuntimeConfig(event)` — ce que fait @nuxtjs/i18n sur **toutes** les requêtes, `/m/` et API comprises :
  copie profonde, conversion de chaque nom et deux lectures de `process.env` par entrée (lentes sous Windows),
  80 % du processeur. `server/plugins/runtime-config.ts` donne à chaque requête la configuration calculée au
  démarrage (partagée et gelée pour `/m/`, `/api/` et `/_nuxt/`, copiée pour les pages). Conséquence : une
  variable d'environnement n'est lue qu'au démarrage.
- **Réponses jamais envoyées** : sur une connexion persistante, une requête peut arriver avant que Node ait fini la
  réponse précédente ; la nouvelle réponse attend alors sa connexion (`res.socket` nul) et `sendStream` de h3 1.15
  rend la main **sans rien envoyer** : le client attend jusqu'à son propre délai (un mandataire nginx avec
  `keepalive` vers le serveur y est exposé en permanence). La diffusion attend désormais la connexion avant
  d'ouvrir le fichier (`responseReady`, `server/lib/http/stream.ts`, test qui reproduit le cas à coup sûr).

**Limites de SQLite, mesurées** : better-sqlite3 est **synchrone** — pendant une requête SQL, et pendant l'attente du
verrou d'écriture tenu par **un autre processus** (jusqu'à 10 s, `SQLITE_BUSY_TIMEOUT_MS` de
`server/utils/prisma.ts`), le processus ne fait rien d'autre, pas même servir un fichier.

| Situation (aperçus sur le processus A, sans accès à la base) | Aperçus | p99 |
| --- | --- | --- |
| A seul | 4 100 req/s | 9 ms |
| A + 416 écritures/s sur A | 253 req/s | 112 ms |
| A + écritures sur A **et** sur un second processus B, même fichier SQLite | 129 req/s | 310 ms |
| Verrou d'écriture tenu 13 s par un autre processus | un aperçu attend 12 s ; l'écriture échoue (500) après 10 s | — |

Deux processus qui écrivent dans la même base : aucune erreur tant que les écritures restent courtes, mais
−21 % d'écritures au total et des latences doublées. **Rester sur SQLite** : un seul serveur web (le processus
de travail vidéo `external` sur la même machine est possible, ses écritures sont rares), trafic modéré. **Passer à
PostgreSQL ou MySQL** dès qu'il faut plusieurs processus ou serveurs web, des écritures soutenues, ou que l'alerte
ci-dessous apparaît (accès asynchrones, plusieurs connexions : le processus n'est plus bloqué). Il n'existe pas
encore d'outil de copie des données de SQLite vers un autre fournisseur.

**Alerte « base SQLite sous pression »** (tableau de bord, ADMIN, § 10.4) : avec SQLite seulement, chaque processus
(serveur web et `surge-media worker`) chronomètre les opérations de Prisma (extension de `usePrisma()` ; durée =
temps bloqué) et compte par minute requêtes, écritures, opérations lentes (≥ 500 ms) et attentes dépassées
(Prisma `P1008`, `P2024`, `P2028`, `P2034`, `SQLITE_BUSY`). Sur les 15 dernières minutes
(`shared/utils/database-pressure.ts`, testé) :

| Niveau | Déclencheur |
| --- | --- |
| « La base SQLite est sous pression » (à traiter) | une attente de verrou dépassée (requête en échec), ou 5 opérations lentes, ou 3 minutes passées à plus de 50 % dans la base |
| « Trafic élevé pour une base SQLite » (information) | une minute à ≥ 300 requêtes/s, ≥ 30 écritures/s ou ≥ 25 % du temps dans la base |

Le constat est enregistré chaque minute dans `Setting` (`databasePressure` ; au plus toutes les 5 minutes, aussitôt
s'il s'aggrave), partagé par tous les processus, affiché **24 h** avec les pointes et la date de dernière
observation ; le journal du serveur l'annonce aussi (au plus toutes les 15 minutes). Coût mesuré : nul sur `/m/`,
3 à 4 % sur l'API. Au démarrage en production, un message rappelle les limites de SQLite.

**Recommandations pour un fort trafic**
- Un **CDN ou un cache** devant `/m/` (§ 12) : les adresses publiques sont immuables et la revalidation (304) coûte
  peu ; c'est l'essentiel du trafic d'un service de médias.
- Au-delà d'un processus : **PostgreSQL ou MySQL**, puis plusieurs instances derrière un répartiteur. Les limites
  de débit et les caches restent **par processus** (Redis pas encore branché) : chaque limite est alors multipliée
  par le nombre d'instances.
- **Limites de débit par défaut** de l'API v1 (§ 6.3) : une clé publique a 300 requêtes/min **par adresse IP** du
  client (adresse réelle derrière un mandataire, `NUXT_TRUST_PROXY`, § 12) ; 60 transformations libres par minute
  et par IP sur `/m/` : relever `NUXT_API_RATE_LIMIT_*` et `NUXT_MEDIA_TRANSFORM_RATE_LIMIT` selon le trafic attendu
  (un CDN devant `/m/` concentre ses requêtes sur ses propres adresses : déclarer ses plages comme mandataires).
- **Mesurer sur la machine cible** : le même portable a donné des débits 7 fois plus faibles sur batterie.

### 12.2 Docker

`Dockerfile` (racine du dépôt) : **une seule image pour SQLite, PostgreSQL et MySQL/MariaDB** (les trois clients
Prisma sont dans la build, § 6.2), Debian 13 « trixie » et Node 24, utilisateur non root `node` (uid 1000), `tini`
en PID 1 (relais des signaux).

| Variante | Construction | Contenu |
| --- | --- | --- |
| complète (défaut) | `docker build -t surge-media .` | ffmpeg 7.1 de Debian (libx264, AAC, SVT-AV1, Opus) et `prlimit` : traitement des vidéos possible (§ 7.7) |
| `slim` | `docker build --target slim -t surge-media:slim .` | sans ffmpeg : `NUXT_VIDEO_PROCESSING` doit rester `off` |

**L'image installe le paquet npm** `@surge-media/core` (§ 15.5) : même artefact que sur npm. Étapes : `build`
(`pnpm fetch` d'après le seul `pnpm-lock.yaml`, cache pnpm partagé entre les builds ; clients Prisma, build
Nuxt, `pnpm pack`) → `package` (l'archive) → `install` (`npm install` de l'archive : modules natifs de la
plateforme cible, CLI Prisma des migrations ; scripts d'installation pré-approuvés pour npm 12 ; échec de la build
si better-sqlite3, sharp ou argon2 ne se chargent pas) → image finale sans sources ni dépendances de
développement. `--build-context package=<dossier contenant surge-media-core.tgz>` remplace l'étape `build` par
une archive déjà construite : c'est ce que fait la CI, d'où aucune build Nuxt par architecture (arm64 émulé).
`--build-arg VERSION=… REVISION=…` renseigne les étiquettes OCI (avec la source et la licence `BUSL-1.1`, qui
relient le paquet GHCR au dépôt) ; `NODE_VERSION` et `DEBIAN_RELEASE` sont aussi réglables (pas Debian 12
« bookworm » : ffmpeg 5.1). **Publication sur GitHub Container Registry** (`ghcr.io/mahmoud-nb/surge-media`,
amd64 et arm64) : par le workflow de release (§ 15.4).

```bash
docker run -d --name surge-media -p 127.0.0.1:3000:3000 -v surge-media-data:/app/data \
  -e NUXT_SITE_URL=https://media.example.com \
  -e NUXT_BOOTSTRAP_ADMIN_EMAIL=vous@exemple.fr -e NUXT_BOOTSTRAP_ADMIN_PASSWORD='un-mot-de-passe-long' \
  surge-media
```

**Commande de l'image** (`docker run … surge-media <commande>`, point d'entrée `docker/entrypoint.sh`) :

| Commande | Effet |
| --- | --- |
| `server` (défaut) | applique les migrations en attente, puis lance le serveur web (port 3000) |
| `worker` | processus de travail du traitement des vidéos (`NUXT_SERVER_ROLE=worker`) : même port, `/api/health` seulement ; ne migre jamais |
| `migrate` | applique les migrations en attente, puis s'arrête |
| autre | exécutée telle quelle (`sh`, `node -v`…) |

**Volume `/app/data`** : base SQLite (`surge-media.db` et ses fichiers `-wal`, `-shm`), médias en stockage local
(`media/`), secrets générés (`secrets/`). À sauvegarder ensemble. Il doit appartenir à l'uid 1000 : automatique
pour un volume nommé, `chown 1000:1000` pour un dossier de l'hôte. `.env` n'est pas lu (aucun fichier dans
l'image) : variables par `-e`, `--env-file` ou Compose ; toutes celles du § 6.3 s'appliquent.

| Variable propre à l'image | Défaut | Rôle |
| --- | --- | --- |
| `DATABASE_URL` | `file:./data/surge-media.db` | `postgresql://…`, `mysql://…` ou `file:…` : `DATABASE_PROVIDER` en est déduit s'il manque |
| `SURGE_MEDIA_MIGRATE` | `true` | `false` : `server` démarre sans migrer (instances supplémentaires ; migrations lancées par `migrate`) |
| `SURGE_MEDIA_SECRETS_DIR` | `/app/data/secrets` | dossier des secrets générés |
| `SURGE_MEDIA_LANG` | `fr` | langue des messages du point d'entrée (`en`) |
| `<VARIABLE>_FILE` | — | valeur lue dans un fichier (secrets Docker, `/run/secrets/…`) pour `DATABASE_URL`, `NUXT_SESSION_PASSWORD`, `NUXT_MEDIA_SIGNING_SECRET`, `NUXT_MEDIA_PREVIOUS_SIGNING_SECRET`, `NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID`, `NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY`, `NUXT_SMTP_PASSWORD`, `NUXT_BOOTSTRAP_ADMIN_PASSWORD` |
| `PORT` | `3000` | port d'écoute dans le conteneur |

- **Secrets** : `NUXT_SESSION_PASSWORD` et `NUXT_MEDIA_SIGNING_SECRET` absents de l'environnement sont générés au
  premier démarrage (32 octets aléatoires, comme `surge-media init`), conservés dans le volume (fichiers `0600`) et
  jamais remplacés ; création atomique : deux conteneurs qui partagent le volume et démarrent ensemble gardent la
  même valeur. Conteneurs sur des volumes ou des machines distincts : fournir les mêmes valeurs à tous.
- **Migrations** : `prisma migrate deploy` lancé depuis le paquet (`/app/node_modules/@surge-media/core`), avec
  le schéma du fournisseur et une URL SQLite rendue absolue (relative au dossier de l'installation, `/app`) ; base injoignable (`P1001`, conteneur de la base encore en démarrage) : 20 essais à 3 s
  d'intervalle ; échec : le conteneur s'arrête (code 1) avec la sortie de Prisma.
- **Santé** : `HEALTHCHECK` intégré sur `/api/health` (toutes les 30 s, 60 s accordées au démarrage) : `healthy`
  dans `docker ps`, utilisable par `depends_on: condition: service_healthy`.
- **Arrêt** : `docker stop` envoie SIGTERM, relayé par `tini` ; accorder 30 s (`stop_grace_period`,
  `--stop-timeout 30`) pour qu'une tâche vidéo en cours soit rendue proprement (§ 7.7).
- **Derrière un mandataire inverse** (§ 12) : les exemples ne publient le port que sur `127.0.0.1` ;
  `NUXT_TRUST_PROXY` (défaut) fait confiance aux réseaux privés, dont ceux de Docker ; HTTPS obligatoire pour le
  cookie de session, sauf sur `localhost`.
- **Mise à jour** : nouvelle image, puis recréer les conteneurs (`docker compose up -d`) : les migrations sont
  appliquées au démarrage de `server`.
- **`migrate` et SQLite** : la base est verrouillée tant que le serveur tourne (« database is locked », § 18) ;
  lancer `migrate` serveur arrêté. Rarement utile : `server` migre à son démarrage.
- **Taille** (décompressée, mesurée le 2026-10-10) : 1,38 Go pour l'image complète, 751 Mo pour `slim`. Postes
  principaux : ffmpeg et ses bibliothèques (≈ 460 Mo), CLI Prisma des migrations (≈ 250 Mo : elle charge Prisma
  Studio dès son démarrage, l'élaguer la casse), Node (≈ 120 Mo), serveur construit (≈ 57 Mo, trois clients compris).
- **Durées** (16 cœurs) : depuis les sources ≈ 3 min, dont ≈ 80 s de build Nuxt (≈ 7 min sous Windows) ; depuis
  une archive (`--build-context package=…`) ≈ 90 s ; ensuite, seule une modification de `packages/` ou du
  fichier de verrouillage relance la build ; démarrage avec les 16 migrations ≈ 5 à 11 s (SQLite) ; arrêt propre
  ≈ 2,5 s.

**Compose** (`docker/`) : `compose.sqlite.yaml` (un conteneur) et `compose.postgres.yaml` (serveur web, processus
de travail des vidéos et PostgreSQL 17 ; `POSTGRES_PASSWORD` requis, dans l'environnement ou `docker/.env`).
MySQL/MariaDB : remplacer le service `postgres` (par exemple `mariadb:11`) et `DATABASE_URL` par `mysql://…`.
Image construite localement : `SURGE_MEDIA_IMAGE=surge-media docker compose -f docker/compose.sqlite.yaml up -d`.

## 13. Choix techniques et versions épinglées

| Choix | Pourquoi |
| --- | --- |
| Nuxt 3.21 + `future.compatibilityVersion: 4` | Nuxt 3 demandé, toujours maintenu en parallèle de Nuxt 4 ; structure `app/` et comportements Nuxt 4 déjà actifs, la migration se limitera à la mise à jour de la dépendance |
| Prisma **7.10.0** épinglé exactement | le tag npm `latest` de `prisma` pointe vers une 8.0.0-rc ; ne pas mettre à jour sans tester |
| Prisma 7 + driver adapters | client sans moteur Rust ; un adapter par fournisseur, choisi à l'exécution |
| TypeScript **~6.0** | TypeScript 7 (compilateur natif) n'est pas encore utilisable par `vue-tsc` |
| `prisma` en dépendance (pas devDependency) | la CLI `surge-media` en a besoin chez l'utilisateur final pour générer et migrer |
| Client Prisma importé dynamiquement (`usePrisma()` asynchrone) | voir Dépannage : « File URL path must be absolute » |
| Configuration d'exécution calculée une fois par processus (`server/plugins/runtime-config.ts`) | Nitro 2 la reconstruit à chaque requête dès qu'un module appelle `useRuntimeConfig(event)` (@nuxtjs/i18n le fait sur toutes) : ≈ 9 ms par requête sous Windows, × 2 à × 19 de débit une fois corrigé (§ 12.1) |
| Alerte « base SQLite sous pression » mesurée dans chaque processus | SQLite est synchrone : seule une mesure du temps passé dans la base et des attentes de verrou dit quand il devient le goulot (§ 12.1) |
| CLI : citty + @clack/prompts, build tsdown | écosystème UnJS (comme Nuxt), binaire ESM autonome |
| nuxt-auth-utils + table `Session` | cookie scellé standard de l'écosystème Nuxt, complété par une session en base pour la révocation |
| argon2id via `@node-rs/argon2` | recommandation OWASP ; binaires précompilés (aucune compilation, embarqués par Nitro) |
| Tailwind v4 + composants maison (pas shadcn-vue ni @nuxt/ui) | contrôle total de l'accessibilité et du thème, zéro dépendance de composants ; Reka UI pourra être ajouté pour les primitives complexes (boîtes de dialogue, menus) |
| i18n `no_prefix` | URL stables pour l'administration (`/admin/*`), langue par cookie |
| **Flydrive** derrière notre interface `MediaStorage` (et non unstorage) | analyse de l'étape 4 : unstorage charge les fichiers entiers en mémoire (pilotes fs et s3), sans lecture partielle ni URL signées ; `@nuxtjs/universal-storage` est un module Nuxt 2 de 2021 pour cookies/localStorage ; NuxtHub impose sa plateforme. Flydrive : flux, S3/R2/MinIO/GCS, protection des clés, remplaçable |
| Node **≥ 24** | exigé par Flydrive 2 (Node 24 = LTS active) ; Flydrive 1.3 resterait possible pour Node 22 |
| Détection du type maison (`sniff.ts`) plutôt que `file-type` | aucune dépendance, liste d'autorisation explicite ; `file-type` ne fonctionnait pas après build (voir Dépannage) |
| S3 : sommes de contrôle `WHEN_REQUIRED` | les SDK récents envoient en `aws-chunked` par défaut, que certains services compatibles stockent tels quels (fichiers corrompus) |
| Un média = un seul espace (bibliothèque ou projet), réutilisation par duplication | validé à l'étape B1 : pas de partage entre projets, donc aucune règle de modification croisée ; chaque espace garde le contrôle de ses médias |
| Rôles = ensembles de portées, plafonnés par le rôle de plateforme | un seul moteur (`spaceScopes`), pur et testé, pour les sessions aujourd'hui et les jetons demain |
| Diffusion `/m/` sans cookie, liens signés v2 (`kid`, droit élargi, échéance alignée) | cachable par un CDN, domaine dédié possible, rotation du secret sans coupure, URL stables pendant 15 min pour l'administration |
| Identifiants opaques `sm_<type>_…` + CRC32, empreinte SHA-256 (pas de JWT durable, pas d'argon2) | révocation instantanée, rejet des jetons mal formés sans base, repérage par les outils de détection de secrets ; 256 bits d'entropie rendent un hachage lent inutile |
| E-mails : nodemailer (SMTP), configuration par l'environnement | bibliothèque de référence, sans dépendance ni module natif ; identifiants SMTP hors de la base, comme ceux de S3 ; textes dans les fichiers de traduction (`mail.*`) |
| « Mode sudo » stocké dans la session en base (`passwordVerifiedAt`) | vérifié côté serveur à chaque action sensible, révocable avec la session ; l'interface rejoue l'action après confirmation |
| Journal d'audit sans clés étrangères | les entrées survivent aux suppressions (comptes, projets, clés) ; libellé lisible conservé dans `data.label` |
| API v1 : projet dans l'URL, Bearer sans cookie, RFC 9457, curseurs | architecture § 6 : isolation lisible, preflight CORS sans authentification, contrat indépendant de l'administration |
| Caches L1 en mémoire + compteurs de révision en base | ETag de liste → 304 sans requête, invalidation « générationnelle » sans purge ; le cache partagé (Redis) viendra avec le multi-instances |
| Colonnes de recherche normalisées | recherche insensible aux accents identique sur SQLite, PostgreSQL et MySQL, sans extension |
| SQLite en WAL | la diffusion et l'API lisent pendant les envois |
| Dossiers : arbre chargé en entier (mis en cache par révision), filtre récursif par liste d'identifiants, sans colonne de chemin | portable sur les 3 bases, pas de limite de 191 caractères sur un chemin, un déplacement de dossier ne réécrit aucune ligne de média ; unicité des noms contrôlée par l'application (les bases traitent différemment `NULL` dans les index uniques) |
| Jetons délégués signés (HMAC, charge lisible), sans état | aucun secret durable dans un navigateur ; vérification sans base ; révoquer l'émetteur suffit ; seul `maxFiles` utilise un compteur en base |
| Transformations : forme canonique syntaxique (indépendante du média et du format) + opération effective calculée selon l'image | une URL par résultat (301 sinon), une signature pour toutes les sources d'un `<picture>`, un fichier pour les demandes équivalentes ; non-agrandissement calculé par nous (sharp ignore le rapport demandé quand il refuse d'agrandir) |
| Préréglages modifiables, cache de 7 jours revalidé (CD7) ; politique par espace appliquée aux seuls paramètres libres | un préréglage se corrige sans changer d'URL ; les préréglages restent toujours servis (aucun site cassé par un changement de politique) ; la bibliothèque suit un réglage de l'installation (modèle `Setting` réutilisable) |
| AVIF : effort d'encodage 2 (sur 9) | mesuré sur une photo de 3000 px : 0,5 s au lieu de 2,1 s (effort 4), fichier ~30 % plus lourd mais toujours plus léger que le WebP |
| File bornée des traitements + pré-génération des aperçus | un pic d'envois ou d'aperçus ne sature ni la mémoire ni le processeur (503 + `Retry-After`) ; premier affichage sans attente |
| **ffmpeg du système** (≥ 6, `NUXT_FFMPEG_PATH`), lancé en processus enfant sans shell ; ni `ffmpeg-static` ni WASM | aucune dépendance npm : binaires de 70 à 80 Mo, licence GPL des builds avec x264, traçage par Nitro avec pnpm et Smart App Control (déjà vécu avec argon2 et oxc) écartés ; le paquet du système reçoit les correctifs de sécurité ; le calcul ne passe jamais par la boucle d'événements de Node |
| Traitement des vidéos **désactivé par défaut** ; modes `embedded` / `external` ; processus de travail = même build (`NUXT_SERVER_ROLE=worker`) ; ffmpeg en priorité la plus basse | une installation sans ffmpeg se comporte comme avant D3 ; le code des médias dépend des imports automatiques de Nitro (une seule build, pas de CLI construite à part) ; mesuré (architecture § 29.3) : en priorité normale, un encodage sur la même machine triple le p99 du serveur web, en priorité la plus basse l'effet disparaît |
| File des vidéos **en base** (`MediaJob` : prise atomique par `updateMany`, bail, 3 essais), sans Redis ni BullMQ | portable SQLite / PostgreSQL / MySQL sans `SKIP LOCKED` ; reprise après un arrêt ; une tâche par fichier (`sourceKey`) : un changement d'affiche ou de point d'intérêt n'annule rien |
| Sans perte → l'original est remplacé ; réencodage → rendu à côté de l'original (`MediaRendition`, droit signé `file`) ; rendu H.264 seulement s'il sert | positions GPS retirées du fichier diffusé ; l'original reste téléchargeable tel qu'envoyé après un réencodage ; une vidéo déjà compatible ne coûte ni calcul ni stockage |
| Diffusion retenue (503) jusqu'au retrait d'une piste de données de l'appareil | choix validé (DD31) : la vie privée (positions GPS) passe avant la disponibilité immédiate d'une vidéo publique |
| **Scalar** (`@scalar/api-reference`) **1.72.3** épinglé exactement, composant Vue embarqué | documentation interactive dans l'administration : interface reconnue, langues fr/en intégrées, client de requêtes ; épinglé car l'API de configuration évolue vite (agent IA, télémétrie, repères à revérifier à chaque mise à jour) ; embarqué plutôt que chargé d'un CDN (aucun script tiers dans une page authentifiée) |
| Spécification OpenAPI : `defineRouteMeta` par route + schémas zod | la documentation vit à côté du code de chaque route ; une route ajoutée apparaît d'elle-même ; les schémas qui valident les requêtes décrivent aussi la spécification ; module virtuel de Nitro (`server-handlers-meta`) à revérifier lors du passage à Nitro 3 |
| **Vitest** 5 (tests des modules purs) | autorisation et signatures : la partie la plus sensible, testée sans serveur ni base |
| `oxc-transform` forcé en **0.141.0** (`pnpm-workspace.yaml` › `overrides`) | contournement local : le « Contrôle intelligent des applications » de Windows bloque le binaire de la 0.143.0 exigée par Nuxt 3.21 ; hors de la plage déclarée par Nuxt (`^0.143.0`), vérifié par typecheck, dev et build — à retirer dès que possible |

## 14. Dépannage

| Symptôme | Cause / solution |
| --- | --- |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 12 bloque les scripts d'installation : `pnpm approve-builds <paquet>` (la liste autorisée est dans `pnpm-workspace.yaml` › `allowBuilds`) |
| Avertissement *unmet peer @nuxt/schema ^4* (via `@nuxt/cli`) | sans effet : la CLI Nuxt est partagée entre Nuxt 3 et 4 |
| `pnpm start` : *Cannot find native binding* … *An Application Control policy has blocked this file* (`.output/server/node_modules/@node-rs/argon2-win32-x64-msvc`) | Windows « Contrôle intelligent des applications » bloque la **copie** du module natif faite par la build (l'original de `node_modules` reste autorisé) ; constaté à l'étape 10 puis de nouveau le 2026-10-03, pas entre les deux. Ne pas désactiver la protection : débloquer le fichier dans les réglages de sécurité Windows si vous le souhaitez, ou tester avec `pnpm dev` |
| `/admin/api` en dev : *Cannot define property modal, object is not extensible* | deux copies de Vue chargées après la découverte tardive de Scalar par Vite : `vite.optimizeDeps.include` le pré-optimise (`nuxt.config.ts`) ; recharger la page si l'erreur apparaît encore après une mise à jour |
| Avertissement de build *[vite:css][postcss] Lexical error … (50 - l) * infinity* | syntaxe CSS récente dans la feuille de style de Scalar, non comprise par PostCSS : sans effet (émise telle quelle) |
| `[surge-media] OpenAPI — …` dans la console (dev) | documentation d'une route incomplète : voir § 9.12 (`defineRouteMeta`, traduction `x-i18n`, codes d'erreur) |
| `File '../.nuxt/tsconfig.server.json' not found` pendant la génération des clients Prisma | lancer `nuxt prepare` avant `scripts/prisma-generate.ts` (ordre du `postinstall`) |
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
| Vidéo refusée 415 | MKV, AVI, 3GP, MPEG-TS, OGV ou WMV alors que le traitement des vidéos est inactif (mode `off`, ffmpeg inutilisable, ou aucun processus de travail actif : « Réglages ») ; format jamais accepté (FLV, MPEG-PS, RealMedia, QuickTime ancien sans `ftyp`) ; MP4/MOV/WebM sans piste vidéo (audio seul). Activer le traitement (§ 7.7) ou convertir en MP4 (H.264/AAC) ou WebM (VP9/Opus) |
| Vidéo acceptée mais illisible dans un navigateur | codec non lu par ce navigateur (HEVC, AV1, ProRes : avertissement « lecture variable » sur la fiche) : sans traitement des vidéos, rien n'est réencodé ; avec, une version H.264 est produite (mode `auto`) et le lecteur l'utilise |
| La lecture d'une vidéo démarre lentement | index (`moov`) en fin de fichier : vidéo envoyée avant D2, ou préparation désactivée (`NUXT_MEDIA_VIDEO_PREPARE`) ou impossible ; bouton « Optimiser la vidéo » de la fiche |
| Journal : « Vidéo gardée telle qu'envoyée (préparation impossible : …) » | structure non gérée (fichier chiffré, données externes, index de plus de 64 Mio…) ou vérification en échec : le fichier est stocké intact, rien n'est perdu |
| Durée « inconnue » ou « estimée » d'une vidéo WebM | enregistrement fait dans un navigateur (`MediaRecorder`) : le fichier n'indique pas sa durée, elle est estimée par sa fin (sinon inconnue) ; le lecteur la découvre en cours de lecture. Traitement des vidéos actif : le fichier est réparé (VP8/VP9/AV1 avec Opus/Vorbis ; nouvelle version) |
| Pas d'image d'affiche après l'envoi d'une vidéo | le navigateur ne sait pas décoder la vidéo (HEVC, ProRes selon le système) ou l'envoi vient de l'API : choisir l'image depuis la fiche (lecteur ou image envoyée) ; traitement des vidéos actif : extraite par le serveur à la fin de la tâche (sinon remarque « L'image d'affiche n'a pas pu être extraite » dans la section Traitement) |
| Sous-titres refusés (422 `INVALID_TEXT_TRACK`) | fichier ni WebVTT ni SRT, temps illisibles ou fin avant le début : le message donne la ligne en cause |
| Sous-titres absents sur un autre site | `<track>` venant d'un autre domaine : ajouter `crossorigin="anonymous"` à `<video>` (l'extrait de la fiche le fait) |
| `pnpm db:migrate` : « database is locked » (SQLite) | un serveur (`pnpm dev`) garde la base ouverte : l'arrêter le temps de la migration, puis le relancer |
| Envoi de vidéo coupé (408) après exactement 5 min | délai de Node non relevé : vérifier `NUXT_MEDIA_UPLOAD_TIMEOUT` et les délais du mandataire (§ 7.7). En développement (`pnpm dev`), le relais de Nitro garde ses propres délais |
| En développement : requête bloquée puis `ECONNRESET` juste après un envoi refusé (415, 413, 422) | relais de développement de Nitro (`httpxy`, vers son fil de travail — sans rapport avec les processus de travail du traitement des vidéos) : il cesse de transmettre le corps refusé et la connexion réutilisée reste bloquée ~6 s. Absent en production (vérifié avec Node et h3 seuls) |
| `[surge-media] Traitement des vidéos désactivé : ffmpeg introuvable ou inutilisable (NUXT_FFMPEG_PATH)…` au démarrage | ffmpeg ou ffprobe absent du `PATH` du serveur : l'installer (§ 7.7), ou donner son chemin complet (`NUXT_FFMPEG_PATH`, `NUXT_FFPROBE_PATH`), puis redémarrer. Le serveur fonctionne normalement, sans traitement des vidéos |
| « ffmpeg trop ancien », « encodeur libx264 absent de ce ffmpeg », « encodeur aac absent de ce ffmpeg » | version 6 au moins, avec `libx264` et `aac` : Debian 12 (5.1) et Ubuntu 22.04 (4.4) sont trop anciens ; une build sans x264 (licence) ne convient pas. Autre paquet ou autre build, puis redémarrer ; « Réglages › Traitement des vidéos » liste les problèmes détectés |
| « Réglages » : traitement « Arrêté » (mode `embedded`), ou processus de travail « Arrêté : ffmpeg inutilisable » | ffmpeg est devenu inutilisable en cours de route (binaire supprimé ou déplacé) : nouvelle détection chaque minute, reprise d'elle-même dès qu'il est de nouveau là ; les tâches attendent dans la file |
| « Réglages » : « Inactif », « Aucun processus de travail en état de traiter ne s'est signalé depuis 5 minutes » (mode `external`) | aucun processus de travail lancé, ou lancé avec une autre base, ou arrêté (ffmpeg inutilisable : voir son journal). D'ici là, formats convertis refusés (415) et aucune tâche créée à l'envoi (« Traiter les vidéos existantes » ensuite). Après le démarrage d'un processus de travail, compter jusqu'à 30 s avant que le serveur web le voie |
| Journal du processus de travail : « fichiers des médias introuvables dans le stockage configuré » | stockage non partagé avec le serveur web : même bucket S3 et même préfixe, ou disque monté au même chemin (`NUXT_MEDIA_STORAGE_ROOT`) ; traitement non démarré sur ce processus |
| « NUXT_SERVER_ROLE=worker avec NUXT_VIDEO_PROCESSING=off » au démarrage | le processus de travail n'a rien à faire : `NUXT_VIDEO_PROCESSING=external` des deux côtés (serveur web et processus de travail) |
| Processus de travail : 404 (`Not Found` en texte brut) sur toutes les adresses | normal : il ne sert que `/api/health` (sonde) ; l'administration, l'API et la diffusion sont sur le serveur web |
| Vidéo : 503 `PROCESSING_PENDING` sur son adresse publique ou un lien de partage | normal pendant le retrait d'une piste de données de l'appareil (positions GPS), en général quelques secondes : réessayer après `Retry-After` ; l'aperçu de l'administration fonctionne. Si cela dure : personne ne traite la file (« Réglages », `/api/health` › `videoProcessing.workers` à 0) |
| Traitement « en attente » qui ne commence pas | traitement inactif (voir plus haut), ou file occupée (une tâche à la fois par défaut, `NUXT_VIDEO_CONCURRENCY` ; « Traiter les vidéos existantes » passe après les nouveaux envois), ou nouvel essai prévu après un échec passager (« Prochain essai au plus tôt ») |
| Traitement « en cours » figé après un arrêt brutal du serveur ou du processus de travail | la tâche revient dans la file à l'expiration de son bail (2 min, un essai compté) ; après 3 essais : échec définitif |
| « Échec du traitement » dans la fiche | code affiché : `NO_VIDEO_TRACK` (aucune piste vidéo), `UNREADABLE` (fichier illisible), `CONVERSION_FAILED` (ffmpeg en échec ou sortie refusée par la vérification : voir le détail technique), `TOO_LONG` (au-delà de `NUXT_VIDEO_MAX_DURATION`), `TIMEOUT`, `SOURCE_MISSING` (original absent du stockage), `FFMPEG_UNAVAILABLE`. La vidéo reste servie avec ce qui a pu être fait ; « Relancer le traitement » après correction |
| « Cannot allocate memory » dans le détail technique (vidéo 4K ou 8K, HDR) | limite de mémoire de ffmpeg atteinte (`prlimit`, Linux) : relever `NUXT_VIDEO_MEMORY_LIMIT` (4096 Mio par défaut) ou baisser `NUXT_VIDEO_THREADS`, puis relancer |
| « No space left on device » dans le journal du serveur ou le détail technique, tâche reprise plus tard | dossier temporaire du système (`TMPDIR`) plein : prévoir, par tâche simultanée, la place des sorties et, sous S3, d'une copie de l'original (§ 7.7) ; l'échec est passager (nouvel essai) |
| « Couleurs HDR non converties » | filtres `zscale` et `tonemap` absents de ce ffmpeg : rendu fait sans correction des couleurs ; une build qui les contient (« Réglages » › conversion HDR), puis « Relancer le traitement » |
| MKV, AVI… : l'original se télécharge au lieu d'être lu | normal : ces formats ne sont pas lus par les navigateurs ; la lecture passe par la version H.264 (`sources`), produite par le traitement |
| Une adresse de vidéo copiée juste après l'envoi redirige (302) | normal : le retrait d'une piste de données ou la réparation d'un WebM crée une nouvelle version ; l'ancienne URL redirige vers la nouvelle |
| Windows : `ffmpeg -version` fonctionne mais le serveur dit « ffmpeg introuvable ou inutilisable » | `PATH` du serveur antérieur à l'installation (ouvrir une nouvelle console, ou chemin complet dans `NUXT_FFMPEG_PATH`, § 7.7), ou binaire bloqué par le « Contrôle intelligent des applications » (comme argon2 et oxc-transform) |
| En développement : Ctrl+C sur `pnpm dev` pendant un encodage | ffmpeg s'arrête avec le serveur ; au redémarrage, la tâche est reprise (bail rendu échu aussitôt, un essai compté) — vérifié sous Linux ; Windows : non rejoué (le Ctrl+C de `surge-media worker` et de `pnpm start` l'a été, § 7.7) |
| Journal d'audit, sessions ou limites de débit : adresse du mandataire (`172.x`, `10.x`) au lieu de celle du client | mandataire sur une adresse publique (la lister dans `NUXT_TRUST_PROXY`), `NUXT_TRUST_PROXY=false`, ou mandataire qui n'ajoute pas `X-Forwarded-For` (nginx : `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) ; une entrée invalide du réglage est signalée au démarrage |
| Tableau de bord : « La base SQLite est sous pression » ou « Trafic élevé pour une base SQLite » | constat mesuré par le serveur (§ 12.1) : attentes de verrou dépassées (requêtes en échec), opérations lentes, base occupant le processus ; passer à PostgreSQL ou MySQL si le trafic est durable, ne pas faire écrire plusieurs processus dans la même base. Le constat reste affiché 24 h |
| Requêtes de `/m/` sans réponse jusqu'au délai du client (connexions persistantes, mandataire nginx `keepalive`) | corrigé le 2026-10-10 (`responseReady`, § 12.1) : la réponse attend sa connexion avant d'envoyer le fichier |
| Débit faible (≈ 100 à 800 requêtes/s), processeur saturé, même sur des réponses 304 | corrigé le 2026-10-10 : configuration d'exécution calculée une fois (§ 12.1). Une variable d'environnement changée sans redémarrage n'est plus vue : redémarrer |
| Windows, essai automatisé : Ctrl+C sans effet sur un serveur lancé par un script | l'attribut « ignorer Ctrl+C » est hérité des processus parents (outils d'automatisation, services) : tester l'arrêt depuis une console ordinaire, ou réactiver Ctrl+C (`SetConsoleCtrlHandler(NULL, FALSE)`) avant de lancer le serveur |
| Média introuvable (404) juste après sa mise à la corbeille | normal : un média en corbeille n'est plus diffusé (sauf aperçu dans l'administration) |
| `An Application Control policy has blocked this file` (`…binding-win32-x64-msvc…node`) au lancement de Nuxt | Windows (« Contrôle intelligent des applications ») refuse un module natif non signé : voir l'override `oxc-transform` (§ 13) ; pour un autre paquet, tester une version voisine ou débloquer le fichier côté Windows |
| Projet introuvable (404) alors qu'il existe | l'utilisateur n'en est pas membre (seuls les ADMIN voient tous les projets) |
| Un développeur reçoit 403 en créant un projet | depuis l'étape 16, seuls les administrateurs et les gestionnaires créent des projets : demander à un gestionnaire de l'y ajouter |
| Bibliothèque sans envoi, sans dossiers à créer | normal hors ADMIN : la bibliothèque est en lecture (dupliquer un média vers son projet reste possible) |
| 403 `LIBRARY_NOT_ALLOWED` à la suppression d'un projet | seul un administrateur verse des médias dans la bibliothèque : supprimer définitivement, ou demander à un administrateur |
| 409 `INVITATION_ACCEPTED` (gestionnaire) | l'invité a déjà choisi son mot de passe : une réinitialisation passe par un administrateur |
| Pas de menu « Rôle dans le projet » pour un membre | gestionnaire : un seul rôle possible (propriétaire) ; il administre tout projet dont il est membre |
| Une boîte « Confirmez votre mot de passe » s'ouvre | normal : action sensible (clé secrète, jeton personnel, membres) plus de 10 min après la dernière saisie du mot de passe (§ 9.7) ; cochez « Faire confiance à cet appareil » pour ne plus la voir pendant 15 jours dans ce navigateur |
| La confirmation est redemandée malgré « Faire confiance à cet appareil » | confiance expirée (15 jours), retirée (tableau de bord, administrateur), mot de passe changé, cookies du navigateur effacés, autre navigateur ou navigation privée, ou option désactivée (`NUXT_PUBLIC_TRUSTED_DEVICE_DAYS=0`) |
| Tableau de bord : chiffres différents d'un compte à l'autre | normal : chaque compte ne voit que ses espaces (bibliothèque et projets dont il est membre ; tout pour l'administrateur) |
| Tableau de bord : graphique des envois vide au premier affichage | il est dessiné dans le navigateur (fuseau horaire du visiteur) : « Chargement du graphique… » le temps de l'hydratation |
| Pas de bouton « Envoyer par e-mail » à côté de « Copier le lien » | `NUXT_SMTP_HOST` ou `NUXT_SMTP_FROM` manquant (redémarrer le serveur après les avoir définis) |
| « L'e-mail n'a pas pu être envoyé » (502 `MAIL_FAILED`) | serveur SMTP injoignable, identifiants refusés, port ou TLS incorrect (587 STARTTLS, ou 465 avec `NUXT_SMTP_SECURE=true`), expéditeur refusé : le détail est dans les journaux du serveur (« Envoi d'e-mail impossible ») |
| « Ce lien n'est plus valable » à l'envoi par e-mail | le lien affiché a été utilisé, remplacé par un plus récent ou a expiré : en générer un nouveau |
| E-mail reçu en indésirable | configurer SPF, DKIM et DMARC du domaine de `NUXT_SMTP_FROM` chez votre fournisseur |
| Pas de case « Faire confiance à cet appareil » | option désactivée : `NUXT_PUBLIC_TRUSTED_DEVICE_DAYS=0` |
| Clé secrète ou jeton personnel perdu | la valeur complète n'est jamais conservée : renouveler la clé (rotation avec recouvrement) ou créer un nouveau jeton, puis révoquer l'ancien |
| Onglets « Clés d'API » et « Origines autorisées » absents | il faut la portée `project:credentials` (rôle de projet OWNER ou DEVELOPER, jamais un EDITOR de plateforme) et un projet non archivé |
| `TS2321: Excessive stack depth` sur un appel `$api(…)` passé à une fonction générique (ex. `useReauth().run`) | isoler l'appel dans une fonction nommée (`function createRequest(body) { return $api(…) }`) : son type de retour n'est alors calculé qu'une fois |
| API v1 : 403 `SECRET_IN_BROWSER` | clé secrète ou jeton personnel appelé depuis un navigateur (`Origin`, `Sec-Fetch-Site`) : passer par votre serveur, ou utiliser une clé publique |
| API v1 : 403 `LISTING_DISABLED` avec une clé publique | activer « Liste publique » dans les réglages du projet, ou demander les médias par `ids` |
| API v1 : 403 `ORIGIN_NOT_ALLOWED` / pas d'en-tête CORS | ajouter l'origine exacte du site (schéma, hôte, port) dans « Origines autorisées » |
| API v1 : 429 pour toutes les requêtes d'une machine | plus de 30 identifiants refusés en une minute depuis cette IP : corriger l'identifiant, attendre la fin de la fenêtre |
| Adresse en `http://localhost/…` (sans port) dans une page de l'administration | rendu serveur sans `NUXT_SITE_URL` : définir la variable (le plugin `$api` transmet aussi l'hôte d'origine depuis cette étape) |
| `ReferenceError: X is not defined` au runtime alors que le typecheck passe | auto-import de Nitro non injecté (ex. après un prédicat de type `(x): x is T => (X as …)`) : importer explicitement depuis `#shared/utils/…` |
| 409 `FOLDER_NOT_EMPTY` à la suppression d'un dossier | il contient des médias ou des sous-dossiers : les ranger ailleurs, ou supprimer avec remontée du contenu (`content=parent`, proposé par l'interface) |
| 409 `FOLDER_NAME_TAKEN` | un dossier voisin porte déjà ce nom (majuscules et minuscules confondues), y compris lors d'une remontée de contenu |
| Un média « disparaît » de la liste après un rangement | la liste montre le dossier affiché seulement : cocher « Inclure les sous-dossiers », ou ouvrir le dossier de destination |
| Recherche sans résultat alors que le média existe | elle porte sur le dossier affiché : cocher « Inclure les sous-dossiers » (depuis la racine : tout l'espace) |
| API v1 : 403 `UPLOAD_LIMIT_REACHED` | le jeton délégué a atteint son nombre de fichiers (`maxFiles`) : en demander un nouveau à votre serveur |
| API v1 : 401 `TOKEN_REVOKED` avec un jeton délégué valide | son émetteur a été révoqué, a expiré ou appartient à un compte désactivé : émettre les jetons avec un identifiant actif |
| API v1 : 403 `INSUFFICIENT_SCOPE` en liste avec un jeton délégué | aucune portée n'est donnée d'office : demander `media:read` à l'émission (en plus de `media:upload`) |
| API v1 : 403 `ORIGIN_NOT_ALLOWED` avec un jeton délégué | l'`Origin` de la page doit figurer dans les origines du projet et, si le jeton en fixe une, être exactement celle-ci |
| Une URL de transformation redirige (301) | elle n'est pas sous forme canonique (ordre des paramètres, valeur par défaut, `jpeg`, `dpr`) : utiliser l'URL de destination (§ 8.1) |
| 400 `INVALID_TRANSFORM` sur `/m/` | paramètre inconnu, répété ou hors bornes, zone hors de l'image (après rotation), format non activé : voir `data.detail` |
| 429 `TRANSFORM_QUOTA` | 50 dérivés pour cette version (réutiliser des tailles existantes ou un préréglage), ou trop de nouvelles transformations depuis une adresse (derrière un CDN : relever `NUXT_MEDIA_TRANSFORM_RATE_LIMIT` ou le mettre à 0) |
| 403 `TRANSFORM_NOT_ALLOWED` sur `/m/` | la politique de l'espace refuse les paramètres libres : utiliser un préréglage, une URL signée (politique `SIGNED`), ou changer la politique (onglet Transformations du projet, ou Réglages pour la bibliothèque) |
| Un préréglage modifié montre encore l'ancien rendu | le navigateur ou le CDN garde l'URL jusqu'à `NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE` (7 jours) : vider le cache, ou purger le CDN |
| 400 `INVALID_TRANSFORM` sur un préréglage qui fonctionnait | sa définition dépasse une borne abaissée depuis (`NUXT_MEDIA_TRANSFORM_MAX_DIMENSION`, formats) : modifier le préréglage |
| Image transformée plus petite que demandée | jamais d'agrandissement : la sortie est réduite en gardant le rapport demandé, et bornée à 4096 px |
| 413 `BODY_TOO_LARGE` sur une requête JSON | corps de plus de 1 Mio : aucune route n'en attend autant (vérifier le client) ; les fichiers passent par les routes d'envoi multipart |
| 408 `UPLOAD_TIMEOUT` à l'envoi | aucune donnée pendant 60 s : connexion perdue ou bloquée (proxy qui met tout le corps en mémoire avant de le transmettre : nginx `proxy_request_buffering off`) |
| 408 `REQUEST_TIMEOUT` | corps JSON non reçu en 30 s : client ou réseau très lent |
| 503 `SERVER_BUSY` à l'envoi ou sur un aperçu | file des traitements pleine : réessayer après `Retry-After` ; en production, ajuster `NUXT_MEDIA_PROCESSING_*` (§ 8) |
| Image privée cassée dans une page externe après un changement de secret | lien signé avec l'ancien secret : déclarer celui-ci dans `NUXT_MEDIA_PREVIOUS_SIGNING_SECRET` pendant 7 jours |
| Docker : « Impossible d'écrire /app/data/secrets » au démarrage | volume monté depuis un dossier de l'hôte qui n'appartient pas à l'uid 1000 : `chown -R 1000:1000 <dossier>`, ou fournir `NUXT_SESSION_PASSWORD` et `NUXT_MEDIA_SIGNING_SECRET` (`-e` ou `_FILE`) |
| Docker : « database is locked » avec la commande `migrate` (SQLite) | le serveur tient la base : l'arrêter avant (`server` applique de toute façon les migrations à son démarrage) |
| Docker : le conteneur s'arrête après « Base injoignable … (20/20) » | base hors d'atteinte pendant 60 s : vérifier `DATABASE_URL` (nom du service Compose, port, mot de passe encodé dans l'URL) et le réseau du conteneur |

---

## 15. Qualité du code, versions et publication

### 15.1 Qualité du code et intégration continue

- **ESLint 10** avec **`@nuxt/eslint`** (`packages/core/eslint.config.mjs`) : règles JavaScript, TypeScript, Vue et
  Nuxt, générées par `nuxt prepare` dans `.nuxt/eslint.config.mjs` (donc après `pnpm install`), et style
  @stylistic (`eslint.config.stylistic: true` dans `nuxt.config.ts`) : 2 espaces, guillemets simples, sans
  point-virgule, virgule finale en multiligne, `else` / `catch` sur leur propre ligne. Ajustements au style établi :
  plusieurs attributs par ligne dans les gabarits (`vue/max-attributes-per-line` désactivée), deux instructions par
  ligne au plus (`case X: a = f(); break`, rappels d'une ligne), `catch {}` admis ; tests : `delete` dynamique admis
  (restauration de `process.env`). Fichiers générés et builds ignorés.
  `pnpm lint` vérifie, `pnpm lint:fix` corrige ce qui peut l'être. La mise en place (2026-10-10) a corrigé
  automatiquement une centaine d'écarts de style (49 fichiers) et révélé un vrai défaut (widget « Votre compte »
  jamais affiché après une erreur du tableau de bord : `v-else-if` mort).
- **Messages de commit** : [Conventional Commits](https://www.conventionalcommits.org), source du CHANGELOG et du
  calcul de la version. `commitlint.config.mjs` (racine, `@commitlint/config-conventional`, casse du sujet libre,
  lignes longues admises dans le corps), vérifié par le hook git **`commit-msg`** que simple-git-hooks installe à
  `pnpm install` (après une modification de sa configuration dans `package.json` : `pnpm exec simple-git-hooks`).
  Exceptionnellement sans vérification : `SKIP_SIMPLE_GIT_HOOKS=1 git commit …`.

  | Type | Dans le CHANGELOG | Version (avant 1.0.0) |
  | --- | --- | --- |
  | `feat` | Features | mineure (correctif) |
  | `fix`, `perf` | Bug Fixes, Performance | correctif |
  | `build` (paquet, image Docker, dépendances) | Build and Distribution | — |
  | `docs`, `refactor`, `style`, `test`, `ci`, `chore` | non | — |
  | `!` après le type, ou pied `BREAKING CHANGE: …` | BREAKING CHANGES | majeure (mineure) |

- **CI** (`.github/workflows/ci.yml`, chaque push sur `main` et chaque pull request) : **Vérifications** (messages
  de commit de la pull request, lint, typecheck, tests, traductions, migrations à jour), **Paquet npm** (build,
  archive, essai d'installation, § 15.5), **Image Docker** (construite depuis cette archive, amd64, démarrée,
  `/api/health`). Préparation commune : `.github/actions/setup` (Node de `.nvmrc`, pnpm par corepack, magasin pnpm
  en cache, installation).

### 15.2 Versions

- **SemVer**, une seule version pour le paquet npm et les images Docker : `version` de
  `packages/core/package.json`, tag annoté **`vX.Y.Z`**, notes dans `packages/core/CHANGELOG.md` (en anglais, publié
  avec le paquet) et dans la release GitHub.
- **Calcul** d'après les commits écrits depuis le dernier tag : rupture → majeure, `feat` → mineure, `fix` / `perf`
  → correctif ; **avant 1.0.0** (option `preMajor`), un cran de moins : rupture → mineure, `feat` → correctif. La
  **première release** impose sa version : `pnpm release 0.1.0` ; passage à 1.0.0 : `pnpm release major`.
- **Préversions** : `pnpm release --preRelease=beta` (`0.2.0-beta.0`, puis `-beta.1`…) → étiquette npm `next`,
  image `X.Y.Z-beta.N` seulement ; `pnpm release` sans option publie ensuite la version stable.
- **Correctif d'une ancienne ligne** : branche `release/X.Y` créée depuis le dernier tag de la ligne, correctifs
  repris (`git cherry-pick`), `pnpm release` sur cette branche → étiquette npm `release-X.Y`, images `X.Y.Z` et
  `X.Y`, sans toucher à `latest`.
- **Licence** : `pnpm release` et le workflow de publication refusent un `LICENSE` qui contient encore un champ
  `[TO BE COMPLETED]` (`pnpm --filter @surge-media/core license:check`). La « Change Date » de la BSL (3 ans)
  court depuis la publication de chaque version ; tags et releases GitHub en sont la preuve datée : ne jamais
  supprimer ni réécrire un tag publié.

### 15.3 Faire une release

Depuis `main` (ou `release/*`) à jour avec le dépôt distant, arbre de travail propre :

```bash
pnpm release:dry       # aperçu : version calculée, CHANGELOG, commandes ; rien n'est écrit
pnpm release           # version calculée, confirmations interactives
pnpm release 0.1.0     # version imposée (première release) ; ou minor, major, --preRelease=beta
pnpm --filter @surge-media/core changelog:preview   # notes de la prochaine version seulement
```

release-it (`packages/core/.release-it.ts`) : vérifications (`pnpm lint`, `typecheck`, `test`, `i18n:check`,
`db:migration --check` : quelques minutes), version du `package.json`, `CHANGELOG.md`, commit
`chore(release): vX.Y.Z`, tag annoté, push, puis **release GitHub** (notes = section du CHANGELOG) : par l'API si
la variable **`GITHUB_TOKEN`** contient un jeton ayant le droit d'écrire sur le dépôt (`contents: write`), sinon
page pré-remplie ouverte dans le navigateur, à publier d'un clic. Un `GITHUB_TOKEN` sans droit sur le dépôt fait
échouer la release (« is not a collaborator ») : le retirer de la session pour passer par le navigateur. La
publication de la release lance le workflow du § 15.4 ; si elle n'a pas été créée (interruption après le push),
la créer à la main pour le tag.

### 15.4 Publication : `.github/workflows/release.yml`

Déclenché par la **publication d'une release GitHub** (pas un brouillon), ou à la main (Actions › Release › Run
workflow, avec le tag) pour relancer une publication interrompue : une version déjà sur npm est sautée, les images
sont réécrites à l'identique.

1. **package** : tag = version du `package.json` ; vérifications ; build ; archive ; essai d'installation ;
2. **npm** : publication de **cette archive**, avec provenance si le dépôt est public ;
3. **docker** : variantes complète et `slim`, **linux/amd64 et linux/arm64** (émulation QEMU), construites depuis
   la même archive (`--build-context package=…` : pas de build Nuxt par architecture) ; attestations de
   provenance et SBOM ; cache GitHub Actions ;
4. **assets** : archive `surge-media-core-X.Y.Z.tgz` jointe à la release.

| Version publiée | Étiquette npm | Tags des images (`ghcr.io/mahmoud-nb/surge-media`, et `…-slim`) |
| --- | --- | --- |
| `0.3.0`, plus haute version stable | `latest` | `0.3.0`, `0.3`, `latest` |
| `1.4.0`, plus haute version stable | `latest` | `1.4.0`, `1.4`, `1`, `latest` |
| `0.4.0-beta.1` | `next` | `0.4.0-beta.1` |
| `0.2.5`, ligne `release/0.2` | `release-0.2` | `0.2.5`, `0.2` |

**À faire une fois, avant la première release** :

1. **npm** : créer l'organisation **`surge-media`** sur npmjs.com (gratuite pour des paquets publics).
2. **Première publication** : la publication de confiance (OIDC, sans secret) ne se déclare que pour un paquet
   existant. Pour la première version, créer un jeton d'accès granulaire npm (lecture et écriture des paquets de
   `@surge-media`, utilisable sans 2FA interactive) et l'enregistrer comme secret **`NPM_TOKEN`** du dépôt
   (Settings › Secrets and variables › Actions), de préférence dans l'environnement **`npm`**.
3. **Ensuite** : sur npmjs.com, paquet `@surge-media/core` › Settings › Trusted publishing › GitHub Actions :
   propriétaire `mahmoud-nb`, dépôt `surge-media`, workflow `release.yml`, environnement `npm` ; puis supprimer le
   secret `NPM_TOKEN` et révoquer le jeton.
4. **Dépôt public** : la provenance npm l'exige (sinon publication sans provenance).
5. **GHCR** : aucun secret (jeton du workflow, `packages: write`). Le paquet `surge-media` est créé à la première
   publication et relié au dépôt par l'étiquette `org.opencontainers.image.source` ; vérifier sa visibilité
   (Package settings › Change visibility › Public) pour un `docker pull` sans authentification.
6. **Environnement `npm`** (créé au premier passage) : règles de protection facultatives, par exemple une
   approbation avant chaque publication.

### 15.5 Le paquet npm

- **Contenu** (`files` du `package.json`, ≈ 9,5 Mo compressés) : serveur construit (`.output`, trois clients Prisma),
  CLI (`dist/cli`), schéma et migrations (`prisma/`), schémas par fournisseur (`server/generated/schemas/`),
  `prisma.config.ts` et `shared/database.ts` (migrations), `.env.example`, `README.md`, `CHANGELOG.md`, `LICENSE`.
- **Dépendances** : seulement celles de l'exécution — better-sqlite3, sharp, @node-rs/argon2 (modules natifs,
  versions épinglées : celles de la build), prisma (CLI des migrations), citty et @clack/prompts (CLI). Nuxt, Vue,
  Tailwind, le SDK AWS… sont des dépendances de développement, intégrées au serveur construit par Nitro.
- **`prepack`** (`scripts/prepack.ts`, lancé par `pnpm pack` et `npm publish`) : vérifie la build ; retire du
  serveur construit les modules natifs compilés pour la plateforme de la build (sharp et `@img/*`, `@node-rs/*`,
  better-sqlite3), après avoir vérifié que leurs versions sont celles des dépendances : npm installe ceux de la
  plateforme de l'utilisateur, que Node trouve en remontant depuis `.output/server` ; remplace par des copies les
  liens symboliques de Nitro (`node_modules/.nitro/<paquet>@<version>`, absolus sous Windows), que l'archive npm ne
  conserve pas (« Cannot find package 'postgres-array' » au démarrage) ; copie `LICENSE` (copie ignorée par git).
  Le serveur construit du dépôt reste utilisable ensuite (modules natifs de `packages/core/node_modules`).
- **`prepare` au lieu de `postinstall`** (`nuxt prepare` et génération des clients) : npm ne lance pas `prepare`
  chez l'utilisateur qui installe le paquet.
- **Essai** : `pnpm --filter @surge-media/core smoke:package <archive>` installe l'archive dans un dossier vide,
  lance `init` (SQLite) puis `start` et attend `/api/health` (CI, release ; vérifié sous Windows avec npm 12 et
  sous Linux avec npm 11).

Installation par un utilisateur, dans le dossier qui contiendra `.env` et les données :

```bash
npm install @surge-media/core
npm install-scripts approve better-sqlite3 @prisma/engines prisma   # npm 12 et plus seulement
npm rebuild better-sqlite3 @prisma/engines                          # idem
npx surge-media init
npx surge-media start
```

npm 12 et plus (comme pnpm : `pnpm approve-builds`) n'exécutent les scripts d'installation des dépendances
qu'approuvés (`allowScripts` du `package.json` de l'utilisateur) : sans celui de better-sqlite3, pas de module
natif — `start` refuse alors de démarrer avec SQLite et donne ces commandes (PostgreSQL et MySQL n'en ont pas
besoin). Mise à jour : `npm install @surge-media/core@latest`, `npx surge-media db migrate`, puis redémarrage.

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

### Étape 5 — 2026-09-29 — Phase B1 : projets, espaces et autorisations

**Décisions validées** (document `.claude/architecture-phase-b.md`, § 16) : une installation = une
organisation ; un média appartient à **un seul espace** (bibliothèque ou projet), réutilisation par
duplication (et déplacement) ; rôles de projet `OWNER` / `DEVELOPER` / `EDITOR` plafonnés par le rôle
de plateforme ; environnements = clés étiquetées d'un même projet (B2) ; diffusion sans cookie, par
défaut sur le domaine de l'application, configurable ; transformations préparées (grammaire d'URL,
liens signés v2) ; Vitest ; dossiers conservés (B5) ; livraison B1 → B5.

**Ajouté**
- Migration `projects_spaces` (3 fournisseurs) : `ProjectRole`, `ProjectMember`, `Project.archivedAt`
  et `createdById`, `Media.projectId` facultatif (bibliothèque) en `Restrict`, `Media.duplicatedFromId`,
  `Folder.projectId` facultatif ; reprise : médias du projet `default` → bibliothèque, projet supprimé.
- Moteur de rôles et de portées (`shared/utils/permissions.ts`) : permissions de plateforme
  (`library:manage`, `projects:create`, `projects:all`, `tokens:personal`, `users:manage`), portées
  `media:*` et `project:*`, plafond, lecture seule des projets archivés. Contrôle d'accès par espace
  (`server/utils/access.ts` : `requireSpaceAccess`, `requireMediaAccess`, 404 si invisible).
- Projets : service, API (`/api/admin/projects`, membres, candidats), écrans liste, création, aperçu
  (réglages, archivage, suppression avec choix pour les médias), médias, membres.
- Médias par espace : bibliothèque (`/admin/media`) et médias de projet (`AdminMediaBrowser`),
  duplication (`MediaStorage.copy`) et déplacement, `GET /api/admin/spaces`, fiche en lecture seule
  sans droit d'écriture, section active de la barre latérale selon l'espace (`useAdminSection`).
- Diffusion sans cookie : liens signés v2 (`kid`, droit `derived`/`admin`, échéance alignée), aperçus
  d'administration signés, rotation du secret (`NUXT_MEDIA_PREVIOUS_SIGNING_SECRET`), 404 sans
  redirection pour un média en corbeille, `Access-Control-Allow-Origin: *`.
- `NUXT_SITE_URL` (question de `surge-media init`, option `--site-url`) et `NUXT_MEDIA_PUBLIC_URL` ;
  liens à copier absolus ; avertissement au démarrage sans URL publique en production.
- Vitest (`pnpm test`) : 50 tests (matrice complète rôles × membres × archivage, signatures, identifiants).
- Barre de filtres des médias et fiche d'un média : deux colonnes à partir de 1280 px (trop serrées à 1024 px).

**Vérifié** : typecheck, 50 tests Vitest, i18n (440 clés), migrations (`--check`), build de production.
58 scénarios d'API rejoués en dev **et** en production avec trois comptes (ADMIN, DEVELOPER, EDITOR) :
création, identifiants, membres (plafond, doublon, dernier propriétaire), visibilité et 404, envoi par
espace, duplication, déplacement, diffusion sans cookie (lien admin, lien de partage, signature altérée,
corbeille), archivage (lecture seule, `PROJECT_ARCHIVED`) et suppression (vers la bibliothèque, purge).
Interface : création (validation), envoi dans un projet, duplication, membres (ajout, rôle, retrait au
clavier avec focus restauré), suppression confirmée ; axe-core : 0 violation WCAG 2.2 AA sur toutes les
pages nouvelles ou modifiées (boîtes de dialogue ouvertes, projet archivé) en fr/en × clair/sombre.
Non vérifié : lecteurs d'écran réels ; MySQL/MariaDB et PostgreSQL réels pour la nouvelle migration.

**Limites connues**
- Clés d'API, jetons personnels et origines CORS : étape B2 ; API v1 : B3–B4 ; dossiers : B5.
- `oxc-transform` forcé en 0.141.0 (§ 13) tant que Windows bloque la 0.143.0.
- Les liens signés d'avant cette étape (sans `kid`) ne sont plus reconnus.
- Changer un rôle de plateforme n'est pas bloqué s'il réduit un propriétaire unique : le projet reste
  administrable par un ADMIN (rôle exercé plafonné, affiché dans l'écran Membres).

**Après `git pull`**
```bash
pnpm install        # Vitest, override oxc-transform
pnpm db:migrate     # projets, membres, espaces + client Prisma
pnpm db:init --yes  # facultatif : ajoute NUXT_SITE_URL (http://localhost:3000) au .env
```

### Étape 6 — 2026-09-29 — Phase B2 : identifiants d'API, mode sudo et journal d'audit

**Cadre** : architecture validée de la phase B (`.claude/architecture-phase-b.md`, § 4, § 12, § 15).

**Ajouté**
- Migration `b2_credentials` (3 fournisseurs) : `AccessToken` restructuré (`type` PERSONAL / SECRET /
  PUBLISHABLE, `environment`, `userId`, `allProjects`, `includeLibrary`, `publicValue`, `lastUsedIp`,
  `replacedById`, `projectId` facultatif), `AccessTokenProject`, `AuditEvent`,
  `Session.passwordVerifiedAt`. Reprises écrites à la main : anciennes lignes `AccessToken` supprimées
  (format jamais accepté par une API), `passwordVerifiedAt` des sessions ouvertes = leur connexion.
- Identifiants opaques `sm_pat_` / `sm_sk_` / `sm_pk_` (base62 + CRC32, empreinte SHA-256, préfixe
  lisible) ; clés de projet par environnement (création, renouvellement avec recouvrement, révocation,
  suppression des clés inactives), jetons personnels (projets choisis ou tous, bibliothèque, portées,
  échéance obligatoire), origines autorisées normalisées avec jokers de sous-domaine (§ 9.6).
- Confirmation du mot de passe pour les actions sensibles : `POST /api/auth/confirm-password`,
  `requireRecentPassword`, `useReauth` + `<AdminReauthDialog>` ; appliquée aussi à la gestion des
  membres (§ 9.7).
- Journal d'audit : `recordAudit` sur les routes projets, membres, clés, jetons, origines, médias
  (visibilité, déplacement, suppression définitive) et comptes ; écran `/admin/audit` (permission
  `audit:read`, filtres catégorie et projet) (§ 9.8).
- Écrans : onglets « Clés d'API » (`/keys`, `/keys/new`) et « Origines autorisées » d'un projet,
  `/admin/tokens` et `/admin/tokens/new` (la section « à venir » disparaît), entrée « Journal d'audit »
  de la barre latérale ; composants `UiCheckboxGroup`, `UiCopyButton`, `AdminSecretPanel`,
  `AdminScopeList`, `AdminTokenStatusBadge`, `AdminReauthDialog`.
- Tests Vitest : format des jetons (CRC, altérations), portées, schémas, origines, fenêtre de
  confirmation (67 tests au total). Configuration `core-start-3100` dans `.claude/launch.json` (build de
  production sur le port 3100 quand un serveur de dev occupe le 3000).

**Vérifié** : typecheck, 67 tests Vitest, i18n (718 clés), contrastes, migrations (`--check`), build de
production. 91 scénarios d'API sur la build de production : confirmation du mot de passe (fenêtre de
10 min, 422, 429, départ sans confirmation), clés (formats, portées, environnement, aucune empreinte ni
secret renvoyé, 403 / 404 selon le rôle, autre projet), renouvellement (recouvrement, `TOKEN_REPLACED`,
révocation immédiate), révocation et suppression, origines (normalisation, doublon, joker, 404),
projet archivé (`PROJECT_ARCHIVED`), jetons personnels (sélection, projet étranger ou archivé, durée,
portée de gestion refusée, isolement entre comptes), journal (actions, auteurs, libellés, filtres,
aucun secret) ; 58 scénarios de B1 rejoués sans régression. Interface : création de clés et de jetons
(validation, focus sur l'erreur), confirmation du mot de passe (erreur, annulation avec Échap sans
fermer le dialogue parent, reprise de l'action), panneau de la valeur affichée une fois (focus),
renouvellement, révocation, origines, journal ; axe-core : 0 violation WCAG 2.2 AA sur les pages
nouvelles ou modifiées (formulaires en erreur, dialogues ouverts, sections repliées ouvertes) en
fr/en × clair/sombre.
Non vérifié : lecteurs d'écran réels ; la migration sur PostgreSQL et MySQL/MariaDB réels.

**Limites connues**
- Les identifiants ne sont pas encore utilisables : l'API v1 (résolution `Bearer`, CORS par projet,
  dernière utilisation, limitation de débit) arrive en B3.
- Un ADMIN ne peut pas révoquer les jetons personnels d'un autre compte depuis l'interface (désactiver
  ou supprimer le compte les coupe).
- Pas de purge automatique du journal d'audit ; limiteur de confirmation du mot de passe en mémoire.

**Après `git pull`**
```bash
pnpm install
pnpm db:migrate     # identifiants d'API, journal d'audit, mode sudo + client Prisma
```

### Étape 7 — 2026-09-29 — Phase B3 : API publique v1 en lecture

**Cadre** : architecture validée de la phase B (§ 5, § 6, § 9 ; décisions D5–D9, D15).

**Ajouté**
- Migration `b3_api_read` (3 fournisseurs) : `Project.publicListing`, `CacheRevision`, colonnes de
  recherche normalisées `Media.searchTitle|searchName|searchAlt` (remplies à l'écriture ; médias
  existants indexés au démarrage par `server/plugins/search-backfill.ts`).
- API `/api/v1` (§ 9.9) : `/me`, projets, liste et détail des médias (recherche insensible aux accents,
  filtres, `ids`, tri, pagination par curseur, `total` sur demande), liens signés (`file`, `preset`,
  `derived`), catalogue des erreurs et spécification OpenAPI 3.1 générée depuis les schémas zod.
- Socle : middleware `api-v1` (identifiant de requête, CORS par projet et preflight, authentification
  Bearer, limitation de débit par seau à jetons), erreurs RFC 9457, garde-fous `SECRET_IN_BROWSER` et
  `ORIGIN_NOT_ALLOWED`, projet archivé refusé, dernière utilisation des identifiants (≤ 5 min).
- Caches : identités des jetons (60 s, invalidées à la révocation, la rotation, la suppression et à la
  modification du compte), état des projets (60 s), métadonnées de diffusion et dérivés, révisions par
  espace → ETag et 304 (listes sans requête) ; SQLite en mode WAL.
- Diffusion `/m/` : identifiant d'API pour les médias privés, requêtes partielles (`Range` → 206/416,
  aussi sous S3), preflight `OPTIONS`.
- Interface : réglage « Liste publique » d'un projet (journalisé), encart « Accès à l'API » (adresse du
  projet, lien vers la spécification) sur l'onglet des clés ; recherche de l'administration insensible
  aux accents.
- Correctif : pendant le rendu serveur, le plugin `$api` transmet aussi l'hôte et le protocole
  d'origine (sans `NUXT_SITE_URL`, les adresses absolues valaient `http://localhost`).
- Tests Vitest : portées des identifiants, curseurs, plages, recherche, limiteur, LRU, ETag, contrat
  Media v1 (URL signées vérifiées), paramètres, problèmes, OpenAPI (89 tests au total).

**Vérifié** : typecheck, 89 tests Vitest, i18n (727 clés), contrastes, migrations (`--check`), build de
production. 97 scénarios d'API sur la build de production : authentification (absent, mal formé,
inconnu, révoqué, expiré, jeton dans l'URL, secret depuis un navigateur, origine de la clé publique,
cookie ignoré), `/me`, projets (périmètre des clés et des jetons, pagination, 404 hors périmètre),
médias (ordre, contrat, URL signées alignées, recherche sans accents, filtres, total, curseurs et
erreurs de curseur, `ids`, paramètres invalides), ETag/304 et invalidation par écriture, clé publique
et liste publique, CORS et preflight, liens signés (fichier, `derived` jamais l'original, préréglage,
média public, refus de la clé publique), `/m/` avec Bearer (secret, public, navigateur, invalide, autre
compte, bibliothèque), dernière utilisation, `Range` (206, suffixe, 416, `If-Range`), OpenAPI, 404,
archivage, désactivation et révocation immédiates, 429 (quota et échecs d'authentification). B1
(58) et B2 (91) rejoués sans régression. Interface : réglage « Liste publique » enregistré et
journalisé, adresse de l'API correcte dès le rendu serveur ; axe-core : 0 violation WCAG 2.2 AA sur
les pages modifiées en fr/en × clair/sombre.
Non vérifié : un vrai bucket S3 pour les plages ; PostgreSQL et MySQL/MariaDB réels pour la migration.

**Limites connues**
- Caches et limiteurs en mémoire du processus : pas encore de second niveau partagé (Redis) pour le
  multi-instances ; `X-Forwarded-For` non pris en compte derrière un proxy.
- Pas de cache serveur des résultats de liste (l'ETag évite déjà la requête quand rien n'a changé) ni
  d'option « liste publique cachable » par un CDN.
- `/m/` : pas de limitation de débit, ni de décompte des identifiants refusés.
- Écritures (envoi, modification, suppression, duplication) et jetons délégués : étape B4 ; dossiers : B5.

**Après `git pull`**
```bash
pnpm install
pnpm db:migrate     # liste publique, révisions, colonnes de recherche + client Prisma
```
Au premier démarrage, les médias existants sont indexés pour la recherche (message dans le journal du serveur).

### Étape 8 — 2026-09-29 — Phase B4 : API v1 en écriture et jetons délégués

**Cadre** : architecture validée de la phase B (§ 2.2, § 4.5, § 6.2, § 9.2 ; décisions D5, D7, D9, D14).

**Ajouté**
- Migration `b4_api_write` (3 fournisseurs) : provenance des médias envoyés par l'API
  (`Media.uploadedByTokenId`, `Media.uploadSubject`) et compteur `DelegatedTokenUsage` (contrainte
  `maxFiles` des jetons délégués). Rien à reprendre à la main.
- API v1 en écriture (§ 9.10) : envoi multipart, modification, remplacement du fichier, mise à la
  corbeille, duplication (vers le projet, un autre projet ou la bibliothèque selon l'identifiant) ;
  en-têtes `Location` et `ETag` ; débit des envois (60 par minute et par identifiant) ; erreurs de
  fichier au format RFC 9457 ; `projectId` ajouté au contrat `Media`.
- Jetons délégués `sm_dt_` : émission par une clé secrète ou un jeton personnel (portées ⊆ émetteur,
  1 à 60 min, sujet final, origine, contraintes d'envoi), vérification sans base (HMAC, clé dérivée du
  secret de signature), émetteur relu à chaque requête (sa révocation les invalide), origine contrôlée,
  débit par émetteur et IP ; utilisables aussi sur `/m/` ; `/me` les décrit sans révéler l'émetteur.
- Identité unique de l'appelant (`server/lib/access/principal.ts`) pour l'API et la diffusion ; le
  journal d'audit enregistre l'identifiant (`tokenId`), le type et le sujet des actions faites par l'API.
- Traitements d'images : file bornée (`NUXT_MEDIA_PROCESSING_CONCURRENCY` / `_QUEUE`, 503
  `SERVER_BUSY` + `Retry-After`) et pré-génération de l'aperçu après envoi, remplacement ou duplication.
- Interface : provenance d'un média (identifiant d'API, utilisateur de l'application) sur sa fiche ;
  auteur « identifiant d'API » et jeton délégué dans le journal d'audit ; message « serveur occupé ».
- Tests Vitest : jetons délégués (format, signature, rotation, altérations, échéance, portées,
  demande d'émission), file des traitements, champs d'écriture, duplication, erreurs de fichier,
  OpenAPI (105 tests au total).

**Vérifié** : typecheck, 105 tests Vitest, i18n (738 clés), migrations (`--check`), build de
production. 94 scénarios d'API sur la build de production : envoi (contrat, `Location`, URL signées,
aperçu pré-généré, provenance, ETag de liste invalidé, visibilité par défaut, portée absente, clé
publique, autre projet, sans fichier, SVG, PNG corrompu, champ inconnu, JSON au lieu de multipart,
secret depuis un navigateur), modification (effacement, recherche à jour, journal avec l'identifiant
et le propriétaire d'un jeton personnel, refus), remplacement (version, redirection de l'ancienne URL,
type refusé), duplication (même projet, autre projet, bibliothèque, refus), corbeille, jetons délégués
(émission et refus, échéance bornée par l'émetteur, `/me`, CORS et origine, contraintes de type, de
taille, de nombre et de visibilité, lecture des médias privés, `/m/`, jeton d'envoi seul, altération,
expiration, révocation de l'émetteur, désactivation du propriétaire), débit des envois (429 au-delà de
60). File des traitements saturée (concurrence 1, sans file) : 503 `SERVER_BUSY` + `Retry-After`, puis
succès. B1, B2 et B3 (97) rejoués sans régression. Interface : provenance et journal affichés,
axe-core : 0 violation WCAG 2.2 AA en fr/en × clair/sombre sur la fiche média et le journal d'audit.
Non vérifié : PostgreSQL et MySQL/MariaDB réels pour la migration ; un vrai bucket S3.

**Limites connues**
- Pas de restauration, de suppression définitive ni de déplacement par l'API (administration) ; pas
  d'`If-Match` (concurrence optimiste des PATCH) ni de clé d'idempotence pour les envois.
- Contrainte « dossier » des jetons délégués et paramètre `folderId` : étape B5 (dossiers).
- Pas de révocation individuelle d'un jeton délégué (durée courte, ou révoquer l'émetteur) ; l'émission
  n'est pas journalisée.
- Compteurs, limiteurs et file des traitements en mémoire du processus (une instance) ; la
  pré-génération s'efface quand des traitements attendent.

**Après `git pull`**
```bash
pnpm install
pnpm db:migrate     # provenance des médias, compteur des jetons délégués + client Prisma
```

### Étape 9 — 2026-09-29 — Phase B5 : dossiers

**Cadre** : architecture validée de la phase B (§ 11 ; décision D11). Aucune migration : les tables
`Folder` et `Media.folderId` existaient depuis l'étape 1.

**Ajouté**
- Règles de l'arborescence (`shared/utils/folders.ts`, pur et testé) : noms uniques parmi les voisins
  (casse ignorée), 8 niveaux, pas de cycle, 1 000 dossiers par espace ; chemins, descendants, ordre
  d'affichage.
- Service des dossiers (`server/lib/folders/service.ts`) : arbre en cache par révision de l'espace,
  création, renommage, déplacement, suppression (vide, ou avec remontée du contenu dans le parent),
  rangement groupé de médias, filtre des listes (dossier, sous-dossiers compris ou non). Chaque
  changement incrémente la révision de l'espace (ETag des listes).
- Administration (§ 9.11) : routes `folders`, filtre `folder`/`recursive` de la médiathèque,
  rangement groupé (`PATCH /api/admin/media`), `folderId` à l'envoi, à la modification, à la
  duplication et au déplacement entre espaces.
- API v1 : `GET/POST /projects/:id/folders`, `PATCH/DELETE /projects/:id/folders/:folderId`,
  `?folder=<id>|root&recursive=true` sur la liste des médias, `folderId` à l'envoi, au `PATCH` et à la
  duplication, contrainte `upload.folderId` des jetons délégués ; codes `FOLDER_*` ; OpenAPI à jour.
- Interface : fil d'Ariane, sous-dossiers avec leur nombre de médias, boîtes de dialogue « Nouveau
  dossier », « Renommer », « Déplacer », « Supprimer », envoi dans le dossier affiché, case « Inclure
  les sous-dossiers », mode sélection pour ranger plusieurs médias ; fiche média : dossier affiché,
  déplacement et duplication vers un espace et un dossier. `UiDialog` accepte `return-focus` (le focus
  va au titre « Dossiers » après la suppression du dossier affiché).
- Tests Vitest : arborescence (chemins, descendants, cycles, profondeur, données incohérentes, noms),
  schémas de l'administration et de l'API (114 tests au total).

**Vérifié** : typecheck, 114 tests Vitest, i18n (799 clés), contrastes, migrations (`--check` : aucun
changement), build de production. 71 scénarios sur la build de production : création (racine,
sous-dossier, EDITOR de projet, homonymes, nom invalide, parent d'un autre espace, 9e niveau),
invisibilité pour un autre compte, envoi dans un dossier, listes (racine, dossier, récursive,
dossier étranger), nombre de médias, rangement unitaire et groupé, renommage, déplacement (cycle,
racine, profondeur), suppression (non vide, remontée du contenu, homonyme, vide, corbeille),
duplication et déplacement entre espaces vers un dossier, limite de 1 000 dossiers ; API v1 (arbre,
ETag et 304, clé publique refusée, création, droits, champs stricts, cycle, renommage, envoi, filtres
`folder`/`root`/`recursive`, ETag d'une liste récursive après déplacement d'un dossier, `PATCH`,
duplication, suppression), jeton délégué à dossier imposé, projet archivé. B1, B2, B3 (97) et B4 (94)
rejoués sans régression. Interface (clics réels) : création avec erreur d'homonyme puis succès, focus
et annonces, navigation, rangement groupé, suppression avec remontée, déplacement depuis la fiche,
dossier introuvable ; axe-core : 0 violation WCAG 2.2 AA en fr/en × clair/sombre (vue d'un dossier,
mode sélection, boîtes de dialogue, fiche média, bibliothèque).
Non vérifié : PostgreSQL et MySQL/MariaDB réels (transactions des dossiers).

**Limites connues**
- Unicité des noms contrôlée par l'application : deux créations simultanées du même nom peuvent passer.
- Pas de glisser-déposer vers un dossier, pas d'arbre complet dans une barre latérale (fil d'Ariane et
  sous-dossiers), pas de déplacement d'un dossier vers un autre espace.
- Les opérations sur les dossiers ne sont pas journalisées (comme la corbeille et les envois).

**Après `git pull`**
```bash
pnpm install
pnpm db:migrate     # aucune migration, régénère seulement le client Prisma
```

### Étape 10 — 2026-10-01 — Documentation interactive de l'API

**Cadre** : demande de l'utilisateur — page de l'espace connecté documentant l'API de façon interactive,
générée par OpenAPI depuis le code des routes (Nitro), affichée avec Scalar, avec les vraies valeurs
(serveur, projets, identifiants, variables d'environnement) et une clé pré-injectée pour tester.

**Ajouté**
- Génération (§ 9.12) : `nitro.experimental.openAPI` ; `defineRouteMeta` sur les 18 routes de l'API v1
  (textes français + `x-i18n` anglais, portées, identifiants admis, codes d'erreur) ; assemblage dans
  `server/lib/api/openapi.ts` (réécrit : composants `parameters`, `requestBodies`, `responses`,
  `headers` ; erreurs par code avec exemples ; contrôles d'incohérence) ; descriptions des schémas zod
  bilingues (`doc(fr, en)`) ; `GET /api/v1/openapi.json?lang=fr|en` ; schémas `apiOpenApiQuerySchema`,
  `apiErrorCatalogSchema` ; bornes « entier sûr » de zod retirées du document. Interfaces CDN de Nitro
  désactivées.
- Page `/admin/api` + entrée « Documentation de l'API » de la barre latérale ; permission `api:docs`
  (ADMIN, DEVELOPER) ; `GET /api/admin/api-docs` (projets, clés valables : valeur des clés publiques,
  préfixe des clés secrètes — mêmes règles que `GET /api/admin/projects/:id/keys`) ; composant
  `AdminApiReference` (Scalar embarqué, chargé à la demande) ; clé publique injectée ; exemples de
  `projectId` ; fichier `.env` par projet et environnement.
- Jetons de couleur `--code-blue|orange|purple|teal` (méthodes HTTP, coloration du code) vérifiés par
  `pnpm a11y:contrast` (51 couples) ; `UiButton` accepte `external` ; la mise en page admin accepte
  `providesMain` (page qui fournit son propre `<main>`).
- Tests : `tests/openapi.test.ts` (lit les vrais `defineRouteMeta`, 7 tests) remplace l'ancien test
  OpenAPI ; matrice des permissions mise à jour (120 tests au total).

**Vérifié** : typecheck, 120 tests Vitest, i18n (835 clés), contrastes (51 couples × 2 thèmes),
migrations (`--check`), build de production (18 opérations extraites par Nitro dans le bundle, aucune
route `/_openapi.json`, `/_scalar`, `/_swagger` ; Scalar dans un morceau chargé seulement par la
page). Sur le serveur de développement (la build ne démarre pas sur ce poste, voir Dépannage) :
28 contrôles HTTP (le 29e, absence de `/_openapi.json`, ne vaut que pour la build : vérifié dans le bundle) — spécification fr/en, langue inconnue, références toutes résolues, extensions
retirées, CORS ouvert, cache ; contexte : 401 sans session, 403 EDITOR, 200 DEVELOPER, valeur de la clé
publique, jamais celle d'une clé secrète ; clé injectée depuis la page : liste et `/me` 200, écriture
refusée ; clé secrète refusée depuis un navigateur, acceptée depuis un serveur). Interface (comptes
jetables, clics réels) : requête d'essai « Liste des médias » avec la clé injectée → 200 et le média du
projet ; exemples de code avec l'URL et l'identifiant réels ; aucune requête hors de l'installation
(250 ressources, une seule origine) ; aucune clé en `localStorage` ; navigation aller-retour sans
erreur ; axe-core : 0 violation en fr/en × clair/sombre sur la page et la référence.
Non vérifié : démarrage de la build de production (module natif argon2 bloqué par Windows sur ce poste),
lecteurs d'écran réels.

**Limites connues**
- Les clés secrètes et jetons personnels ne peuvent pas être pré-injectés (valeurs jamais relisibles,
  refusées depuis un navigateur) : la clé injectée est une clé publique (lecture des médias publics).
  Un « jeton de console » lié à la session a été étudié puis écarté, car il assouplit le garde-fou
  `SECRET_IN_BROWSER` (voir « Maintenance — 2026-10-02 »).
- Fenêtre « Tester la requête » de Scalar : écarts d'accessibilité dans le code de Scalar (§ 10.3).
- Deux titres `h1` sur la page (le titre de la page et celui de la spécification, rendu par Scalar
  dans son repère `main`).
- L'API d'administration (`/api/admin/**`, cookie de session) n'est pas documentée : interne à
  l'interface, hors contrat public ; la diffusion `/m/…` est décrite dans l'introduction de la
  spécification, pas comme opération.
- Migration `20261001154517_api_console` (colonne `AccessToken.sessionId`, jamais utilisée par le code),
  préparée pour le jeton de console : **colonne retirée le 2026-10-02** par la migration
  `drop_api_console` (voir « Maintenance — 2026-10-02 »).

**Après `git pull`**
```bash
pnpm install          # @scalar/api-reference
pnpm db:migrate       # migration api_console (colonne AccessToken.sessionId, voir ci-dessus)
```

### Étape 11 — 2026-10-01 — Phase C1 : moteur de transformation et diffusion

**Cadre** : phase C (transformations d'images à la demande) présentée puis **validée** par l'utilisateur
(décisions CD1 à CD12, `.claude/architecture-phase-c.md`), livrée en quatre sous-étapes. C1 : le moteur
et la diffusion par `/m/`, sans migration ni interface.

**Ajouté**
- `shared/utils/transforms.ts` (pur, partagé) : formats, paramètres, préréglages intégrés (`preview`,
  `full`) et noms réservés, `parseTransformation` (bornes, erreurs nommées), forme canonique
  (`formatTransformation`, ordre d'exécution, `dpr` appliqué), `parseTransformFormat`.
- `server/lib/media/transform-plan.ts` (pur) : opération effective selon l'image (zone vérifiée après
  rotation, jamais d'agrandissement en gardant le rapport demandé, borne de sortie, recadrage par point
  d'intérêt prêt pour C3, aplatissement JPEG, qualité par format) ; son identifiant regroupe les
  demandes qui produisent la même image.
- `server/lib/media/delivery-path.ts` (pur) : grammaire de `/m/` (original, préréglage, paramètres),
  301 vers la forme canonique, 400 `INVALID_TRANSFORM`, droit signé sans format.
- Gestionnaire d'images : `transform(source, plan)` remplace `preview` (pipeline sharp générique ;
  miroir et rotation réordonnés : sharp applique toujours le miroir avant la rotation) ; AVIF effort 2
  (mesuré : 4 fois plus rapide que l'effort 4 pour ~30 % de poids en plus).
- `variants.ts` : dérivés par opération effective, quota par version, rappel de débit avant une
  génération libre, dédoublonnage garde-fous compris ; `transform-settings.ts` (variables
  `NUXT_MEDIA_TRANSFORM_*`) ; route `/m/` (redirections 301 et 302 avec la transformation, débit par IP,
  `Retry-After`) ; `delivery.ts` : signature permanente (média public), mode d'accès détaillé.
- Signatures : droit `t:<transformation canonique>`, signature permanente (`perm`, sans `exp`) pour un
  dérivé précis.
- Plugin `variant-keys` : reprise au démarrage des aperçus existants (renommés, fichiers conservés).
- Codes `INVALID_TRANSFORM` (400), `TRANSFORM_QUOTA` (429).
- Tests : `tests/transforms.test.ts` (analyse, forme canonique, chemins, opération effective),
  `tests/image-transform.test.ts` (pipeline sharp réel : 16 combinaisons rotation × miroir, orientation
  EXIF, 4 formats), signatures (`t:`, permanentes) — 164 tests au total.

**Vérifié** : typecheck, 164 tests Vitest, i18n, contrastes, migrations (`--check` : aucune), build de
production ; **66 scénarios HTTP** sur la build de production (original et aperçu inchangés, aperçu
pré-généré sous son nouvel identifiant, formats par l'extension, ETag/304/HEAD/Range, non-agrandissement,
fichier partagé, 301 canoniques avec signature conservée, erreurs 400/404, orientation EXIF, 6 demandes
simultanées → un seul dérivé, médias privés et signatures exactes / `derived` / permanentes / admin /
expirées, corbeille, remplacement → 302 et dérivés supprimés, quota de 50, débit de 60/min avec
`Retry-After`, exemptions) ; scénarios B1 à B5 rejoués sans régression ; journaux du serveur sans
erreur ; aperçu existant de la base de développement repris sans régénération.

**Écarts par rapport au document validé** : ordre canonique aligné sur l'ordre d'exécution
(`r, flip, crop, …` au lieu de `crop, r, flip, …`) ; `q_` et `bg_` explicites conservés dans la forme
canonique (elle ne dépend pas du format, condition de CD5) ; sortie bornée à 4096 px même pour `full`
(image réduite plutôt que refusée) ; aperçus existants repris au démarrage (plutôt que par la migration
de C2).

**Limites connues**
- Débit par IP en mémoire du processus (comme les autres limiteurs) ; derrière un CDN, à relever.
- Un préréglage inconnu répond 404 ; les préréglages personnalisés et la politique par projet arrivent
  en C2, le point d'intérêt en C3 (`g_focal` = centre d'ici là).
- Pas encore de lien signé de transformation par l'API (C3) : les signatures `t:` et permanentes sont
  vérifiées mais pas encore délivrées.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance
pnpm db:migrate       # aucune migration
```

### Étape 12 — 2026-10-01 — Phase C2 : politique des transformations et préréglages

**Cadre** : deuxième sous-étape de la phase C (architecture validée, `.claude/architecture-phase-c.md`) :
politique des transformations libres par espace, préréglages globaux et de projet, page « Réglages »
de l'installation, onglet « Transformations » des projets.

**Ajouté**
- Migration `c2_transforms` (3 fournisseurs) : `Project.transformPolicy` (`OPEN` par défaut),
  modèles `TransformPreset` (`projectId` null = global, cascade avec le projet) et `Setting`
  (clé-valeur, ex. `transforms.libraryPolicy`).
- `shared/utils/transforms.ts` : politiques, `freeTransformAllowed`, `parsePresetDefinition` (ni `crop`,
  ni transformation vide), codes `TRANSFORM_ERROR_CODES`, niveaux et limites des préréglages ;
  `shared/schemas/transforms.ts` (politique, préréglage, formulaire par champs → forme canonique).
- `server/lib/transforms/service.ts` : politique de la bibliothèque et préréglages globaux (cache
  60 s), état des projets étendu (politique, préréglages), résolution intégré → projet → global,
  écritures en transaction (homonymes, limite de 100), invalidation des caches ; `server/utils/
  transforms.ts` (droits par niveau).
- Diffusion : politique appliquée aux paramètres libres (403 `TRANSFORM_NOT_ALLOWED`), préréglages
  globaux et de projet, cache `public, max-age=604800` revalidé pour un préréglage modifiable
  (`NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE`).
- Administration : routes `transforms` et `presets` ; permission `settings:manage` (ADMIN) ; page
  « Réglages » (barre latérale) ; onglet « Transformations » des projets ; composant
  `AdminTransformSettings` (politique, préréglages avec dialogues, limites du serveur) ; journal
  d'audit (catégories « Préréglages » et « Réglages », détails).
- API v1 : `GET /api/v1/projects/:projectId/presets` (étiquette « Transformations » de la
  spécification), `transformPolicy` dans le contrat `Project`.
- Page d'accueil : exemple d'URL de transformation aligné sur la vraie grammaire.
- Tests : décisions de politique, définitions de préréglages, formulaire (170 tests Vitest au total).

**Vérifié** : typecheck, 170 tests Vitest, i18n (961 clés), contrastes, migrations (`--check`), build
de production ; **58 scénarios HTTP** sur la build (droits par rôle et par niveau, validation des
préréglages, priorité projet → global, masquage, modification et renommage visibles sous la même URL,
suppression, politiques `SIGNED` et `PRESETS` avec chaque type de signature, bibliothèque, API v1 avec
une clé publique, ETag, OpenAPI, journal) ; C1 (66) et B1 à B5 rejoués sans régression ; interface
avec de vrais clics (politique, création avec erreurs de champ, nom déjà pris, modification avec
borne dépassée, préréglage global masqué, suppression avec focus sur la liste, journal) ; axe-core :
0 violation en fr/en × clair/sombre sur l'onglet et la page Réglages, dialogues compris (avec erreurs) ;
largeur de téléphone sans défilement horizontal.

**Limites connues**
- Unicité des noms de préréglages contrôlée par l'application (deux créations simultanées du même nom
  peuvent passer, comme pour les dossiers).
- Les fichiers générés par un préréglage modifié ou supprimé restent jusqu'au prochain remplacement du
  média (purge des dérivés inutilisés : plus tard).
- Pas encore d'aperçu du rendu dans le dialogue d'un préréglage (générateur d'URL : C4).

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance
pnpm db:migrate       # migration c2_transforms
```

### Maintenance — 2026-10-02 — Retrait de la colonne inutilisée `AccessToken.sessionId`

**Cadre** : décision en suspens depuis l'étape 10. Le « jeton de console » (jeton personnel lié à la
session, admis dans le navigateur) a été écarté : il assouplissait le garde-fou `SECRET_IN_BROWSER`
(aucun secret durable dans un navigateur, architecture phase B § 4.7). Sa colonne, jamais utilisée par
le code, est retirée.

**Fait**
- Migration `drop_api_console` (3 fournisseurs) : suppression de la clé étrangère, de l'index et de la
  colonne `AccessToken.sessionId` ; relation `Session.consoleTokens` retirée du schéma. La migration
  `api_console`, déjà publiée, est **conservée** dans l'historique (une base qui l'a appliquée reste
  cohérente) : l'historique ne fait qu'avancer.
- Base de développement : sauvegarde préalable, migration appliquée, données intactes (contrôle
  d'intégrité et des clés étrangères de SQLite).

**Vérifié** : migrations (`--check`), typecheck, tests Vitest, build de production, scénarios B2
(identifiants d'API) et B3 (API v1 en lecture) rejoués.

**Piste** (sans colonne nouvelle) : requêtes d'essai authentifiées dans `/admin/api` par un **jeton
délégué** de quelques minutes émis par l'administration (compatible avec `SECRET_IN_BROWSER`).

**Après `git pull`**
```bash
pnpm db:migrate       # migration drop_api_console
```

### Étape 13 — 2026-10-02 — Phase C3 : API des transformations et point d'intérêt

**Cadre** : troisième sous-étape de la phase C (architecture validée, `.claude/architecture-phase-c.md`) :
les applications reçoivent de quoi construire leurs URL de dérivés (gabarit, liens signés unitaires et par
lot) et chaque image peut avoir un point d'intérêt.

**Ajouté**
- Migration `c3_focal_point` (3 fournisseurs) : `Media.focalX`, `Media.focalY`.
- Point d'intérêt : utilisé par le recadrage `focal` ; le changer crée une nouvelle version (URL nouvelles,
  anciennes redirigées, dérivés de l'ancienne version supprimés) ; conservé au remplacement, repris à la
  duplication ; `PATCH` de l'administration et de l'API v1.
- API v1 : `urlTemplate` et `focalPoint` dans le contrat `Media` ; `signed-url` étendu (cibles `preset` pour
  tout préréglage, `transform` canonisée, `format`, signatures permanentes en politique `signed`) ; nouvelle
  route `POST /projects/:projectId/signed-urls` (lot de 100, erreurs par lien) ; codes `INVALID_TRANSFORM`,
  `TRANSFORM_NOT_ALLOWED`, `PRESET_NOT_FOUND`, `TRANSFORM_QUOTA` au catalogue ; OpenAPI : opération du lot et
  section « Transformations d'images » (grammaire de `/m/`).
- `server/lib/api/signature-plan.ts` (décision de signature, pure et testée) et `signed-urls.ts`.
- Fiche média : section **Point d'intérêt** (`AdminFocalPointEditor` : clic sur l'image, curseurs au clavier,
  aperçus 1:1 et 16:9 calculés comme le serveur).
- Tests : point d'intérêt (arrondi, aperçu de l'interface comparé au recadrage du serveur), décisions de
  signature, schémas des liens unitaires et par lot, contrat `Media` (176 tests Vitest au total).

**Vérifié** : typecheck, 176 tests Vitest, i18n (978 clés), contrastes, migrations (`--check`), build de production ;
**81 scénarios HTTP** sur la build (gabarit public et privé rempli, recadrage vérifié au pixel avant et après
le point, redirections et suppression des anciens dérivés, arrondi, même point, effacement, validation,
corbeille, duplication, liens dans les trois politiques avec chaque identifiant, signature permanente et cache
immuable, même signature pour un autre format, lot avec erreurs par lien et 100 liens, OpenAPI et catalogue) ;
C1 (66), C2 (58) et B1 à B5 rejoués sans régression (le contrôle du débit des envois de B4,
sensible au temps, est repassé seul) ; interface avec de vrais clics et au clavier (clic sur
l'image, curseurs, effacer, enregistrer : nouvelle version) ; axe-core : 0 violation en fr/en × clair/sombre ;
largeur de téléphone sans défilement horizontal.

**Limites connues**
- Changer le point d'intérêt jette tous les dérivés de la version, même ceux qu'il n'affecte pas (régénérés à
  la demande).
- Pas de journal des changements de point d'intérêt (comme les remplacements de fichier).
- En politique `signed`, `urlTemplate` d'un média public n'est pas signé : les paramètres libres passent par
  `signed-url` / `signed-urls`.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance
pnpm db:migrate       # migration c3_focal_point
```

### Étape 14 — 2026-10-02 — Phase C4 : générateur d'adresses

**Cadre** : dernière sous-étape de la phase C (architecture validée, `.claude/architecture-phase-c.md`) :
composer une image transformée depuis sa fiche, la voir, copier son adresse et des exemples d'intégration.
**La phase C est terminée.**

**Ajouté**
- Route d'aperçu `GET /api/admin/media/:id/transform` : rendu à la volée dans la file des traitements, jamais
  enregistré ni compté dans le quota ; dimensions et opération effective en en-têtes.
- Route `POST /api/admin/media/:id/links` : adresses construites comme les liens de l'API (politique de
  l'espace, bibliothèque comprise ; signature permanente ou à échéance selon le cas ; erreur par lien).
- Options du générateur dans la fiche (`transforms`) ; résolution commune « préréglage ou paramètres »
  (`resolveTransformRequest`) pour l'aperçu, les adresses et l'API v1.
- Fiche média : section **Générateur d'adresses** (`AdminUrlGenerator`) ; champs de transformation partagés
  avec le dialogue des préréglages (`AdminTransformFields`) ; extraits HTML (`shared/utils/snippets.ts`).
- Tests : champs, requêtes d'aperçu et de liens, extraits HTML (échappement, ordre des formats, 2x)
  (179 tests Vitest au total).

**Vérifié** : typecheck, 179 tests Vitest, i18n (1015 clés), contrastes, migrations (`--check`), build de
production ; **39 scénarios HTTP** sur la build (options de la fiche, aperçu dans chaque format, préréglages,
non-agrandissement, aucun dérivé enregistré, erreurs avec le champ fautif, droits par rôle, adresses dans les
trois politiques et dans la bibliothèque, lien privé à échéance servi, erreurs par lien, corbeille) ; C1 à C3
et B1 à B5 rejoués sans régression (le contrôle du débit des envois de B4 tient maintenant compte des jetons
regagnés pendant la boucle : 62 envois acceptés en 2,7 s, conformément au limiteur) ; interface avec de
vrais clics et au clavier (paramètres, champ invalide, préréglage, format, validité d'un lien privé,
politique « préréglages seulement », mise à jour après un nouveau point d'intérêt ; bouton de copie : le
navigateur de test refuse le presse-papiers, le message d'échec est bien annoncé) ; dialogue des
préréglages revérifié avec les champs partagés ; axe-core : 0 violation en fr/en × clair/sombre ; largeur
de téléphone sans défilement horizontal.

**Limites connues**
- Le générateur ne propose ni zone de recadrage (`crop`) ni densité (`dpr`) : l'API les accepte.
- Pas d'aperçu dans le dialogue d'un préréglage (aucun média de référence).
- Chaque aperçu est recalculé (seul le navigateur le garde 5 minutes) : sur une très grande image, il
  occupe un traitement à chaque changement de réglage (file bornée, § 8).

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance, aucune migration
```

### Étape 15 — 2026-10-03 — Générateur d'adresses : zone de recadrage, densité, formulaires

**Cadre** : complément de C4 demandé par l'utilisateur : zone de recadrage et densité dans le générateur,
formulation des champs plus explicite. Aucune route ni migration nouvelle (l'API et `/m/` acceptaient
déjà `crop` et `dpr`).

**Ajouté**
- Zone de recadrage (`AdminCropSelector`) : deux clics sur deux coins opposés (pointeur unique), quatre
  champs en pixels, image affichée avec la rotation et le miroir choisis, zone en surbrillance ; annonce
  vocale des actions à la souris seulement (pas à chaque frappe).
- Densité de pixels (1x à 3x, pas de 0,5) : adresse en dimensions multipliées, taille d'affichage et densité
  réelle sous l'aperçu ; `srcset` 1x/2x/3x (chaque densité seulement si elle apporte au moins une
  demi-densité, d'après la dimension la plus contrainte du cadre).
- Champs regroupés par thème (Taille, Cadrage, Rendu, Orientation, Sortie) avec des aides qui décrivent le
  choix courant ; ajustement et ancrage affichés quand ils agissent ; aperçu de la couleur de fond ; formats
  décrits (« WebP — recommandé », « AVIF — le plus léger »…). Le dialogue des préréglages profite des mêmes
  champs et affiche ses paramètres dès la saisie (sans attendre le nom).
- `shared/schemas/transforms.ts` : `parseCropFields`, `rotatedSize`, `cropParameter`, `cropFieldValues`,
  `TRANSFORM_DENSITIES` ; `imageSnippets` reçoit une liste de densités. 183 tests Vitest.

**Vérifié** : typecheck, 183 tests Vitest, i18n (1067 clés), contrastes, migrations (`--check`), build ;
**45 scénarios HTTP** de C4 (dont zone, densité, zone hors image, zone dans l'image tournée, adresses
canoniques 1x/2x/3x) — sur le serveur de développement, la build ne démarrant plus (voir ci-dessous) ;
interface : sélection en deux clics, saisie au clavier avec erreurs sur les champs, rotation (bornes de
la zone échangées), densité (2x atteinte, densité réelle 1,2x, image trop petite), ajustements, dialogue des
préréglages ; axe-core : 0 violation en fr/en × clair/sombre (zone sélectionnée et champ invalide compris) ;
largeur de téléphone sans défilement horizontal.

**À noter** : Windows Smart App Control bloque de nouveau la copie de `argon2` dans `.output` (la build se
termine, `pnpm start` échoue au démarrage ; § 14) : vérifications faites avec `pnpm dev`.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance, aucune migration
```

### Étape 16 — 2026-10-03 — Rôle Gestionnaire et répartition des responsabilités

**Cadre** : demande de l'utilisateur : un rôle **Gestionnaire**, administrateur limité aux projets qu'il a
créés ou auxquels il est affecté, qui invite des développeurs et des éditeurs ; un développeur ne crée
plus de projets et n'accède qu'aux projets auxquels il est affecté. Décisions validées : un gestionnaire
membre d'un projet en est **toujours propriétaire** ; bibliothèque **en lecture pour tous, gérée par
l'ADMIN** ; le gestionnaire **suit ses invitations** (lien régénérable tant qu'elle n'est pas acceptée) ;
les développeurs propriétaires d'un projet sont **promus gestionnaires** à la migration.

**Modifié / ajouté**
- `shared/utils/permissions.ts` : rôle `MANAGER` (`ROLES` dans l'ordre ADMIN, MANAGER, DEVELOPER,
  EDITOR), permissions `library:read` et `users:invite`, plafond `DEVELOPER` → `DEVELOPER`,
  `PROJECT_ROLE_FLOOR` (MANAGER → OWNER), `clampProjectRole`, `invitableRoles` ; bibliothèque :
  `media:read` seul hors ADMIN (§ 9.1).
- Schéma : enum `Role` + `MANAGER`, `User.invitedById` (`onDelete: SetNull`, index). Migration
  `20261003194322_manager_role` (3 fournisseurs ; PostgreSQL : type recréé pour pouvoir utiliser la
  nouvelle valeur dans la reprise) : développeurs propriétaires → gestionnaires, adhésions des
  gestionnaires → `OWNER`, autres adhésions ramenées au plafond.
- Invitations (`POST /api/admin/users`, `users:invite`) : rôle parmi `invitableRoles`, projets et rôle de
  projet (obligatoires pour un gestionnaire), mot de passe récent, audit `user.created` (+ projets) et
  `member.added` ; liste, fiche et lien limités aux invités du gestionnaire (§ 9.4).
- Changement de rôle de plateforme : adhésions normalisées dans la même transaction. `LAST_OWNER`
  compte les propriétaires effectifs. Suppression d'un projet vers la bibliothèque : ADMIN seulement
  (403 `LIBRARY_NOT_ALLOWED`). Jeton personnel avec la bibliothèque : `library:read` suffit.
- Interface : « Mes invitations » dans la barre latérale du gestionnaire ; formulaire d'invitation (rôles
  permis, projets, rôle dans ces projets — texte fixe s'il n'y en a qu'un) ; fiche en lecture pour le
  gestionnaire ; colonne « Invité par » et section « Projets » pour l'administrateur ; membres : pas de
  menu de rôle pour un gestionnaire (note « administre tout projet dont il est membre ») ; dialogue de
  suppression d'un projet réduit à la suppression définitive hors ADMIN ; aide « lecture seule » pour la
  bibliothèque d'un jeton personnel ; journal : projets d'une invitation. Libellé manquant
  `permissions.settings.manage` du tableau de bord ajouté (absent depuis C2).
- 199 tests Vitest (matrice des rôles, plancher, invitations, bibliothèque en lecture, schéma d'invitation).

**Vérifié** : typecheck, 199 tests, i18n (1115 clés), contrastes, migrations (`--check`) ; migration
rejouée sur une copie de la base avec un développeur propriétaire (11 contrôles) ; **79 scénarios HTTP**
(création de projets, invitations et refus, confirmation du mot de passe, suivi, membres, plancher et
plafond, normalisation, `LAST_OWNER`, bibliothèque, suppression d'un gestionnaire) ; non-régression
B1–B5 et C1–C4 rejouée, le propriétaire des projets de test étant désormais un gestionnaire : seules
changent les attentes voulues (rétrogradation d'un gestionnaire, versement dans la bibliothèque par un
éditeur, un gestionnaire ou un jeton). Interface (gestionnaire et administrateur) : parcours d'invitation,
erreurs reliées aux champs, fiches, membres, bibliothèque, dialogue de suppression ; axe-core : 0 violation
en fr/en × clair/sombre ; largeur de téléphone sans défilement horizontal.

**Non vérifié** : `pnpm build` (votre serveur de développement tournait et partage `.nuxt` ; le démarrage
de production reste bloqué par Smart App Control, § 14).

**Limites connues / suites possibles**
- La recherche de comptes à ajouter (`candidates`) montre tous les comptes actifs (nom, e-mail) à un
  propriétaire de projet, gestionnaire compris.
- Pas de journal d'audit par projet pour un gestionnaire (`audit:read` reste à l'ADMIN).
- Toujours pas d'envoi d'e-mail : le lien d'invitation se transmet à la main.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance
pnpm db:migrate       # migration manager_role (rôle Gestionnaire, auteur des invitations)
```

### Étape 17 — 2026-10-04 — Appareils de confiance pour les actions sensibles

**Cadre** : demande de l'utilisateur : une case « Faire confiance à cet appareil » pour ne plus ressaisir le
mot de passe des actions sensibles pendant 15 jours. Choix validés : la case figure **dans le dialogue de
confirmation seulement** (pas sur la page de connexion, pour ne pas la confondre avec un « rester
connecté ») ; la confiance se consulte et se retire depuis le **tableau de bord** (ce navigateur ou tous
ses appareils) et la **fiche d'un compte** (administrateur).

**Ajouté**
- Table `TrustedDevice` (migration `20261004151952_trusted_devices`, création seule, 3 fournisseurs) ;
  `server/utils/trusted-devices.ts` (cookie `surge-media-trusted-device` HTTP-only, Secure, Lax, chemin
  `/` ; empreinte seule en base ; toutes les valeurs homonymes du cookie sont examinées) ;
  `requireRecentPassword` accepte un appareil de confiance du compte (§ 9.7).
- `POST /api/auth/confirm-password` : `trustDevice` → `trustedUntil` ; `GET` / `DELETE /api/auth/trusted-devices` ;
  `DELETE /api/admin/users/:id/trusted-devices` ; `trustedDevices` dans la fiche d'un compte (administrateur).
- Retrait automatique au changement de mot de passe et à la désactivation (mêmes transactions que les
  sessions). Audit `user.device_trusted` et `user.devices_revoked`.
- Configuration `NUXT_PUBLIC_TRUSTED_DEVICE_DAYS` (15 ; 0 désactive ; 365 au plus) ; `trustedDeviceDays`,
  `TRUSTED_DEVICE_SCOPES` (`shared/utils/auth.ts`), `forgetTrustedDevicesSchema`.
- Interface : case + rappel « ordinateur partagé » dans `<AdminReauthDialog>` ; rubrique « Appareil de
  confiance » de « Votre compte » (échéance, autres appareils, retrait, focus rendu au titre) ; fiche
  d'un compte : nombre d'appareils et retrait ; journal : durée et nombre d'appareils. 202 tests Vitest.

**Corrigé pendant les essais** : le cookie, d'abord limité à `/api` en `SameSite=Strict`, n'accompagnait pas
le chargement des pages : le tableau de bord rendu côté serveur affichait « pas de confiance ». Il suit
désormais les attributs du cookie de session.

**Vérifié** : typecheck, 202 tests, i18n (1133 clés), contrastes, migrations (`--check`) ; **37 scénarios
HTTP** (sans et avec la case, attributs du cookie, empreinte seule, action permise après la fenêtre de
10 min, cookie sans session ou d'un autre compte refusé, rendu serveur, survie à la déconnexion, second
appareil, remplacement, retrait de cet appareil ou de tous, expiration, retrait par l'administrateur,
changement de mot de passe, désactivation, journal sans jeton) ; B2 et rôles (79) rejoués ; interface :
dialogue (case, focus sur le mot de passe), action rejouée puis action suivante sans dialogue, tableau de
bord, fiche, journal ; axe-core : 0 violation en fr/en × clair/sombre ; largeur de téléphone sans
défilement horizontal.

**Non vérifié** : `pnpm build` (votre serveur de développement tournait ; démarrage de production bloqué par
Smart App Control, § 14).

**Limites connues / suites possibles** : pas de liste détaillée des appareils (navigateur, dernière
utilisation) ni de retrait un par un — page « Mon compte » à envisager ; la confiance ne distingue pas
les actions (toutes les actions sensibles en profitent).

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance
pnpm db:migrate       # migration trusted_devices (table TrustedDevice)
```

### Étape 18 — 2026-10-04 — Envoi des liens d'invitation et de réinitialisation par e-mail

**Cadre** : demande de l'utilisateur : un bouton à côté de « Copier le lien » pour envoyer le lien par
e-mail, absent si les paramètres SMTP ne sont pas renseignés. Choix validés : paramètres SMTP par
**variables d'environnement** (`NUXT_SMTP_*`, comme S3 ; aucun secret en base) ; e-mail dans la **langue
de l'interface de l'expéditeur**.

**Ajouté**
- Dépendance `nodemailer` 10 (MIT-0, sans dépendance ni module natif ; `@types/nodemailer` en
  développement). `server/lib/mail/transport.ts` (`smtpConfig`, `mailEnabled`, `sendMail`, connexion
  réutilisée, délais de 10 à 20 s) et `server/lib/mail/password-link.ts` (module pur testé : textes
  `mail.*` des fichiers de traduction, version texte et HTML échappée, échéance avec fuseau).
- `POST /api/admin/users/:id/password-link/email` (jeton du lien affiché revérifié, destinataire = adresse
  du compte, 5 envois par heure et par compte, audit `user.link_emailed`) et `GET /api/admin/config/mail`.
- Interface : emplacement `actions` de `<UiCopyField>` ; bouton « Envoyer par e-mail » dans
  `<AdminPasswordLinkPanel>` (prop `userId`), confirmation annoncée, erreurs traduites ; phrase « ne
  sera plus affiché » adaptée quand l'envoi est possible. 208 tests Vitest (`tests/mail.test.ts`).

**Vérifié** : typecheck, 208 tests, i18n (1158 clés), contrastes, migrations (`--check`, aucune) ; **28
scénarios HTTP** contre une copie isolée de l'application (sa propre base, port 3200) reliée à un faux
serveur SMTP local, et contre votre serveur sans SMTP (bouton masqué, 409) : contenu fr/en, destinataire
imposé, liens utilisés, remplacés ou d'un autre compte refusés, droits du gestionnaire et du développeur,
refus SMTP (502, rien de journalisé), limite d'envoi, journal sans jeton ; interface : bouton à côté de
« Copier le lien », envoi, erreur, absence sans SMTP ; axe-core : 0 violation (fr clair, en sombre,
erreur) ; largeur de téléphone sans défilement ; e-mail reçu affiché et audité (contrastes conformes).
**Build de production** faite dans la copie isolée : `nodemailer` (exports conditionnels) est bien tracé
dans `.output`, et un message envoyé depuis la build est arrivé au faux serveur.

**Limites connues / suites possibles** : pas de bouton « Envoyer un e-mail de test » ni de commande CLI pour
vérifier la configuration ; pas d'envoi automatique à la création du compte ; pas de file d'attente (l'envoi
se fait pendant la requête) ; limite d'envoi en mémoire (par instance).

**Après `git pull`**
```bash
pnpm install          # nouvelle dépendance nodemailer ; aucune migration
```
Pour activer l'envoi : définir au moins `NUXT_SMTP_HOST` et `NUXT_SMTP_FROM` (voir `.env.example`), puis redémarrer.

### Étape 19 — 2026-10-04 — Tableau de bord : statistiques, raccourcis et widgets

**Cadre** : demande de l'utilisateur : plus de widgets, des statistiques et des raccourcis. Choix validés :
statistiques, raccourcis, projets, **points d'attention**, **graphique des envois** (30 jours) et **activité
récente** (administrateur) ; disposition **fixe par rôle** ; « Vos permissions » **replié** dans « Votre compte ».

**Ajouté**
- `GET /api/admin/dashboard` (`server/lib/dashboard/service.ts`) : agrégats limités aux espaces visibles
  (`groupBy`/`count`/`aggregate`), comptes ou invitations, identifiants d'API, points d'attention assemblés
  selon les droits, journal (`listAuditEvents` accepte une taille de page). Aucune empreinte ni secret renvoyé.
- `shared/utils/dashboard.ts` (pur, testé) : `hourlyCounts`, `dailyUploads`, `calendarDay`, `attentionSeverity`,
  type `DashboardAttention`, constantes (30 jours, 7 jours, 6 projets, 8 entrées).
- Composants `app/components/admin/dashboard/` : `StatCard` (lien étendu à la carte, contour de focus),
  `Shortcuts`, `UploadsChart` (SVG décoratif + légende + tableau repliable), `Attention`, `Projects`,
  `Activity`, `Account` ; composable `useAuditFormat` (mise en forme partagée avec la page du journal).
- 214 tests Vitest (`tests/dashboard.test.ts`).

**Vérifié** : typecheck, 214 tests, i18n (1219 clés), contrastes, migrations (`--check`, aucune) ; **38
scénarios HTTP** : chaque chiffre (médias, poids, images, public/privé, corbeille, dérivés, envois, projets,
comptes par rôle, invitations et expirées, clés et jetons) comparé à un calcul SQL indépendant, pour un
administrateur, un gestionnaire, un développeur et un éditeur ; points d'attention par rôle, absence de
secret ; interface : administrateur et gestionnaire, tableau des données du graphique ; axe-core : 0
violation (fr clair, en sombre, gestionnaire) ; largeur de téléphone sans défilement horizontal.

**Limites connues / suites possibles** : pas de personnalisation (masquer, réordonner) ; chiffres calculés
à chaque affichage (pas de cache : à prévoir pour de très grandes bibliothèques) ; pas de médias récents
en vignettes ; journal réservé à l'administrateur (pas de journal par projet).

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance, aucune migration
```

### Correctifs — 2026-10-05 — Flux interrompus, corps des requêtes, envois bloqués

**Cadre** : en préparant la phase D (vidéos, proposition `.claude/architecture-phase-d.md`, en attente de
validation), trois faiblesses de l'existant ont été mesurées ; l'utilisateur a demandé de les corriger
tout de suite, indépendamment de la vidéo.

**Corrigé**
- **Flux de `/m/` interrompus** : h3 1.15 (`sendStream`) n'appelle que `stream.abort()` quand le client
  abandonne une réponse ; ni un flux de fichier local ni le corps d'une réponse S3 n'ont cette méthode.
  Mesuré : 20 requêtes interrompues sur 20 laissaient leur fichier ouvert (descripteur pris, espace d'un
  fichier purgé non libéré ; avec S3, connexion du pool prise). `closeWithResponse`
  (`server/lib/http/stream.ts`) détruit le flux à la fermeture de la réponse : 0 sur 20.
- **Corps des requêtes sans limite** : h3 (`readRawBody`) accumulait tout corps en mémoire, même sur une
  route publique (`POST /api/auth/login`). Middleware `body-limit.ts` : lecture différée (seulement quand
  la route lit son corps, après ses contrôles), **1 Mio** et **30 s** au plus → 413 `BODY_TOO_LARGE`, 408
  `REQUEST_TIMEOUT`, `Connection: close`. Les envois multipart ne sont pas concernés (lus en flux).
- **Envoi bloqué** : `receiveUpload` s'arrête après **60 s** sans donnée → 408 `UPLOAD_TIMEOUT` (avant :
  jusqu'à 300 s, délai global de Node), fichier temporaire supprimé, message traduit dans l'interface.
- Catalogue de l'API v1 : `REQUEST_TIMEOUT`, `UPLOAD_TIMEOUT` (408), `BODY_TOO_LARGE` (413), ajoutés
  d'office aux opérations à corps de la spécification OpenAPI ; `readApiBody` ne masque plus ces refus
  derrière `INVALID_REQUEST`.

**Vérifié** : typecheck, 225 tests Vitest (`tests/http.test.ts` : lecture bornée, et fermeture des flux
sur une vraie connexion, avec et sans garde-fou), i18n (1220 clés) ; sur le serveur de dev : limite de
corps (taille annoncée, corps fragmenté, corps lent → 408 à 30 s, connexion normale inchangée), envois
bloqués administration et API v1 (408 à 60 s, problème RFC 9457, aucun fichier temporaire restant), 40
requêtes abandonnées sur un original de 5,5 Mio (descripteurs du serveur stables), plages, purge ;
scénarios rejoués : rôles (79), appareils de confiance (37), B2, API v1 en écriture (94), C2 (58),
tableau de bord (38) ; connexion et envoi depuis le navigateur ; build de production (copie isolée).

**Limites connues** : la limite de 1 Mio et les délais sont des constantes (`server/lib/http/body.ts`,
`UPLOAD_IDLE_TIMEOUT_MS`) ; le délai global de Node (`requestTimeout`, 300 s) reste en place : il sera
relevé avec les vidéos (D1), un envoi de 25 Mio exigeant aujourd'hui au moins 0,7 Mbit/s.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance, aucune migration
```

### Étape 20 — 2026-10-05 — Phase D1 : vidéos (envoi, stockage, diffusion directe)

**Cadre** : demande de l'utilisateur : accepter, stocker et distribuer des vidéos, d'abord en CRUD simple et
diffusion directe, **sans transcodage ni traitement avancé** ; les traitements (miniatures, transcodage,
formats adaptatifs) seront étudiés ensuite, sans nuire aux performances. Proposition
`.claude/architecture-phase-d.md` (DD1 à DD14) **validée** le 2026-10-05.

**Ajouté**
- Formats **MP4, WebM, MOV** (`ACCEPTED_MEDIA_TYPES`), détection pure `detectMimeType` (`sniff.ts` : marques ISO,
  `DocType` EBML ; AVIF, HEIF, 3GP, M4A, Matroska distingués).
- **Lecteur d'en-têtes vidéo** `server/lib/media/video/` (`source`, `isobmff`, `ebml`, `codecs`, `probe`), sans
  dépendance ; gestionnaire `handlers/video.ts` (`queued: false` : hors file des traitements d'images) ;
  métadonnées `shared/utils/video.ts` (compatibilité, libellés des codecs, type de source).
- **Limites par genre** (`server/lib/media/limits.ts`, `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE`) appliquées **pendant la
  réception** : type et taille contrôlés dès les premiers octets (415, 413, 422 `KIND_MISMATCH` pour un
  remplacement), suite du corps vidangée ; jetons délégués bornés par genre ; `GET /api/admin/config/media` →
  `maxUploadSizes`.
- Greffon `http-timeouts.ts` (`NUXT_MEDIA_UPLOAD_TIMEOUT`, 3600 s) ; liens signés des vidéos dans l'administration : 6 h.
- Interface : filtre « Type », cartes vidéo (icône, durée), fiche avec lecteur natif, durée, codecs, débit,
  avertissements, « Description courte », extrait `<video>` (`videoSnippet`), remplacement limité au genre,
  avertissement en quittant la page pendant un envoi, carte « Médias » du tableau de bord avec les vidéos.
- Documentation de l'API (section « Vidéos », envois, contrat `Media`), `.env.example`, `.gitattributes`
  (`*.mp4`, `*.webm`, `*.mov` binaires).
- Tests : `tests/video.test.ts` (30 : détection, codecs RFC 6381, MP4/MOV/WebM fabriqués boîte par boîte —
  rotation, fragmenté, index en fin, lieu, fichiers hostiles —, limites, et **trois enregistrements réels**
  `tests/fixtures/video/` produits par `MediaRecorder` dans Chromium 152).

**Vérifié** : typecheck, 255 tests Vitest, i18n (1250 clés), migrations (aucune), build de production (copie
isolée) ; **60 scénarios HTTP** (`video-test.mjs` : envois admin et API v1, vraies vidéos, MOV pivoté avec lieu,
refus anticipés avant la fin de l'envoi, 413 par genre, diffusion par plages, 304, HEAD, 404 des dérivés, vidéo
privée et lien de 6 h, remplacements, filtres, duplication, tableau de bord, jeton délégué limité par type et
taille, OpenAPI) ; scénarios des étapes précédentes rejoués (rôles 79, appareils 37, B2, B4 94, C2 58, C4 45,
tableau de bord 38, correctifs 28 + 8) ; mécanisme du délai Node vérifié par un banc ; interface : axe-core 0
violation en fr/en × clair/sombre (médiathèque filtrée, fiche vidéo avec avertissements et extrait, tableau de
bord), pas de défilement horizontal en largeur de téléphone.

**Limites connues / suites** : pas d'aperçu ni de vignette, pas de transcodage (lecture selon les codecs), pas de
retrait des métadonnées, pas de sous-titres (axe signale `video-caption` « à vérifier ») : étapes D2 à D4 de
l'architecture ; WebM de navigateur sans durée ; 2 Gio au plus ; en développement, relais de Nitro (voir § 14) ;
délai de 300 s du relais de développement non relevé ; S3 réel non testé avec de gros fichiers.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance, aucune migration
```
Facultatif : `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE` et `NUXT_MEDIA_UPLOAD_TIMEOUT` dans `.env` ; régler le mandataire
inverse (§ 7.7).

### Étape 21 — 2026-10-06 — Phase D2 : préparation des vidéos, image d'affiche, sous-titres

**Cadre** : suite de la phase D, proposition `.claude/architecture-phase-d.md` § 17 à § 27 (DD15 à DD24)
**validée** le 2026-10-05 avec un ajout de l'utilisateur : retirer aussi les **métadonnées de l'appareil**. Toujours
sans ffmpeg ni tâche de fond. Essais préalables sur deux vidéos réelles de l'utilisateur (téléphone Samsung en HEVC
avec lieu, export Windows avec index en fin), sur des copies : § 18.5 de l'architecture.

**Ajouté**
- **Préparation des MP4/MOV** (`server/lib/media/video/prepare.ts`, étape `prepare` des gestionnaires) : index en
  tête, métadonnées d'origine retirées par une liste de ce qui est conservé (`udta`, clés QuickTime, liste
  iTunes, `uuid`/XMP, boîtes de premier niveau), décalages `stco`/`co64` recalculés, sortie réanalysée et
  comparée avant écriture, fichiers non gérés gardés intacts ; flux de morceaux écrit directement dans le stockage,
  empreinte calculée au passage ; `NUXT_MEDIA_VIDEO_PREPARE` ; `metadata.prepared` ; détection du lieu étendue au
  XMP ; `POST /api/admin/media/:id/prepare` et bouton « Optimiser la vidéo » (vidéos envoyées avant D2).
- **Durée estimée des WebM** sans durée (dernier `Cluster`, `metadata.durationEstimated`).
- **Image d'affiche** : colonnes `Media.poster*`, normalisation JPEG (`normalizePoster`), source des dérivés
  (`variants.ts`), `PUT|DELETE /api/admin/media/:id/poster` et `…/v1/…/poster`, copie à la duplication ; capture
  dans le navigateur (`app/utils/video-frame.ts`) à l'envoi et depuis la fiche ; vignettes vidéo dans la
  médiathèque (pastille « lecture »), point d'intérêt et générateur d'adresses sur l'affiche.
- **Sous-titres** : table `MediaTextTrack`, analyseur WebVTT/SRT (`text-track.ts`), service (`tracks.ts`),
  réception en mémoire (`receiveSmallUpload`), diffusion `/m/…/tracks/<piste>.vtt` (droit `track:<piste>`),
  routes admin (`/api/admin/media/:id/tracks`) et v1 (`…/tracks`, cible `track` des liens signés), panneau
  « Sous-titres et pistes de texte » (`AdminTextTracksPanel`), `<track>` dans le lecteur de la fiche,
  avertissement « Pas de sous-titres » (WCAG 1.2.2), extrait `<video>` avec affiche, pistes et `crossorigin`
  (aussi pour une vidéo privée : lien temporaire étendu à l'affiche et aux pistes).
- API v1 : `Media.poster`, `Media.textTracks`, schémas `TextTrack`, corps `PosterUpload`, `TrackUpload`,
  `TrackUpdate`, erreurs `TRACK_NOT_FOUND`, `TRACK_LIMIT_REACHED`, `INVALID_TEXT_TRACK`, section « Vidéos » avec
  un exemple de capture d'affiche.
- Migration `20261005215018_video_poster_tracks` (SQLite, PostgreSQL, MySQL).
- Tests : `video.test.ts` (préparation, XMP, durée WebM), `text-track.test.ts`, `tracks-delivery.test.ts`,
  `storage.test.ts`, contrat `Media` (affiche, pistes signées).

**Corrigé** : sur le stockage local, la suppression des dérivés d'une ancienne version (`deletePrefix`
« variants/<média>/v3- ») ne supprimait rien — Flydrive y attend un dossier — : les dérivés des anciennes
versions restaient sur le disque (remplacement, point d'intérêt). Les fichiers d'un dossier sont désormais listés
et filtrés. Les fichiers déjà laissés ainsi ne sont pas supprimés automatiquement.

**Vérifié** : typecheck et build de production (copie isolée), 281 tests Vitest, i18n (1331 clés), migration sur les trois bases ; **100 scénarios HTTP**
(`d2-test.mjs` : vraies vidéos préparées octet pour octet identiques à la référence, « Optimiser », affiche
— versions, normalisation, droits, duplication, purge, jetons délégués — et pistes — SRT Windows-1252, VTT, par
défaut par groupe, erreurs avec ligne, 413, limite de 20, liens signés, 302, corbeille, duplication, API v1) ;
scénarios précédents rejoués ; images décodées identiques avant et après préparation (navigateur intégré) ; gain
de démarrage mesuré (§ 18.5 de l'architecture) ; interface : capture d'affiche à l'envoi et depuis le lecteur,
pistes lues par le navigateur, axe-core 0 violation en fr/en × clair/sombre (fiches, médiathèque, boîte d'ajout
de piste), focus après chaque action, largeur de téléphone.

**Limites connues / suites** : lieu enregistré dans les données d'une piste de métadonnées (GoPro, drones) ni
détecté ni retiré ; WebM non préparés ; affiche impossible à capturer quand le navigateur ne décode pas la vidéo ;
dérivés laissés par d'anciennes versions avant le correctif ; D3 (ffmpeg dans un processus séparé : affiches côté
serveur, rendus compatibles, réparation des WebM) et D4 (HLS) à proposer.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance
pnpm db:migrate       # colonnes d'affiche, table MediaTextTrack (arrêter « pnpm dev » avant, avec SQLite)
```
Facultatif : `NUXT_MEDIA_VIDEO_PREPARE` dans `.env` (`faststart,metadata` par défaut). Les vidéos déjà envoyées
gardent leur fichier : bouton « Optimiser la vidéo » dans leur fiche.

### Étape 22 — 2026-10-09 — Phase D3 : traitement des vidéos par ffmpeg

**Cadre** : suite de la phase D, proposition `.claude/architecture-phase-d.md` § 28 à § 42 (DD25 à DD36)
**validée**, l'utilisateur ayant délégué les choix restés ouverts. Traitement **facultatif et désactivé par défaut**
(ffmpeg du système, jamais dans le chemin d'une requête : règles de performance de DD12). Implémentée en six
modules — A : couche ffmpeg ; B : diffusion ; C : détection ; D : file, pipeline et service ; E : contrats ; F :
interface —, qui couvrent les trois parties prévues par DD36 : (1) file, modes, ffmpeg, état, affiche côté serveur ;
(2) rendus, `sources[]`, formats convertis ; (3) réparation des WebM, pistes de métadonnées. État détaillé :
section « D3 — état de l'implémentation » de l'architecture ; contrats entre modules :
`.claude/d3-implementation-notes.md`.

**Ajouté**
- **Schéma** : migration `20261006211348_d3_video_processing` (SQLite, PostgreSQL, MySQL) : enums `ProcessingState`,
  `MediaJobStatus`, tables `MediaJob` (file) et `MediaRendition` (rendus), colonne `Media.processingState` ;
  SQLite : attente des verrous explicite (10 s, `server/utils/prisma.ts`) pour un processus de travail qui partage
  le fichier.
- **Réglages** : `NUXT_VIDEO_PROCESSING` (`off` par défaut), `NUXT_SERVER_ROLE`, `NUXT_FFMPEG_PATH`, `NUXT_FFPROBE_PATH`,
  `NUXT_VIDEO_CONCURRENCY`, `_THREADS`, `_RENDITION`, `_PRESET`, `_CRF`, `_AV1`, `_MAX_DURATION`, `_MEMORY_LIMIT`
  (`nuxt.config.ts`, `server/lib/video-processing/settings.ts` : valeur invalide → défaut et avertissement),
  `.env.example` ; constantes et règles partagées `shared/utils/video-processing.ts`.
- **Couche ffmpeg** (`server/lib/video-processing/`) : détection au démarrage (`ffmpeg.ts` : version ≥ 6,
  `libx264`, `aac`, ffprobe ; conversion HDR, AV1), lancement borné (`run.ts` : priorité 19, groupe de processus
  ou `taskkill`, `prlimit` mémoire et temps processeur, environnement réduit, délais, durée de sortie, progression
  `-progress`), arguments (`args.ts`, seul endroit : format d'entrée imposé, `-protocol_whitelist file`,
  `-enable_drefs 0`, `-max_pixels`, `-fs`, désentrelacement `bwdif`, `-fpsmax 60`, HDR → SDR), ffprobe
  (`ffprobe.ts`), plan pur (`plan.ts`).
- **File et pipeline** : `jobs.ts` (prise atomique, bail, reprise, rattrapage, présence des processus de travail),
  `runner.ts` (boucle et superviseur : nouvel essai au démarrage, reprise après une panne de ffmpeg), `pipeline.ts`
  (probe, sanitize, repair, transcode, av1, poster, vérification de chaque sortie par le lecteur de D1 ; dossiers
  temporaires propres à chaque installation), `status.ts`, `worker-id.ts` ; intégration au service des médias
  (envoi, remplacement, « Optimiser », corbeille, restauration, duplication, purge, relance, vidéos existantes) ;
  plugin `server/plugins/0.video-processing.ts`, middleware `server/middleware/0.server-role.ts` (processus de
  travail : `/api/health` seulement), greffons de démarrage ignorés par un processus de travail (compte
  d'amorçage, URL du site, indexation de la recherche, clés des dérivés, compteurs des jetons délégués) ; CLI
  `surge-media worker [--port 3001]` (`cli/worker.ts`, fr/en).
- **Détection** (`sniff.ts`, 1 024 octets examinés) : 3GP/3G2, MKV, AVI, WMV, Ogg Theora, MPEG-TS/M2TS ; pistes
  de données de l'appareil dans le lecteur ISO BMFF (`metadata.dataTracks`) ; règles d'envoi par intersection
  avec les types acceptés en ce moment (`acceptedMimeTypes`), 415 d'emblée quand aucun type n'est admis.
- **Diffusion** : `/m/<id>/v<n>/renditions/h264.mp4|av1.webm` (droit signé `file`, nom `renditions` réservé),
  retenue 503 `PROCESSING_PENDING`, relecture du cache de diffusion (version plus récente, rendu ou affiche
  inconnus), originaux illisibles en téléchargement ; ordre des sources partagé (`server/lib/media/sources.ts`).
- **Contrats** : API v1 `Media.processing` et `Media.sources`, `sources` des liens signés (cible `file`), ETag du
  média et des listes qui suit l'avancement, formats convertis dans `upload.types` des jetons délégués ; OpenAPI
  fr/en (composants `MediaSource` et `MediaProcessing`, section « Vidéos » réécrite, `PROCESSING_PENDING` parmi les
  erreurs de `/m/`). Administration : `processingState` des listes ; `processing`, `renditions`, `sources`,
  `publicSources` de la fiche ; routes `POST /api/admin/media/:id/process`, `GET /api/admin/media/:id/processing`,
  `GET /api/admin/video-processing`, `POST /api/admin/video-processing/backfill` (journal :
  `media.processing_backfill`) ; `/api/health` › `videoProcessing` ; `config/media` › `videoProcessing` ;
  `videoSnippet` avec `sources`.
- **Interface** : pastille d'état partagée (`ProcessingStateBadge`) des cartes et de la fiche ; section
  **Traitement** de la fiche (`VideoProcessingPanel`, rafraîchie toutes les 5 s pendant le traitement :
  `useProcessingPoll`, règles pures `app/utils/processing-view.ts`) avec les versions compatibles ; lecteur avec un
  `<source>` par source ; avertissements revus ; aide et `accept` de l'envoi pour les formats convertis ; section
  **Traitement des vidéos** de « Réglages » (`VideoProcessingSettings`) avec « Traiter les vidéos existantes » ;
  détail du journal d'audit ; textes fr/en.
- **Tests** : `video-processing.test.ts`, `video-ffmpeg.test.ts` (vrai ffmpeg sur des vidéos fabriquées par
  `lavfi`, dont un faux AVI qui est une liste HLS visant `/etc/passwd` et une URL locale ; ignoré sans ffmpeg),
  `video-queue.test.ts`, `renditions-delivery.test.ts`, `video-admin.test.ts`, `video-sources.test.ts`,
  `video-routes.test.ts`, `api-video.test.ts`, `processing-view.test.ts` ; `video.test.ts` étendu.
- **Documentation** : § 7.7 réécrit (traitement, modes, file, installation de ffmpeg, processus de travail,
  conteneur, administration) ; § 1 à 6, 7.1, 7.3 à 7.6, 9.8 à 9.10 et 12 à 14 mis à jour.

**Écarts par rapport à la proposition** (détail : section « Écarts à la proposition » de l'architecture) :
- validité d'une tâche par **fichier** (`MediaJob.sourceKey`) et clés des rendus indépendantes de la version :
  changer l'affiche ou le point d'intérêt ne touche ni les tâches ni les rendus ; remplacer un rendu (relance)
  change la version ;
- `TOO_LONG` n'empêche que les réencodages (pistes GPS retirées, réparation et affiche faites, puis échec) ;
- mode `auto` : une vidéo entrelacée reçoit aussi un rendu ; mode `never` : un format converti reçoit quand même
  le sien ;
- affiche extraite en dernier (du rendu H.264 produit par cet essai, sinon de la source) ; reprises après 30 s
  puis 5 min, le 3e échec étant définitif ;
- fils de ffmpeg plafonnés à 16, `MALLOC_ARENA_MAX=2`, `prlimit` borne aussi le temps processeur ;
- réparation des WebM seulement en VP8/VP9/AV1 avec Opus/Vorbis ;
- vidéo retenue : priorité 10 dans la file, liens de l'administration signés « admin » ;
- « actif » en `embedded` exige aussi que la boucle tourne ; processus de travail arrêté : présence `halted`,
  effacée à l'arrêt propre ;
- développement : ffmpeg reste dans le groupe du terminal ; Windows : la CLI `worker` ne retransmet pas les
  signaux ;
- route légère `GET /api/admin/media/:id/processing` pour la fiche ; `/api/health` compte aussi le serveur en mode
  `embedded` dans `workers`.

**Corrigé** : rien d'antérieur à D3 (les défauts relevés par les relecteurs portaient sur le code de D3 : voir
« Vérifié ») ; un défaut antérieur observé pendant les essais reste ouvert (voir « Limites connues »).

**Vérifié** (2026-10-09) : `pnpm typecheck`, `pnpm test` (**526 tests**, 27 fichiers ; Node 24 exigé : sous Node 22,
les tests des sous-titres échouent), `pnpm i18n:check` (1528 clés, 1419 appels `t()`), `pnpm db:migration --check`
(schéma inchangé depuis la migration de D3) ; aucune nouvelle dépendance npm. Pendant l'implémentation (serveur de
développement en mode `embedded`, base et stockage copiés, et build de production avec `surge-media worker` en mode
`external` ; ffmpeg 6.1) : HEVC prête en 2 s avec l'affiche du serveur ; HEVC HLG convertie en SDR ; MKV → rendu
H.264 et original en téléchargement ; GoPro `gpmd` → 503 puis version 2 sans la piste ; WebM réparé ; remplacement,
corbeille, restauration et duplication pendant un encodage ; ffprobe retiré en cours de route (tâche rendue sans
essai compté, traitement inactif, MKV refusé 415, reprise 56 s après son retour) ; Ctrl+C pendant un encodage
(aucun ffmpeg orphelin, reprise au redémarrage) ; processus de travail : prise en 4,6 s, présence, 404 hors
`/api/health`, SIGTERM → tâche rendue ; plantage → reprise par le bail ; 4 processus sur une même base SQLite
(80 tâches, aucune double prise) ; dossier temporaire d'une autre installation conservé. Interface dans un vrai
navigateur (Chromium, mode `embedded`, vrai ffmpeg) : pastilles, section Traitement à chaque transition,
rafraîchissement toutes les 5 s arrêté à la fin et suspendu onglet masqué, saisie conservée malgré un changement de
version, annonces des seules transitions, MKV (encadré « Télécharger l'original », puis lecteur sur sa version
H.264), « Relancer » au clavier, nouvel essai après un ffmpeg tué, corbeille et restauration, extrait `<video>`,
« Réglages » et dialogue « Traiter les vidéos existantes » au clavier, journal d'audit ; axe-core : 0 violation en
fr/en × clair/sombre × 375/1280 px, sans défilement horizontal. Chaque module relu par des relecteurs indépendants, avec vérification contradictoire de
chaque défaut : 13 corrigés en phase B (modules A à C), 11 en phase C (module D), 7 au module E, 27 + 7 au module F.

**Non vérifié** : un poste Windows (ffmpeg et Smart App Control, `taskkill`, priorité la plus basse
(`IDLE_PRIORITY_CLASS`), Ctrl+C de `surge-media worker` et sur `pnpm dev` pendant un encodage, tests avec
ffmpeg) ; lecture effective du rendu H.264 et capture d'affiche depuis le lecteur (le Chromium de test ne lit
pas le H.264) ; changement de source du lecteur pendant la lecture ; PostgreSQL et MySQL/MariaDB réels (migration,
prise des tâches) ; stockage S3 (copie de l'original dans le dossier temporaire) ; conteneur de travail durci ;
lecteurs d'écran réels.

**Limites connues / suites**
- Original 3GP/MKV gardé tel quel : un lieu de tournage qu'il contiendrait n'est ni détecté ni retiré (le rendu
  H.264, lui, n'a aucune métadonnée).
- Mode `external` : formats convertis refusés jusqu'à 30 s après le démarrage d'un processus de travail ; fin d'une
  retenue (503) vue avec jusqu'à 60 s de retard à l'ancienne URL ou après un échec définitif (cache de diffusion du
  serveur web) ; processus de travail sur une autre machine : PostgreSQL/MySQL et stockage partagé obligatoires.
- La retenue (503) ne dépend pas de l'activité du traitement : tant qu'aucun processus ne traite la file (mode
  `external` sans processus de travail actif, boucle arrêtée ou désactivée en `embedded`), une vidéo à piste de
  données en attente — y compris restaurée pendant l'inactivité — reste indisponible hors liens « admin » jusqu'à
  son traitement ou le passage en `off`.
- Arrêt brutal en production (SIGKILL, panne) : ffmpeg peut finir seul (borné sous Linux par `prlimit --cpu`), la
  tâche est reprise à l'expiration du bail (2 min, un essai compté).
- API v1 : une page de liste qui contient une vidéo en cours de traitement est relue à chaque revalidation ;
  l'ETag d'un média en cours change aussi à chaque renouvellement du bail (30 s).
- Un processus de travail sert encore les fichiers statiques publics (`/_nuxt/*`, `public/`), que Nitro sert avant
  les middlewares.
- Interface : petits écarts relevés et laissés (heure de début de l'essai précédent après un nouvel essai ;
  « Prochain essai au plus tôt » parfois déjà passé si aucun processus ne reprend la tâche ; guillemets de
  l'attribut `type` échappés dans l'extrait `<video>` ; aperçu annoncé avec la fin du traitement).
- Antérieur à D3, observé pendant les essais : un aperçu pré-généré pendant un changement de version peut rester
  orphelin dans le stockage (`variants/<média>/v<n>-…`).
- Pas de webhook de fin de traitement, de filtre « État » dans la médiathèque, d'accélération matérielle, d'audio
  seul, ni de fichier de plus de 2 Gio.
- **À vérifier sur un poste Windows** (tâche en attente pour l'utilisateur) : ffmpeg installé par
  `winget install Gyan.FFmpeg` et non bloqué par Smart App Control, arrêt de l'arbre de processus par `taskkill`,
  priorité la plus basse (`IDLE_PRIORITY_CLASS`), Ctrl+C de `surge-media worker` (et de `pnpm start` en
  `embedded`) pendant un encodage puis état de la tâche (ffmpeg, sans groupe de processus propre, peut recevoir
  le Ctrl+C lui aussi), Ctrl+C sur `pnpm dev` pendant un encodage, `pnpm test` avec ffmpeg (le bloc
  `runTool : processus enfant borné` y est toujours ignoré).
- Suite : **D4** (HLS multi-débits, planches de survol, manifestes signés), à proposer.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance
pnpm db:migrate       # migration d3_video_processing : MediaJob, MediaRendition, Media.processingState
                      # (arrêter « pnpm dev » avant, avec SQLite)
```
Rien ne change sans autre réglage (mode `off`). Facultatif : installer ffmpeg ≥ 6 (§ 7.7), ajouter
`NUXT_VIDEO_PROCESSING="embedded"` à `packages/core/.env` et redémarrer ; puis « Réglages › Traitement des vidéos »
(ffmpeg détecté, état « Actif ») et « Traiter les vidéos existantes ».

### Maintenance — 2026-10-10 — Test global sous Windows, montée en charge, alerte SQLite

**Cadre** : demande de l'utilisateur — vérifier sous Windows que tout fonctionne et que le projet est prêt pour un
grand nombre de requêtes ; si SQLite pose problème avec un fort trafic, prévoir un message d'alerte. Tous les essais
ont tourné sur une **copie isolée** (`packages/core` copié, base copiée par `VACUUM INTO`, médias copiés, build de
production lancée sur un autre port) : ni la base ni le serveur de développement de l'utilisateur n'ont servi.

**Corrigé**
- **Débit** : la configuration d'exécution était reconstruite à chaque requête (Nitro 2 + @nuxtjs/i18n, ≈ 9 ms et
  80 % du processeur) → `server/plugins/runtime-config.ts` (+ `server/lib/http/runtime-config.ts`) : × 2 à × 19
  selon les routes (§ 12.1). Les variables d'environnement ne sont plus lues qu'au démarrage.
- **Réponses de `/m/` jamais envoyées** sur une connexion persistante (h3 1.15 `sendStream` sans connexion
  attribuée) → `responseReady` (`server/lib/http/stream.ts`) avant l'ouverture du fichier : 0 blocage sur ≈ 250 000
  requêtes (avant : ≈ 1 sur 5 000 à 10 000).
- Test `video-ffmpeg` : sous Windows, un processus arrêté par `taskkill /F` sort avec le code 1 (`null` sous
  POSIX) — attente adaptée ; la logique d'exécution, fondée sur `timedOut`/`aborted`/`tooLong`, n'en dépendait pas.

**Ajouté**
- **Alerte « base SQLite sous pression »** (§ 12.1, § 10.4) : `shared/utils/database-pressure.ts` (règles pures),
  `server/lib/database/pressure.ts` (compteurs par processus, constat dans `Setting`), extension de `usePrisma()`
  (SQLite seulement), plugin `server/plugins/database-pressure.ts` (comptage des requêtes, constat chaque minute,
  message au démarrage en production), point d'attention `database` du tableau de bord (ADMIN), textes fr/en.
  Aucune migration (`Setting` existe déjà).

**Vérifié (Windows 11, Node 24.20, ffmpeg 9.0.2)**
- `pnpm test` : **539 tests** passés, 9 ignorés (blocs POSIX), 28 fichiers ; `typecheck` (copie isolée, erreur
  volontaire bien détectée), `i18n:check` (1536 clés), `db:migration --check`, build de production.
- Scénarios HTTP rejoués sur la build de production : rôles (79), appareils de confiance (37), B2 (91), B3 (97),
  B4 (94), B5 (71), C1 (66), C2 (58), C3 (81), C4 (45), corps des requêtes (8), envois bloqués (23), tableau de bord
  (37/38 : l'alerte `NUXT_SITE_URL` est attendue en production). Les scénarios C2 à C4 enchaînés juste après C1
  dépassent la limite de 60 nouvelles transformations libres par minute et par IP (429, comportement voulu) :
  espacés d'une minute, tout passe. Le scénario vidéo de D1 précède D2/D3 : ses 22 écarts sont les changements
  voulus (MKV accepté avec le traitement actif, MP4 préparé à l'envoi, affiche).
- **D3 sous Windows** (points en attente depuis l'étape 22) : ffmpeg accepté par le Contrôle intelligent des
  applications sur ce poste, priorité « Inactive » constatée, vrai Ctrl+C de console pendant un encodage avec
  `surge-media worker` puis `pnpm start` en `embedded` : arrêt en moins d'une seconde, ffmpeg arrêté, tâche rendue
  **sans essai compté**, reprise et terminée (rendu H.264 1080p) ; aucun processus restant.
- Charge (§ 12.1) : tableaux avant/après, trafic mixte jusqu'à 512 connexions sans erreur, écritures et envois,
  deux processus sur la même base SQLite, verrou tenu 13 s ; alerte déclenchée de bout en bout (vrai verrou),
  axe **0 violation** fr/en × clair/sombre, pas de défilement horizontal à 375 px ; coût de la mesure : nul sur
  `/m/`, 3 à 4 % sur l'API.

**Limites connues**
- Pas encore de prise en charge de `X-Forwarded-For` : derrière un mandataire, les limites par IP (clé publique,
  transformations libres, échecs d'authentification) s'appliquent à tous les visiteurs ensemble (§ 12.1).
- Limites et caches en mémoire de chaque processus (Redis pas branché) ; pas d'outil de copie SQLite → PostgreSQL.
- Attente du verrou SQLite : 10 s (processus figé pendant ce temps) ; seuils de l'alerte en constantes.
- Ctrl+C sur `pnpm dev` pendant un encodage : non rejoué sous Windows.
- Un dossier `node_modules/.pnpm` a été créé par erreur dans `packages/core/node_modules` (installation lancée par
  `pnpm` dans la copie isolée, arrêtée aussitôt ; les liens existants sont intacts) : il peut être supprimé.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance, aucune migration
```
Redémarrer le serveur (nouveaux plugins). Avec SQLite en production, un message rappelle ses limites au démarrage ;
le tableau de bord (ADMIN) signale une base sous pression.

### Maintenance — 2026-10-10 (suite) — Adresse IP réelle derrière un mandataire, WAL vérifié

**Cadre** : décisions de l'utilisateur après le test de charge — déploiement en Docker derrière un mandataire inverse :
prendre en compte `X-Forwarded-For` pour que les limites de débit et le journal d'audit voient la vraie adresse du
client ; garder l'attente du verrou SQLite à 10 s et s'assurer que le mode WAL est actif.

**Ajouté**
- `NUXT_TRUST_PROXY` (défaut `true` : boucle locale et réseaux privés ; `false` ; ou liste d'adresses et de plages
  CIDR avec `loopback` / `private`), § 6.3 et § 12. `server/lib/http/client-ip.ts` (pur, testé : normalisation des
  adresses, mandataires de confiance par `net.BlockList`, lecture de droite à gauche) et plugin
  `server/plugins/client-ip.ts`, qui pose `event.context.clientAddress` une fois par requête avant tout crochet :
  `getRequestIP(event)` de h3 le rend en priorité, d'où une seule adresse partout (limiteurs de connexion, de l'API v1
  et de `/m/`, journal d'audit, sessions, appareils de confiance, dernière utilisation des identifiants), sans
  modifier ces modules. Pas le « plus à gauche » de h3 (`xForwardedFor: true`) ni le `trust proxy: true` d'Express :
  usurpables quand le mandataire ajoute à l'en-tête reçu.
- WAL : le résultat de `PRAGMA journal_mode = WAL` est vérifié (avertissement si SQLite garde un autre mode).
  `?connection_limit=1` n'a pas été ajouté : il réglait le pool du moteur Rust de Prisma ≤ 6, absent avec les
  « driver adapters » (une seule connexion par processus, transactions déjà sérialisées).

**Vérifié** : 14 tests (`tests/client-ip.test.ts` : usurpations, IPv6, ports, en-têtes multiples ou démesurés,
listes) ; Vitest **553 tests** en 29 fichiers ; typecheck ; i18n. De bout en bout sur la build de production d'une copie
isolée : avec le défaut, 32 échecs d'authentification « depuis » A → A limité (429), B derrière le même mandataire non
limité, « A, C » → C retenu, « C, A » → A retenu, IP de la session et du journal d'audit = client réel (adresse usurpée
à gauche ignorée) ; avec `false` et avec une liste sans la boucle locale : en-tête ignoré partout, entrée invalide
signalée au démarrage. WAL constaté sur la base de la copie et sur celle de développement.

**Après `git pull`**
```bash
pnpm install          # aucune nouvelle dépendance, aucune migration
```
Redémarrer le serveur. En Docker derrière un mandataire : rien à régler si le mandataire est sur un réseau privé et
ajoute `X-Forwarded-For` (sinon § 12) ; ne pas publier le port du conteneur de l'application.

### Maintenance — 2026-10-10 — Licence BSL 1.1, README npm du core

**Cadre** : décision de l'utilisateur en vue du déploiement — surgeMedia passe de MIT (valeur par défaut jamais confirmée,
dépôt resté privé : aucune version publiée sous MIT) à la **Business Source License 1.1**, code public sur GitHub.

**Ajouté / modifié**
- `LICENSE` (racine) : modèle officiel BSL 1.1 de MariaDB, partie « Terms » et « Covenants of Licensor » **identique
  au texte de référence SPDX** (`BUSL-1.1`), seuls les paramètres sont propres à surgeMedia :
  - **Change Date** : trois ans après la première publication de chaque version ; **Change License** : Apache 2.0 ;
  - **Additional Use Grant** : production gratuite pour tous, sauf (a) entité (ou son groupe) au chiffre d'affaires brut supérieur
    à 500 000 USD au dernier exercice clos (conversion au taux publié par la Réserve fédérale américaine), y compris quand le logiciel est exploité
    pour son compte (agence, prestataire) ; (b) offre à des tiers d'un **service hébergé concurrent** (stockage de médias
    « as a service », CMS de médias headless, transformation ou diffusion de médias), gratuit ou payant. Exclus de (b) :
    les sites et applications de l'utilisateur lui-même, et l'instance dédiée qu'un prestataire héberge pour un client en
    accessoire de ses services (le client reste soumis au seuil) ;
  - fichiers placés sous une autre licence (futurs composants Vue/React/Svelte, par exemple) exclus du « Licensed Work ».
- `package.json` (racine et `packages/core`) : `"license": "BUSL-1.1"` ; README : section « Licence ». Montants
  commerciaux exprimés en **dollars américains** (décision de l'utilisateur).
- `packages/core/README.md` : présentation **en anglais** destinée à la page npm (fonctionnalités, prérequis,
  démarrage, CLI, variables essentielles, adresses de transformation, API, vidéos, production, résumé de la licence),
  liens absolus vers GitHub. Le démarrage décrit l'installation **depuis le dépôt** : le paquet npm n'est pas encore
  utilisable seul (voir ci-dessous).

**Reste à faire** : remplacer les trois `[TO BE COMPLETED: …]` du fichier `LICENSE` (nom légal du concédant, deux
fois, et adresse de contact pour la licence commerciale) **avant de rendre le dépôt public** :
```bash
grep -n "TO BE COMPLETED" LICENSE
```
Joindre `LICENSE` à toute copie distribuée (image Docker, paquet npm) : la BSL exige qu'elle accompagne chaque copie.

**Avant une publication npm** (constaté le 2026-10-10 avec `npm pack --dry-run --ignore-scripts` dans `packages/core`) :
le paquet est `private` et n'a pas de champ `files` (npm se rabat sur `.gitignore` : sources, tests et CLI construite
publiés, mais ni la build du serveur `.output`, ni `LICENSE`). Une fois installé, la CLI travaillerait dans
`node_modules/@surge-media/core` (`.env`, schéma, base SQLite et médias sous `./data`, effacés par une réinstallation),
et tout changement de fournisseur demande un `nuxt build`. Modèle de distribution à décider : image Docker, ou paquet
qui crée un dossier d'installation hors de `node_modules`.

### Étape 23 — 2026-10-10 — Image Docker, un client Prisma par fournisseur

**Cadre** : décisions de l'utilisateur — exécuter surgeMedia aussi par Docker (en plus de l'installation par npx),
image publiée plus tard sur GitHub Container Registry ; **une seule image pour les trois bases** ; deux variantes,
avec ffmpeg (par défaut) et `slim` sans ; workflow de publication GHCR reporté.

**Un client Prisma par fournisseur** (prérequis de l'image unique, § 6.2)
- `cli/lib/generate.ts` et `scripts/prisma-generate.ts` : un client par fournisseur dans
  `server/generated/prisma/<fournisseur>/`, depuis `server/generated/schemas/<fournisseur>.prisma` (copie du schéma,
  fournisseur et sortie réécrits) ; générés en parallèle (≈ 2,5 s), rien de refait si les schémas et la version de
  Prisma sont inchangés (`.stamp.json`). `server/generated/prisma/client.ts` ne réexporte que les **types** (ceux du
  client SQLite : les trois exposent la même interface, schéma portable).
- `server/utils/prisma.ts` : `CLIENT_MODULES` charge par import différé le client de `DATABASE_PROVIDER` (Nitro en
  fait trois morceaux, un seul est chargé).
- Scripts `dev`, `build`, `typecheck`, `postinstall` : `tsx scripts/prisma-generate.ts` au lieu de `prisma generate` ;
  `db:generate` force la régénération. CLI : `init`, `db migrate` et `db reset` génèrent les clients s'il le faut ;
  après un changement de fournisseur, « redémarrez » remplace « reconstruisez » (fr, en). **Changer de base ne
  demande plus de reconstruire l'application.**

**Docker** (§ 12.2)
- `Dockerfile` (racine) en plusieurs étapes, `.dockerignore`, `docker/entrypoint.sh` (commandes `server`, `worker`,
  `migrate` ; secrets générés et conservés dans le volume ; variables `_FILE` ; fournisseur déduit de l'URL ;
  attente de la base ; messages en français ou en anglais), `docker/compose.sqlite.yaml`,
  `docker/compose.postgres.yaml` (serveur web, processus de travail des vidéos, PostgreSQL 17).
- README (racine et core) : démarrage par Docker ; § 6.2, § 12 et § 14 mis à jour.

**Vérifié** : typecheck ; Vitest **553 tests** ; i18n ; build de production locale (trois clients embarqués, serveur
démarré sur SQLite) ; `pnpm db:migrate`. Avec Docker Desktop 29.1 (Windows, moteur Linux), parcours complet sur
chaque base — connexion (argon2), projet, jeton personnel, image envoyée puis transformée en AVIF (sharp), vidéo MKV
(MPEG-4 Part 2) convertie en H.264/AAC avec affiche :
- **SQLite**, image complète, mode `embedded` : santé en 11 s, secrets en `0600`, 16 migrations, WAL ; conteneur
  `healthy` ; arrêt propre en 2,6 s (code 0) ; redémarrage sans nouveau secret ni migration ;
- **PostgreSQL 17** (`compose.postgres.yaml`) : serveur et processus de travail `healthy`, vidéo traitée par le
  processus de travail ;
- **MariaDB 11** : **première exécution réelle des migrations MySQL** (16, sans erreur), URL lue par
  `DATABASE_URL_FILE`, attente de la base (2 essais), messages en anglais ;
- **`slim`** durcie (`--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`) : fonctionne ;
  traitement des vidéos désactivé avec un message clair ; commande `migrate` (serveur arrêté) et commande libre.

Non vérifié : arm64 (build multi-plateforme), mandataire inverse devant le conteneur, stockage S3, MySQL 8,
publication sur GHCR.

**Après `git pull`**
```bash
pnpm install          # régénère les trois clients Prisma (aucune migration)
```
L'ancien client unique de `server/generated/prisma` est remplacé automatiquement.

### Étape 24 — 2026-10-10 — Versions, releases et publication (npm, GHCR)

**Cadre** : demande de l'utilisateur — stratégie complète de versions et de releases pour `packages/core` :
CHANGELOG automatique, ESLint, scripts de version, de release et de publication, workflow GitHub publiant le
paquet npm et l'image Docker sur GHCR quand une release est publiée. Décisions de l'utilisateur : release par un
**script local** (`pnpm release`), paquet **`@surge-media/core`**, commits vérifiés par **commitlint**, première
version **0.1.0**.

**Prérequis : un paquet npm réellement utilisable** (§ 15.5). Constaté avant : serveur construit avec les modules
natifs de la plateforme de la build (sharp, argon2, better-sqlite3 : inutilisables sous un autre système), liens
symboliques de Nitro perdus par l'archive (« Cannot find package 'postgres-array' »), `.env` et données écrits
dans `node_modules`, `postinstall` dépendant de tsx.
- `package.json` du core : publiable (`files`, `bin`, `publishConfig`, dépôt, mots-clés, description anglaise) ;
  dépendances réduites à l'exécution (better-sqlite3 ajoutée, natives épinglées), le reste en développement ;
  `prepare` au lieu de `postinstall` ; scripts `lint`, `release`, `release:dry`, `changelog:preview`,
  `smoke:package`.
- `scripts/prepack.ts` : modules natifs retirés du serveur construit (versions comparées aux dépendances), liens
  de Nitro remplacés par des copies, licence copiée (`packages/core/LICENSE`, ignorée par git).
- CLI : **paquet** (code) et **dossier de l'installation** (`.env`, données) distingués (`cli/lib/project.ts`) —
  dossier courant pour le paquet publié, `packages/core` dans le dépôt (inchangé), `--cwd` sinon ; refus d'un
  dossier dans `node_modules` ; nouvelle commande **`start`** (`cli/server.ts`, qui remplace `cli/worker.ts`) ;
  migrations lancées depuis le paquet avec le schéma du fournisseur et une URL SQLite absolue ; vérification du
  pilote SQLite (`cli/lib/native.ts`) avec la marche à suivre pour npm 12 (scripts d'installation à approuver) ;
  fr, en.
- **Image Docker** construite depuis l'archive npm (étapes `package` et `install`, § 12.2) : même artefact
  partout ; `--build-context package=…` évite la build Nuxt par architecture ; plus d'étape Prisma séparée.

**Qualité** (§ 15.1) : ESLint 10 + `@nuxt/eslint` 1.17 (`eslint.config.mjs`, style dans `nuxt.config.ts`),
correction automatique de 49 fichiers ; défaut révélé et corrigé : widget « Votre compte » du tableau de bord
jamais affiché après une erreur de chargement (`v-else-if` mort, `app/pages/admin/index.vue`). commitlint
(`commitlint.config.mjs`) et hook `commit-msg` (simple-git-hooks) ; `pnpm-workspace.yaml` : scripts
d'installation de simple-git-hooks autorisés, de unrs-resolver refusés.

**Versions et publication** (§ 15.2 à § 15.4) : release-it 21 et `@release-it/conventional-changelog`
(`packages/core/.release-it.ts` : vérifications, version calculée depuis les Conventional Commits avec `preMajor`
avant 1.0.0, `CHANGELOG.md`, commit, tag `vX.Y.Z`, push, release GitHub par l'API ou le navigateur) ;
`.github/actions/setup`, `.github/workflows/ci.yml` (vérifications, paquet, image) et
`.github/workflows/release.yml` (paquet vérifié et essayé, npm avec provenance et publication de confiance, images
amd64 + arm64 complète et `slim` sur GHCR, archive jointe à la release ; `latest` réservé à la plus haute version
stable, étiquettes `next` et `release-X.Y`).

**Vérifié** : lint (0 problème), typecheck, Vitest **553 tests**, i18n ; workflows validés par actionlint ; logique
des étiquettes (`latest`, `next`, `release-X.Y`) sur quatre cas ; release-it : version calculée (0.0.1 en
automatique, 0.1.0 imposée), aperçu du CHANGELOG (Features, Bug Fixes ; documentation masquée), vérifications
préalables passées ; commitlint : message non conforme refusé, historique conforme accepté. Paquet : archive de
9,5 Mo sans module natif ; installé par **npm 12 sous Windows** dans un dossier vide : `init` et `start` depuis ce
dossier, parcours complet (connexion, projet, jeton, image, transformation AVIF) ; message de `start` vérifié sans
le module natif de better-sqlite3, puis fonctionnement après approbation et `npm rebuild` ; `smoke:package` sous
Windows (npm 12) et sous Linux (npm 11, étape `build` du Dockerfile). Docker : image construite **depuis l'archive
construite sous Windows** (88 s) — SQLite (vidéo MKV convertie, affiche) et PostgreSQL 17 avec processus de travail
— et depuis les sources (prepack sous Linux).

Non vérifié : exécution réelle des workflows sur GitHub (dépôt privé, aucun tag poussé), publication npm et GHCR,
arm64.

**Après `git pull`**
```bash
pnpm install          # ESLint, commitlint, release-it ; installe le hook commit-msg
```
Messages de commit au format Conventional Commits désormais exigés. Première release : configurer npm et GitHub
(§ 15.4, « À faire une fois ») et compléter `LICENSE` (vérifié par `license:check`), puis `pnpm release 0.1.0`.
