<script setup lang="ts">
import { Crosshair, Eraser } from '@lucide/vue'
import { focalObjectPosition, roundFocalCoordinate, sameFocalPoint, type FocalPoint } from '#shared/utils/transforms'

/**
 * Point d'intérêt d'une image (fiche média, phase C3) : un clic sur l'image place le point (pointeur
 * unique, sans glisser : WCAG 2.5.7), deux curseurs en sont l'équivalent au clavier ; les aperçus
 * 1:1 et 16:9 reproduisent le recadrage du serveur (`focalObjectPosition`). L'enregistrement crée
 * une nouvelle version du média (`saved` : la page recharge le média).
 */
const props = defineProps<{
  mediaId: string
  /** Aperçu de l'image orientée (même rapport que l'original). */
  src: string
  width: number
  height: number
  focalPoint: FocalPoint | null
  canEdit: boolean
}>()
const emit = defineEmits<{ saved: [] }>()

const { t, locale } = useI18n()
const { $api } = useNuxtApp()
const uid = useId()

const AXES = ['x', 'y'] as const
const RATIOS = [{ key: 'square', ratio: 1 }, { key: 'wide', ratio: 16 / 9 }] as const

const draft = ref<FocalPoint | null>(props.focalPoint)
watch(() => props.focalPoint, (value) => {
  draft.value = value
})
/** Position affichée : le point, ou le centre (recadrage par défaut) s'il n'y en a pas. */
const shown = computed(() => draft.value ?? { x: 0.5, y: 0.5 })
/** Fraction → pourcentage entier, au format de la langue (« 35 % » insécable en français). */
const percent = (value: number) => formatPercent(Math.round(value * 100), locale.value)

const status = ref<{ variant: 'success' | 'info' | 'error', message: string } | null>(null)
const saving = ref(false)

function pick(event: MouseEvent) {
  if (!props.canEdit) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (!rect.width || !rect.height) return
  draft.value = {
    x: roundFocalCoordinate((event.clientX - rect.left) / rect.width),
    y: roundFocalCoordinate((event.clientY - rect.top) / rect.height),
  }
  status.value = null
}

function setAxis(axis: 'x' | 'y', event: Event) {
  draft.value = { ...shown.value, [axis]: roundFocalCoordinate(Number((event.target as HTMLInputElement).value) / 100) }
  status.value = null
}

function clearPoint() {
  draft.value = null
  status.value = null
}

const previews = computed(() => RATIOS.map(({ key, ratio }) => {
  const position = focalObjectPosition(props.width, props.height, ratio, draft.value)
  return { key, style: { aspectRatio: String(ratio), objectPosition: `${position.x * 100}% ${position.y * 100}%` } }
}))

async function save() {
  // Boutons jamais désactivés (le focus resterait sur un bouton inactif) : rien à faire sans changement.
  if (sameFocalPoint(draft.value, props.focalPoint)) {
    status.value = { variant: 'info', message: t('media.focal.unchanged') }
    return
  }
  saving.value = true
  status.value = null
  try {
    const point = draft.value
    const result = await $api(`/api/admin/media/${props.mediaId}`, { method: 'PATCH', body: { focalPoint: point } })
    status.value = { variant: 'success', message: t(point ? 'media.focal.saved' : 'media.focal.cleared', { version: result.media.version }) }
    emit('saved')
  }
  catch (error) {
    const { code } = apiError(error)
    status.value = { variant: 'error', message: code === 'VERSION_CONFLICT' ? t('media.focal.conflict') : t('common.unexpectedError') }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section aria-labelledby="focal-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
    <h2 id="focal-title" class="text-lg font-semibold text-foreground">
      {{ t('media.focal.title') }}
    </h2>
    <p class="mt-2 text-sm text-muted-foreground">
      {{ t('media.focal.description') }}
    </p>

    <div class="mt-4 grid gap-5">
      <!-- Un clic place le point ; les curseurs ci-dessous en sont l'équivalent au clavier. -->
      <div class="flex justify-center">
        <div
          class="bg-checker relative inline-block max-w-full overflow-hidden rounded-lg border border-border"
          :class="{ 'cursor-crosshair': canEdit }"
          @click="pick"
        >
          <img :src="src" alt="" :width="width" :height="height" class="block h-auto max-h-80 w-auto max-w-full" draggable="false">
          <span
            class="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgb(0_0_0/0.75)]"
            :class="{ 'border-dashed': !draft }"
            :style="{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }"
            aria-hidden="true"
          >
            <span class="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.75)]" />
          </span>
        </div>
      </div>

      <p class="text-sm text-foreground">
        {{ draft ? t('media.focal.current', { x: percent(draft.x), y: percent(draft.y) }) : t('media.focal.none') }}
      </p>

      <template v-if="canEdit">
        <p class="-mt-3 text-sm text-muted-foreground">
          {{ t('media.focal.pickHint') }}
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <div v-for="axis in AXES" :key="axis" class="grid gap-2">
            <div class="flex items-baseline justify-between gap-2">
              <label :for="`${uid}-${axis}`" class="text-sm font-medium text-foreground">{{ t(`media.focal.${axis}`) }}</label>
              <output :for="`${uid}-${axis}`" class="text-sm whitespace-nowrap text-muted-foreground tabular-nums">{{ percent(shown[axis]) }}</output>
            </div>
            <input
              :id="`${uid}-${axis}`"
              type="range"
              min="0"
              max="100"
              step="1"
              :value="Math.round(shown[axis] * 100)"
              :aria-valuetext="percent(shown[axis])"
              class="focal-range"
              @input="setAxis(axis, $event)"
            >
          </div>
        </div>
      </template>

      <div>
        <h3 class="text-sm font-medium text-foreground">
          {{ t('media.focal.previewsTitle') }}
        </h3>
        <div class="mt-2 grid grid-cols-[9fr_16fr] items-start gap-3">
          <figure v-for="preview in previews" :key="preview.key" class="grid gap-1">
            <img :src="src" alt="" class="bg-checker w-full rounded-md border border-border object-cover" :style="preview.style">
            <figcaption class="text-xs text-muted-foreground">
              {{ t(`media.focal.${preview.key}`) }}
            </figcaption>
          </figure>
        </div>
      </div>

      <template v-if="canEdit">
        <p class="text-sm text-muted-foreground">
          {{ t('media.focal.versionNote') }}
        </p>
        <div class="flex flex-wrap justify-end gap-3">
          <UiButton variant="outline" @click="clearPoint">
            <Eraser aria-hidden="true" />
            {{ t('media.focal.clear') }}
          </UiButton>
          <UiButton :loading="saving" @click="save">
            <Crosshair aria-hidden="true" />
            {{ t('media.focal.save') }}
          </UiButton>
        </div>
        <!-- Sous les boutons : son apparition ou sa disparition ne les déplace pas sous le pointeur. -->
        <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
          {{ status.message }}
        </UiAlert>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* Curseur : piste bordée (≥ 3:1, WCAG 1.4.11) et poignée de la couleur principale, dans les deux thèmes. */
.focal-range {
  appearance: none;
  width: 100%;
  height: 1.5rem;
  background: transparent;
  cursor: pointer;
}
.focal-range::-webkit-slider-runnable-track {
  height: 0.5rem;
  border: 1px solid var(--input);
  border-radius: 9999px;
  background: var(--muted);
}
.focal-range::-moz-range-track {
  height: 0.5rem;
  border: 1px solid var(--input);
  border-radius: 9999px;
  background: var(--muted);
}
.focal-range::-webkit-slider-thumb {
  appearance: none;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: calc(-0.375rem - 1px);
  border: 2px solid var(--surface);
  border-radius: 9999px;
  background: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}
.focal-range::-moz-range-thumb {
  width: 1rem;
  height: 1rem;
  border: 2px solid var(--surface);
  border-radius: 9999px;
  background: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}
</style>
