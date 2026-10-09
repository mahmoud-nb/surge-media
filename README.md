# surgeMedia

Plateforme **auto-hébergée** et modulaire de gestion et de traitement des médias (un « mini-Cloudinary ») :
interface d'administration, API sécurisée (jetons d'accès, CORS), transformations d'images à la demande
(crop, resize, optimisation) et vidéos (diffusion directe, conversion facultative par ffmpeg, hors du chemin des requêtes) —
avec des composants prêts à l'emploi pour Vue, React et Svelte.

| Package | Rôle | État |
| --- | --- | --- |
| [`@surge-media/core`](packages/core) | admin + API + traitement des images et des vidéos (Nuxt 3, Nitro, Prisma, Flydrive, sharp ; ffmpeg ≥ 6 du système, facultatif) | en cours |
| `@surge-media/vue` · `react` · `svelte` | composants frontend (images optimisées, galeries, upload…) | à venir |
| `docs` | documentation (GitHub Pages) | à venir |

## Démarrer

```bash
pnpm install
pnpm db:init   # SQLite par défaut, ou PostgreSQL / MySQL / MariaDB
pnpm dev
```

Guide complet de développement : [setup.md](setup.md).

## Licence

MIT
