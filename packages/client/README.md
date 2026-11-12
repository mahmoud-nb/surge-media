# @surge-media/client

Framework-free TypeScript client for [SurgeMedia](https://github.com/mahmoud-nb/surge-media), the self-hosted media
platform: read the API v1 from a browser, Node.js or an edge runtime, build responsive image and video URLs, and
upload files.

- **Credentials**: a publishable key (`sm_pk_…`, public media) or delegated tokens (`sm_dt_…`) issued by your
  back end, renewed automatically before they expire. Secret keys never belong in a browser.
- **Reads** with ETag revalidation (`304`), translated errors (`SurgeApiError`, French and English messages).
- **URLs**: canonical transformations (no redirect), `srcset` with the real size of each derivative, `<picture>`
  formats enabled on the server, focal point, video sources, posters and text tracks.
- **Uploads**: the rules of the token (`uploadRules()`: accepted types, maximum sizes, uploads left), checks before
  sending (`checkFile()`, `acceptAttribute()`), `media.upload()` with progress in browsers, and `createUploadQueue()`,
  a framework-free queue (concurrency, cancel, retry, poster captured from the video during the upload).
- **Server entry** `@surge-media/client/server`: `createDelegatedToken()` issues delegated tokens with your secret
  key (`DISPLAY_SCOPES`, `UPLOAD_SCOPES`); it refuses to run in a browser and the main entry never imports it.
- **Component logic** shared by every component library (Vue today, React and Svelte next, or your own): French
  (default) and English texts (`createTranslate()`), icon paths (`ICONS`), image attributes and inline styles
  (`imageSource()`, `pictureSources()`, `thumbnailSource()`, `imageStyle()`), alternative text and fallback steps,
  video poster and retry after a `503`, processing status, upload help and actions. Inline styles are camelCase
  objects (Vue and React) or text with `cssText()`.
- **Optional theme** `@surge-media/client/style.css`: `--sm-*` tokens (light and dark, WCAG 2.2 AA contrast) and the
  styles of the stable `sm-*` classes, in a CSS layer your own styles always override.
- No runtime dependency, ESM only, tree-shakable.

```sh
npm install @surge-media/client
```

```ts
import { createSurgeClient, srcsetAttribute, widthCandidates } from '@surge-media/client'

const client = createSurgeClient({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  publishableKey: 'sm_pk_…',
  // or: getToken: () => fetch('/api/surge-token', { method: 'POST' }).then(response => response.json()),
})

const media = await client.media.get('cm…')
const { transformFormats, transformMaxDimension } = await client.project()
const srcset = srcsetAttribute(widthCandidates(media, { widths: [480, 960, 1440], format: 'avif', maxDimension: transformMaxDimension }))
```

```ts
// On your server only
import { createDelegatedToken, UPLOAD_SCOPES } from '@surge-media/client/server'

const token = await createDelegatedToken({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  secretKey: process.env.SURGE_MEDIA_SECRET_KEY,
  scopes: UPLOAD_SCOPES,
  subject: String(user.id),
  upload: { maxFiles: 10, maxSize: 50 * 1024 * 1024 },
})
```

Vue components built on this client: [`@surge-media/vue`](https://www.npmjs.com/package/@surge-media/vue) (its
`style.css` is this theme).
Changes: [CHANGELOG](https://github.com/mahmoud-nb/surge-media/blob/main/packages/CHANGELOG.md).

## License

[MIT](./LICENSE). The SurgeMedia server (`@surge-media/core`) is distributed under its own license (BUSL-1.1).
