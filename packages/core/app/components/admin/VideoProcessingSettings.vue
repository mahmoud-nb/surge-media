<script setup lang="ts">
/**
 * Traitement des vidéos (phase D3, § 37) pour la page « Réglages » : état en lecture seule — mode,
 * traitement actif ou non, ffmpeg détecté, réglages d'encodage, processus de travail, tâches par statut —
 * et « Traiter les vidéos existantes » (confirmation avec le nombre de vidéos et une estimation du temps).
 * Tout se règle par les variables d'environnement du serveur (NUXT_VIDEO_*) : rien n'est modifiable ici,
 * et aucune valeur sensible n'est affichée (l'API ne renvoie ni chemins des binaires ni limite mémoire).
 * Pas de rafraîchissement automatique (aucun contenu qui bouge seul, WCAG 2.2.2) : bouton « Actualiser ».
 */
import { Clapperboard, ListChecks, RefreshCw, Server } from '@lucide/vue'

const props = withDefaults(defineProps<{
  /** Niveau des titres de section (la page fournit le h1 et le h2 de la section). */
  headingLevel?: 2 | 3
}>(), { headingLevel: 2 })

const { t, te, locale } = useI18n()
const { $api } = useNuxtApp()
const heading = computed(() => `h${props.headingLevel}`)
const ids = {
  status: useId(),
  ffmpeg: useId(),
  encoding: useId(),
  workers: useId(),
  jobs: useId(),
  backfill: useId(),
  backfillReason: useId(),
}

/**
 * Moment de la dernière lecture : base des durées relatives (« il y a 2 minutes »). Gardé dans l'état
 * transmis au navigateur, pour que le rendu serveur et l'hydratation calculent le même texte.
 */
const loadedAt = useState('video-processing-loaded-at', () => Date.now())
const { data, error, refresh } = await useApiFetch('/api/admin/video-processing', {
  onResponse() {
    loadedAt.value = Date.now()
  },
})
/** Réponse de GET /api/admin/video-processing (typée une fois : le typage des routes Nitro sature sinon). */
type ProcessingState = NonNullable<typeof data.value>
type Worker = ProcessingState['workers'][number]

const numberFormat = computed(() => new Intl.NumberFormat(locale.value))

// ─── État ────────────────────────────────────────────────────────────────────

/**
 * État résumé : `noFfmpeg` = mode embedded avec un ffmpeg inutilisable dès le démarrage ; `halted` = boucle
 * arrêtée en route (ffmpeg devenu inutilisable, nouvelle détection chaque minute) ; `noWorker` = mode
 * external sans processus de travail en état de traiter vu dans les 5 dernières minutes.
 */
type Status = 'active' | 'off' | 'halted' | 'noFfmpeg' | 'noWorker'
const STATUS_BADGES: Record<Status, 'success' | 'neutral' | 'warning'> = {
  active: 'success',
  off: 'neutral',
  halted: 'warning',
  noFfmpeg: 'warning',
  noWorker: 'warning',
}
const status = computed<Status | null>(() => {
  const state = data.value
  if (!state) return null
  if (state.mode === 'off') return 'off'
  if (state.active) return 'active'
  if (state.halted) return 'halted'
  return state.mode === 'external' ? 'noWorker' : 'noFfmpeg'
})

const modes = computed(() => VIDEO_PROCESSING_MODES.map(value => ({
  value,
  current: value === data.value?.mode,
  text: t('settings.videoProcessing.modes.line', {
    label: t(`settings.videoProcessing.modes.${value}.label`),
    value,
    description: t(`settings.videoProcessing.modes.${value}.description`),
  }),
})))

/** Problème signalé par la détection de ffmpeg : texte traduit, ou le code s'il est inconnu de l'interface. */
function problemText(code: string): string {
  const key = `settings.videoProcessing.ffmpeg.problems.${code}`
  return te(key) ? t(`settings.videoProcessing.ffmpeg.problems.${code}`) : code
}

// ─── Processus de travail ────────────────────────────────────────────────────

function workerState(worker: Worker): 'active' | 'halted' | 'absent' {
  if (worker.halted) return 'halted'
  return worker.active ? 'active' : 'absent'
}
const WORKER_BADGES = { active: 'success', halted: 'warning', absent: 'neutral' } as const

/** Durée écoulée depuis une date, par rapport à la dernière lecture (« il y a 2 minutes »). */
function relativeTime(date: string | Date): string {
  const seconds = (new Date(date).getTime() - loadedAt.value) / 1000
  const format = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
  const absolute = Math.abs(seconds)
  if (absolute < 60) return format.format(Math.round(seconds), 'second')
  if (absolute < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (absolute < 86_400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86_400), 'day')
}

// ─── Tâches ──────────────────────────────────────────────────────────────────

const JOB_COUNTS = ['queued', 'running', 'done', 'failed', 'cancelled'] as const

// ─── Traiter les vidéos existantes ───────────────────────────────────────────

/**
 * Estimation grossière du temps de traitement des vidéos existantes (s), d'après les mesures du § 29.2
 * de l'architecture (H.264 1080p `veryfast` : 1,7 s de processeur par seconde de vidéo, ≈ 0,5 × la durée
 * sur 4 cœurs) :
 *
 *   temps ≈ nombre × 1 s (analyse, affiche, nettoyage)
 *         + durée totale × coût ÷ (fils par ffmpeg × tâches en parallèle)
 *
 *   coût = 2 × facteur du préréglage x264 (+ 3 si l'AV1 est activé et possible), en secondes de calcul
 *          d'un fil par seconde de vidéo : 1,7 mesuré, arrondi à 2 (parallélisme imparfait) ; AV1 =
 *          1,5 × le H.264 (temps processeur mesuré) ; préréglage `medium` ≈ 1,9 × `veryfast` (temps
 *          processeur mesuré), ordres de grandeur pour les autres. 0 en mode `never` (seuls les formats
 *          convertis y sont réencodés, et une vidéo jamais traitée n'en est pas un : envoyée quand le
 *          traitement était inactif) ;
 *   tâches en parallèle = `concurrency` de ce serveur (embedded) ou somme des `concurrency` des
 *          processus de travail actifs (external, 1 au moins).
 *
 * Majorant en mode `auto` (les vidéos déjà compatibles ne sont pas réencodées) ; suppose assez de cœurs
 * pour tous les fils. Durées inconnues comptées pour 0.
 */
const PRESET_COST: Readonly<Record<string, number>> = {
  ultrafast: 0.4,
  superfast: 0.6,
  veryfast: 1,
  faster: 1.2,
  fast: 1.4,
  medium: 1.9,
  slow: 2.5,
  slower: 5,
  veryslow: 10,
}
const H264_COST = 2
const AV1_COST = 3
const OVERHEAD_PER_VIDEO = 1

function estimateSeconds(state: ProcessingState): number {
  const { settings, backfill } = state
  const parallel = state.mode === 'external'
    ? Math.max(1, state.workers.filter(worker => worker.active).reduce((sum, worker) => sum + Math.max(1, worker.concurrency), 0))
    : Math.max(1, settings.concurrency)
  const av1 = settings.av1 && (state.ffmpeg?.av1 ?? true)
  const cost = settings.rendition === 'never' ? 0 : H264_COST * (PRESET_COST[settings.preset] ?? 1) + (av1 ? AV1_COST : 0)
  return backfill.count * OVERHEAD_PER_VIDEO + (backfill.totalDuration * cost) / (Math.max(1, settings.threads) * parallel)
}

/**
 * Durée arrondie pour une estimation (« environ 1 heure et 40 minutes », jamais à la seconde près) ; null
 * sous la minute (phrase à part : « jusqu'à environ moins d'une minute » ne se dit pas).
 */
function roughDuration(seconds: number): string | null {
  if (seconds < 60) return null
  const step = seconds < 3600 ? 60 : seconds < 86_400 ? 600 : 3600
  return formatDuration(Math.max(step, Math.round(seconds / step) * step), locale.value)
}

const backfill = computed(() => {
  const state = data.value
  if (!state) return null
  const { count, totalDuration } = state.backfill
  return {
    count,
    totalDuration: totalDuration > 0 ? formatDuration(totalDuration < 60 ? totalDuration : Math.round(totalDuration / 60) * 60, locale.value) : null,
    /** Estimation (vidéos à traiter seulement) ; `duration` null : moins d'une minute. */
    estimate: count > 0 ? { duration: roughDuration(estimateSeconds(state)) } : null,
    /** Raison pour laquelle le bouton est désactivé, ou null. */
    disabledReason: !state.active
      ? t('settings.videoProcessing.backfill.disabledInactive')
      : count === 0 ? t('settings.videoProcessing.backfill.disabledEmpty') : null,
  }
})

const confirmOpen = ref(false)
const confirmReturnFocus = ref(true)
const backfilling = ref(false)
const backfillError = ref<string>()
const backfillStatus = ref<string>()

function askBackfill() {
  backfillError.value = undefined
  confirmReturnFocus.value = true
  confirmOpen.value = true
}

async function runBackfill() {
  // Pas de `disabled` pendant la requête : le focus resterait perdu sur un bouton désactivé.
  if (backfilling.value) return
  backfillError.value = undefined
  backfilling.value = true
  try {
    const { count } = await $api('/api/admin/video-processing/backfill', { method: 'POST' })
    backfillStatus.value = t('settings.videoProcessing.backfill.done', { count }, count)
    // Le bouton d'ouverture peut être désactivé une fois la file remplie : focus sur le titre de la
    // section, suivi du message de résultat (role="status").
    confirmReturnFocus.value = false
    confirmOpen.value = false
    await refresh()
    await nextTick()
    document.getElementById(ids.backfill)?.focus()
  }
  catch (err) {
    const { code } = apiError(err)
    if (code === 'PROCESSING_DISABLED') {
      backfillError.value = t('settings.videoProcessing.backfill.errors.PROCESSING_DISABLED')
      await refresh()
    }
    else {
      backfillError.value = t('common.unexpectedError')
    }
  }
  finally {
    backfilling.value = false
  }
}

// ─── Actualisation ───────────────────────────────────────────────────────────

const refreshing = ref(false)
/** Annonce discrète de la fin d'une actualisation demandée (l'heure la rend unique à chaque fois). */
const refreshAnnouncement = ref('')

async function reload() {
  if (refreshing.value) return
  refreshing.value = true
  refreshAnnouncement.value = ''
  try {
    await refresh()
    if (!error.value) {
      const time = new Intl.DateTimeFormat(locale.value, { timeStyle: 'medium' }).format(loadedAt.value)
      refreshAnnouncement.value = t('settings.videoProcessing.refreshed', { time })
    }
  }
  finally {
    refreshing.value = false
  }
}
</script>

<template>
  <UiAlert v-if="error" variant="error" live="assertive" :title="t('settings.videoProcessing.loadError')">
    <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
      {{ t('common.retry') }}
    </UiButton>
  </UiAlert>

  <div v-else-if="data && status" class="grid gap-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted-foreground">
        <i18n-t keypath="settings.videoProcessing.loadedAt" scope="global" tag="span">
          <template #time>
            <NuxtTime :datetime="loadedAt" :locale="locale" time-style="short" />
          </template>
        </i18n-t>
      </p>
      <UiButton variant="outline" size="sm" :aria-disabled="refreshing || undefined" @click="reload">
        <RefreshCw aria-hidden="true" />
        {{ t('settings.videoProcessing.refresh') }}
      </UiButton>
      <p class="sr-only" role="status">
        {{ refreshAnnouncement }}
      </p>
    </div>

    <!-- État et mode -->
    <section :aria-labelledby="ids.status" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
      <component :is="heading" :id="ids.status" class="text-lg font-semibold text-foreground">
        {{ t('settings.videoProcessing.status.title') }}
      </component>
      <dl class="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div class="grid gap-1">
          <dt class="text-muted-foreground">
            {{ t('settings.videoProcessing.status.label') }}
          </dt>
          <dd class="grid gap-1 text-foreground">
            <span><UiBadge :variant="STATUS_BADGES[status]">{{ t(`settings.videoProcessing.status.badges.${status}`) }}</UiBadge></span>
            <span>{{ t(`settings.videoProcessing.status.text.${status}`) }}</span>
          </dd>
        </div>
        <div class="grid gap-1">
          <dt class="text-muted-foreground">
            {{ t('settings.videoProcessing.status.mode') }}
          </dt>
          <dd class="font-medium text-foreground">
            {{ t(`settings.videoProcessing.modes.${data.mode}.label`) }} (<code class="font-mono text-xs">{{ data.mode }}</code>)
          </dd>
        </div>
      </dl>

      <div class="mt-5 grid gap-2 text-sm">
        <p class="font-medium text-foreground">
          {{ t('settings.videoProcessing.status.modesLabel') }}
        </p>
        <ul class="grid gap-1.5">
          <li v-for="mode in modes" :key="mode.value" :class="cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', mode.current ? 'text-foreground' : 'text-muted-foreground')">
            <span>{{ mode.text }}</span>
            <UiBadge v-if="mode.current" variant="primary">
              {{ t('settings.videoProcessing.status.current') }}
            </UiBadge>
          </li>
        </ul>
      </div>

      <UiAlert v-if="data.mode === 'off'" variant="info" :title="t('settings.videoProcessing.enable.title')" class="mt-5">
        <!-- « NUXT_VIDEO_PROCESSING=embedded » d'un seul tenant : coupé au besoin (écran de 375 px). -->
        <p class="wrap-anywhere">
          {{ t('settings.videoProcessing.enable.text') }}
        </p>
      </UiAlert>
    </section>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- ffmpeg -->
      <section :aria-labelledby="ids.ffmpeg" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <component :is="heading" :id="ids.ffmpeg" class="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Clapperboard class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {{ t('settings.videoProcessing.ffmpeg.title') }}
        </component>
        <p v-if="!data.ffmpeg" class="mt-2 text-sm text-muted-foreground">
          {{ data.mode === 'off' ? t('settings.videoProcessing.ffmpeg.notShownOff') : t('settings.videoProcessing.ffmpeg.notShownExternal') }}
        </p>
        <template v-else>
          <dl class="mt-4 grid gap-y-3 text-sm">
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('settings.videoProcessing.ffmpeg.version') }}
              </dt>
              <dd class="font-medium break-all text-foreground">
                {{ data.ffmpeg.version ?? t('settings.videoProcessing.ffmpeg.unknownVersion') }}
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('settings.videoProcessing.ffmpeg.state') }}
              </dt>
              <dd>
                <UiBadge :variant="data.ffmpeg.ok ? 'success' : 'warning'">
                  {{ data.ffmpeg.ok ? t('settings.videoProcessing.ffmpeg.usable') : t('settings.videoProcessing.ffmpeg.unusable') }}
                </UiBadge>
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('settings.videoProcessing.ffmpeg.encoders') }}
              </dt>
              <dd class="font-medium text-foreground">
                <code v-if="data.ffmpeg.encoders.length > 0" class="font-mono text-xs break-all">{{ data.ffmpeg.encoders.join(', ') }}</code>
                <span v-else>{{ t('settings.videoProcessing.ffmpeg.noEncoders') }}</span>
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('settings.videoProcessing.ffmpeg.hdr') }}
              </dt>
              <dd class="text-foreground">
                {{ data.ffmpeg.hdrFilters ? t('settings.videoProcessing.ffmpeg.hdrAvailable') : t('settings.videoProcessing.ffmpeg.hdrMissing') }}
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('settings.videoProcessing.ffmpeg.av1') }}
              </dt>
              <dd class="text-foreground">
                {{ data.ffmpeg.av1 ? t('settings.videoProcessing.ffmpeg.av1Available') : t('settings.videoProcessing.ffmpeg.av1Missing') }}
              </dd>
            </div>
          </dl>
          <UiAlert v-if="data.ffmpeg.problems.length > 0" variant="warning" :title="t('settings.videoProcessing.ffmpeg.problemsTitle')" class="mt-4">
            <ul class="grid list-disc gap-1 pl-4">
              <li v-for="problem in data.ffmpeg.problems" :key="problem">
                {{ problemText(problem) }}
              </li>
            </ul>
          </UiAlert>
        </template>
      </section>

      <!-- Réglages d'encodage -->
      <section :aria-labelledby="ids.encoding" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <component :is="heading" :id="ids.encoding" class="text-lg font-semibold text-foreground">
          {{ t('settings.videoProcessing.encoding.title') }}
        </component>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.videoProcessing.encoding.description') }}
        </p>
        <p v-if="data.mode === 'external'" class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.videoProcessing.encoding.externalNote') }}
        </p>
        <dl class="mt-4 grid gap-y-3 text-sm">
          <div class="grid gap-0.5">
            <dt class="text-muted-foreground">
              {{ t('settings.videoProcessing.encoding.rendition') }}
            </dt>
            <dd class="text-foreground">
              {{ t(`settings.videoProcessing.encoding.renditionModes.${data.settings.rendition}`) }}
            </dd>
          </div>
          <div class="grid gap-0.5">
            <dt class="text-muted-foreground">
              {{ t('settings.videoProcessing.encoding.preset') }}
            </dt>
            <dd class="font-medium text-foreground">
              <code class="font-mono text-xs">{{ data.settings.preset }}</code>
            </dd>
          </div>
          <div class="grid gap-0.5">
            <dt class="text-muted-foreground">
              {{ t('settings.videoProcessing.encoding.crf') }}
            </dt>
            <dd class="text-foreground">
              {{ t('settings.videoProcessing.encoding.crfValue', { crf: data.settings.crf }) }}
            </dd>
          </div>
          <div class="grid gap-0.5">
            <dt class="text-muted-foreground">
              {{ t('settings.videoProcessing.encoding.av1') }}
            </dt>
            <dd class="text-foreground">
              {{ !data.settings.av1
                ? t('settings.videoProcessing.encoding.off')
                : data.ffmpeg && !data.ffmpeg.av1 ? t('settings.videoProcessing.encoding.av1Unavailable') : t('settings.videoProcessing.encoding.on') }}
            </dd>
          </div>
          <div class="grid gap-0.5">
            <dt class="text-muted-foreground">
              {{ t('settings.videoProcessing.encoding.concurrency') }}
            </dt>
            <dd class="font-medium text-foreground">
              {{ numberFormat.format(data.settings.concurrency) }}
            </dd>
          </div>
          <div class="grid gap-0.5">
            <dt class="text-muted-foreground">
              {{ t('settings.videoProcessing.encoding.threads') }}
            </dt>
            <dd class="font-medium text-foreground">
              {{ numberFormat.format(data.settings.threads) }}
            </dd>
          </div>
          <div class="grid gap-0.5">
            <dt class="text-muted-foreground">
              {{ t('settings.videoProcessing.encoding.maxDuration') }}
            </dt>
            <dd class="font-medium text-foreground">
              {{ formatDuration(data.settings.maxDuration, locale) }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- Processus de travail -->
      <section :aria-labelledby="ids.workers" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <component :is="heading" :id="ids.workers" class="text-lg font-semibold text-foreground">
          {{ t('settings.videoProcessing.workers.title') }}
        </component>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.videoProcessing.workers.description') }}
        </p>
        <ul v-if="data.workers.length > 0" class="mt-4 divide-y divide-border rounded-lg border border-border" :aria-labelledby="ids.workers">
          <li v-for="worker in data.workers" :key="worker.id" class="grid gap-1 px-4 py-3 text-sm">
            <p class="flex flex-wrap items-center gap-2">
              <Server class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="font-medium break-all text-foreground">{{ worker.host || t('settings.videoProcessing.workers.unknownHost') }}</span>
              <UiBadge :variant="WORKER_BADGES[workerState(worker)]" class="whitespace-normal">
                {{ t(`settings.videoProcessing.workers.states.${workerState(worker)}`) }}
              </UiBadge>
            </p>
            <p class="text-muted-foreground">
              <i18n-t keypath="settings.videoProcessing.workers.seen" scope="global" tag="span">
                <template #relative>
                  {{ relativeTime(worker.seenAt) }}
                </template>
                <template #date>
                  <NuxtTime :datetime="worker.seenAt" :locale="locale" date-style="medium" time-style="short" />
                </template>
              </i18n-t>
            </p>
            <p class="text-muted-foreground">
              {{ worker.version ? t('settings.videoProcessing.workers.ffmpegVersion', { version: worker.version }) : t('settings.videoProcessing.workers.unknownVersion') }}
              ·
              {{ t('settings.videoProcessing.workers.concurrency', { count: worker.concurrency }, worker.concurrency) }}
            </p>
            <p class="text-xs break-all text-muted-foreground">
              {{ t('settings.videoProcessing.workers.identifier', { id: worker.id }) }}
            </p>
          </li>
        </ul>
        <p v-else class="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Server class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {{ t(`settings.videoProcessing.workers.empty.${data.mode}`) }}
        </p>
      </section>

      <!-- Tâches par statut -->
      <section :aria-labelledby="ids.jobs" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <component :is="heading" :id="ids.jobs" class="flex items-center gap-2 text-lg font-semibold text-foreground">
          <ListChecks class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {{ t('settings.videoProcessing.jobs.title') }}
        </component>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.videoProcessing.jobs.description') }}
        </p>
        <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div v-for="key in JOB_COUNTS" :key="key" class="grid gap-0.5">
            <dt class="text-muted-foreground">
              {{ t(`settings.videoProcessing.jobs.${key}`) }}
            </dt>
            <dd class="text-lg font-semibold text-foreground tabular-nums">
              {{ numberFormat.format(data.jobs[key]) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <!-- Traiter les vidéos existantes -->
    <section v-if="backfill" :aria-labelledby="ids.backfill" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
      <component :is="heading" :id="ids.backfill" tabindex="-1" class="text-lg font-semibold text-foreground">
        {{ t('settings.videoProcessing.backfill.title') }}
      </component>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">
        {{ t('settings.videoProcessing.backfill.description') }}
      </p>
      <div class="mt-4 grid gap-1 text-sm text-foreground">
        <p class="font-medium">
          {{ t('settings.videoProcessing.backfill.count', { count: backfill.count }, backfill.count) }}
        </p>
        <p v-if="backfill.count > 0 && backfill.totalDuration">
          {{ t('settings.videoProcessing.backfill.totalDuration', { duration: backfill.totalDuration }) }}
        </p>
        <template v-if="backfill.estimate">
          <p>
            {{ backfill.estimate.duration
              ? t('settings.videoProcessing.backfill.estimate', { duration: backfill.estimate.duration })
              : t('settings.videoProcessing.backfill.estimateShort') }}
          </p>
          <p class="text-muted-foreground">
            {{ t('settings.videoProcessing.backfill.estimateNote') }}
          </p>
        </template>
      </div>

      <UiAlert v-if="backfillStatus" variant="success" live="polite" class="mt-4">
        {{ backfillStatus }}
      </UiAlert>

      <div class="mt-4 grid justify-items-start gap-2">
        <UiButton
          :disabled="Boolean(backfill.disabledReason)"
          :aria-describedby="backfill.disabledReason ? ids.backfillReason : undefined"
          @click="askBackfill"
        >
          <ListChecks aria-hidden="true" />
          {{ t('settings.videoProcessing.backfill.button') }}
        </UiButton>
        <p v-if="backfill.disabledReason" :id="ids.backfillReason" class="text-sm text-muted-foreground">
          {{ backfill.disabledReason }}
        </p>
      </div>
    </section>

    <UiDialog
      v-if="backfill"
      v-model:open="confirmOpen"
      :title="t('settings.videoProcessing.backfill.dialog.title')"
      :description="t('settings.videoProcessing.backfill.dialog.description', { count: backfill.count }, backfill.count)"
      :return-focus="confirmReturnFocus"
    >
      <div class="grid gap-3 text-sm">
        <p v-if="backfill.estimate" class="text-foreground">
          {{ backfill.estimate.duration
            ? t('settings.videoProcessing.backfill.dialog.estimate', { duration: backfill.estimate.duration })
            : t('settings.videoProcessing.backfill.dialog.estimateShort') }}
        </p>
        <UiAlert v-if="backfillError" variant="error" live="assertive">
          {{ backfillError }}
        </UiAlert>
      </div>
      <template #actions>
        <UiButton variant="outline" autofocus @click="confirmOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton :aria-disabled="backfilling || undefined" @click="runBackfill">
          {{ backfilling ? t('settings.videoProcessing.backfill.dialog.submitting') : t('settings.videoProcessing.backfill.dialog.submit') }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
