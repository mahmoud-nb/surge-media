---
title: SDK et composants
description: L’API REST fonctionne aujourd’hui avec tous les langages. Des composants officiels pour Vue, React et Svelte sont prévus.
---

surgeMedia est conçu « API d’abord » : tout ce que l’administration fait avec les médias, votre code peut le faire avec l’API REST v1. Des paquets front-end officiels réduiront les intégrations les plus courantes à une seule ligne.

## Feuille de route

| Paquet | Framework | État |
| --- | --- | --- |
| `@surge-media/core` | Serveur : administration, API REST, diffusion, traitements | **Disponible** |
| `@surge-media/vue` | Vue 3, Nuxt | Prévu |
| `@surge-media/react` | React, Next.js | Prévu |
| `@surge-media/svelte` | Svelte, SvelteKit | Prévu |

Chaque paquet de composants proposera :

- **Image optimisée** — `srcset`, `<picture>` avec AVIF / WebP, recadrage sur le point d’intérêt, chargement différé, construits à partir du `urlTemplate` du média.
- **Galerie et sélecteur de médias** — parcourir les médias et les dossiers d’un projet avec une clé publique ou un jeton délégué.
- **Envoi de fichiers** — envois directs depuis le navigateur avec un jeton délégué émis par votre back-end : progression, contrôle du type et de la taille, nouvelles tentatives.
- **Aides pour la vidéo** — `sources`, affiche et sous-titres reliés à un élément `<video>` natif.

Suivez les versions du [dépôt GitHub](https://github.com/mahmoud-nb/surge-media) pour être averti.

## Aujourd’hui : tous les langages

L’API est décrite par un document **OpenAPI 3.1** servi par votre instance sur `/api/v1/openapi.json` (`?lang=fr` ou `en`). Générez un client typé avec l’outil de votre choix — par exemple, en TypeScript :

```bash
npx openapi-typescript https://media.example.com/api/v1/openapi.json -o surge-media.d.ts
```

Une fonction d’images responsives tient en quelques lignes, sans dépendance :

```ts
type Media = { urlTemplate: string | null; width: number | null; altText: string | null };

export function srcset(media: Media, widths = [480, 800, 1200, 1600], format = 'avif') {
  if (!media.urlTemplate) return '';
  return widths
    .filter((w) => !media.width || w <= media.width)
    .map((w) => `${media.urlTemplate!.replace('{transform}', `w_${w}`).replace('{format}', format)} ${w}w`)
    .join(', ');
}
```

## Voir aussi

- [Architecture et API](../../guides/architecture/)
- [Transformations d’images](../image-transformations/)
