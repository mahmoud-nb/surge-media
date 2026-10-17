---
title: Build a framework integration
description: Use @surge-media/client to write your own surgeMedia components for a framework without an official package — Angular, SolidJS, Qwik, Lit… — with the same guarantees as the official ones.
---

The official packages cover Vue, and React and Svelte are planned (see [SDKs and components](../sdks/)). For another framework — Angular, SolidJS, Qwik, Lit, Ember — or for your own design system, build a small local library on top of **`@surge-media/client`**. The client holds all the logic: API calls, credentials, URLs, `srcset`, transformation policy, video sources. Your library only maps it to the framework's components. The official packages are built exactly this way.

## What the client gives you

| You need | Use |
| --- | --- |
| Read media, the project, its presets | `createSurgeClient()`, `client.media.get()` / `list()` / `getMany()`, `client.project()`, `client.presets()` |
| The attributes of an image (`src`, `srcset`, `sizes`, `width`, `height`) | `imageSourceSet(request)` |
| Free parameters or presets only, from the project's policy | `transformMode(policy, media)` |
| The format of an `<img>`, the `<source>` formats of a `<picture>` | `imageFormat(formats)`, `pictureFormats(formats)`, `FORMAT_MIME_TYPES` |
| Presets that always exist | `BUILTIN_PRESETS` (`preview`, `full`) |
| A CSS crop around the focal point | `focalObjectPosition()`, `objectPosition()` |
| Video poster, sources and tracks | `posterUrl()`, `media.sources`, `media.textTracks` |
| Follow a video the server is preparing | `isProcessing(media)`, `watchMedia(client, media, options)` |
| Readable errors | `SurgeApiError`, `errorMessage(code, locale)` |
| Durations and sizes in the user's language | `formatDuration()`, `formatClock()`, `formatBytes()` |

## How an integration is organized

1. **A shared context** for the application — and for each request with server-side rendering: the client and the project settings (`transformPolicy`, `transformFormats`, `transformMaxDimension`, presets), read once. Use the framework's own mechanism: Angular providers, Solid context, Qwik context…
2. **A framework-agnostic core** in your library: a few functions that turn a `Media` object and the settings into ready-to-render attributes. It is the only code you write against the client, and the same for every framework.
3. **Thin components** that call the core and render a plain `<img>`, `<picture>` or `<video>`.

## Step 1: the framework-agnostic core

```ts
// src/core.ts
import {
  BUILTIN_PRESETS,
  type ImageSourceRequest,
  imageFormat,
  imageSourceSet,
  isProcessing,
  type Media,
  posterUrl,
  type Preset,
  type Project,
  type SurgeClient,
  transformMode,
  watchMedia,
} from '@surge-media/client'

/** Project settings used to build URLs, read once per app or request. */
export interface SurgeSettings {
  project: Project | null
  presets: readonly Preset[]
}

export const DEFAULT_SETTINGS: SurgeSettings = {
  project: null,
  presets: BUILTIN_PRESETS,
}

export async function loadSettings(
  client: SurgeClient,
): Promise<SurgeSettings> {
  const [project, presets] = await Promise.all([
    client.project().catch(() => null),
    client.presets().catch(() => BUILTIN_PRESETS),
  ])
  return { project, presets }
}

/** What a component may set: size, crop, presets, srcset widths… */
export type ImageOptions = Partial<Pick<ImageSourceRequest,
  'width' | 'height' | 'aspect' | 'fit' | 'sizes' | 'widths'
  | 'preset' | 'presetNames' | 'transform'>>

/** Attributes of an <img> for a media item, ready to render. */
export function imageAttributes(
  media: Media,
  settings: SurgeSettings,
  options: ImageOptions = {},
) {
  const { project } = settings
  const set = imageSourceSet({
    ...options,
    media,
    format: imageFormat(project?.transformFormats),
    mode: transformMode(project?.transformPolicy, media),
    maxDimension: project?.transformMaxDimension ?? 4096,
    presets: settings.presets,
  })
  return {
    src: set.src,
    srcset: set.srcset,
    sizes: set.srcset ? set.sizes : undefined,
    width: set.width,
    height: set.height,
  }
}

/** Poster of a video, resized when free transformations are allowed. */
export function videoPoster(media: Media, settings: SurgeSettings) {
  const { project } = settings
  if (!media.poster) return undefined
  if (transformMode(project?.transformPolicy, media) === 'presets') {
    return media.poster.url
  }
  return posterUrl(media, {
    width: Math.min(media.poster.width, 1280),
    format: imageFormat(project?.transformFormats),
    maxDimension: project?.transformMaxDimension,
  }) ?? undefined
}

/** Follows a video the server is preparing; returns a stop function. */
export function followProcessing(
  client: SurgeClient,
  media: Media,
  onUpdate: (media: Media) => void,
): () => void {
  const controller = new AbortController()
  if (isProcessing(media)) {
    void watchMedia(client, media, { signal: controller.signal, onUpdate })
  }
  return () => controller.abort()
}
```

`imageSourceSet()` does the hard part: a `srcset` by width (or by density when the display width is fixed), the real size of each file (the server never enlarges an image), the server-side crop around the focal point when an `aspect` is given, and presets when the project does not allow free parameters.

## Step 2: SolidJS components

```tsx
// src/solid/surge-media.tsx
import type { Media, SurgeClient } from '@surge-media/client'
import {
  createContext,
  createMemo,
  createResource,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js'
import {
  DEFAULT_SETTINGS,
  imageAttributes,
  type ImageOptions,
  loadSettings,
  type SurgeSettings,
} from '../core'

const Settings = createContext<() => SurgeSettings>(
  () => DEFAULT_SETTINGS,
)

export function SurgeProvider(
  props: ParentProps<{ client: SurgeClient }>,
) {
  const [settings] = createResource(() => loadSettings(props.client))
  const value = () => settings() ?? DEFAULT_SETTINGS
  return (
    <Settings.Provider value={value}>{props.children}</Settings.Provider>
  )
}

export function SurgeImage(
  props: ImageOptions & { media: Media, alt?: string },
) {
  const settings = useContext(Settings)
  const [failed, setFailed] = createSignal(false)
  const attrs = createMemo(() =>
    imageAttributes(props.media, settings(), props))
  // If the derivative fails to load, fall back to the original file.
  return (
    <img
      {...attrs()}
      src={failed() ? props.media.url : attrs().src}
      srcset={failed() ? undefined : attrs().srcset}
      alt={props.alt ?? props.media.altText ?? ''}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
```

```tsx
// src/index.tsx (application)
import { createSurgeClient } from '@surge-media/client'
import { render } from 'solid-js/web'
import { SurgeImage, SurgeProvider } from './lib/solid/surge-media'

const client = createSurgeClient({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  publishableKey: 'sm_pk_…',
})

render(() => (
  <SurgeProvider client={client}>
    <SurgeImage media={hero} sizes="(min-width: 960px) 50vw, 100vw" />
  </SurgeProvider>
), document.getElementById('app')!)
```

## Step 3: an Angular component

```ts
// src/angular/surge-media.ts
import {
  Component,
  computed,
  inject,
  InjectionToken,
  input,
  makeEnvironmentProviders,
  type Signal,
  signal,
} from '@angular/core'
import type { Media, SurgeClient } from '@surge-media/client'
import {
  DEFAULT_SETTINGS,
  imageAttributes,
  loadSettings,
  type SurgeSettings,
} from '../core'

const SETTINGS = new InjectionToken<Signal<SurgeSettings>>('surge-media')

/** In app.config.ts: providers: [provideSurgeMedia(client)] */
export function provideSurgeMedia(client: SurgeClient) {
  return makeEnvironmentProviders([{
    provide: SETTINGS,
    useFactory: () => {
      const settings = signal(DEFAULT_SETTINGS)
      void loadSettings(client).then(value => settings.set(value))
      return settings.asReadonly()
    },
  }])
}

@Component({
  selector: 'surge-image',
  standalone: true,
  template: `
    <img
      [attr.src]="attrs().src"
      [attr.srcset]="attrs().srcset ?? null"
      [attr.sizes]="attrs().sizes ?? null"
      [attr.width]="attrs().width ?? null"
      [attr.height]="attrs().height ?? null"
      [alt]="alt() ?? media().altText ?? ''"
      loading="lazy"
      decoding="async"
      (error)="failed.set(true)"
    />
  `,
})
export class SurgeImageComponent {
  readonly media = input.required<Media>()
  readonly sizes = input<string>()
  readonly width = input<number>()
  readonly aspect = input<number>()
  readonly alt = input<string>()

  private readonly settings = inject(SETTINGS)
  protected readonly failed = signal(false)
  protected readonly attrs = computed(() => {
    const attrs = imageAttributes(this.media(), this.settings(), {
      sizes: this.sizes(),
      width: this.width(),
      aspect: this.aspect(),
    })
    // If the derivative fails to load, fall back to the original file.
    return this.failed()
      ? { ...attrs, src: this.media().url, srcset: undefined }
      : attrs
  })
}
```

```ts
// src/app/app.config.ts (application)
import type { ApplicationConfig } from '@angular/core'
import { createSurgeClient } from '@surge-media/client'
import { provideSurgeMedia } from './lib/angular/surge-media'

export const appConfig: ApplicationConfig = {
  providers: [
    provideSurgeMedia(createSurgeClient({
      baseUrl: 'https://media.example.com',
      projectId: 'cm…',
      publishableKey: 'sm_pk_…',
    })),
  ],
}
```

Then, in any template that imports `SurgeImageComponent`: `<surge-image [media]="hero" sizes="100vw" />`.

## Step 4: videos

A video needs no computation beyond the poster: render the server's data in the browser's native player. In any framework, the markup to produce is:

```html title="Video markup"
<video controls preload="metadata" playsinline
  crossorigin="anonymous" width="1920" height="1080"
  poster="https://media.example.com/m/…/w_1280/visit.webp"
  aria-label="Visit">
  <source src="…/renditions/av1.webm" type='video/webm; codecs="…"'>
  <source src="…/renditions/h264.mp4" type='video/mp4; codecs="…"'>
  <track kind="captions" srclang="en" label="English"
    src="…/tracks/cm….vtt" default>
</video>
```

- One `<source>` per item of `media.sources`, **in the server's order** (`url`, `type`): the browser plays the first one it supports.
- `poster` from `videoPoster()`; `width` and `height` from the media, to reserve the space.
- One `<track>` per item of `media.textTracks` (`kind`, `language`, `label`, `url`, `default`), and then `crossorigin="anonymous"`: the tracks are served by surgeMedia's domain.
- No `sources` yet (a converted format being prepared): show a message and a link to `media.url`; call `followProcessing()` to get the updated media when it is ready.

## Package your library

A local library can simply be a folder of your application (`src/lib/surge-media/`), or a package of your monorepo:

```json title="package.json"
{
  "name": "@acme/surge-media-solid",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "peerDependencies": { "solid-js": "^1.9.0" },
  "dependencies": { "@surge-media/client": "^0.1.0" }
}
```

The framework is a **peer dependency** (the application's own copy); the client is a regular dependency.

## Checklist

What the official packages guarantee, and your integration should too:

- **Credentials**: a publishable key, or delegated tokens from `getToken`, issued by your server with the secret key. Never a secret key or a personal token in a browser.
- **Server-side rendering**: one client and one context per request (a delegated token belongs to one visitor), and the project settings known **before** rendering — read them in an initializer (Angular `provideAppInitializer`, a Solid resource inside `Suspense`…) or pass them from your configuration. Otherwise the server builds URLs for the default policy.
- **Images**: `width` and `height` always set (no layout shift), `max-width: 100%; height: auto` for fluid images, `sizes` that match your layout.
- **Alternative text**: an explicit `alt`, else the media's `altText`; empty only for a purely decorative image.
- **Fallback**: derivative, then `media.url`, then the alternative text shown in place of the image. Reset it when the media changes.
- **Videos**: sources in the server's order, no autoplay — a muted looping video needs a visible pause button (WCAG 2.2.2).
- **Status**: announce processing changes politely (`role="status"`), only on transitions.
- **Private media**: their URLs are signed until `urlExpiresAt`; read the media again before that time if the page stays open.
- **Tests**: render on the server and compare `src` / `srcset` with `imageSourceSet()`; type your components with the client's `Media` type.

Built an integration for a framework? Tell us on [GitHub](https://github.com/mahmoud-nb/surge-media): it can become an official package.

## Related

- [SDKs and components](../sdks/)
- [Image transformations](../image-transformations/)
- [Security & access control](../../guides/security/)
