import { DEFAULT_REFRESH_BEFORE_MS, isProcessing, type Media, refreshDelay, watchMedia } from '@surge-media/client'
import { onBeforeUnmount, onMounted, type Ref, ref, shallowRef, type ShallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useSurgeMedia } from '../context'

/**
 * Suivi d'un média affiché (objet reçu en propriété) : tant que le serveur prépare la vidéo, relit le média
 * (navigateur seulement, onglet visible, relecture légère par ETag) et rend la version à jour. Sans client
 * (objet `Media` fourni par le back-end sans identifiant), rend le média tel quel.
 */
export function useLiveMedia(source: () => Media, enabled: () => boolean, onUpdate?: (media: Media) => void): ShallowRef<Media> {
  const { client } = useSurgeMedia()
  const current = shallowRef(source())
  let controller: AbortController | null = null
  let mounted = false

  function stop() {
    controller?.abort()
    controller = null
  }

  function start() {
    stop()
    if (!mounted || !client || !enabled() || !isProcessing(current.value)) return
    const local = new AbortController()
    controller = local
    void watchMedia(client, current.value, {
      signal: local.signal,
      onUpdate(media) {
        current.value = media
        onUpdate?.(media)
      },
    })
  }

  watch(source, (media) => {
    current.value = media
    start()
  })
  watch(enabled, start)
  onMounted(() => {
    mounted = true
    start()
  })
  onBeforeUnmount(stop)
  return current
}

export interface UseMediaOptions {
  /** Relire un média privé avant l'échéance de ses URL signées (2 min avant par défaut ; 0 : jamais). */
  refreshBeforeMs?: number
  /** Suivre le traitement d'une vidéo jusqu'à ce qu'elle soit prête (vrai par défaut). */
  watchProcessing?: boolean
}

export interface UseMediaResult {
  media: ShallowRef<Media | null>
  error: ShallowRef<unknown>
  pending: Ref<boolean>
  refresh: () => Promise<void>
}

/**
 * Charge un média par son identifiant (navigateur seulement : en rendu serveur, lire le média côté serveur
 * et passer l'objet aux composants). Relit un média privé avant l'échéance de ses URL signées et suit le
 * traitement d'une vidéo. Exige un client (plugin configuré avec une clé publique ou des jetons délégués).
 */
export function useMedia(id: MaybeRefOrGetter<string | null | undefined>, options: UseMediaOptions = {}): UseMediaResult {
  const { client } = useSurgeMedia()
  const media = shallowRef<Media | null>(null)
  const error = shallowRef<unknown>(null)
  const pending = ref(false)
  const refreshBefore = options.refreshBeforeMs ?? DEFAULT_REFRESH_BEFORE_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let mounted = false

  function schedule(value: Media) {
    if (timer) clearTimeout(timer)
    timer = null
    const delay = refreshDelay(value, refreshBefore)
    if (delay !== null) timer = setTimeout(() => void refresh(), delay)
  }

  function track(value: Media) {
    controller?.abort()
    controller = null
    if (options.watchProcessing === false || !client || !isProcessing(value)) return
    const local = new AbortController()
    controller = local
    void watchMedia(client, value, {
      signal: local.signal,
      onUpdate(next) {
        media.value = next
        schedule(next)
      },
    })
  }

  async function refresh(): Promise<void> {
    const value = toValue(id)
    if (!mounted || !client || !value) {
      media.value = null
      return
    }
    pending.value = true
    try {
      const next = await client.media.get(value)
      if (toValue(id) !== value) return
      media.value = next
      error.value = null
      schedule(next)
      track(next)
    }
    catch (caught) {
      error.value = caught
    }
    finally {
      pending.value = false
    }
  }

  watch(() => toValue(id), () => void refresh())
  onMounted(() => {
    mounted = true
    void refresh()
  })
  onBeforeUnmount(() => {
    mounted = false
    if (timer) clearTimeout(timer)
    controller?.abort()
  })
  return { media, error, pending, refresh }
}
