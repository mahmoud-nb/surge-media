<script setup lang="ts">
/**
 * Traitement d'une vidéo par ffmpeg (phase D3, architecture § 32 et § 37) : état du média, étape en
 * cours et son avancement (barre native + pourcentage écrit), essais, dates, erreur traduite, remarques,
 * rendus produits (téléchargement) et « Traiter » / « Relancer ». L'avancement est relu par la page
 * (useProcessingPoll) ; ce panneau n'annonce que les changements d'état (début, fin, échec, nouvel
 * essai) dans une région `role="status"` masquée, jamais chaque progression. Après « Relancer », le
 * focus va au message de résultat (le bouton disparaît : la tâche est en file).
 */
import { Download, RefreshCw } from '@lucide/vue'
import type { ProcessingJobView, ProcessingSnapshot } from '~/composables/useProcessingPoll'
import { processingInProgress } from '~/composables/useProcessingPoll'
import { codecLabel } from '#shared/utils/video'
import { JOB_MAX_ATTEMPTS, type ProcessingStateValue } from '#shared/utils/video-processing'

interface Rendition {
  name: string
  container: string
  codecs: string
  width: number
  height: number
  duration: number
  bitrate: number
  size: number
  url: string
}

const props = defineProps<{
  mediaId: string
  /** État du média (et non le statut de la tâche) ; null = jamais traitée. */
  state: ProcessingStateValue | null
  processing: ProcessingJobView | null
  renditions: readonly Rendition[]
  canWrite: boolean
  inTrash: boolean
  /** Traitement actif sur le serveur (mode `embedded`, ou `external` avec un processus de travail vu). */
  active: boolean
}>()

const emit = defineEmits<{
  /** Tâche demandée : nouvel état à reporter dans la fiche (sans la recharger). */
  updated: [snapshot: ProcessingSnapshot]
  /** Fiche périmée (fichier remplacé, média mis à la corbeille entre-temps) : à recharger. */
  stale: []
}>()

const { t, locale } = useI18n()
const { $api } = useNuxtApp()
const titleId = useId()
const stepId = useId()

const STATE_BADGES: Record<ProcessingStateValue, 'neutral' | 'primary' | 'success' | 'danger'> = {
  PENDING: 'neutral',
  PROCESSING: 'primary',
  READY: 'success',
  FAILED: 'danger',
}

const inProgress = computed(() => processingInProgress(props.state))
const job = computed(() => props.processing)

/** Tâche annulée par la mise à la corbeille : elle reprendra à la restauration. */
const interrupted = computed(() => props.inTrash && inProgress.value)

/** Étape en cours (tâche lancée), avancement de cette étape (null : inconnu, pas de barre). */
const running = computed(() => !props.inTrash && props.state === 'PROCESSING' && job.value?.status === 'RUNNING')
const stepLabel = computed(() => (job.value?.step ? t(`media.processing.steps.${job.value.step}`) : null))
const progress = computed(() => {
  const value = job.value?.progress
  return running.value && typeof value === 'number' ? Math.min(1, Math.max(0, value)) : null
})

/** Essai en cours (« 2 sur 3 ») après un échec passager, ou essai qui a échoué en dernier. */
const attempt = computed(() => {
  const value = job.value
  if (!value || value.attempts === 0) return null
  if (inProgress.value) return Math.min(value.attempts + 1, JOB_MAX_ATTEMPTS)
  return props.state === 'FAILED' ? Math.min(value.attempts, JOB_MAX_ATTEMPTS) : null
})

/** Tâche remise en file après un échec passager : prochain essai au plus tôt (date à venir). */
const nextAttempt = computed(() => {
  const value = job.value
  if (props.inTrash || !value || value.status !== 'QUEUED' || value.attempts === 0) return null
  return new Date(value.runAfter).getTime() > Date.now() ? value.runAfter : null
})

function errorText(code: ProcessingJobView['errorCode']): string {
  return code ? t(`media.processing.errors.${code}`) : t('media.processing.errors.unknown')
}

/** Échec passager d'un essai précédent, pendant que la tâche attend ou refait un essai. */
const previousError = computed(() => {
  const value = job.value
  if (!inProgress.value || props.inTrash || !value || value.attempts === 0 || !value.errorCode) return null
  return t('media.processing.previousError', { message: errorText(value.errorCode) })
})

const failure = computed(() => (props.state === 'FAILED'
  ? { message: errorText(job.value?.errorCode ?? null), detail: job.value?.errorDetail ?? null }
  : null))

const warnings = computed(() => (job.value?.warnings ?? []).map(code => ({ code, text: t(`media.processing.warnings.${code}`) })))

// ─── Rendus ──────────────────────────────────────────────────────────────────

const CONTAINER_LABELS: Record<string, string> = { mp4: 'MP4', webm: 'WebM' }

/** « MP4 · H.264 / AAC » : conteneur et codecs (noms propres, identiques dans toutes les langues). */
function formatLabel(rendition: Rendition): string {
  const codecs = rendition.codecs.split(',').map(codec => codecLabel(codec.trim().split('.')[0] ?? '')).filter(Boolean)
  const container = CONTAINER_LABELS[rendition.container] ?? rendition.container.toUpperCase()
  return codecs.length > 0 ? `${container} · ${codecs.join(' / ')}` : container
}

const renditionItems = computed(() => props.renditions.map(rendition => ({ ...rendition, format: formatLabel(rendition) })))

// ─── Traiter, relancer ───────────────────────────────────────────────────────

/** Première fois (vidéo envoyée avant D3), après un échec, ou pour refaire les rendus. */
const canRun = computed(() => props.canWrite && !props.inTrash && props.active
  && (props.state === null || props.state === 'FAILED' || props.state === 'READY'))

/** Traitement inactif : rien ne peut être relancé, une tâche en file attendra. */
const inactiveNote = computed(() => {
  if (props.active || props.inTrash) return null
  if (inProgress.value) return t('media.processing.inactive.pending')
  return props.canWrite && (props.state === 'FAILED' || props.state === 'READY') ? t('media.processing.inactive.rerun') : null
})

const busy = ref(false)
const status = ref<{ variant: 'success' | 'error', message: string } | null>(null)
const statusEl = useTemplateRef<HTMLElement>('statusEl')

/** Message d'un refus du serveur ; `stale` : la fiche ne reflète plus le média (à recharger). */
function requestError(error: unknown): { message: string, stale: boolean } {
  const { status: code, code: reason } = apiError(error)
  if (reason === 'PROCESSING_DISABLED') return { message: t('media.processing.requestErrors.PROCESSING_DISABLED'), stale: false }
  if (reason === 'VERSION_CONFLICT') return { message: t('media.processing.requestErrors.VERSION_CONFLICT'), stale: true }
  if (reason === 'IN_TRASH') return { message: t('media.processing.requestErrors.IN_TRASH'), stale: true }
  if (code === 422) return { message: t('media.processing.requestErrors.KIND_MISMATCH'), stale: false }
  return { message: t('common.unexpectedError'), stale: false }
}

async function run() {
  if (busy.value) return
  status.value = null
  busy.value = true
  try {
    const { media } = await $api(`/api/admin/media/${props.mediaId}/process`, { method: 'POST' })
    emit('updated', { version: media.version, processingState: media.processingState, processing: media.processing })
    status.value = { variant: 'success', message: t('media.processing.requested') }
  }
  catch (error) {
    const outcome = requestError(error)
    status.value = { variant: 'error', message: outcome.message }
    if (outcome.stale) emit('stale')
  }
  finally {
    busy.value = false
    // Le bouton disparaît (tâche en file) : le focus va au message de résultat.
    await nextTick()
    statusEl.value?.focus()
  }
}

// ─── Annonces (changements d'état seulement) ─────────────────────────────────

type Transition = 'started' | 'finished' | 'failed' | 'retry'

function transition(before: ProcessingStateValue | null, after: ProcessingStateValue | null): Transition | null {
  if (before === 'PENDING' && after === 'PROCESSING') return 'started'
  if (before === 'PROCESSING' && after === 'PENDING') return 'retry'
  if (!processingInProgress(before)) return null
  if (after === 'READY') return 'finished'
  return after === 'FAILED' ? 'failed' : null
}

const announcement = ref('')
watch([() => props.mediaId, () => props.state], async ([id, state], [previousId, previousState]) => {
  // Autre média (navigation) : pas un changement d'état.
  const kind = id === previousId ? transition(previousState, state) : null
  if (!kind) return
  // Vidé puis rempli : un même message (deux traitements terminés) est annoncé de nouveau.
  announcement.value = ''
  await nextTick()
  announcement.value = t(`media.processing.announcements.${kind}`)
})
</script>

<template>
  <section :aria-labelledby="titleId" class="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 :id="titleId" class="text-base font-semibold text-foreground">
        {{ t('media.processing.title') }}
      </h2>
      <UiBadge v-if="state" :variant="STATE_BADGES[state]">
        {{ t(`media.processing.states.${state}`) }}
      </UiBadge>
    </div>

    <p v-if="state === null" class="text-sm text-muted-foreground">
      {{ t('media.processing.never') }}
    </p>
    <p v-else-if="interrupted" class="text-sm text-foreground">
      {{ t('media.processing.interrupted') }}
    </p>
    <p v-else-if="state === 'PENDING'" class="text-sm text-foreground">
      {{ t('media.processing.queued') }}
    </p>

    <!-- Étape en cours : barre native (jamais indéterminée : pas d'animation continue) et pourcentage écrit. -->
    <div v-if="running && stepLabel" class="grid gap-1.5">
      <p :id="stepId" class="text-sm font-medium text-foreground">
        {{ t('media.processing.currentStep', { step: stepLabel }) }}
      </p>
      <div v-if="progress !== null" class="flex items-center gap-3">
        <progress
          :value="progress"
          max="1"
          :aria-labelledby="stepId"
          class="h-2.5 min-w-0 flex-1 appearance-none overflow-hidden rounded-full border border-input bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
        />
        <span class="shrink-0 text-sm text-foreground tabular-nums">{{ formatPercent(progress * 100, locale) }}</span>
      </div>
    </div>

    <p v-if="previousError" class="text-sm text-muted-foreground">
      {{ previousError }}
    </p>

    <UiAlert v-if="failure" variant="error">
      <p>{{ failure.message }}</p>
      <p v-if="failure.detail" class="mt-1 text-xs break-words">
        {{ t('media.processing.errorDetail', { detail: failure.detail }) }}
      </p>
    </UiAlert>

    <dl v-if="job" class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <div v-if="attempt !== null" class="grid gap-0.5">
        <dt class="text-muted-foreground">
          {{ t('media.processing.attempt') }}
        </dt>
        <dd class="font-medium text-foreground">
          {{ t('media.processing.attemptValue', { current: attempt, max: JOB_MAX_ATTEMPTS }) }}
        </dd>
      </div>
      <div v-if="nextAttempt" class="grid gap-0.5">
        <dt class="text-muted-foreground">
          {{ t('media.processing.nextAttempt') }}
        </dt>
        <dd class="font-medium text-foreground">
          <NuxtTime :datetime="nextAttempt" :locale="locale" date-style="medium" time-style="short" />
        </dd>
      </div>
      <div class="grid gap-0.5">
        <dt class="text-muted-foreground">
          {{ t('media.processing.createdAt') }}
        </dt>
        <dd class="font-medium text-foreground">
          <NuxtTime :datetime="job.createdAt" :locale="locale" date-style="medium" time-style="short" />
        </dd>
      </div>
      <div v-if="job.startedAt" class="grid gap-0.5">
        <dt class="text-muted-foreground">
          {{ t('media.processing.startedAt') }}
        </dt>
        <dd class="font-medium text-foreground">
          <NuxtTime :datetime="job.startedAt" :locale="locale" date-style="medium" time-style="short" />
        </dd>
      </div>
      <div v-if="job.finishedAt" class="grid gap-0.5">
        <dt class="text-muted-foreground">
          {{ t('media.processing.finishedAt') }}
        </dt>
        <dd class="font-medium text-foreground">
          <NuxtTime :datetime="job.finishedAt" :locale="locale" date-style="medium" time-style="short" />
        </dd>
      </div>
    </dl>

    <div v-if="warnings.length > 0" class="grid gap-1.5">
      <h3 class="text-sm font-semibold text-foreground">
        {{ t('media.processing.warningsTitle') }}
      </h3>
      <ul class="grid list-disc gap-1 ps-5 text-sm text-foreground">
        <li v-for="warning in warnings" :key="warning.code">
          {{ warning.text }}
        </li>
      </ul>
    </div>

    <!-- Rendus : versions réencodées servies avant l'original (sources du lecteur). -->
    <div v-if="renditionItems.length > 0" class="grid gap-3 border-t border-border pt-4">
      <div>
        <h3 class="text-sm font-semibold text-foreground">
          {{ t('media.processing.renditions.title') }}
        </h3>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('media.processing.renditions.description') }}
        </p>
      </div>
      <ul class="grid gap-3">
        <li v-for="rendition in renditionItems" :key="rendition.name" class="grid gap-3 rounded-lg border border-border p-3">
          <p class="text-sm font-medium break-words text-foreground">
            {{ rendition.format }}
          </p>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('media.processing.renditions.definition') }}
              </dt>
              <dd class="font-medium text-foreground">
                {{ t('media.dimensions', { width: rendition.width, height: rendition.height }) }}
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('media.detail.bitrate') }}
              </dt>
              <dd class="font-medium text-foreground">
                {{ formatBitrate(rendition.bitrate, locale) }}
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('media.detail.size') }}
              </dt>
              <dd class="font-medium text-foreground">
                {{ formatBytes(rendition.size, locale) }}
              </dd>
            </div>
            <div class="grid gap-0.5">
              <dt class="text-muted-foreground">
                {{ t('media.detail.duration') }}
              </dt>
              <dd class="font-medium text-foreground">
                <span aria-hidden="true">{{ formatClock(rendition.duration) }}</span>
                <span class="sr-only">{{ formatDuration(rendition.duration, locale) }}</span>
              </dd>
            </div>
          </dl>
          <div>
            <!-- Nom accessible : texte visible suivi du format (plusieurs liens « Télécharger » dans la liste). -->
            <UiButton :to="rendition.url" external download variant="outline" size="sm">
              <Download aria-hidden="true" />
              <i18n-t keypath="media.processing.renditions.download" tag="span" scope="global">
                <template #format>
                  <span class="sr-only">{{ rendition.format }}</span>
                </template>
              </i18n-t>
            </UiButton>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="status" ref="statusEl" tabindex="-1" class="rounded-lg">
      <UiAlert :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
        {{ status.message }}
      </UiAlert>
    </div>

    <div v-if="canRun" class="grid gap-2">
      <div>
        <UiButton variant="secondary" :loading="busy" @click="run">
          <RefreshCw aria-hidden="true" />
          {{ state === null ? t('media.processing.run') : t('media.processing.rerun') }}
        </UiButton>
      </div>
      <p v-if="state === 'READY'" class="text-xs text-muted-foreground">
        {{ t('media.processing.rerunReadyHint') }}
      </p>
    </div>
    <p v-else-if="inactiveNote" class="text-sm text-muted-foreground">
      {{ inactiveNote }}
    </p>

    <!-- Changements d'état annoncés sans déplacer le focus (jamais chaque progression). -->
    <p class="sr-only" role="status">
      {{ announcement }}
    </p>
  </section>
</template>
