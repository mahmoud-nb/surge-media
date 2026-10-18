---
title: Créer une intégration pour un framework
description: Utilisez @surge-media/client pour écrire vos propres composants surgeMedia dans un framework sans paquet officiel — Angular, SolidJS, Qwik, Lit… — avec les mêmes garanties que les paquets officiels.
---

Les paquets officiels couvrent Vue, et React et Svelte sont prévus (voir [SDK et composants](../sdks/)). Pour un autre framework — Angular, SolidJS, Qwik, Lit, Ember — ou pour votre propre design system, créez une petite librairie locale au-dessus de **`@surge-media/client`**. Le client porte toute la logique : appels à l’API, identifiants, URL, `srcset`, politique de transformation, sources vidéo. Votre librairie se contente de la relier aux composants du framework. Les paquets officiels sont construits exactement ainsi.

## Ce que le client vous apporte

| Besoin | À utiliser |
| --- | --- |
| Lire les médias, le projet, ses préréglages | `createSurgeClient()`, `client.media.get()` / `list()` / `getMany()`, `client.project()`, `client.presets()` |
| Les attributs d’une image (`src`, `srcset`, `sizes`, `width`, `height`) | `imageSourceSet(request)` |
| Paramètres libres ou préréglages seulement, selon la politique du projet | `transformMode(policy, media)` |
| Le format d’un `<img>`, les formats des `<source>` d’un `<picture>` | `imageFormat(formats)`, `pictureFormats(formats)`, `FORMAT_MIME_TYPES` |
| Les préréglages toujours présents | `BUILTIN_PRESETS` (`preview`, `full`) |
| Un recadrage CSS autour du point d’intérêt | `focalObjectPosition()`, `objectPosition()` |
| Affiche, sources et pistes d’une vidéo | `posterUrl()`, `media.sources`, `media.textTracks` |
| Suivre une vidéo que le serveur prépare | `isProcessing(media)`, `watchMedia(client, media, options)` |
| Envoyer des fichiers : règles, contrôle, file avec progression, capture de l’affiche | `client.uploadRules()`, `checkFile()`, `acceptAttribute()`, `createUploadQueue()`, `captureVideoFrame()` |
| Des jetons délégués émis par votre serveur | `createDelegatedToken()`, `UPLOAD_SCOPES` (`@surge-media/client/server`) |
| Des erreurs lisibles | `SurgeApiError`, `errorMessage(code, locale)` |
| Durées et tailles dans la langue de l’utilisateur | `formatDuration()`, `formatClock()`, `formatBytes()` |

## Organisation d’une intégration

1. **Un contexte partagé** par application — et par requête avec un rendu serveur : le client et les réglages du projet (`transformPolicy`, `transformFormats`, `transformMaxDimension`, préréglages), lus une fois. Utilisez le mécanisme du framework : fournisseurs Angular, contexte Solid, contexte Qwik…
2. **Un cœur indépendant du framework** dans votre librairie : quelques fonctions qui transforment un objet `Media` et les réglages en attributs prêts à afficher. C’est le seul code écrit contre le client, et le même pour tous les frameworks.
3. **Des composants fins**, qui appellent ce cœur et affichent un simple `<img>`, `<picture>` ou `<video>`.

## Étape 1 : le cœur indépendant du framework

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

/** Réglages du projet pour construire les URL, lus une fois. */
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

/** Ce qu'un composant peut régler : taille, cadrage, préréglages… */
export type ImageOptions = Partial<Pick<ImageSourceRequest,
  'width' | 'height' | 'aspect' | 'fit' | 'sizes' | 'widths'
  | 'preset' | 'presetNames' | 'transform'>>

/** Attributs d'un <img> pour un média, prêts à afficher. */
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

/** Affiche d'une vidéo, réduite si les paramètres libres sont permis. */
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

/** Suit une vidéo en préparation ; renvoie de quoi l'arrêter. */
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

`imageSourceSet()` fait le plus difficile : un `srcset` en largeurs (ou en densités quand la largeur d’affichage est fixe), la taille réelle de chaque fichier (le serveur n’agrandit jamais une image), le recadrage serveur autour du point d’intérêt quand un `aspect` est donné, et les préréglages quand le projet n’autorise pas les paramètres libres.

## Étape 2 : des composants SolidJS

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
  // Si le dérivé ne se charge pas, repli sur le fichier original.
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

## Étape 3 : un composant Angular

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

/** Dans app.config.ts : providers: [provideSurgeMedia(client)] */
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
    // Si le dérivé ne se charge pas, repli sur le fichier original.
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

Puis, dans tout gabarit qui importe `SurgeImageComponent` : `<surge-image [media]="hero" sizes="100vw" />`.

## Étape 4 : les vidéos

Une vidéo ne demande aucun calcul hormis l’affiche : affichez les données du serveur dans le lecteur natif du navigateur. Quel que soit le framework, le balisage à produire est :

```html title="Balisage d’une vidéo"
<video controls preload="metadata" playsinline
  crossorigin="anonymous" width="1920" height="1080"
  poster="https://media.example.com/m/…/w_1280/visite.webp"
  aria-label="Visite">
  <source src="…/renditions/av1.webm" type='video/webm; codecs="…"'>
  <source src="…/renditions/h264.mp4" type='video/mp4; codecs="…"'>
  <track kind="captions" srclang="fr" label="Français"
    src="…/tracks/cm….vtt" default>
</video>
```

- Une `<source>` par élément de `media.sources`, **dans l’ordre du serveur** (`url`, `type`) : le navigateur lit la première qu’il sait lire.
- `poster` tiré de `videoPoster()` ; `width` et `height` du média, pour réserver la place.
- Une `<track>` par élément de `media.textTracks` (`kind`, `language`, `label`, `url`, `default`), et alors `crossorigin="anonymous"` : les pistes sont servies par le domaine de surgeMedia.
- Pas encore de `sources` (format converti en préparation) : affichez un message et un lien vers `media.url` ; appelez `followProcessing()` pour recevoir le média à jour quand il sera prêt.

## Empaqueter votre librairie

Une librairie locale peut simplement être un dossier de votre application (`src/lib/surge-media/`), ou un paquet de votre monorepo :

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

Le framework est une **dépendance pair** (l’exemplaire de l’application) ; le client, une dépendance ordinaire.

## Liste de contrôle

Ce que garantissent les paquets officiels, et que votre intégration doit garantir aussi :

- **Identifiants** : une clé publique, ou des jetons délégués obtenus par `getToken`, émis par votre serveur avec la clé secrète. Jamais de clé secrète ni de jeton personnel dans un navigateur.
- **Rendu serveur** : un client et un contexte par requête (un jeton délégué appartient à un seul visiteur), et les réglages du projet connus **avant** le rendu — lisez-les dans une initialisation (`provideAppInitializer` d’Angular, une ressource Solid dans `Suspense`…) ou passez-les depuis votre configuration. Sinon le serveur construit les URL de la politique par défaut.
- **Images** : `width` et `height` toujours posés (aucun décalage au chargement), `max-width: 100%; height: auto` pour une image fluide, un `sizes` conforme à votre mise en page.
- **Texte alternatif** : un `alt` explicite, sinon l’`altText` du média ; vide seulement pour une image purement décorative.
- **Repli** : dérivé, puis `media.url`, puis le texte alternatif affiché à la place de l’image. À réinitialiser quand le média change.
- **Vidéos** : sources dans l’ordre du serveur, aucune lecture automatique — une vidéo muette en boucle exige un bouton pause visible (WCAG 2.2.2).
- **État** : annoncez les changements du traitement poliment (`role="status"`), seulement aux transitions.
- **Médias privés** : leurs URL sont signées jusqu’à `urlExpiresAt` ; relisez le média avant cette échéance si la page reste ouverte.
- **Tests** : faites un rendu serveur et comparez `src` / `srcset` à ceux de `imageSourceSet()` ; typez vos composants avec le type `Media` du client.

Vous avez créé une intégration pour un framework ? Dites-le-nous sur [GitHub](https://github.com/mahmoud-nb/surge-media) : elle peut devenir un paquet officiel.

## Voir aussi

- [SDK et composants](../sdks/)
- [Transformations d’images](../image-transformations/)
- [Sécurité et contrôle d’accès](../../guides/security/)
