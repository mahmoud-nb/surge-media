# @surge-media/client

Framework-free TypeScript client for [surgeMedia](https://github.com/mahmoud-nb/surge-media), the self-hosted media
platform: read the API v1 from a browser, Node.js or an edge runtime, and build responsive image and video URLs.

- **Credentials**: a publishable key (`sm_pk_…`, public media) or delegated tokens (`sm_dt_…`) issued by your
  back end, renewed automatically before they expire. Secret keys never belong in a browser.
- **Reads** with ETag revalidation (`304`), translated errors (`SurgeApiError`, French and English messages).
- **URLs**: canonical transformations (no redirect), `srcset` with the real size of each derivative, `<picture>`
  formats enabled on the server, focal point, video sources, posters and text tracks.
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

Vue components built on this client: [`@surge-media/vue`](https://www.npmjs.com/package/@surge-media/vue).
Changes: [CHANGELOG](https://github.com/mahmoud-nb/surge-media/blob/main/packages/CHANGELOG.md).

## License

[MIT](./LICENSE). The surgeMedia server (`@surge-media/core`) is distributed under its own license (BUSL-1.1).
