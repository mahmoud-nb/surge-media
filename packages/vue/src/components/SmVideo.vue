<script setup lang="ts">
/**
 * Vidéo d'un média surgeMedia dans le lecteur natif du navigateur (commandes accessibles) : `<source>` dans
 * l'ordre de préférence du serveur (AV1, H.264, original), affiche dimensionnée, sous-titres `<track>`,
 * aucune lecture automatique (sauf mode `ambient`, muet, avec un bouton pause : WCAG 2.2.2). Suit le
 * traitement d'une vidéo en préparation ; sans source lisible, affiche l'état et un lien vers l'original ;
 * une vidéo retenue par le serveur (503 `PROCESSING_PENDING`) est réessayée après `Retry-After`. La
 * logique sans framework est dans le client (`videoPoster`, `heldVideoDelay`, styles en ligne…).
 */
import {
  heldVideoDelay,
  type Media,
  prefersReducedMotion,
  processingVisible,
  VIDEO_EMPTY_POSTER_STYLE,
  VIDEO_FRAME_STYLE,
  VIDEO_LAYER_STYLE,
  VIDEO_PLAYER_STYLE,
  VIDEO_RETRY_LIMIT,
  videoEmptyStyle,
  videoLabel,
  videoMessageKey,
  videoPoster,
  videoSize,
  whenNearViewport,
} from '@surge-media/client'
import { computed, type CSSProperties, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch as watchSource } from 'vue'
import { useLiveMedia } from '../composables/media'
import { useDisplaySettings, useSurgeMedia } from '../context'
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

const { t } = useSurgeMedia()
const display = useDisplaySettings()
const live = useLiveMedia(() => props.media, () => props.watch, media => emit('update', media))
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
const posterSrc = computed(() => videoPoster(live.value, props, display.value))
const size = computed(() => videoSize(live.value, props))
const label = computed(() => videoLabel(live.value, props.label))
const textTracks = computed(() => props.tracks ? live.value.textTracks : [])

const frame: CSSProperties = VIDEO_FRAME_STYLE
const playerStyle: CSSProperties = VIDEO_PLAYER_STYLE
const emptyStyle = computed<CSSProperties>(() => videoEmptyStyle(size.value.width, size.value.height))

// ─── Chargement différé ───
const preload = ref(props.lazy ? 'none' : props.preload)
let stopObserving: (() => void) | null = null

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
  const delay = await heldVideoDelay(rendered.value[0]?.url ?? live.value.url)
  if (delay !== null && retries < VIDEO_RETRY_LIMIT) {
    state.value = 'held'
    retries++
    retryTimer = setTimeout(() => {
      state.value = 'ready'
      void nextTick(() => video.value?.load())
    }, delay)
    return
  }
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
    stopObserving = whenNearViewport(element, () => {
      preload.value = props.preload
    })
  }
  if (props.ambient && element && !prefersReducedMotion()) {
    element.muted = true
    void element.play().catch(() => {})
  }
})

onBeforeUnmount(() => {
  stopObserving?.()
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
        :width="size.width"
        :height="size.height"
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
        :style="VIDEO_EMPTY_POSTER_STYLE"
      >
      <p class="sm-video__message" :style="VIDEO_LAYER_STYLE">
        {{ t(videoMessageKey(live, state === 'error')) }}
      </p>
      <SmProcessingStatus
        v-if="processingVisible(live.processing)"
        :processing="live.processing"
        :style="VIDEO_LAYER_STYLE"
      />
      <a class="sm-video__download" :href="live.url" download :style="VIDEO_LAYER_STYLE">{{ t('video.download') }}</a>
    </div>
  </div>
</template>
