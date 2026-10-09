<script setup lang="ts">
/**
 * Vignette de la médiathèque. Toute la carte est cliquable (lien « étiré » sur le titre),
 * mais le lien n'a pour nom que le titre du média ; le focus est rendu sur la carte entière.
 * L'aperçu est décoratif (alt vide) : le titre, juste en dessous, identifie le média.
 * Vidéo : aperçu tiré de son image d'affiche (phase D2) et pastille « vidéo », sinon une icône ; la
 * durée ; jamais d'élément <video> dans la grille (chaque carte chargerait les métadonnées du fichier).
 * En mode sélection (`selectable`), une case à cocher passe au-dessus du lien étiré.
 * Traitement d'une vidéo (phase D3, § 37) : pastille de texte à côté de « Privé » tant qu'il est en
 * attente ou en cours, ou en échec ; icône fixe (aucune animation continue, WCAG 2.2.2) ; rien une fois
 * traitée ni pour un média non concerné. Dans la corbeille, la tâche est annulée : « en attente » ou
 * « en cours » y serait faux (la restauration la relance), seul l'échec reste signalé.
 */
import { Film, Lock, Play } from '@lucide/vue'
import { processingInProgress } from '~/composables/useProcessingPoll'

const props = defineProps<{
  media: {
    id: string
    kind: string
    originalName: string
    title: string | null
    previewUrl: string | null
    extension: string | null
    width: number | null
    height: number | null
    duration: number | null
    size: number
    visibility: MediaVisibility
    /** État du traitement de la vidéo (null : non concerné). */
    processingState?: ProcessingStateValue | null
    /** Date de mise à la corbeille (null : média actif). */
    deletedAt?: string | null
  }
  /** Affiche une case de sélection (actions groupées). */
  selectable?: boolean
}>()

const selected = defineModel<boolean>('selected', { default: false })

const { t, locale } = useI18n()
const name = computed(() => props.media.title || props.media.originalName)
const isVideo = computed(() => props.media.kind === 'VIDEO')
/** Durée : compacte à l'écran (« 1:23 »), en toutes lettres pour les lecteurs d'écran. */
const duration = computed(() => (props.media.duration === null
  ? null
  : { clock: formatClock(props.media.duration), spoken: t('media.durationLabel', { duration: formatDuration(props.media.duration, locale.value) }) }))
const details = computed(() => [
  props.media.extension?.toUpperCase(),
  props.media.width && props.media.height ? t('media.dimensions', { width: props.media.width, height: props.media.height }) : null,
  formatBytes(props.media.size, locale.value),
].filter(Boolean) as string[])

/** État affiché en pastille (même présentation que la fiche) : en attente, en cours ou en échec. */
const processing = computed<ProcessingStateValue | null>(() => {
  const state = props.media.processingState ?? null
  if (state === 'FAILED') return state
  return processingInProgress(state) && !props.media.deletedAt ? state : null
})
</script>

<template>
  <article
    :class="cn(
      'relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow hover:shadow-md has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring',
      selectable && selected && 'border-primary ring-2 ring-primary',
    )"
  >
    <!-- Image en position absolue : un aspect-ratio seul se laisserait étirer par une image haute. -->
    <div :class="cn('relative aspect-[4/3] overflow-hidden border-b border-border', isVideo ? 'bg-muted' : 'bg-checker')">
      <img v-if="media.previewUrl" :src="media.previewUrl" alt="" loading="lazy" decoding="async" class="absolute inset-0 size-full object-contain">
      <div v-else-if="isVideo" class="absolute inset-0 flex items-center justify-center">
        <Film class="size-10 text-muted-foreground" aria-hidden="true" />
      </div>
      <!-- Vidéo avec affiche : la vignette seule ressemblerait à une image. -->
      <span
        v-if="isVideo && media.previewUrl"
        class="absolute bottom-2 left-2 flex rounded-md border border-border bg-surface p-1 text-foreground shadow-xs"
        aria-hidden="true"
      ><Play class="size-3.5" /></span>
      <span
        v-if="isVideo && duration"
        class="absolute right-2 bottom-2 rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground tabular-nums shadow-xs"
        aria-hidden="true"
      >{{ duration.clock }}</span>
    </div>
    <!-- Libellé englobant : toute la pastille (28 px) est cliquable ; le texte est réservé aux lecteurs d'écran. -->
    <label v-if="selectable" class="absolute top-2 left-2 z-10 flex cursor-pointer items-center rounded-md border border-input bg-surface p-1.5 shadow-xs">
      <input v-model="selected" type="checkbox" class="size-4 accent-primary">
      <span class="sr-only">{{ t('media.selection.item', { name }) }}</span>
    </label>
    <div class="grid gap-1.5 p-3">
      <h3 class="truncate text-sm font-medium text-foreground" :title="name">
        <NuxtLink :to="`/admin/media/${media.id}`" class="after:absolute after:inset-0 focus-visible:outline-none">
          {{ name }}
        </NuxtLink>
      </h3>
      <p class="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
        <template v-for="(detail, index) in details" :key="index">
          <span v-if="index > 0" aria-hidden="true">·</span>
          <span>{{ detail }}</span>
        </template>
        <span v-if="duration" class="sr-only">{{ duration.spoken }}</span>
      </p>
      <!-- Pastilles : retour à la ligne permis (carte de 160 px de large sur un écran de 375 px). -->
      <p v-if="media.visibility === 'PRIVATE' || processing" class="flex flex-wrap gap-1.5">
        <UiBadge v-if="media.visibility === 'PRIVATE'">
          <Lock class="size-3" aria-hidden="true" />
          {{ t('media.visibility.PRIVATE.label') }}
        </UiBadge>
        <AdminProcessingStateBadge v-if="processing" :state="processing" class="whitespace-normal" />
      </p>
    </div>
  </article>
</template>
