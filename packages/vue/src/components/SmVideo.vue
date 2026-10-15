<script setup lang="ts">
/**
 * Vidéo d'un média surgeMedia dans le lecteur natif du navigateur (commandes accessibles) : `<source>` dans
 * l'ordre de préférence du serveur (AV1, H.264, original), affiche dimensionnée, sous-titres `<track>`,
 * aucune lecture automatique (sauf mode `ambient`, muet, avec un bouton pause : WCAG 2.2.2). Suit le
 * traitement d'une vidéo en préparation ; sans source lisible, affiche l'état et un lien vers l'original ;
 * une vidéo retenue par le serveur (503 `PROCESSING_PENDING`) est réessayée après `Retry-After`.
 */
import { imageFormat, type Media, parseRetryAfter, posterUrl } from '@surge-media/client'
import { computed, type CSSProperties, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch as watchSource } from 'vue'
import { useTransformMode } from '../composables/image'
import { useLiveMedia } from '../composables/media'
import { useSurgeMedia } from '../context'
import { IconPause, IconPlay } from '../icons'
import SmProcessingStatus from './SmProcessingStatus.vue'

const props = withDefaults(defineProps<{
  media: Media
  /** Commandes du lecteur natif. */
  controls?: boolean
  /** Préchargement : `metadata` (défaut), `none`, `auto`. */
  preload?: 'none' | 'metadata' | 'auto'
  /** Rien n'est chargé avant que la vidéo approche de l'écran. */
  lazy?: boolean
  /** Image d'affiche : celle du média (vrai), une URL, ou aucune (faux). */
  poster?: boolean | string
  /** Largeur de l'affiche demandée au serveur (par défaut : celle de la vidéo, 1280 px au plus). */
  posterWidth?: number
  /** Pistes de texte du média (sous-titres, chapitres…). */
  tracks?: boolean
  /** Nom accessible du lecteur (sinon le titre du média). */
  label?: string
  /** Vidéo d'ambiance : muette, en boucle, lancée seule (jamais si l'utilisateur limite les animations), avec un bouton pause. */
  ambient?: boolean
  /** Suivre le traitement d'une vidéo en préparation (avec un client). */
  watch?: boolean
  /** Taille d'affichage (sinon celle de la vidéo, réduite à la largeur disponible). */
  width?: number
  height?: number
}>(), {
  controls: true,
  preload: 'metadata',
  poster: true,
  posterWidth: undefined,
  tracks: true,
  label: undefined,
  watch: true,
  width: undefined,
  height: undefined,
})

const emit = defineEmits<{
  /** Média relu pendant le suivi du traitement (version, sources, état). */
  update: [media: Media]
  /** Aucune source n'a pu être lue. */
  error: []
}>()

const { settings, defaults, t } = useSurgeMedia()
const live = useLiveMedia(() => props.media, () => props.watch, media => emit('update', media))
const mode = useTransformMode(() => live.value)
const video = ref<HTMLVideoElement | null>(null)

// ─── Sources (renouvelées seulement si leurs URL changent, jamais en pleine lecture) ───
const sourcesKey = computed(() => live.value.sources.map(source => source.url).join('|'))
const rendered = shallowRef(live.value.sources)
let swapPending = false

function applySources() {
  swapPending = false
  const element = video.value
  const time = element?.currentTime ?? 0
  rendered.value = live.value.sources
  void nextTick(() => {
    const next = video.value
    if (!next) return
    next.load()
    if (time > 0) next.addEventListener('loadedmetadata', () => { next.currentTime = time }, { once: true })
  })
}

watchSource(sourcesKey, () => {
  if (video.value && !video.value.paused) swapPending = true
  else applySources()
})

// ─── Affiche, dimensions, nom, pistes ───
const posterSrc = computed(() => {
  if (props.poster === false) return undefined
  if (typeof props.poster === 'string') return props.poster
  const media = live.value
  if (!media.poster) return undefined
  if (mode.value === 'presets') return media.poster.url
  const width = props.posterWidth ?? Math.min(media.poster.width, 1280)
  return posterUrl(media, { width, format: imageFormat(settings.value.formats, defaults.imageFormat), maxDimension: settings.value.maxDimension }) ?? undefined
})
const width = computed(() => props.width ?? live.value.width ?? live.value.poster?.width ?? undefined)
const height = computed(() => props.height ?? live.value.height ?? live.value.poster?.height ?? undefined)
const label = computed(() => props.label ?? live.value.title ?? live.value.altText ?? undefined)
const textTracks = computed(() => props.tracks ? live.value.textTracks : [])

const frame = computed<CSSProperties>(() => ({ position: 'relative', display: 'inline-block', maxWidth: '100%', verticalAlign: 'top' }))
const playerStyle: CSSProperties = { display: 'block', maxWidth: '100%', height: 'auto' }
const emptyStyle = computed<CSSProperties>(() => ({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  overflow: 'hidden',
  width: width.value ? `${width.value}px` : '640px',
  maxWidth: '100%',
  aspectRatio: width.value && height.value ? `${width.value} / ${height.value}` : '16 / 9',
}))

// ─── Chargement différé ───
const preload = ref(props.lazy ? 'none' : props.preload)
let observer: IntersectionObserver | null = null

// ─── Mode ambiant ───
const paused = ref(true)
function toggle() {
  const element = video.value
  if (!element) return
  if (element.paused) void element.play().catch(() => {})
  else element.pause()
}

// ─── Erreurs : retenue par le serveur (503) ou source illisible ───
type State = 'ready' | 'held' | 'error'
const state = ref<State>('ready')
let retries = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

async function onSourceError(index: number) {
  if (index !== rendered.value.length - 1) return
  const url = rendered.value[0]?.url ?? live.value.url
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (response.status === 503 && retries < 10) {
      state.value = 'held'
      retries++
      const delay = (parseRetryAfter(response.headers.get('retry-after')) ?? 30) * 1000
      retryTimer = setTimeout(() => {
        state.value = 'ready'
        void nextTick(() => video.value?.load())
      }, Math.min(Math.max(delay, 5000), 300_000))
      return
    }
  }
  catch {}
  state.value = 'error'
  emit('error')
}

watchSource(() => `${live.value.id}:${live.value.version}`, () => {
  retries = 0
  state.value = 'ready'
})

onMounted(() => {
  const element = video.value
  if (props.lazy && element) {
    if (typeof IntersectionObserver === 'undefined') preload.value = props.preload
    else {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some(entry => entry.isIntersecting)) return
        preload.value = props.preload
        observer?.disconnect()
        observer = null
      }, { rootMargin: '200px' })
      observer.observe(element)
    }
  }
  if (props.ambient && element && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    element.muted = true
    void element.play().catch(() => {})
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (retryTimer) clearTimeout(retryTimer)
})

function onPause() {
  paused.value = true
  if (swapPending) applySources()
}
</script>

<template>
  <div class="sm-video" :class="{ 'sm-video--ambient': props.ambient }" :style="frame">
    <template v-if="rendered.length > 0 && state !== 'error'">
      <video
        ref="video"
        class="sm-video__player"
        :controls="props.controls && !props.ambient"
        :preload="preload"
        playsinline
        :muted="props.ambient"
        :loop="props.ambient"
        :poster="posterSrc"
        :width="width"
        :height="height"
        :aria-label="label || undefined"
        :crossorigin="textTracks.length > 0 ? 'anonymous' : undefined"
        :style="playerStyle"
        @play="paused = false"
        @pause="onPause"
        @ended="onPause"
      >
        <source
          v-for="(source, index) in rendered"
          :key="source.url"
          :src="source.url"
          :type="source.type"
          @error="onSourceError(index)"
        >
        <track
          v-for="track in textTracks"
          :key="track.id"
          :kind="track.kind"
          :srclang="track.language"
          :label="track.label"
          :src="track.url"
          :default="track.default"
        >
        {{ t('video.unsupported') }}
      </video>
      <button
        v-if="props.ambient"
        type="button"
        class="sm-video__toggle"
        :aria-label="paused ? t('video.play') : t('video.pause')"
        @click="toggle"
      >
        <component :is="paused ? IconPlay : IconPause" :size="18" />
      </button>
      <p v-if="state === 'held'" class="sm-video__message" role="status">
        {{ t('video.held') }}
      </p>
    </template>
    <div v-else class="sm-video__empty" :style="emptyStyle">
      <img
        v-if="posterSrc"
        class="sm-video__poster"
        :src="posterSrc"
        alt=""
        :style="{ position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', opacity: '0.35' }"
      >
      <p class="sm-video__message" :style="{ position: 'relative' }">
        {{ state === 'error' || !live.processing || live.processing.status === 'failed' ? t('video.unavailable') : t('video.noSource') }}
      </p>
      <SmProcessingStatus
        v-if="live.processing && live.processing.status !== 'ready'"
        :processing="live.processing"
        :style="{ position: 'relative' }"
      />
      <a class="sm-video__download" :href="live.url" download :style="{ position: 'relative' }">{{ t('video.download') }}</a>
    </div>
  </div>
</template>
