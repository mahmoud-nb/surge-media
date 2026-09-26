# surgeMedia

Plateforme **auto-hébergée** et modulaire de gestion et de traitement des médias (un « mini-Cloudinary ») :
interface d'administration, API sécurisée (jetons d'accès, CORS) et transformations d'images à la demande
(crop, resize, optimisation) — avec des composants prêts à l'emploi pour Vue, React et Svelte.

| Package | Rôle | État |
| --- | --- | --- |
| [`@surge-media/core`](packages/core) | admin + API + traitement d'images (Nuxt 3, Nitro, Prisma, sharp, unstorage) | en cours |
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
