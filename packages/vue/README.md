# @surge-media/vue

[![CI](https://github.com/mahmoud-nb/surge-media/actions/workflows/ci.yml/badge.svg)](https://github.com/mahmoud-nb/surge-media/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/mahmoud-nb/surge-media/blob/main/packages/vue/LICENSE)
[![Types included](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)](https://github.com/mahmoud-nb/surge-media/tree/main/packages/vue)
[![Vue 3.5+](https://img.shields.io/badge/Vue-3.5%2B-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Tested with Vitest](https://img.shields.io/badge/tested_with-Vitest-6e9f18?logo=vitest&logoColor=white)](https://github.com/mahmoud-nb/surge-media/actions/workflows/ci.yml)
[![WCAG 2.2 AA](https://img.shields.io/badge/WCAG_2.2-AA-005a9c)](https://www.w3.org/TR/WCAG22/)

Vue 3 components for [SurgeMedia](https://github.com/mahmoud-nb/surge-media), the self-hosted media platform.

- **`SmImage`** and **`SmPicture`**: responsive images (`srcset` with real widths or densities, AVIF / WebP with a
  fallback), server-side crop around the focal point, presets when the project only allows presets, fallback to the
  original file then to the alternative text.
- **`SmVideo`**: the browser's native player with the server's playback sources (AV1, H.264, original), poster and
  captions, no autoplay (an `ambient` mode loops a muted video with a pause button), processing status while the
  server prepares the video.
- **`SmUploader`**: uploads with delegated tokens (`media:upload`) — native file input, drag and drop, paste, checks
  before sending from the rules of the token, progress, cancel, retry, poster captured from videos, title and
  alternative text typed before the upload (`details`); `useUploadQueue()` and `useUploadRules()` for your own UI.
- **`SmMedia`**, **`SmThumbnail`**, **`SmProcessingStatus`**, `useMedia()`.
- Server-side rendering, French (default) and English texts, WCAG 2.2 AA, optional theme (`--sm-*` tokens, light
  and dark) in a CSS layer your styles always override.
- Built on [`@surge-media/client`](https://www.npmjs.com/package/@surge-media/client), which holds the
  framework-free logic (texts, URLs, inline styles, states) and the theme: the same base for your own components.

Requires Vue 3.5 or later.

```sh
npm install @surge-media/vue
```

```ts
import { createSurgeMedia } from '@surge-media/vue'
import '@surge-media/vue/style.css' // optional theme

app.use(createSurgeMedia({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  publishableKey: 'sm_pk_…', // or getToken: () => … (delegated tokens issued by your back end)
  locale: 'en',
}))
```

```vue
<SmImage :media="media" sizes="(min-width: 960px) 50vw, 100vw" />
<SmPicture :media="media" :sources="[{ media: '(max-width: 640px)', aspect: 1 }]" />
<SmVideo :media="video" />
<SmUploader :kinds="['image']" details @uploaded="onUploaded" />
```

With server-side rendering, create the plugin for each request: delegated tokens belong to one user. Issue upload
tokens on your server with `createDelegatedToken()` from `@surge-media/client/server` (add `@surge-media/client`,
same version, to your dependencies).

Changes: [CHANGELOG](https://github.com/mahmoud-nb/surge-media/blob/main/packages/CHANGELOG.md).

## License

[MIT](./LICENSE). The SurgeMedia server (`@surge-media/core`) is distributed under its own license (BUSL-1.1).
