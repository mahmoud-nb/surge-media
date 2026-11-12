---
title: Build a framework integration
description: Use @surge-media/client to write your own SurgeMedia components for a framework without an official package — Angular, SolidJS, Qwik, Lit… — with the same guarantees as the official ones.
---

The official packages cover Vue, and React and Svelte are planned (see [SDKs and components](../sdks/)). For another framework — Angular, SolidJS, Qwik, Lit, Ember — or for your own design system, build a small local library on top of **`@surge-media/client`**. The client holds all the logic: API calls, credentials, URLs, `srcset`, transformation policy, video sources, and the components' own logic — French and English texts, icons, attributes and inline styles, image fallback, video states — along with their CSS theme. Your library only maps it to the framework's components. The official packages are built exactly this way.

## What the client gives you

### The API and URLs

| You need | Use |
| --- | --- |
| Read media, the project, its presets | `createSurgeClient()`, `client.media.get()` / `list()` / `getMany()`, `client.project()`, `client.presets()` |
| The attributes of an image from a complete request | `imageSourceSet(request)`, `transformMode(policy, media)`, `imageFormat()`, `pictureFormats()` |
| A CSS crop around the focal point | `focalObjectPosition()`, `objectPosition()`, `focusPosition()` |
| Video poster, sources and tracks | `posterUrl()`, `media.sources`, `media.textTracks` |
| Follow a video the server is preparing | `isProcessing(media)`, `watchMedia(client, media, options)` |
| Upload files: rules, checks, queue with progress, poster capture | `client.uploadRules()`, `checkFile()`, `acceptAttribute()`, `createUploadQueue()`, `captureVideoFrame()` |
| Delegated tokens issued by your server | `createDelegatedToken()`, `UPLOAD_SCOPES` (`@surge-media/client/server`) |
| Readable errors | `SurgeApiError`, `errorMessage(code, locale)` |
| Durations, sizes and percentages in the user's language | `formatDuration()`, `formatClock()`, `formatBytes()`, `formatPercent()` |

### The component logic

The official components only hold the rendering: everything below lives in the client, written once for every framework.

| You need | Use |
| --- | --- |
| The project's display settings: policy, formats, maximum size, known presets | `projectSettings()`, `knownPresets()`, `displaySettings()` → `DisplaySettings` |
| The attributes of an `<img>` from a component's props | `imageSource(media, options, settings)` |
| The `<source>` tags of a `<picture>`, with art direction | `pictureSources(media, options, settings)` |
| Alternative text, fallback to the original then to the text | `resolveAltText()`, `nextImageStage()`, `imageFailedEarly()` |
| Poster, size, accessible name and messages of a video | `videoPoster()`, `videoSize()`, `videoLabel()`, `videoMessageKey()` |
| A video held by the server, lazy loading, ambient mode | `heldVideoDelay()`, `VIDEO_RETRY_LIMIT`, `whenNearViewport()`, `prefersReducedMotion()` |
| Thumbnails | `thumbnailSource()`, `kindIcon()`, `kindLabelKey()`, `thumbnailIconSizes()` |
| Processing status: icon, progress, failure reason, announcements | `PROCESSING_ICONS`, `processingVisible()`, `processingProgress()`, `processingReason()`, `processingAnnouncementKey()` |
| Upload display: input, help, actions and status of each file | `uploaderAccept()`, `uploaderFields()`, `uploadHelpLines()`, `canRetryUpload()`, `uploadStatusText()`, `takeSettledUploads()` |
| Read a private media item again before its signed URLs expire | `refreshDelay(media)` |
| Component texts in French (default) and English | `createTranslate(locale, overrides)` → `t(key, params)`, `COMPONENT_MESSAGES` |
| Icons (SVG paths, always decorative) | `ICONS`, `iconSvgAttributes(name, size)` |
| Minimal inline styles | `imageStyle()`, `imageErrorFrameStyle()`, `VIDEO_PLAYER_STYLE`…, `VISUALLY_HIDDEN`, `cssText()` |

Inline styles are objects with camelCase properties, accepted as is by Vue and React; `cssText()` turns them into a string (`max-width: 100%; height: auto`) for frameworks that expect a text style: SolidJS, Angular, Lit, Svelte. Without any stylesheet, they keep sizes, aspect ratios and screen reader texts (`VISUALLY_HIDDEN`) correct.

### The theme

`@surge-media/client/style.css` is the optional theme of the official packages (`@surge-media/vue/style.css` reuses it as is). Import it once in the application and put the same stable classes on your elements: `sm-image`, `sm-image--error`, `sm-video`, `sm-video__player`, `sm-video__message`, `sm-status`, `sm-thumbnail`, `sm-uploader`… It defines `--sm-*` tokens (`--sm-color-primary`, `--sm-color-surface`, `--sm-radius`…) in light and dark, with checked contrast (WCAG 2.2 AA); everything lives in the `surge-media` CSS layer, so your styles always win.

## How an integration is organized

1. **A shared context** for the application — and for each request with server-side rendering: the client, the project's display settings (`DisplaySettings`: policy, formats, maximum size, presets), read once, and the translation of texts. Use the framework's own mechanism: Angular providers, Solid context, Qwik context…
2. **The component logic, already in the client**: `imageSource()`, `pictureSources()`, `videoPoster()`, `resolveAltText()`… turn a `Media` object and the settings into ready-to-render attributes, texts and styles. Your library only adds a small framework-agnostic core: reading the settings and following things over time (a video being processed, a private media item about to expire).
3. **Thin components** that call these functions and render a plain `<img>`, `<picture>` or `<video>` with the theme's `sm-*` classes.

## Step 1: the framework-agnostic core

```ts
// src/core.ts
import {
  displaySettings,
  type DisplaySettings,
  isProcessing,
  knownPresets,
  type Media,
  projectSettings,
  refreshDelay,
  type SurgeClient,
  watchMedia,
} from '@surge-media/client'

/** Settings before the project is read: deterministic server rendering. */
export const DEFAULT_SETTINGS: DisplaySettings = displaySettings(
  projectSettings(null),
  knownPresets(null),
)

/** Policy, formats, maximum size and presets, read once. */
export async function loadSettings(
  client: SurgeClient,
): Promise<DisplaySettings> {
  const [project, presets] = await Promise.all([
    client.project().catch(() => null),
    client.presets().catch(() => null),
  ])
  return displaySettings(projectSettings(project), knownPresets(presets))
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

/** Reads a private media item again before its signed URLs expire. */
export function followExpiry(
  client: SurgeClient,
  media: Media,
  onUpdate: (media: Media) => void,
): () => void {
  const delay = refreshDelay(media)
  if (delay === null) return () => {}
  const timer = setTimeout(() => {
    client.media.get(media.id).then(onUpdate, () => {})
  }, delay)
  return () => clearTimeout(timer)
}
```

`DEFAULT_SETTINGS` is used for the first render, before the project is read. To know the policy without reading the project (server-side rendering), pass your values as the second argument of `projectSettings()` and the third of `displaySettings()`: `DisplayDefaults` (`policy`, `formats`, `maxDimension`, `widths`, `imageFormat`). Call `followExpiry()` again with each media item read.

The rest is not yours to write: the components call the client directly with the context's settings. `imageSource(media, options, settings)` does the hard part: a `srcset` by width (or by density when the display width is fixed), the real size of each file (the server never enlarges an image), the server-side crop around the focal point when an `aspect` is given, the format enabled on the server, and presets when the project does not allow free parameters. Its options (`ImageOptions`) are the props of the official components: `width`, `height`, `aspect`, `fit`, `transform`, `preset`, `presets`, `format`, `widths`, `sizes`. `pictureSources()` likewise returns the `<source>` tags of a `<picture>` (with a stable `key` for your lists) and its fallback image.

## Step 2: SolidJS components

```tsx
// src/solid/surge-media.tsx
import {
  createTranslate,
  cssText,
  type DisplaySettings,
  type IconName,
  ICONS,
  iconSvgAttributes,
  imageErrorFrameStyle,
  type ImageOptions,
  imageSource,
  type ImageStage,
  imageStyle,
  type Media,
  nextImageStage,
  resolveAltText,
  type SurgeClient,
  type Translate,
} from '@surge-media/client'
import {
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { DEFAULT_SETTINGS, loadSettings } from '../core'

interface Surge {
  settings: () => DisplaySettings
  t: Translate
}

const SurgeContext = createContext<Surge>({
  settings: () => DEFAULT_SETTINGS,
  t: createTranslate('fr'),
})

export const useSurge = () => useContext(SurgeContext)

export function SurgeProvider(
  props: ParentProps<{ client: SurgeClient, locale?: string }>,
) {
  const [settings] = createResource(() => loadSettings(props.client))
  const translate = createMemo(() => createTranslate(props.locale ?? 'fr'))
  const value: Surge = {
    settings: () => settings() ?? DEFAULT_SETTINGS,
    t: (key, params) => translate()(key, params),
  }
  return (
    <SurgeContext.Provider value={value}>
      {props.children}
    </SurgeContext.Provider>
  )
}

export function SurgeImage(
  props: ImageOptions & { media: Media, alt?: string, decorative?: boolean },
) {
  const { settings } = useSurge()
  const set = createMemo(() => imageSource(props.media, props, settings()))
  const alt = createMemo(() => resolveAltText(props.media, props))
  // Fallback: derivative, then the original file, then the alternative text.
  const [stage, setStage] = createSignal<ImageStage>('source')
  createEffect(on(() => props.media.id, () => setStage('source'), {
    defer: true,
  }))
  const derived = () => stage() === 'source'
  return (
    <Show
      when={stage() !== 'error'}
      fallback={(
        <span
          class="sm-image sm-image--error"
          role={alt() ? 'img' : undefined}
          aria-label={alt() || undefined}
          aria-hidden={alt() ? undefined : 'true'}
          style={cssText(imageErrorFrameStyle(set()))}
        >
          {alt()}
        </span>
      )}
    >
      <img
        class="sm-image"
        src={derived() ? set().src : props.media.url}
        srcset={derived() ? set().srcset : undefined}
        sizes={derived() && set().srcset ? set().sizes : undefined}
        width={set().width}
        height={set().height}
        alt={alt()}
        loading="lazy"
        decoding="async"
        style={cssText(imageStyle(props.media, set()))}
        onError={() => setStage(nextImageStage(stage(), props.media))}
      />
    </Show>
  )
}

/** An icon from the client, always decorative: a text carries the meaning. */
export function SurgeIcon(props: { name: IconName, size?: number }) {
  return (
    <svg {...iconSvgAttributes(props.name, props.size)}>
      <For each={ICONS[props.name]}>
        {([tag, attributes]) => <Dynamic component={tag} {...attributes} />}
      </For>
    </svg>
  )
}
```

```tsx
// src/index.tsx (application)
import '@surge-media/client/style.css' // optional theme
import { createSurgeClient } from '@surge-media/client'
import { render } from 'solid-js/web'
import { SurgeImage, SurgeProvider } from './lib/solid/surge-media'

const client = createSurgeClient({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  publishableKey: 'sm_pk_…',
})

render(() => (
  <SurgeProvider client={client} locale="en">
    <SurgeImage media={hero} sizes="(min-width: 960px) 50vw, 100vw" />
  </SurgeProvider>
), document.getElementById('app')!)
```

The context also carries `t`, the translation of the component texts (`t('video.download')`, `t('processing.states.pending')`…) in French or English, falling back to the base language (`en-GB` → `en`). Pass your overrides or other languages as the second argument of `createTranslate()`: `{ en: { video: { download: 'Download' } } }`. `SurgeIcon` renders an icon from the client — the pause button of an ambient video, the icon of a processing status (`PROCESSING_ICONS`) — with `aria-hidden`: a text always carries the meaning.

## Step 3: an Angular component

```ts
// src/angular/surge-media.ts
import {
  booleanAttribute,
  Component,
  computed,
  inject,
  InjectionToken,
  input,
  linkedSignal,
  LOCALE_ID,
  makeEnvironmentProviders,
  type Signal,
  signal,
} from '@angular/core'
import {
  createTranslate,
  cssText,
  type DisplaySettings,
  imageErrorFrameStyle,
  imageSource,
  type ImageStage,
  imageStyle,
  type Media,
  nextImageStage,
  resolveAltText,
  type SurgeClient,
  type Translate,
} from '@surge-media/client'
import { DEFAULT_SETTINGS, loadSettings } from '../core'

export interface Surge {
  settings: Signal<DisplaySettings>
  t: Translate
}

export const SURGE = new InjectionToken<Surge>('surge-media')

/** In app.config.ts: providers: [provideSurgeMedia(client)] */
export function provideSurgeMedia(client: SurgeClient) {
  return makeEnvironmentProviders([{
    provide: SURGE,
    useFactory: (): Surge => {
      const settings = signal(DEFAULT_SETTINGS)
      void loadSettings(client).then(value => settings.set(value))
      // Texts in the application's language (en-US → en).
      const t = createTranslate(inject(LOCALE_ID))
      return { settings: settings.asReadonly(), t }
    },
  }])
}

@Component({
  selector: 'surge-image',
  template: `
    @if (stage() !== 'error') {
      <img
        class="sm-image"
        [attr.src]="derived() ? set().src : media().url"
        [attr.srcset]="derived() ? set().srcset ?? null : null"
        [attr.sizes]="derived() && set().srcset ? set().sizes : null"
        [attr.width]="set().width ?? null"
        [attr.height]="set().height ?? null"
        [alt]="altText()"
        [style]="style()"
        loading="lazy"
        decoding="async"
        (error)="onError()"
      />
    } @else {
      <span
        class="sm-image sm-image--error"
        [attr.role]="altText() ? 'img' : null"
        [attr.aria-label]="altText() || null"
        [attr.aria-hidden]="altText() ? null : 'true'"
        [style]="frameStyle()"
      >{{ altText() }}</span>
    }
  `,
})
export class SurgeImageComponent {
  readonly media = input.required<Media>()
  readonly sizes = input<string>()
  readonly width = input<number>()
  readonly aspect = input<number | string>()
  readonly alt = input<string>()
  readonly decorative = input(false, { transform: booleanAttribute })

  private readonly settings = inject(SURGE).settings
  protected readonly set = computed(() => imageSource(this.media(), {
    sizes: this.sizes(),
    width: this.width(),
    aspect: this.aspect(),
  }, this.settings()))

  protected readonly altText = computed(() => resolveAltText(this.media(), {
    alt: this.alt(),
    decorative: this.decorative(),
  }))

  protected readonly style = computed(() =>
    cssText(imageStyle(this.media(), this.set())))

  protected readonly frameStyle = computed(() =>
    cssText(imageErrorFrameStyle(this.set())))

  // Fallback: derivative, then the original file, then the alternative
  // text; back to the derivative when the media changes.
  protected readonly stage = linkedSignal<Media, ImageStage>({
    source: this.media,
    computation: () => 'source',
  })

  protected readonly derived = computed(() => this.stage() === 'source')

  protected onError() {
    this.stage.set(nextImageStage(this.stage(), this.media()))
  }
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

Then, in any template that imports `SurgeImageComponent`: `<surge-image [media]="hero" sizes="100vw" />`. Add the theme to the project's `styles` list in `angular.json`: `"@surge-media/client/style.css"`.

## Step 4: videos

A video plays in the browser's native player, with the server's data. In any framework, the markup to produce is:

```html title="Video markup"
<div class="sm-video" style="position: relative; display: inline-block;
  max-width: 100%; vertical-align: top">
  <video class="sm-video__player" controls preload="metadata" playsinline
    crossorigin="anonymous" width="1920" height="1080"
    poster="https://media.example.com/m/…/w_1280/visit.webp"
    aria-label="Visit" style="display: block; max-width: 100%; height: auto">
    <source src="…/renditions/av1.webm" type='video/webm; codecs="…"'>
    <source src="…/renditions/h264.mp4" type='video/mp4; codecs="…"'>
    <track kind="captions" srclang="en" label="English"
      src="…/tracks/cm….vtt" default>
    Your browser cannot play this video.
  </video>
</div>
```

- One `<source>` per item of `media.sources`, **in the server's order** (`url`, `type`): the browser plays the first one it supports.
- `poster` from `videoPoster(media, { posterWidth }, settings)`: a derivative of 1,280 px at most, or the poster as is when only presets are allowed. `width` and `height` from `videoSize(media)`, to reserve the space; `aria-label` from `videoLabel(media, label)` (the title, else the alternative text); inline styles `VIDEO_FRAME_STYLE` and `VIDEO_PLAYER_STYLE`.
- One `<track>` per item of `media.textTracks` (`kind`, `language`, `label`, `url`, `default`), and then `crossorigin="anonymous"`: the tracks are served by SurgeMedia's domain. The fallback text is `t('video.unsupported')`.
- No `sources` yet (a converted format being prepared): in place of the player, the message `t(videoMessageKey(media))`, the processing status when `processingVisible(media.processing)`, and a `t('video.download')` link to `media.url`, in a `videoEmptyStyle(width, height)` frame. Call `followProcessing()` to get the updated media when it is ready.
- Error on the last `<source>`: `heldVideoDelay(url)` (a `HEAD` request) tells whether the server holds the video (503 `PROCESSING_PENDING`) and in how many milliseconds to retry with `video.load()` — at most `VIDEO_RETRY_LIMIT` times, announcing `t('video.held')` (`role="status"`). `null`: the video cannot be played, show `t(videoMessageKey(media, true))`.
- Ambient video (muted, looping): started automatically only when `prefersReducedMotion()` is false, with a visible pause button (`t('video.pause')`, `pause` icon). `whenNearViewport()` delays loading a video far from the screen.

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
- **Server-side rendering**: one client and one context per request (a delegated token belongs to one visitor), and the project settings known **before** rendering — read them in an initializer (Angular `provideAppInitializer`, a Solid resource inside `Suspense`…) or pass them from your configuration (`DisplayDefaults`). Otherwise the server builds URLs for the default policy. An image that failed before hydration is detected on mount with `imageFailedEarly(img)`.
- **Images**: `width` and `height` always set (no layout shift) and `max-width: 100%; height: auto` for fluid images — `imageSource()` and `imageStyle()` take care of it —, `sizes` that match your layout.
- **Alternative text**: `resolveAltText()` — an explicit `alt`, else the media's `altText`; empty only with `decorative`, for a purely decorative image. An image without alternative text is reported in development.
- **Fallback**: `nextImageStage()` — derivative, then `media.url`, then the alternative text shown in place of the image (`imageErrorFrameStyle()`). Reset it when the media changes.
- **Texts**: no hard-coded text — labels, announcements and `aria-label` go through `t()`: French by default, English, and your languages as overrides.
- **Videos**: sources in the server's order, no autoplay — a muted looping video needs a visible pause button (WCAG 2.2.2) and respects `prefersReducedMotion()`.
- **Status**: announce processing changes politely (`role="status"`, text hidden with `VISUALLY_HIDDEN`), only on transitions: `processingAnnouncementKey(next, previous)`. Static icons, never animated.
- **Private media**: their URLs are signed until `urlExpiresAt`; read the media again before that time if the page stays open (`followExpiry()`, from `refreshDelay()`).
- **Theme**: the `sm-*` classes of the official packages, so that `@surge-media/client/style.css` applies; without it, inline styles keep sizes and aspect ratios correct.
- **Tests**: render on the server and compare `src` / `srcset` with `imageSource()`; type your components with the client's types (`Media`, `ImageOptions`, `DisplaySettings`).

Built an integration for a framework? Tell us on [GitHub](https://github.com/mahmoud-nb/surge-media): it can become an official package.

## Related

- [SDKs and components](../sdks/)
- [Image transformations](../image-transformations/)
- [Security & access control](../../guides/security/)
