---
title: SDKs and components
description: '@surge-media/vue and @surge-media/client: responsive images, videos and API access for Vue 3 and Nuxt, MIT-licensed. The REST API works with any language.'
---

surgeMedia is API-first: everything the admin does with media, your code can do through the REST API v1. The official front-end packages turn the most common integrations — responsive images, videos, uploads, pickers — into a few lines.

## Packages

| Package | For | License | Status |
| --- | --- | --- | --- |
| `@surge-media/core` | Server: admin, REST API, delivery, processing | BUSL-1.1 | **Available** |
| `@surge-media/client` | Any JavaScript runtime: browser, Node.js, edge | MIT | In development — first release 0.1 |
| `@surge-media/vue` | Vue 3.5+, including Nuxt | MIT | In development — first release 0.1 |
| `@surge-media/nuxt` | Nuxt module (auto-imports, token route) | MIT | Later — Nuxt works today with `@surge-media/vue` |
| `@surge-media/react` | React, Next.js | MIT | Planned |
| `@surge-media/svelte` | Svelte, SvelteKit | MIT | Planned |

The display components (images, `<picture>`, videos, thumbnails, processing status) are ready; uploads, media pickers and editing (focal point, crop, poster, subtitles) follow before the first release. Watch the [GitHub repository](https://github.com/mahmoud-nb/surge-media) releases to be notified.

## @surge-media/vue

### Install

```bash
npm install @surge-media/vue
```

`@surge-media/client` is installed with it. Vue 3.5 or later is required.

### Set up

Register the plugin once, with your instance URL, the project id and a credential:

```ts
// main.ts
import { createSurgeMedia } from '@surge-media/vue'
import '@surge-media/vue/style.css' // optional theme

app.use(createSurgeMedia({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  publishableKey: 'sm_pk_…',
  locale: 'en', // 'fr' by default; a ref follows your app's language
}))
```

| Credential | Use it for |
| --- | --- |
| No credential | Displaying `Media` objects your back end already fetched (public media, or private media with their signed URLs). |
| Publishable key (`publishableKey`) | Public sites: public media, listing when the project enables it. Restricted to the project's allowed origins. |
| Delegated tokens (`getToken`) | Signed-in users: private media, and later uploads and editing. Your back end issues short-lived tokens with its secret key; the client renews them before they expire. Include `project:read` in their scopes. |

**Never put a secret key or a personal token in a browser**: the client refuses them and the API rejects them (`SECRET_IN_BROWSER`).

### Components

```vue
<script setup lang="ts">
import type { Media } from '@surge-media/client'
import { SmImage, SmPicture, SmVideo } from '@surge-media/vue'

defineProps<{ hero: Media; gallery: Media[]; trailer: Media }>()
</script>

<template>
  <!-- Fluid image: srcset with the real width of each file -->
  <SmImage :media="hero" sizes="(min-width: 960px) 50vw, 100vw" priority />

  <!-- Fixed size with a 16:9 crop around the focal point: 1x, 2x, 3x -->
  <SmImage
    v-for="item in gallery" :key="item.id"
    :media="item" :width="320" aspect="16/9"
  />

  <!-- AVIF, WebP and JPEG; a square crop on small screens -->
  <SmPicture
    :media="hero"
    :sources="[{ media: '(max-width: 640px)', aspect: 1 }]"
  />

  <!-- Native player: AV1, H.264 or original sources, poster, captions -->
  <SmVideo :media="trailer" />
</template>
```

| Component | What it does |
| --- | --- |
| `SmImage` | `<img>` with a `srcset` by width (or by density with a fixed `width`), `width` / `height` always set (no layout shift), server crop around the focal point (`aspect`, `fit`), presets (`preset`, `presets`), `loading`, `fetchpriority` or `priority`, `objectFit` to fill a box. Alternative text from `alt` or the media; `decorative` for purely decorative images. |
| `SmPicture` | `<picture>` with one `<source>` per format enabled on the server (AVIF, WebP) and a JPEG fallback; art direction through `sources` (a crop per media query). |
| `SmVideo` | The browser's native player with the server's playback `sources`, a sized poster, text tracks, `lazy` loading. No autoplay: `ambient` loops a muted video with a pause button. While the server prepares a video, shows its status and a link to the original. |
| `SmMedia` | Picks `SmImage` or `SmVideo` from the media kind. |
| `SmThumbnail` | Square thumbnail cropped around the focal point, video duration, processing badge. |
| `SmProcessingStatus` | Processing status of a video, with a progress bar and polite announcements for screen readers. |

The components follow the project's transformation policy: with **presets only**, they build their `srcset` from presets; with **signed only**, from presets too, unless the media is private (its URLs are already signed). If a derivative fails to load, the image falls back to the original file, then to its alternative text.

`useMedia(id)` loads a media item in the browser, refreshes the signed URLs of a private one before they expire, and follows the processing of a video until it is ready.

### Theme and languages

- `@surge-media/vue/style.css` is optional: without it, sizes, aspect ratios and screen reader texts stay correct. It defines `--sm-*` tokens (`--sm-color-primary`, `--sm-color-surface`, `--sm-radius`…) in light and dark — dark follows the system preference, unless an ancestor has `.light` or `[data-theme="light"]`, or when it has `.dark` or `[data-theme="dark"]`. Everything lives in the `surge-media` CSS layer, so your styles always win.
- French (default) and English are built in. Pass `locale` (a string or a ref) and override or add texts with `messages: { en: { video: { download: 'Download' } } }`.
- The components target WCAG 2.2 AA: native elements, keyboard access, no autoplay, contrast checked in both themes.

## @surge-media/client

The framework-free layer the components are built on — use it directly in plain JavaScript, on a server or in another framework:

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
// Transformation policy, enabled formats, maximum size
const project = await client.project()

const srcset = srcsetAttribute(widthCandidates(items[0], {
  widths: [480, 960, 1440],
  format: 'avif',
  maxDimension: project.transformMaxDimension,
}))
```

It handles ETag revalidation, delegated token renewal and translated errors (`SurgeApiError`), and builds canonical transformation URLs — the exact form the server expects, so no redirect. `imageSourceSet()` computes all the attributes of an image (`src`, `srcset`, `sizes`, `width`, `height`) from the project's policy: it is the heart of every image component.

No package for your framework yet (Angular, SolidJS, Qwik…)? [Build a framework integration](../framework-integration/) on top of the client, the way the official packages are built.

## Any language

The API is described by an **OpenAPI 3.1** document served by your instance at `/api/v1/openapi.json` (`?lang=en` or `fr`). Generate a typed client with the tool of your choice — for example, in TypeScript:

```bash
npx openapi-typescript https://media.example.com/api/v1/openapi.json \
  -o surge-media.d.ts
```

Image URLs need no SDK at all: replace `{transform}` and `{format}` in a media's `urlTemplate` — see [Image transformations](../image-transformations/).

## Nuxt

`@surge-media/vue` works in Nuxt (with Vue 3.5 or later) and its server-side rendering: a Nuxt plugin runs once per request on the server, which is exactly what the library needs (delegated tokens belong to one visitor). A dedicated `@surge-media/nuxt` module may come later; nothing below will need to change.

### 1. Install and configure

```bash
npm install @surge-media/vue
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: ['@surge-media/vue/style.css'], // optional theme
  runtimeConfig: {
    surgeMedia: {
      // NUXT_SURGE_MEDIA_SECRET_KEY — server only (step 3)
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

Set these variables (`NUXT_PUBLIC_SURGE_MEDIA_BASE_URL`: your instance address, such as `https://media.example.com`), then add your site's origin (`https://www.example.com`) to the project's allowed origins in the surgeMedia admin.

### 2. Create `plugins/surge-media.ts`

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
    // With @nuxtjs/i18n: locale: nuxtApp.$i18n.locale
    locale: 'en',
    // Presets-only or signed policy, or restricted formats? Say so here:
    // the server render then builds the right URLs from the start.
    // defaults: { policy: 'presets', formats: ['webp', 'jpg'] },
  }))

  // Available in every page and component, without imports.
  const components = { SmImage, SmPicture, SmVideo, SmMedia, SmThumbnail }
  for (const [name, component] of Object.entries(components)) {
    nuxtApp.vueApp.component(name, component)
  }
})
```

Then use the components anywhere, with media fetched on the server so the page is rendered complete:

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

### 3. Private media: delegated tokens (optional)

To show private media to signed-in visitors, let your Nuxt server issue delegated tokens with the project's **secret key**, which never leaves the server:

```ts
// server/api/surge-media/token.post.ts
export default defineEventHandler(async (event) => {
  // Your own authentication: only signed-in visitors get a token
  // (requireUserSession comes from nuxt-auth-utils, for example).
  const { user } = await requireUserSession(event)
  const config = useRuntimeConfig(event)
  const { baseUrl, projectId } = config.public.surgeMedia

  // Returns { token, expiresAt, scopes }, accepted as is by the plugin.
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

In the plugin, replace `publishableKey` with `getToken`:

```ts
// plugins/surge-media.ts
// Forwards the visitor's cookies during server rendering
const requestFetch = useRequestFetch()

nuxtApp.vueApp.use(createSurgeMedia({
  baseUrl: surgeMedia.baseUrl,
  projectId: surgeMedia.projectId,
  getToken: () =>
    requestFetch('/api/surge-media/token', { method: 'POST' }),
}))
```

The client asks for a token on first use and renews it before it expires. Because the plugin runs for each request, two visitors never share a token.

## Related

- [Architecture & APIs](../../guides/architecture/)
- [Security & access control](../../guides/security/)
- [Image transformations](../image-transformations/)
- [Build a framework integration](../framework-integration/)
