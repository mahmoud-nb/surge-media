# surgeMedia — site public et documentation

Vitrine commerciale et documentation de surgeMedia, construites avec [Astro Starlight](https://starlight.astro.build) :
anglais par défaut, français sous `/fr/`, thèmes clair et sombre, recherche intégrée. Publiées sur GitHub Pages à
chaque merge sur `main` (`.github/workflows/website.yml`).

Guide complet (structure, liens et chemin de base, traductions, publication) : [setup.md § 16](../../setup.md#16-site-public-et-documentation-appswebsite).

## Commandes

Depuis la racine du dépôt :

```bash
pnpm install
pnpm website:dev        # http://localhost:4321/surge-media/
pnpm website:build      # site statique dans apps/website/dist
```

Dans `apps/website` :

| Commande | Rôle |
| --- | --- |
| `pnpm typecheck` | vérification des types (`astro check`) |
| `pnpm check:links` | liens internes et ancres du build (après `pnpm build`) |
| `pnpm preview` | sert le build localement |
| `pnpm og-image` | régénère `public/og.png` depuis `scripts/og-image.svg` |

## Ajouter ou modifier une page

1. Écrire la page anglaise dans `src/content/docs/…` (`.md`, ou `.mdx` pour utiliser des composants).
2. Écrire sa traduction au même chemin sous `src/content/docs/fr/…` (sinon la page anglaise est servie avec un
   avertissement).
3. L'ajouter à `sidebar` dans `astro.config.mjs` si elle doit apparaître dans la navigation.
4. Liens : **relatifs** dans le Markdown (`../security/`) ; absolus (`/pricing/`, `/fr/pricing/`) seulement dans le
   frontmatter et les props des composants, qui ajoutent le chemin de base.

## Domaine personnalisé

Configurer le domaine dans *Settings › Pages* : le workflow récupère l'adresse et le chemin de base de GitHub
Pages, sans autre modification. En local : `SITE_URL=https://surge-media.example BASE_PATH=/ pnpm build`.
