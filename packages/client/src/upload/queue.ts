import type { SurgeClient } from '../client'
import { isSurgeApiError, SurgeApiError } from '../errors'
import type { Media, MediaKind, UploadFields, UploadRules } from '../types'
import { checkFile, fileKind } from './rules'
import { type CapturedFrame, captureVideoFrame } from './video-frame'

/**
 * File d'envoi sans framework (architecture phase E, ED32, ED34) : pré-contrôle d'après les règles du
 * serveur, envois en parallèle bornés, progression, annulation, nouvel essai, affiche capturée pendant
 * l'envoi d'une vidéo (ED35). L'état est une liste d'éléments immuables, publiée à chaque changement
 * (`subscribe`) : Vue, React ou Svelte n'y ajoutent que leur réactivité et leur interface.
 */

/**
 * État d'un fichier : `queued` (en attente : d'un départ, d'une place ou d'un nouvel essai automatique,
 * voir `retryAt`), `uploading`, `poster` (média créé, affiche en cours d'envoi), `done`, `error`,
 * `canceled`.
 */
export type UploadStatus = 'queued' | 'uploading' | 'poster' | 'done' | 'error' | 'canceled'

export interface UploadItem {
  readonly id: string
  readonly file: Blob
  readonly name: string
  readonly size: number
  /** Genre probable (type annoncé, extension) ; null s'il est inconnu. */
  readonly kind: MediaKind | null
  readonly status: UploadStatus
  /** Fraction envoyée (0 à 1) ; null avant le départ ou hors navigateur. */
  readonly progress: number | null
  /** Champs envoyés avec le fichier (ceux qu'impose un jeton délégué l'emportent côté serveur). */
  readonly fields: Readonly<UploadFields>
  /** Média créé. */
  readonly media: Media | null
  /** Dernière erreur : refus du pré-contrôle (statut 0) ou du serveur. */
  readonly error: SurgeApiError | null
  /** Envois tentés. */
  readonly attempts: number
  /** Heure (ms) du prochain essai automatique ; null sinon. */
  readonly retryAt: number | null
}

export interface UploadQueueOptions {
  client: Pick<SurgeClient, 'media'>
  /** Règles d'envoi (`client.uploadRules()`) : pré-contrôle et envois restants ; sans elles, le serveur seul juge. */
  rules?: UploadRules | null
  /** Genres acceptés par cette file (restreints par les règles). */
  kinds?: readonly MediaKind[]
  /** Champs communs à tous les fichiers. */
  fields?: UploadFields
  /** Envois simultanés (2 par défaut). */
  concurrency?: number
  /** Envoi dès l'ajout (vrai par défaut) ; sinon `start()`. */
  autoStart?: boolean
  /** Capture de l'affiche d'une vidéo pendant son envoi (vrai par défaut, navigateur seulement). */
  capturePoster?: boolean
  /** Nouveaux essais automatiques après 429, 503 ou une erreur réseau (3 par défaut). */
  maxRetries?: number
  /** Capture d'image (remplaçable, par exemple dans les tests). */
  captureFrame?: (file: Blob) => Promise<CapturedFrame | null>
  onUploaded?: (media: Media, item: UploadItem) => void
  onError?: (item: UploadItem) => void
  /** Plus rien n'est en cours ni prêt à partir, après au moins un envoi. */
  onSettled?: (items: readonly UploadItem[]) => void
}

export interface UploadQueue {
  readonly items: readonly UploadItem[]
  /** Un envoi est en cours ou prêt à partir. */
  readonly busy: boolean
  readonly rules: UploadRules | null
  /** Ajoute des fichiers (pré-contrôlés aussitôt) et rend les éléments créés. */
  add: (files: Iterable<Blob> | ArrayLike<Blob>, fields?: UploadFields) => UploadItem[]
  /** Modifie les champs d'un fichier pas encore envoyé (titre, texte alternatif…). */
  update: (id: string, fields: UploadFields) => void
  /** Lance les fichiers en attente (avec `autoStart: false`). */
  start: () => void
  cancel: (id: string) => void
  /** Relance un fichier en erreur ou annulé (nouveau pré-contrôle). */
  retry: (id: string) => void
  remove: (id: string) => void
  /** Retire les fichiers terminés, en erreur ou annulés. */
  clear: () => void
  /** Nouvelles règles (relues après un changement de jeton, par exemple) : pré-contrôle et envois restants. */
  setRules: (rules: UploadRules | null) => void
  subscribe: (listener: (items: readonly UploadItem[]) => void) => () => void
  /** Interrompt tout et oublie les abonnés. */
  destroy: () => void
}

/** Codes réessayés automatiquement : débit, serveur occupé, réseau. */
const RETRYABLE = new Set(['RATE_LIMITED', 'SERVER_BUSY', 'NETWORK_ERROR'])
const ACTIVE: ReadonlySet<UploadStatus> = new Set(['uploading', 'poster'])

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function fileName(file: Blob): string {
  return typeof File === 'function' && file instanceof File ? file.name : 'file'
}

let sequence = 0

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const concurrency = Math.max(1, options.concurrency ?? 2)
  const maxRetries = options.maxRetries ?? 3
  const captureFrame = options.captureFrame ?? captureVideoFrame
  let rules = options.rules ?? null
  let items: readonly UploadItem[] = []
  let destroyed = false
  let working = false
  const listeners = new Set<(items: readonly UploadItem[]) => void>()
  /** Fichiers autorisés à partir (ajoutés avec `autoStart`, lancés par `start()` ou relancés). */
  const startable = new Set<string>()
  const controllers = new Map<string, AbortController>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const autoRetries = new Map<string, number>()
  /** Fichiers partis depuis les dernières règles : ils comptent dans les envois restants. */
  const counted = new Set<string>()

  function notify() {
    for (const listener of listeners) listener(items)
  }

  function get(id: string): UploadItem | undefined {
    return items.find(item => item.id === id)
  }

  function patch(id: string, changes: Partial<UploadItem>) {
    if (!get(id)) return
    items = items.map(item => (item.id === id ? { ...item, ...changes } : item))
    notify()
  }

  /** Envois encore permis par les règles, fichiers déjà partis et en attente déduits ; Infinity sans limite. */
  function slotsLeft(except?: string): number {
    if (!rules || rules.remaining === null) return Number.POSITIVE_INFINITY
    const sent = items.filter(item => counted.has(item.id) && (ACTIVE.has(item.status) || item.status === 'done')).length
    const waiting = items.filter(item => item.status === 'queued' && item.id !== except).length
    return rules.remaining - sent - waiting
  }

  /** Pré-contrôle (genres, types, taille, envois restants) : l'erreur à afficher, ou null. */
  function precheck(file: Blob, name: string, id?: string): SurgeApiError | null {
    if (!rules) return null
    const refused = checkFile({ name, type: file.type, size: file.size }, rules, options.kinds)
    if (refused) return refused
    return slotsLeft(id) <= 0 ? new SurgeApiError({ status: 0, code: 'UPLOAD_LIMIT_REACHED' }) : null
  }

  function settle() {
    if (!working || items.some(item => ACTIVE.has(item.status) || (item.status === 'queued' && startable.has(item.id)))) return
    working = false
    options.onSettled?.(items)
  }

  function pump() {
    if (destroyed) return
    let running = items.filter(item => ACTIVE.has(item.status)).length
    for (const item of items) {
      if (running >= concurrency) break
      if (item.status !== 'queued' || item.retryAt !== null || !startable.has(item.id)) continue
      running++
      void run(item.id)
    }
    settle()
  }

  function scheduleRetry(id: string, error: SurgeApiError) {
    const count = (autoRetries.get(id) ?? 0) + 1
    autoRetries.set(id, count)
    const seconds = Math.min(60, Math.max(1, error.retryAfter ?? 2 ** count))
    const retryAt = Date.now() + seconds * 1000
    patch(id, { status: 'queued', progress: null, error, retryAt })
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      patch(id, { retryAt: null })
      pump()
    }, seconds * 1000))
  }

  function fail(id: string, error: SurgeApiError) {
    patch(id, { status: 'error', progress: null, error, retryAt: null })
    const item = get(id)
    if (item) options.onError?.(item)
  }

  async function run(id: string) {
    const item = get(id)
    if (!item) return
    const refused = rules && slotsLeft(id) <= 0 ? new SurgeApiError({ status: 0, code: 'UPLOAD_LIMIT_REACHED' }) : null
    if (refused) return fail(id, refused)

    working = true
    counted.add(id)
    const controller = new AbortController()
    controllers.set(id, controller)
    patch(id, { status: 'uploading', progress: 0, error: null, attempts: item.attempts + 1, retryAt: null })
    // Capture en parallèle de l'envoi : rien n'est envoyé pour la faire.
    const poster = options.capturePoster !== false && item.kind === 'video' ? captureFrame(item.file).catch(() => null) : null

    let media: Media
    try {
      media = await options.client.media.upload(item.file, item.fields, {
        filename: item.name,
        signal: controller.signal,
        onProgress: progress => patch(id, { progress: progress.fraction }),
      })
    }
    catch (error) {
      controllers.delete(id)
      counted.delete(id)
      if (isAbort(error)) patch(id, { status: 'canceled', progress: null })
      else {
        const failure = isSurgeApiError(error) ? error : new SurgeApiError({ status: 0, code: 'UNKNOWN', detail: String(error), cause: error })
        if (RETRYABLE.has(failure.code) && (autoRetries.get(id) ?? 0) < maxRetries && !destroyed) scheduleRetry(id, failure)
        else fail(id, failure)
      }
      pump()
      return
    }

    // Vidéo créée : son affiche capturée, si le serveur n'en a pas déjà une ; un échec la laisse sans affiche.
    if (poster && !media.poster && !controller.signal.aborted) {
      patch(id, { status: 'poster', progress: 1, media })
      const frame = await poster
      if (frame && !controller.signal.aborted) {
        try {
          media = await options.client.media.setPoster(media.id, frame.blob, { time: frame.time, signal: controller.signal })
        }
        catch {}
      }
    }
    controllers.delete(id)
    patch(id, { status: 'done', progress: 1, media, error: null })
    const done = get(id)
    if (done) options.onUploaded?.(media, done)
    pump()
  }

  function stop(id: string) {
    startable.delete(id)
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  }

  return {
    get items() {
      return items
    },
    get busy() {
      return items.some(item => ACTIVE.has(item.status) || (item.status === 'queued' && startable.has(item.id)))
    },
    get rules() {
      return rules
    },

    add(files, fields = {}) {
      if (destroyed) return []
      const created: UploadItem[] = []
      for (const file of Array.from(files)) {
        const id = `sm-upload-${++sequence}`
        const name = fileName(file)
        const error = precheck(file, name)
        const item: UploadItem = {
          id,
          file,
          name,
          size: file.size,
          kind: fileKind({ name, type: file.type, size: file.size }, rules),
          status: error ? 'error' : 'queued',
          progress: null,
          fields: { ...options.fields, ...fields },
          media: null,
          error,
          attempts: 0,
          retryAt: null,
        }
        // Ajouté un par un : les envois restants tiennent compte des fichiers précédents.
        items = [...items, item]
        created.push(item)
        if (!error && options.autoStart !== false) startable.add(id)
      }
      if (created.length > 0) notify()
      for (const item of created) if (item.error) options.onError?.(item)
      pump()
      return created
    },

    update(id, fields) {
      const item = get(id)
      if (!item || item.status === 'uploading' || item.status === 'poster' || item.status === 'done') return
      patch(id, { fields: { ...item.fields, ...fields } })
    },

    start() {
      for (const item of items) if (item.status === 'queued') startable.add(item.id)
      pump()
    },

    cancel(id) {
      const item = get(id)
      if (!item) return
      const controller = controllers.get(id)
      if (controller) {
        controller.abort()
        return
      }
      if (item.status === 'queued') {
        stop(id)
        patch(id, { status: 'canceled', progress: null, retryAt: null })
        pump()
      }
    },

    retry(id) {
      const item = get(id)
      if (!item || (item.status !== 'error' && item.status !== 'canceled')) return
      autoRetries.delete(id)
      const error = precheck(item.file, item.name, id)
      if (error) return fail(id, error)
      startable.add(id)
      patch(id, { status: 'queued', progress: null, error: null, retryAt: null })
      pump()
    },

    remove(id) {
      if (!get(id)) return
      controllers.get(id)?.abort()
      controllers.delete(id)
      stop(id)
      counted.delete(id)
      items = items.filter(item => item.id !== id)
      notify()
      pump()
    },

    clear() {
      const finished = items.filter(item => item.status === 'done' || item.status === 'error' || item.status === 'canceled')
      if (finished.length === 0) return
      for (const item of finished) {
        stop(item.id)
        counted.delete(item.id)
      }
      items = items.filter(item => !finished.includes(item))
      notify()
    },

    setRules(next) {
      rules = next
      // Les règles relues comptent déjà les envois terminés : seuls ceux en cours restent déduits.
      for (const id of [...counted]) if (!ACTIVE.has(get(id)?.status ?? 'done')) counted.delete(id)
      notify()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    destroy() {
      destroyed = true
      for (const controller of controllers.values()) controller.abort()
      for (const timer of timers.values()) clearTimeout(timer)
      controllers.clear()
      timers.clear()
      listeners.clear()
    },
  }
}
