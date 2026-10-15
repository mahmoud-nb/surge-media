import {
  ALL_FORMATS,
  BUILTIN_PRESETS,
  createSurgeClient,
  DEFAULT_MAX_DIMENSION,
  type Preset,
  type Project,
  type SurgeClient,
  type TokenProvider,
  type TransformFormat,
  type TransformPolicy,
} from '@surge-media/client'
import { computed, type ComputedRef, inject, type InjectionKey, isRef, type Ref, ref, shallowRef, type ShallowRef } from 'vue'
import { createTranslate, type DeepPartial, type Messages, type Translate } from './i18n'

/** Réglages utilisés tant que le projet n'est pas lu (ou sans client) : rendu serveur déterministe. */
export interface SurgeMediaDefaults {
  /** Formats de sortie activés sur le serveur (sinon ceux du projet ; à défaut, les quatre). */
  formats?: TransformFormat[]
  /** Politique de transformation (sinon celle du projet ; à défaut, `open`). */
  policy?: TransformPolicy
  /** Dimension maximale d'un dérivé (sinon celle du projet ; à défaut, 4096). */
  maxDimension?: number
  /** Largeurs des srcset (sinon celles du client). */
  widths?: number[]
  /** Format des images seules (`<img>`) : WebP par défaut. */
  imageFormat?: TransformFormat
}

export interface SurgeMediaOptions {
  /** Client déjà créé ; sinon créé depuis `baseUrl`, `projectId` et l'identifiant. */
  client?: SurgeClient
  baseUrl?: string
  projectId?: string
  publishableKey?: string
  getToken?: TokenProvider
  fetch?: typeof fetch
  /** Langue des textes (`fr` par défaut) : chaîne, ou `Ref` à garder synchronisée (vue-i18n…). */
  locale?: string | Ref<string>
  /** Langue de repli d'une langue sans traduction (`fr` par défaut). */
  fallbackLocale?: string
  /** Textes surchargés ou langues ajoutées : `{ fr: { video: { download: '…' } }, de: { … } }`. */
  messages?: Record<string, DeepPartial<Messages>>
  defaults?: SurgeMediaDefaults
  /** Projet déjà lu (rendu serveur) : politique et formats connus dès le premier rendu. */
  project?: Project
  /** Préréglages déjà lus (rendu serveur). */
  presets?: Preset[]
  /** Lire le projet au démarrage dans le navigateur (vrai par défaut avec un client). */
  loadProject?: boolean
}

/** Réglages effectifs du projet pour construire les URL. */
export interface ProjectSettings {
  policy: TransformPolicy | null
  formats: readonly TransformFormat[]
  maxDimension: number
}

export interface SurgeMediaContext {
  readonly client: SurgeClient | null
  /** Langue active (modifiable). */
  readonly locale: Ref<string>
  /** Traduction réactive (suit `locale`). */
  readonly t: Translate
  readonly defaults: Readonly<SurgeMediaDefaults>
  readonly project: ShallowRef<Project | null>
  readonly settings: ComputedRef<ProjectSettings>
  /** Préréglages connus : intégrés, puis ceux du projet une fois lus. */
  readonly presets: ComputedRef<readonly Preset[]>
  /** Relit le projet (politique, formats) ; ses erreurs sont gardées dans `error`, jamais levées. */
  refreshProject: () => Promise<void>
  /** Lit les préréglages du projet (une fois). */
  loadPresets: () => Promise<void>
  readonly error: ShallowRef<unknown>
}

export const SURGE_MEDIA_KEY: InjectionKey<SurgeMediaContext> = Symbol('surge-media')

export function createSurgeMediaContext(options: SurgeMediaOptions = {}): SurgeMediaContext {
  const client = options.client
    ?? (options.baseUrl && options.projectId
      ? createSurgeClient({
          baseUrl: options.baseUrl,
          projectId: options.projectId,
          publishableKey: options.publishableKey,
          getToken: options.getToken,
          fetch: options.fetch,
        })
      : null)
  const locale = isRef(options.locale) ? options.locale : ref(options.locale ?? 'fr')
  const translate = computed(() => createTranslate(locale.value, options.messages, options.fallbackLocale))
  const defaults = options.defaults ?? {}
  const project = shallowRef<Project | null>(options.project ?? null)
  const projectPresets = shallowRef<Preset[] | null>(options.presets ?? null)
  const error = shallowRef<unknown>(null)
  let presetsLoading: Promise<void> | null = null

  return {
    client,
    locale,
    t: (key, params) => translate.value(key, params),
    defaults,
    project,
    settings: computed(() => ({
      policy: project.value?.transformPolicy ?? defaults.policy ?? null,
      formats: project.value?.transformFormats ?? defaults.formats ?? ALL_FORMATS,
      maxDimension: project.value?.transformMaxDimension ?? defaults.maxDimension ?? DEFAULT_MAX_DIMENSION,
    })),
    presets: computed(() => {
      const custom = projectPresets.value ?? []
      return [...BUILTIN_PRESETS.filter(builtin => !custom.some(preset => preset.name === builtin.name)), ...custom]
    }),
    async refreshProject() {
      if (!client) return
      try {
        project.value = await client.project({ refresh: true })
        error.value = null
      }
      catch (caught) {
        error.value = caught
      }
    },
    loadPresets() {
      if (!client || projectPresets.value) return Promise.resolve()
      presetsLoading ??= client.presets().then(
        (items) => { projectPresets.value = items },
        (caught: unknown) => {
          error.value = caught
          presetsLoading = null
        },
      )
      return presetsLoading
    },
    error,
  }
}

let fallback: SurgeMediaContext | null = null

/** Contexte fourni par le plugin ; sans plugin, un contexte par défaut (sans client, en français). */
export function useSurgeMedia(): SurgeMediaContext {
  const context = inject(SURGE_MEDIA_KEY, null)
  if (context) return context
  fallback ??= createSurgeMediaContext()
  return fallback
}
