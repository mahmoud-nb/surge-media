---
title: Créer une intégration pour un framework
description: Utilisez @surge-media/client pour écrire vos propres composants surgeMedia dans un framework sans paquet officiel — Angular, SolidJS, Qwik, Lit… — avec les mêmes garanties que les paquets officiels.
---

Les paquets officiels couvrent Vue, et React et Svelte sont prévus (voir [SDK et composants](../sdks/)). Pour un autre framework — Angular, SolidJS, Qwik, Lit, Ember — ou pour votre propre design system, créez une petite librairie locale au-dessus de **`@surge-media/client`**. Le client porte toute la logique : appels à l’API, identifiants, URL, `srcset`, politique de transformation, sources vidéo, et celle des composants — textes en français et en anglais, icônes, attributs et styles en ligne, repli d’une image, états d’une vidéo —, ainsi que leur thème CSS. Votre librairie se contente de la relier aux composants du framework. Les paquets officiels sont construits exactement ainsi.

## Ce que le client vous apporte

### L’API et les URL

| Besoin | À utiliser |
| --- | --- |
| Lire les médias, le projet, ses préréglages | `createSurgeClient()`, `client.media.get()` / `list()` / `getMany()`, `client.project()`, `client.presets()` |
| Les attributs d’une image d’après une requête complète | `imageSourceSet(request)`, `transformMode(policy, media)`, `imageFormat()`, `pictureFormats()` |
| Un recadrage CSS autour du point d’intérêt | `focalObjectPosition()`, `objectPosition()`, `focusPosition()` |
| Affiche, sources et pistes d’une vidéo | `posterUrl()`, `media.sources`, `media.textTracks` |
| Suivre une vidéo que le serveur prépare | `isProcessing(media)`, `watchMedia(client, media, options)` |
| Envoyer des fichiers : règles, contrôle, file avec progression, capture de l’affiche | `client.uploadRules()`, `checkFile()`, `acceptAttribute()`, `createUploadQueue()`, `captureVideoFrame()` |
| Des jetons délégués émis par votre serveur | `createDelegatedToken()`, `UPLOAD_SCOPES` (`@surge-media/client/server`) |
| Des erreurs lisibles | `SurgeApiError`, `errorMessage(code, locale)` |
| Durées, tailles et pourcentages dans la langue de l’utilisateur | `formatDuration()`, `formatClock()`, `formatBytes()`, `formatPercent()` |

### La logique des composants

Les composants officiels ne contiennent que le rendu : tout ce qui suit est dans le client, écrit une fois pour tous les frameworks.

| Besoin | À utiliser |
| --- | --- |
| Réglages d’affichage du projet : politique, formats, taille maximale, préréglages connus | `projectSettings()`, `knownPresets()`, `displaySettings()` → `DisplaySettings` |
| Les attributs d’un `<img>` d’après les propriétés d’un composant | `imageSource(media, options, settings)` |
| Les `<source>` d’un `<picture>`, avec direction artistique | `pictureSources(media, options, settings)` |
| Texte alternatif, repli sur l’original puis sur le texte | `resolveAltText()`, `nextImageStage()`, `imageFailedEarly()` |
| Affiche, taille, nom accessible et messages d’une vidéo | `videoPoster()`, `videoSize()`, `videoLabel()`, `videoMessageKey()` |
| Vidéo retenue par le serveur, chargement différé, mode ambiant | `heldVideoDelay()`, `VIDEO_RETRY_LIMIT`, `whenNearViewport()`, `prefersReducedMotion()` |
| Vignettes | `thumbnailSource()`, `kindIcon()`, `kindLabelKey()`, `thumbnailIconSizes()` |
| État du traitement : icône, avancement, raison d’un échec, annonces | `PROCESSING_ICONS`, `processingVisible()`, `processingProgress()`, `processingReason()`, `processingAnnouncementKey()` |
| Affichage de l’envoi : champ, aide, actions et état de chaque fichier | `uploaderAccept()`, `uploaderFields()`, `uploadHelpLines()`, `canRetryUpload()`, `uploadStatusText()`, `takeSettledUploads()` |
| Relire un média privé avant l’échéance de ses URL signées | `refreshDelay(media)` |
| Textes des composants en français (par défaut) et en anglais | `createTranslate(locale, overrides)` → `t(key, params)`, `COMPONENT_MESSAGES` |
| Icônes (tracés SVG, toujours décoratives) | `ICONS`, `iconSvgAttributes(name, size)` |
| Styles en ligne minimaux | `imageStyle()`, `imageErrorFrameStyle()`, `VIDEO_PLAYER_STYLE`…, `VISUALLY_HIDDEN`, `cssText()` |

Les styles en ligne sont des objets aux propriétés en camelCase, acceptés tels quels par Vue et React ; `cssText()` en fait une chaîne (`max-width: 100%; height: auto`) pour les frameworks qui attendent un style en texte : SolidJS, Angular, Lit, Svelte. Sans feuille de style, ils gardent corrects les tailles, les rapports et les textes réservés aux lecteurs d’écran (`VISUALLY_HIDDEN`).

### Le thème

`@surge-media/client/style.css` est le thème facultatif des paquets officiels (`@surge-media/vue/style.css` le reprend tel quel). Importez-le une fois dans l’application et posez sur vos éléments les mêmes classes stables : `sm-image`, `sm-image--error`, `sm-video`, `sm-video__player`, `sm-video__message`, `sm-status`, `sm-thumbnail`, `sm-uploader`… Il définit des jetons `--sm-*` (`--sm-color-primary`, `--sm-color-surface`, `--sm-radius`…) en clair et en sombre, aux contrastes vérifiés (WCAG 2.2 AA) ; tout est rangé dans la couche CSS `surge-media` : vos styles l’emportent toujours.

## Organisation d’une intégration

1. **Un contexte partagé** par application — et par requête avec un rendu serveur : le client, les réglages d’affichage du projet (`DisplaySettings` : politique, formats, taille maximale, préréglages), lus une fois, et la traduction des textes. Utilisez le mécanisme du framework : fournisseurs Angular, contexte Solid, contexte Qwik…
2. **La logique des composants, déjà dans le client** : `imageSource()`, `pictureSources()`, `videoPoster()`, `resolveAltText()`… transforment un objet `Media` et les réglages en attributs, textes et styles prêts à afficher. Votre librairie n’y ajoute qu’un petit cœur indépendant du framework : la lecture des réglages et les suivis dans le temps (traitement d’une vidéo, échéance d’un média privé).
3. **Des composants fins**, qui appellent ces fonctions et affichent un simple `<img>`, `<picture>` ou `<video>` avec les classes `sm-*` du thème.

## Étape 1 : le cœur indépendant du framework

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

/** Réglages avant la lecture du projet : rendu serveur déterministe. */
export const DEFAULT_SETTINGS: DisplaySettings = displaySettings(
  projectSettings(null),
  knownPresets(null),
)

/** Politique, formats, taille maximale et préréglages, lus une fois. */
export async function loadSettings(
  client: SurgeClient,
): Promise<DisplaySettings> {
  const [project, presets] = await Promise.all([
    client.project().catch(() => null),
    client.presets().catch(() => null),
  ])
  return displaySettings(projectSettings(project), knownPresets(presets))
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

/** Relit un média privé avant l'échéance de ses URL signées. */
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

`DEFAULT_SETTINGS` sert au premier rendu, avant la lecture du projet. Pour connaître la politique sans lire le projet (rendu serveur), passez vos valeurs en second argument de `projectSettings()` et en troisième de `displaySettings()` : `DisplayDefaults` (`policy`, `formats`, `maxDimension`, `widths`, `imageFormat`). Rappelez `followExpiry()` avec chaque média relu.

Le reste ne s’écrit pas : les composants appellent directement le client avec les réglages du contexte. `imageSource(media, options, settings)` fait le plus difficile : un `srcset` en largeurs (ou en densités quand la largeur d’affichage est fixe), la taille réelle de chaque fichier (le serveur n’agrandit jamais une image), le recadrage serveur autour du point d’intérêt quand un `aspect` est donné, le format activé sur le serveur, et les préréglages quand le projet n’autorise pas les paramètres libres. Ses options (`ImageOptions`) sont les propriétés des composants officiels : `width`, `height`, `aspect`, `fit`, `transform`, `preset`, `presets`, `format`, `widths`, `sizes`. `pictureSources()` rend de même les balises `<source>` d’un `<picture>` (avec une `key` stable pour vos listes) et son image de repli.

## Étape 2 : des composants SolidJS

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
  // Repli : dérivé, puis fichier original, puis texte alternatif.
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

/** Icône du client, toujours décorative : le sens est porté par un texte. */
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
import '@surge-media/client/style.css' // thème facultatif
import { createSurgeClient } from '@surge-media/client'
import { render } from 'solid-js/web'
import { SurgeImage, SurgeProvider } from './lib/solid/surge-media'

const client = createSurgeClient({
  baseUrl: 'https://media.example.com',
  projectId: 'cm…',
  publishableKey: 'sm_pk_…',
})

render(() => (
  <SurgeProvider client={client} locale="fr">
    <SurgeImage media={hero} sizes="(min-width: 960px) 50vw, 100vw" />
  </SurgeProvider>
), document.getElementById('app')!)
```

Le contexte porte aussi `t`, la traduction des textes des composants (`t('video.download')`, `t('processing.states.pending')`…) en français ou en anglais, avec repli sur la langue de base (`fr-CA` → `fr`). Passez vos surcharges ou d’autres langues en second argument de `createTranslate()` : `{ fr: { video: { download: 'Télécharger' } } }`. `SurgeIcon` affiche une icône du client — bouton pause d’une vidéo d’ambiance, icône de l’état du traitement (`PROCESSING_ICONS`) — avec `aria-hidden` : le sens est toujours donné par un texte.

## Étape 3 : un composant Angular

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

/** Dans app.config.ts : providers: [provideSurgeMedia(client)] */
export function provideSurgeMedia(client: SurgeClient) {
  return makeEnvironmentProviders([{
    provide: SURGE,
    useFactory: (): Surge => {
      const settings = signal(DEFAULT_SETTINGS)
      void loadSettings(client).then(value => settings.set(value))
      // Textes dans la langue de l'application (fr-FR → fr).
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

  // Repli : dérivé, puis fichier original, puis texte alternatif ;
  // de nouveau le dérivé quand le média change.
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

Puis, dans tout gabarit qui importe `SurgeImageComponent` : `<surge-image [media]="hero" sizes="100vw" />`. Le thème s’ajoute à la liste `styles` du projet dans `angular.json` : `"@surge-media/client/style.css"`.

## Étape 4 : les vidéos

Une vidéo s’affiche dans le lecteur natif du navigateur, avec les données du serveur. Quel que soit le framework, le balisage à produire est :

```html title="Balisage d’une vidéo"
<div class="sm-video" style="position: relative; display: inline-block;
  max-width: 100%; vertical-align: top">
  <video class="sm-video__player" controls preload="metadata" playsinline
    crossorigin="anonymous" width="1920" height="1080"
    poster="https://media.example.com/m/…/w_1280/visite.webp"
    aria-label="Visite" style="display: block; max-width: 100%; height: auto">
    <source src="…/renditions/av1.webm" type='video/webm; codecs="…"'>
    <source src="…/renditions/h264.mp4" type='video/mp4; codecs="…"'>
    <track kind="captions" srclang="fr" label="Français"
      src="…/tracks/cm….vtt" default>
    Votre navigateur ne peut pas lire cette vidéo.
  </video>
</div>
```

- Une `<source>` par élément de `media.sources`, **dans l’ordre du serveur** (`url`, `type`) : le navigateur lit la première qu’il sait lire.
- `poster` tiré de `videoPoster(media, { posterWidth }, settings)` : un dérivé de 1 280 px au plus, ou l’affiche telle quelle si seuls les préréglages sont permis. `width` et `height` tirés de `videoSize(media)`, pour réserver la place ; `aria-label` de `videoLabel(media, label)` (le titre, sinon le texte alternatif) ; styles en ligne `VIDEO_FRAME_STYLE` et `VIDEO_PLAYER_STYLE`.
- Une `<track>` par élément de `media.textTracks` (`kind`, `language`, `label`, `url`, `default`), et alors `crossorigin="anonymous"` : les pistes sont servies par le domaine de surgeMedia. Le texte de repli est `t('video.unsupported')`.
- Pas encore de `sources` (format converti en préparation) : à la place du lecteur, le message `t(videoMessageKey(media))`, l’état du traitement si `processingVisible(media.processing)` et un lien `t('video.download')` vers `media.url`, dans un cadre `videoEmptyStyle(width, height)`. Appelez `followProcessing()` pour recevoir le média à jour quand il sera prêt.
- Erreur de la dernière `<source>` : `heldVideoDelay(url)` (une requête `HEAD`) indique si le serveur retient la vidéo (503 `PROCESSING_PENDING`) et dans combien de millisecondes réessayer avec `video.load()` — au plus `VIDEO_RETRY_LIMIT` fois, en annonçant `t('video.held')` (`role="status"`). `null` : la vidéo est illisible, affichez `t(videoMessageKey(media, true))`.
- Vidéo d’ambiance (muette, en boucle) : lancée seule seulement si `prefersReducedMotion()` est faux, avec un bouton pause visible (`t('video.pause')`, icône `pause`). `whenNearViewport()` retarde le chargement d’une vidéo loin de l’écran.

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
- **Rendu serveur** : un client et un contexte par requête (un jeton délégué appartient à un seul visiteur), et les réglages du projet connus **avant** le rendu — lisez-les dans une initialisation (`provideAppInitializer` d’Angular, une ressource Solid dans `Suspense`…) ou passez-les depuis votre configuration (`DisplayDefaults`). Sinon le serveur construit les URL de la politique par défaut. Une image en échec avant l’hydratation se repère au montage avec `imageFailedEarly(img)`.
- **Images** : `width` et `height` toujours posés (aucun décalage au chargement) et `max-width: 100%; height: auto` pour une image fluide — `imageSource()` et `imageStyle()` s’en chargent —, un `sizes` conforme à votre mise en page.
- **Texte alternatif** : `resolveAltText()` — un `alt` explicite, sinon l’`altText` du média ; vide seulement avec `decorative`, pour une image purement décorative. Une image sans texte alternatif est signalée en développement.
- **Repli** : `nextImageStage()` — dérivé, puis `media.url`, puis le texte alternatif affiché à la place de l’image (`imageErrorFrameStyle()`). À réinitialiser quand le média change.
- **Textes** : aucun texte en dur — libellés, annonces et `aria-label` passent par `t()` : le français par défaut, l’anglais, et vos langues en surcharge.
- **Vidéos** : sources dans l’ordre du serveur, aucune lecture automatique — une vidéo muette en boucle exige un bouton pause visible (WCAG 2.2.2) et respecte `prefersReducedMotion()`.
- **État** : annoncez les changements du traitement poliment (`role="status"`, texte masqué par `VISUALLY_HIDDEN`), seulement aux transitions : `processingAnnouncementKey(next, previous)`. Des icônes fixes, jamais animées.
- **Médias privés** : leurs URL sont signées jusqu’à `urlExpiresAt` ; relisez le média avant cette échéance si la page reste ouverte (`followExpiry()`, d’après `refreshDelay()`).
- **Thème** : les classes `sm-*` des paquets officiels, pour que `@surge-media/client/style.css` s’applique ; sans lui, les styles en ligne gardent les tailles et les rapports corrects.
- **Tests** : faites un rendu serveur et comparez `src` / `srcset` à ceux de `imageSource()` ; typez vos composants avec les types du client (`Media`, `ImageOptions`, `DisplaySettings`).

Vous avez créé une intégration pour un framework ? Dites-le-nous sur [GitHub](https://github.com/mahmoud-nb/surge-media) : elle peut devenir un paquet officiel.

## Voir aussi

- [SDK et composants](../sdks/)
- [Transformations d’images](../image-transformations/)
- [Sécurité et contrôle d’accès](../../guides/security/)
