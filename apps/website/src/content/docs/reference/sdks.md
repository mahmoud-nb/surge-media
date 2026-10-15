---
title: SDKs and components
description: The REST API works with any language today. First-party components for Vue, React and Svelte are on the roadmap.
---

surgeMedia is API-first: everything the admin does with media, your code can do through the REST API v1. Official front-end packages will turn the most common integrations into one-liners.

## Roadmap

| Package | Framework | Status |
| --- | --- | --- |
| `@surge-media/core` | Server: admin, REST API, delivery, processing | **Available** |
| `@surge-media/vue` | Vue 3, Nuxt | Planned |
| `@surge-media/react` | React, Next.js | Planned |
| `@surge-media/svelte` | Svelte, SvelteKit | Planned |

Each component package will provide:

- **Optimized image** — `srcset`, `<picture>` with AVIF / WebP, focal-point cropping, lazy loading, built from the media's `urlTemplate`.
- **Gallery and media picker** — browse a project's media and folders with a publishable key or a delegated token.
- **Uploader** — direct browser uploads with a delegated token issued by your back end: progress, type and size checks, retries.
- **Video player helpers** — `sources`, poster and subtitles mapped to a native `<video>` element.

Watch the [GitHub repository](https://github.com/mahmoud-nb/surge-media) releases to be notified.

## Today: any language

The API is described by an **OpenAPI 3.1** document served by your instance at `/api/v1/openapi.json` (`?lang=en` or `fr`). Generate a typed client with the tool of your choice — for example, in TypeScript:

```bash
npx openapi-typescript https://media.example.com/api/v1/openapi.json -o surge-media.d.ts
```

A responsive image helper takes a few lines, with no dependency:

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

## Related

- [Architecture & APIs](../../guides/architecture/)
- [Image transformations](../image-transformations/)
