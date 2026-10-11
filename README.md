# surgeMedia

Plateforme **auto-hébergée** et modulaire de gestion et de traitement des médias (un « mini-Cloudinary ») :
interface d'administration, API sécurisée (jetons d'accès, CORS), transformations d'images à la demande
(crop, resize, optimisation) et vidéos (diffusion directe, conversion facultative par ffmpeg, hors du chemin des requêtes) —
avec des composants prêts à l'emploi pour Vue, React et Svelte.

| Package | Rôle | État |
| --- | --- | --- |
| [`@surge-media/core`](apps/core) | admin + API + traitement des images et des vidéos (Nuxt 3, Nitro, Prisma, Flydrive, sharp ; ffmpeg ≥ 6 du système, facultatif) | en cours |
| `@surge-media/vue` · `react` · `svelte` | composants frontend (images optimisées, galeries, upload…) | à venir |
| `docs` | documentation (GitHub Pages) | à venir |

## Démarrer

Depuis les sources (développement) :

```bash
pnpm install
pnpm db:init   # SQLite par défaut, ou PostgreSQL / MySQL / MariaDB
pnpm dev
```

Avec le paquet npm, dans le dossier qui contiendra la configuration et les données (npm 12 et plus : approuver
d'abord les scripts d'installation, [setup.md § 15.5](setup.md#155-le-paquet-npm)) :

```bash
npm install @surge-media/core
npx surge-media init
npx surge-media start
```

Ou avec Docker (une seule image pour SQLite, PostgreSQL et MySQL/MariaDB ; variante `slim` sans ffmpeg) :

```bash
docker build -t surge-media .
docker run -d -p 127.0.0.1:3000:3000 -v surge-media-data:/app/data -e NUXT_SITE_URL=http://localhost:3000 \
  -e NUXT_BOOTSTRAP_ADMIN_EMAIL=vous@exemple.fr -e NUXT_BOOTSTRAP_ADMIN_PASSWORD=un-mot-de-passe-long surge-media
```

Exemples Compose dans [`docker/`](docker), détails dans [setup.md § 12.2](setup.md#122-docker). Images
publiées à chaque version : `ghcr.io/mahmoud-nb/surge-media` (amd64, arm64).

Guide complet de développement : [setup.md](setup.md) ; versions, releases et publication :
[§ 15](setup.md#15-qualité-du-code-versions-et-publication) ; historique :
[CHANGELOG](apps/core/CHANGELOG.md).

## Licence

surgeMedia est distribué sous **Business Source License 1.1** (identifiant SPDX `BUSL-1.1`) : voir [LICENSE](LICENSE).
Le code source est public, mais il ne s'agit pas d'une licence open source au sens de l'OSI. En résumé :

- développement, tests et évaluation : **libres et gratuits pour tous** ;
- utilisation en production : **gratuite**, sauf dans deux cas qui demandent une licence commerciale :
  - l'entité qui l'utilise (ou pour le compte de laquelle il est utilisé), avec les sociétés de son groupe, a réalisé
    un chiffre d'affaires brut supérieur à **500 000 USD** lors de son dernier exercice clos ;
  - surgeMedia est proposé à des tiers comme **service hébergé concurrent** (stockage de médias « as a service »,
    CMS de médias headless…) ;
- chaque version passe sous **licence Apache 2.0** trois ans après sa première publication.

Ce résumé n'a pas de valeur juridique : seul le texte anglais du fichier [LICENSE](LICENSE) fait foi.
