# surgeMedia — guide de développement

Ce guide explique comment installer, lancer et faire évoluer le monorepo surgeMedia.
Il est tenu à jour à chaque étape du projet (voir le [Journal des étapes](#journal-des-étapes)).

---

## 1. Prérequis

| Outil | Version | Remarque |
| --- | --- | --- |
| Node.js | 22.12+ ou 24+ (recommandé : 24, cf. `.nvmrc`) | Node 20 n'est plus maintenu |
| pnpm | 12.x | `corepack enable` utilise la version du champ `packageManager` |
| Git | récent | |
| PostgreSQL / MySQL / MariaDB | optionnel | uniquement si vous n'utilisez pas SQLite |

## 2. Démarrage rapide (dépôt déjà cloné)

```bash
pnpm install        # dépendances + nuxt prepare + prisma generate
pnpm db:init        # choix du fournisseur de base (SQLite par défaut) + migrations
pnpm dev            # http://localhost:3000
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
      ├─ server/
      │  ├─ api/           routes API Nitro (health.get.ts…)
      │  ├─ plugins/       montage du stockage, fermeture de la base
      │  ├─ utils/         usePrisma(), MEDIA_STORAGE (auto-importés)
      │  └─ generated/     client Prisma généré (non versionné)
      ├─ shared/           code partagé serveur / CLI / config (fournisseurs de BDD)
      ├─ prisma/
      │  ├─ schema.prisma
      │  └─ migrations/<fournisseur>/   un historique par fournisseur
      ├─ cli/              CLI `surge-media` (init, db migrate, db reset), i18n fr/en
      ├─ scripts/          outils de maintenance (génération des migrations)
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

# dépendances du core
pnpm --filter @surge-media/core add prisma@7.10.0 @prisma/client@7.10.0 \
  @prisma/adapter-better-sqlite3@7.10.0 @prisma/adapter-pg@7.10.0 @prisma/adapter-mariadb@7.10.0 \
  sharp unstorage citty @clack/prompts
pnpm --filter @surge-media/core add -D typescript@~6.0.3 vue-tsc tsx tsdown @types/node@24

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
| `pnpm db:init` | configure la base (fournisseur + URL) et applique les migrations |
| `pnpm db:migrate` | applique les migrations en attente |
| `pnpm db:reset` | recrée la base (⚠ supprime les données), éventuellement avec un autre fournisseur |
| `pnpm db:studio` | Prisma Studio |
| `pnpm cli <commande>` | lance la CLI `surge-media` depuis les sources |

Dans `packages/core` uniquement : `pnpm db:generate` (client Prisma), `pnpm db:migration <nom>`
(maintenance, voir § 6.5), `pnpm build:cli` (build de la CLI), `pnpm start` (serveur de production).

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
| `NUXT_STORAGE_BASE` | `./data/media` | dossier des fichiers médias (originaux et dérivés) |
| `SURGE_MEDIA_LANG` | locale système, sinon `fr` | langue de la CLI |

### 6.4 Modèle de données (`prisma/schema.prisma`)

| Modèle | Rôle |
| --- | --- |
| `User` | comptes de l'interface d'administration (rôle `ADMIN`/`EDITOR`/`VIEWER`, langue préférée) |
| `Session` | sessions d'administration (seule l'empreinte SHA-256 du jeton est stockée) |
| `Project` | application cliente : regroupe médias, dossiers, jetons et origines CORS |
| `AccessToken` | jeton d'API d'un projet (empreinte + préfixe lisible, portées, expiration, révocation) |
| `AllowedOrigin` | origines autorisées (CORS) pour les appels navigateur d'un projet |
| `Folder` | arborescence de dossiers d'un projet |
| `Media` | fichier original (type, visibilité publique/privée, dimensions, empreinte, alt, corbeille) |
| `MediaVariant` | dérivé généré à la demande (crop, resize, format, qualité) et mis en cache |

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
# 3. appliquer localement
pnpm db:migrate
```

Le script compare `prisma/migrations/schema.snapshot.prisma` (état à la dernière migration) au schéma
courant, écrit une migration par fournisseur puis met l'instantané à jour. En CI,
`pnpm --filter @surge-media/core db:migration --check` échoue si le schéma a changé sans migration.
Ne modifiez jamais une migration déjà publiée.

## 7. Stockage des fichiers (unstorage)

Le plugin `server/plugins/storage.ts` monte le pilote `fs` d'unstorage sur `useStorage('media')`
(constante `MEDIA_STORAGE`) au démarrage, dans le dossier `NUXT_STORAGE_BASE`. Le montage se fait à
l'exécution pour que le dossier reste configurable sans rebuild. D'autres pilotes (S3, Azure…)
pourront être branchés au même endroit.

## 8. Traitement d'images (sharp)

`sharp` (libvips) est installé avec ses binaires précompilés ; aucun outil de compilation n'est
nécessaire sur Windows, macOS et Linux glibc. La sonde `/api/health` vérifie qu'il se charge.

## 9. Production

```bash
pnpm build                          # nuxt build + build de la CLI
cd packages/core && pnpm db:migrate # appliquer les migrations sur la base de production
pnpm start                          # node --env-file-if-exists=.env .output/server/index.mjs
```

- En production, `.env` n'est lu que par le script `start` ; sinon fournissez les variables d'environnement.
- Le client Prisma est lié au fournisseur choisi : tout changement de fournisseur impose un rebuild.
- `GET /api/health` : 200 si base, stockage et sharp répondent, 503 sinon (sonde Docker / orchestrateur).

## 10. Choix techniques et versions épinglées

| Choix | Pourquoi |
| --- | --- |
| Nuxt 3.21 + `future.compatibilityVersion: 4` | Nuxt 3 demandé, toujours maintenu en parallèle de Nuxt 4 ; structure `app/` et comportements Nuxt 4 déjà actifs, la migration se limitera à la mise à jour de la dépendance |
| Prisma **7.10.0** épinglé exactement | le tag npm `latest` de `prisma` pointe vers une 8.0.0-rc ; ne pas mettre à jour sans tester |
| Prisma 7 + driver adapters | client sans moteur Rust ; un adapter par fournisseur, choisi à l'exécution |
| TypeScript **~6.0** | TypeScript 7 (compilateur natif) n'est pas encore utilisable par `vue-tsc` |
| `prisma` en dépendance (pas devDependency) | la CLI `surge-media` en a besoin chez l'utilisateur final pour générer et migrer |
| Client Prisma importé dynamiquement (`usePrisma()` asynchrone) | voir Dépannage : « File URL path must be absolute » |
| CLI : citty + @clack/prompts, build tsdown | écosystème UnJS (comme Nuxt), binaire ESM autonome |

## 11. Dépannage

| Symptôme | Cause / solution |
| --- | --- |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 12 bloque les scripts d'installation : `pnpm approve-builds <paquet>` (la liste autorisée est dans `pnpm-workspace.yaml` › `allowBuilds`) |
| Avertissement *unmet peer @nuxt/schema ^4* (via `@nuxt/cli`) | sans effet : la CLI Nuxt est partagée entre Nuxt 3 et 4 |
| `File '../.nuxt/tsconfig.server.json' not found` pendant `prisma generate` | lancer `nuxt prepare` avant `prisma generate` (ordre du `postinstall`) |
| `File URL path must be absolute` au démarrage (Windows) | ne jamais importer statiquement `server/generated/prisma` dans le code serveur : passer par `await usePrisma()` |
| `P3019` / fournisseur différent de `migration_lock.toml` | `.env` et schéma désynchronisés : relancer `pnpm db:init` |
| `prisma migrate reset` refusé (« invoked by … AI agent ») | garde-fou de Prisma quand la commande est lancée par un agent IA : lancez `pnpm db:reset` vous-même |
| Base SQLite créée au mauvais endroit | lancer les commandes depuis `packages/core` (chemin relatif) ou utiliser un chemin absolu |

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
