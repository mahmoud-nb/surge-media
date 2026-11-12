---
title: SDK et composants
description: '@surge-media/vue et @surge-media/client : images responsives, vidéos et accès à l’API pour Vue 3 et Nuxt, sous licence MIT. L’API REST fonctionne avec tous les langages.'
---

SurgeMedia est conçu « API d’abord » : tout ce que l’administration fait avec les médias, votre code peut le faire avec l’API REST v1. Les paquets front-end officiels réduisent les intégrations les plus courantes — images responsives, vidéos, envois, sélecteurs — à quelques lignes.

## Paquets

| Paquet | Pour | Licence | État |
| --- | --- | --- | --- |
| `@surge-media/core` | Serveur : administration, API REST, diffusion, traitements | BUSL-1.1 | **Disponible** |
| `@surge-media/client` | Tout environnement JavaScript : navigateur, Node.js, edge | MIT | En développement — première version 0.1 |
| `@surge-media/vue` | Vue 3.5+, Nuxt compris | MIT | En développement — première version 0.1 |
| `@surge-media/nuxt` | Module Nuxt (auto-imports, route des jetons) | MIT | Plus tard — Nuxt fonctionne dès aujourd’hui avec `@surge-media/vue` |
| `@surge-media/react` | React, Next.js | MIT | Prévu |
| `@surge-media/svelte` | Svelte, SvelteKit | MIT | Prévu |

Les composants d’affichage (images, `<picture>`, vidéos, vignettes, état du traitement) et l’envoi de fichiers sont prêts ; les sélecteurs de médias et l’édition (point d’intérêt, recadrage, image d’affiche, sous-titres) suivent avant la première version. Suivez les versions du [dépôt GitHub](https://github.com/mahmoud-nb/surge-media) pour être averti.

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
| Jetons délégués (`getToken`) | Utilisateurs connectés : médias privés, envois, puis édition. Votre back-end émet des jetons de courte durée avec sa clé secrète ; le client les renouvelle avant leur échéance. Incluez `project:read` dans leurs portées. |

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
| `SmUploader` | Envoi d’images et de vidéos avec des jetons délégués : champ de fichier natif, dépôt, collage, contrôle avant l’envoi, progression, annulation, nouvel essai, capture de l’affiche — voir [Envoyer des fichiers](#envoyer-des-fichiers). |

Les composants respectent la politique de transformation du projet : en **préréglages seulement**, ils construisent leur `srcset` à partir des préréglages ; en **signées seulement**, aussi, sauf pour un média privé (ses URL sont déjà signées). Si un dérivé ne se charge pas, l’image se replie sur le fichier original, puis sur son texte alternatif.

`useMedia(id)` charge un média dans le navigateur, renouvelle les URL signées d’un média privé avant leur échéance et suit le traitement d’une vidéo jusqu’à ce qu’elle soit prête.

### Envoyer des fichiers

`SmUploader` envoie des images et des vidéos dans le projet avec des **jetons délégués** qui comprennent la portée `media:upload` (voir plus bas) :

```vue
<script setup lang="ts">
import type { Media } from '@surge-media/client'
import { SmUploader } from '@surge-media/vue'

function onUploaded(media: Media) {
  // Enregistrez media.id avec votre contenu
}
</script>

<template>
  <SmUploader :kinds="['image']" details @uploaded="onUploaded" />
</template>
```

- **Contrôle avant l’envoi** : types acceptés, taille maximale par type et envois restants viennent du jeton (`GET /me`) ; un fichier refusé est expliqué aussitôt, par exemple « Ce fichier est trop volumineux. Taille maximale : 25 Mo. ». Le serveur vérifie toujours le contenu.
- **File d’envoi** : deux envois à la fois, progression par fichier, annulation, nouvel essai ; nouvel essai automatique après un `429`, un `503` ou une erreur réseau, 3 fois au plus.
- **Vidéos** : une image d’affiche est capturée dans le navigateur pendant l’envoi, puis jointe à la vidéo.
- **`details`** : titre et texte alternatif sont saisis avant l’envoi — un jeton d’envoi ne peut pas modifier un média ensuite. Sans cette option, les fichiers partent dès qu’ils sont choisis.
- `visibility`, `chooseVisibility` et `folderId` décident où vont les fichiers, sauf si le jeton les impose ; `capture` (`user` ou `environment`) ouvre l’appareil photo sur mobile. Événements : `uploaded`, `error`, `done`.
- Accessible : un champ de fichier natif avec un bouton visible (le dépôt et le collage ne font que s’y ajouter), contraintes reliées au champ, une annonce par fichier terminé.

Votre back-end émet les jetons avec la **clé secrète** du projet, grâce à l’entrée serveur du client. Ajoutez `@surge-media/client` à vos dépendances, dans la même version que `@surge-media/vue` :

```ts
// server.ts — Node.js avec Express
import express from 'express'
import {
  createDelegatedToken,
  UPLOAD_SCOPES,
} from '@surge-media/client/server'

const app = express()

app.post('/api/surge-media/token', async (req, res) => {
  const user = req.user // votre propre authentification
  if (!user) return res.sendStatus(401)
  res.json(await createDelegatedToken({
    baseUrl: process.env.SURGE_MEDIA_URL!,
    projectId: process.env.SURGE_MEDIA_PROJECT!,
    secretKey: process.env.SURGE_MEDIA_SECRET_KEY!,
    scopes: UPLOAD_SCOPES, // project:read, media:read, media:upload
    subject: String(user.id),
    origin: 'https://www.example.com',
    // Facultatif : types, visibility, folderId
    upload: { maxFiles: 10, maxSize: 50 * 1024 * 1024 },
  }))
})
```

Le plugin reçoit alors ses jetons de cette route : `getToken: () => fetch('/api/surge-media/token', { method: 'POST' }).then(r => r.json())`. `@surge-media/client/server` refuse de s’exécuter dans un navigateur ; l’entrée principale ne l’importe jamais. `maxFiles` compte par jeton : un jeton renouvelé repart de zéro, gardez donc un éventuel quota par utilisateur dans votre application.

Depuis un autre langage, appelez directement l’API :

```bash
curl -X POST \
  "https://media.example.com/api/v1/projects/cm…/delegated-tokens" \
  -H "Authorization: Bearer $SURGE_MEDIA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"scopes":["project:read","media:read","media:upload"]}'
```

### Thème et langues

- `@surge-media/vue/style.css`, le thème du client (`@surge-media/client/style.css`) repris tel quel, est facultatif : sans lui, tailles, rapports et textes réservés aux lecteurs d’écran restent corrects. Il définit des jetons `--sm-*` (`--sm-color-primary`, `--sm-color-surface`, `--sm-radius`…) en clair et en sombre — le sombre suit la préférence du système, sauf si un ancêtre porte `.light` ou `[data-theme="light"]`, ou dès qu’il porte `.dark` ou `[data-theme="dark"]`. Tout est rangé dans la couche CSS `surge-media` : vos styles l’emportent toujours.
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
// Filtre par slugs d'étiquettes : au moins une par défaut, ou toutes avec tagMatch: 'all'
const heroes = await client.media.list({ tags: ['hero', 'ete'], tagMatch: 'all' })
// Politique de transformation, formats activés, taille maximale
const project = await client.project()

const srcset = srcsetAttribute(widthCandidates(items[0], {
  widths: [480, 960, 1440],
  format: 'avif',
  maxDimension: project.transformMaxDimension,
}))
```

Il gère la revalidation par ETag, le renouvellement des jetons délégués et les erreurs traduites (`SurgeApiError`), et construit les URL de transformation sous forme canonique — exactement celle qu’attend le serveur, donc sans redirection. `imageSourceSet()` calcule tous les attributs d’une image (`src`, `srcset`, `sizes`, `width`, `height`) d’après la politique du projet, et `imageSource()` les tire des propriétés d’un composant et des réglages du projet : c’est le cœur de tout composant d’image.

Pour l’envoi, `client.media.upload()` envoie un fichier (avec sa progression dans un navigateur), `client.uploadRules()` lit les règles du jeton, `checkFile()` et `acceptAttribute()` les appliquent, et `createUploadQueue()` est la file sans framework sur laquelle repose `SmUploader`. Sur votre serveur, `@surge-media/client/server` émet les jetons délégués.

La logique des composants est elle aussi dans le client, commune à toutes les librairies : réglages d’affichage du projet (`displaySettings()`), texte alternatif et repli d’une image (`resolveAltText()`, `nextImageStage()`), balises `<source>` d’un `<picture>` (`pictureSources()`), affiche, messages et nouvel essai d’une vidéo (`videoPoster()`, `heldVideoDelay()`), état du traitement, affichage de l’envoi, textes en français et en anglais (`createTranslate()`), icônes (`ICONS`) et styles en ligne (`cssText()` pour les frameworks à styles en texte). Le thème aussi : `@surge-media/client/style.css` (classes `sm-*`, jetons `--sm-*`). `@surge-media/vue` n’y ajoute que le rendu et la réactivité.

Pas encore de paquet pour votre framework (Angular, SolidJS, Qwik…) ? [Créez une intégration pour un framework](../framework-integration/) au-dessus du client et de son thème, comme le sont les paquets officiels.

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
    SurgeMedia: {
      // NUXT_SURGE_MEDIA_SECRET_KEY — serveur seulement (étape 3)
      secretKey: '',
    },
    public: {
      SurgeMedia: {
        baseUrl: '', // NUXT_PUBLIC_SURGE_MEDIA_BASE_URL
        projectId: '', // NUXT_PUBLIC_SURGE_MEDIA_PROJECT_ID
        publishableKey: '', // NUXT_PUBLIC_SURGE_MEDIA_PUBLISHABLE_KEY
      },
    },
  },
})
```

Renseignez ces variables (`NUXT_PUBLIC_SURGE_MEDIA_BASE_URL` : l’adresse de votre instance, par exemple `https://media.example.com`), puis ajoutez l’origine de votre site (`https://www.example.com`) aux origines autorisées du projet, dans l’administration de SurgeMedia.

### 2. Créer `plugins/surge-media.ts`

```ts
// plugins/surge-media.ts
import {
  createSurgeMedia,
  SmImage,
  SmMedia,
  SmPicture,
  SmThumbnail,
  SmUploader,
  SmVideo,
} from '@surge-media/vue'

export default defineNuxtPlugin((nuxtApp) => {
  const { SurgeMedia } = useRuntimeConfig().public

  nuxtApp.vueApp.use(createSurgeMedia({
    baseUrl: SurgeMedia.baseUrl,
    projectId: SurgeMedia.projectId,
    publishableKey: SurgeMedia.publishableKey,
    // Avec @nuxtjs/i18n : locale: nuxtApp.$i18n.locale
    locale: 'fr',
    // Préréglages seuls, transformations signées ou formats limités ?
    // Indiquez-le ici : le rendu serveur construit alors les bonnes URL.
    // defaults: { policy: 'presets', formats: ['webp', 'jpg'] },
  }))

  // Disponibles partout (pages et composants), sans import.
  const components = {
    SmImage, SmPicture, SmVideo, SmMedia, SmThumbnail, SmUploader,
  }
  for (const [name, component] of Object.entries(components)) {
    nuxtApp.vueApp.component(name, component)
  }
})
```

Utilisez ensuite les composants partout, avec des médias lus côté serveur pour que la page soit rendue complète :

```vue
<!-- pages/index.vue -->
<script setup lang="ts">
const config = useRuntimeConfig().public.SurgeMedia
const { data: hero } = await useFetch(
  `${config.baseUrl}/api/v1/projects/${config.projectId}/media/cm…`,
  { headers: { Authorization: `Bearer ${config.publishableKey}` } },
)
</script>

<template>
  <SmImage v-if="hero" :media="hero" sizes="100vw" priority />
</template>
```

### 3. Médias privés et envois : jetons délégués (facultatif)

Pour montrer des médias privés aux visiteurs connectés ou les laisser envoyer des fichiers, laissez votre serveur Nuxt émettre des jetons délégués avec la **clé secrète** du projet, qui ne quitte jamais le serveur. Ajoutez `@surge-media/client` (même version que `@surge-media/vue`) pour son entrée serveur :

```ts
// server/api/surge-media/token.post.ts
import {
  createDelegatedToken,
  UPLOAD_SCOPES,
} from '@surge-media/client/server'

export default defineEventHandler(async (event) => {
  // Votre propre authentification : seuls les visiteurs connectés
  // reçoivent un jeton (requireUserSession vient de nuxt-auth-utils).
  const { user } = await requireUserSession(event)
  const config = useRuntimeConfig(event)
  const { baseUrl, projectId } = config.public.SurgeMedia

  // Renvoie { token, expiresAt, scopes } : accepté tel quel.
  return createDelegatedToken({
    baseUrl,
    projectId,
    secretKey: config.SurgeMedia.secretKey,
    // DISPLAY_SCOPES pour les médias privés sans envoi
    scopes: UPLOAD_SCOPES,
    subject: String(user.id),
  })
})
```

Dans le plugin, remplacez `publishableKey` par `getToken` :

```ts
// plugins/surge-media.ts
// Transmet les cookies du visiteur pendant le rendu serveur
const requestFetch = useRequestFetch()

nuxtApp.vueApp.use(createSurgeMedia({
  baseUrl: SurgeMedia.baseUrl,
  projectId: SurgeMedia.projectId,
  getToken: () =>
    requestFetch('/api/surge-media/token', { method: 'POST' }),
}))
```

Le client demande un jeton à la première utilisation et le renouvelle avant son échéance. Comme le plugin s’exécute pour chaque requête, deux visiteurs ne partagent jamais un jeton.

## Voir aussi

- [Architecture et API](../../guides/architecture/)
- [Sécurité et contrôle d’accès](../../guides/security/)
- [Transformations d’images](../image-transformations/)
- [Créer une intégration pour un framework](../framework-integration/)
