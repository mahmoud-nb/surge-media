---
title: SDK et composants
description: '@surge-media/vue et @surge-media/client : images responsives, vidéos et accès à l’API pour Vue 3 et Nuxt, sous licence MIT. L’API REST fonctionne avec tous les langages.'
---

surgeMedia est conçu « API d’abord » : tout ce que l’administration fait avec les médias, votre code peut le faire avec l’API REST v1. Les paquets front-end officiels réduisent les intégrations les plus courantes — images responsives, vidéos, envois, sélecteurs — à quelques lignes.

## Paquets

| Paquet | Pour | Licence | État |
| --- | --- | --- | --- |
| `@surge-media/core` | Serveur : administration, API REST, diffusion, traitements | BUSL-1.1 | **Disponible** |
| `@surge-media/client` | Tout environnement JavaScript : navigateur, Node.js, edge | MIT | En développement — première version 0.1 |
| `@surge-media/vue` | Vue 3.5+, Nuxt compris | MIT | En développement — première version 0.1 |
| `@surge-media/nuxt` | Module Nuxt (auto-imports, route des jetons) | MIT | Plus tard — Nuxt fonctionne dès aujourd’hui avec `@surge-media/vue` |
| `@surge-media/react` | React, Next.js | MIT | Prévu |
| `@surge-media/svelte` | Svelte, SvelteKit | MIT | Prévu |

Les composants d’affichage (images, `<picture>`, vidéos, vignettes, état du traitement) sont prêts ; l’envoi de fichiers, les sélecteurs de médias et l’édition (point d’intérêt, recadrage, image d’affiche, sous-titres) suivent avant la première version. Suivez les versions du [dépôt GitHub](https://github.com/mahmoud-nb/surge-media) pour être averti.

## @surge-media/vue

### Installation

```bash
npm install @surge-media/vue
```

`@surge-media/client` est installé avec lui. Vue 3.5 ou plus récent est requis.

### Mise en place

Déclarez le plugin une fois, avec l’adresse de votre instance, l’identifiant du projet et un identifiant d’accès :

```ts
// main.ts
import { createSurgeMedia } from '@surge-media/vue'
import '@surge-media/vue/style.css' // thème facultatif

app.use(createSurgeMedia({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  publishableKey: 'sm_pk_…',
  // Français par défaut ; une ref suit la langue de l'application.
  locale: 'fr',
}))
```

| Identifiant | À utiliser pour |
| --- | --- |
| Aucun | Afficher des objets `Media` déjà lus par votre back-end (médias publics, ou privés avec leurs URL signées). |
| Clé publique (`publishableKey`) | Sites publics : médias publics, liste si le projet l’active. Limitée aux origines autorisées du projet. |
| Jetons délégués (`getToken`) | Utilisateurs connectés : médias privés, puis envois et édition. Votre back-end émet des jetons de courte durée avec sa clé secrète ; le client les renouvelle avant leur échéance. Incluez `project:read` dans leurs portées. |

**Ne placez jamais une clé secrète ou un jeton personnel dans un navigateur** : le client les refuse et l’API les rejette (`SECRET_IN_BROWSER`).

### Composants

```vue
<script setup lang="ts">
import type { Media } from '@surge-media/client'
import { SmImage, SmPicture, SmVideo } from '@surge-media/vue'

defineProps<{ hero: Media; gallery: Media[]; trailer: Media }>()
</script>

<template>
  <!-- Image fluide : srcset avec la largeur réelle de chaque fichier -->
  <SmImage :media="hero" sizes="(min-width: 960px) 50vw, 100vw" priority />

  <!-- Taille fixe, recadrage 16:9 sur le point d'intérêt : 1x, 2x, 3x -->
  <SmImage
    v-for="item in gallery" :key="item.id"
    :media="item" :width="320" aspect="16/9"
  />

  <!-- AVIF, WebP et JPEG ; recadrage carré sur petit écran -->
  <SmPicture
    :media="hero"
    :sources="[{ media: '(max-width: 640px)', aspect: 1 }]"
  />

  <!-- Lecteur natif : sources AV1 ou H.264, affiche, sous-titres -->
  <SmVideo :media="trailer" />
</template>
```

| Composant | Rôle |
| --- | --- |
| `SmImage` | `<img>` avec un `srcset` en largeurs (ou en densités avec une `width` fixe), `width` / `height` toujours posés (aucun décalage au chargement), recadrage serveur autour du point d’intérêt (`aspect`, `fit`), préréglages (`preset`, `presets`), `loading`, `fetchpriority` ou `priority`, `objectFit` pour remplir un cadre. Texte alternatif tiré de `alt` ou du média ; `decorative` pour une image purement décorative. |
| `SmPicture` | `<picture>` avec une `<source>` par format activé sur le serveur (AVIF, WebP) et un repli JPEG ; direction artistique par `sources` (un cadrage par media query). |
| `SmVideo` | Le lecteur natif du navigateur avec les `sources` de lecture du serveur, une affiche dimensionnée, les pistes de texte, le chargement différé (`lazy`). Aucune lecture automatique : `ambient` passe une vidéo muette en boucle avec un bouton pause. Pendant que le serveur prépare une vidéo, affiche son état et un lien vers l’original. |
| `SmMedia` | Choisit `SmImage` ou `SmVideo` selon le genre du média. |
| `SmThumbnail` | Vignette carrée recadrée autour du point d’intérêt, durée d’une vidéo, pastille d’état du traitement. |
| `SmProcessingStatus` | État du traitement d’une vidéo, avec barre de progression et annonces polies pour les lecteurs d’écran. |

Les composants respectent la politique de transformation du projet : en **préréglages seulement**, ils construisent leur `srcset` à partir des préréglages ; en **signées seulement**, aussi, sauf pour un média privé (ses URL sont déjà signées). Si un dérivé ne se charge pas, l’image se replie sur le fichier original, puis sur son texte alternatif.

`useMedia(id)` charge un média dans le navigateur, renouvelle les URL signées d’un média privé avant leur échéance et suit le traitement d’une vidéo jusqu’à ce qu’elle soit prête.

### Thème et langues

- `@surge-media/vue/style.css` est facultatif : sans lui, tailles, rapports et textes réservés aux lecteurs d’écran restent corrects. Il définit des jetons `--sm-*` (`--sm-color-primary`, `--sm-color-surface`, `--sm-radius`…) en clair et en sombre — le sombre suit la préférence du système, sauf si un ancêtre porte `.light` ou `[data-theme="light"]`, ou dès qu’il porte `.dark` ou `[data-theme="dark"]`. Tout est rangé dans la couche CSS `surge-media` : vos styles l’emportent toujours.
- Le français (par défaut) et l’anglais sont intégrés. Passez `locale` (chaîne ou ref) et surchargez ou ajoutez des textes avec `messages: { fr: { video: { download: 'Télécharger' } } }`.
- Les composants visent le niveau WCAG 2.2 AA : éléments natifs, accès au clavier, aucune lecture automatique, contrastes vérifiés dans les deux thèmes.

## @surge-media/client

La couche sans framework sur laquelle reposent les composants — à utiliser directement en JavaScript, sur un serveur ou dans un autre framework :

```ts
import {
  createSurgeClient,
  srcsetAttribute,
  widthCandidates,
} from '@surge-media/client'

const client = createSurgeClient({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  publishableKey: 'sm_pk_…',
})

const { items } = await client.media.list({ kind: 'image', limit: 12 })
// Politique de transformation, formats activés, taille maximale
const project = await client.project()

const srcset = srcsetAttribute(widthCandidates(items[0], {
  widths: [480, 960, 1440],
  format: 'avif',
  maxDimension: project.transformMaxDimension,
}))
```

Il gère la revalidation par ETag, le renouvellement des jetons délégués et les erreurs traduites (`SurgeApiError`), et construit les URL de transformation sous forme canonique — exactement celle qu’attend le serveur, donc sans redirection.

## Tous les langages

L’API est décrite par un document **OpenAPI 3.1** servi par votre instance sur `/api/v1/openapi.json` (`?lang=fr` ou `en`). Générez un client typé avec l’outil de votre choix — par exemple, en TypeScript :

```bash
npx openapi-typescript https://media.example.com/api/v1/openapi.json \
  -o surge-media.d.ts
```

Les URL d’images ne demandent aucun SDK : remplacez `{transform}` et `{format}` dans le `urlTemplate` d’un média — voir [Transformations d’images](../image-transformations/).

## Nuxt

`@surge-media/vue` fonctionne dans Nuxt (avec Vue 3.5 ou plus récent) et avec son rendu serveur : un plugin Nuxt s’exécute une fois par requête côté serveur, exactement ce dont la librairie a besoin (un jeton délégué appartient à un seul visiteur). Un module `@surge-media/nuxt` dédié pourra venir plus tard ; rien de ce qui suit ne devra changer.

### 1. Installer et configurer

```bash
npm install @surge-media/vue
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: ['@surge-media/vue/style.css'], // thème facultatif
  runtimeConfig: {
    surgeMedia: {
      // NUXT_SURGE_MEDIA_SECRET_KEY — serveur seulement (étape 3)
      secretKey: '',
    },
    public: {
      surgeMedia: {
        baseUrl: '', // NUXT_PUBLIC_SURGE_MEDIA_BASE_URL
        projectId: '', // NUXT_PUBLIC_SURGE_MEDIA_PROJECT_ID
        publishableKey: '', // NUXT_PUBLIC_SURGE_MEDIA_PUBLISHABLE_KEY
      },
    },
  },
})
```

Renseignez ces variables (`NUXT_PUBLIC_SURGE_MEDIA_BASE_URL` : l’adresse de votre instance, par exemple `https://media.example.com`), puis ajoutez l’origine de votre site (`https://www.example.com`) aux origines autorisées du projet, dans l’administration de surgeMedia.

### 2. Créer `plugins/surge-media.ts`

```ts
// plugins/surge-media.ts
import {
  createSurgeMedia,
  SmImage,
  SmMedia,
  SmPicture,
  SmThumbnail,
  SmVideo,
} from '@surge-media/vue'

export default defineNuxtPlugin((nuxtApp) => {
  const { surgeMedia } = useRuntimeConfig().public

  nuxtApp.vueApp.use(createSurgeMedia({
    baseUrl: surgeMedia.baseUrl,
    projectId: surgeMedia.projectId,
    publishableKey: surgeMedia.publishableKey,
    // Avec @nuxtjs/i18n : locale: nuxtApp.$i18n.locale
    locale: 'fr',
    // Préréglages seuls, transformations signées ou formats limités ?
    // Indiquez-le ici : le rendu serveur construit alors les bonnes URL.
    // defaults: { policy: 'presets', formats: ['webp', 'jpg'] },
  }))

  // Disponibles partout (pages et composants), sans import.
  const components = { SmImage, SmPicture, SmVideo, SmMedia, SmThumbnail }
  for (const [name, component] of Object.entries(components)) {
    nuxtApp.vueApp.component(name, component)
  }
})
```

Utilisez ensuite les composants partout, avec des médias lus côté serveur pour que la page soit rendue complète :

```vue
<!-- pages/index.vue -->
<script setup lang="ts">
const config = useRuntimeConfig().public.surgeMedia
const { data: hero } = await useFetch(
  `${config.baseUrl}/api/v1/projects/${config.projectId}/media/cm…`,
  { headers: { Authorization: `Bearer ${config.publishableKey}` } },
)
</script>

<template>
  <SmImage v-if="hero" :media="hero" sizes="100vw" priority />
</template>
```

### 3. Médias privés : jetons délégués (facultatif)

Pour montrer des médias privés aux visiteurs connectés, laissez votre serveur Nuxt émettre des jetons délégués avec la **clé secrète** du projet, qui ne quitte jamais le serveur :

```ts
// server/api/surge-media/token.post.ts
export default defineEventHandler(async (event) => {
  // Votre propre authentification : seuls les visiteurs connectés
  // reçoivent un jeton (requireUserSession vient de nuxt-auth-utils).
  const { user } = await requireUserSession(event)
  const config = useRuntimeConfig(event)
  const { baseUrl, projectId } = config.public.surgeMedia

  // Renvoie { token, expiresAt, scopes } : accepté tel quel.
  const url = `${baseUrl}/api/v1/projects/${projectId}/delegated-tokens`
  return $fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.surgeMedia.secretKey}` },
    body: {
      scopes: ['project:read', 'media:read'],
      expiresIn: 900,
      subject: String(user.id),
    },
  })
})
```

Dans le plugin, remplacez `publishableKey` par `getToken` :

```ts
// plugins/surge-media.ts
// Transmet les cookies du visiteur pendant le rendu serveur
const requestFetch = useRequestFetch()

nuxtApp.vueApp.use(createSurgeMedia({
  baseUrl: surgeMedia.baseUrl,
  projectId: surgeMedia.projectId,
  getToken: () =>
    requestFetch('/api/surge-media/token', { method: 'POST' }),
}))
```

Le client demande un jeton à la première utilisation et le renouvelle avant son échéance. Comme le plugin s’exécute pour chaque requête, deux visiteurs ne partagent jamais un jeton.

## Voir aussi

- [Architecture et API](../../guides/architecture/)
- [Sécurité et contrôle d’accès](../../guides/security/)
- [Transformations d’images](../image-transformations/)
