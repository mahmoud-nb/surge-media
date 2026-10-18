import {
  type ComponentMessages,
  createSurgeClient,
  createTranslate,
  type DeepPartial,
  type DisplayDefaults,
  displaySettings,
  type DisplaySettings,
  knownPresets,
  type Preset,
  type Project,
  type ProjectSettings,
  projectSettings,
  type SurgeClient,
  type TokenProvider,
  type Translate,
} from '@surge-media/client'
import { computed, type ComputedRef, inject, type InjectionKey, isRef, type Ref, ref, shallowRef, type ShallowRef } from 'vue'

/** Réglages utilisés tant que le projet n'est pas lu (ou sans client) : rendu serveur déterministe. */
export type SurgeMediaDefaults = DisplayDefaults

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
  messages?: Record<string, DeepPartial<ComponentMessages>>
  defaults?: SurgeMediaDefaults
  /** Projet déjà lu (rendu serveur) : politique et formats connus dès le premier rendu. */
  project?: Project
  /** Préréglages déjà lus (rendu serveur). */
  presets?: Preset[]
  /** Lire le projet au démarrage dans le navigateur (vrai par défaut avec un client). */
  loadProject?: boolean
}

/** Réglages effectifs du projet pour construire les URL (`projectSettings` du client). */
export type { ProjectSettings }

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
    settings: computed(() => projectSettings(project.value, defaults)),
    presets: computed(() => knownPresets(projectPresets.value)),
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

/** Réglages des composants d'affichage (réglages du projet, préréglages, valeurs par défaut), réactifs. */
export function useDisplaySettings(): ComputedRef<DisplaySettings> {
  const { settings, presets, defaults } = useSurgeMedia()
  return computed(() => displaySettings(settings.value, presets.value, defaults))
}
