# @surge-media/vue

Vue 3 components for [surgeMedia](https://github.com/mahmoud-nb/surge-media), the self-hosted media platform.

- **`SmImage`** and **`SmPicture`**: responsive images (`srcset` with real widths or densities, AVIF / WebP with a
  fallback), server-side crop around the focal point, presets when the project only allows presets, fallback to the
  original file then to the alternative text.
- **`SmVideo`**: the browser's native player with the server's playback sources (AV1, H.264, original), poster and
  captions, no autoplay (an `ambient` mode loops a muted video with a pause button), processing status while the
  server prepares the video.
- **`SmMedia`**, **`SmThumbnail`**, **`SmProcessingStatus`**, `useMedia()`.
- Server-side rendering, French (default) and English texts, WCAG 2.2 AA, optional theme (`--sm-*` tokens, light
  and dark) in a CSS layer your styles always override.

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
```

With server-side rendering, create the plugin for each request: delegated tokens belong to one user.

Changes: [CHANGELOG](https://github.com/mahmoud-nb/surge-media/blob/main/packages/CHANGELOG.md).

## License

[MIT](./LICENSE). The surgeMedia server (`@surge-media/core`) is distributed under its own license (BUSL-1.1).
