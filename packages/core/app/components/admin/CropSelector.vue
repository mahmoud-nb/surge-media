<script setup lang="ts">
/**
 * Zone de recadrage du générateur d'adresses (paramètre `crop`, pixels de l'image orientée **puis
 * tournée et retournée**, comme l'exécute le serveur) : deux clics sur deux coins opposés (pointeur
 * unique, sans glisser : WCAG 2.5.7) ou saisie de la position et de la taille. L'image est affichée
 * avec la rotation et le miroir choisis ; la zone gardée est mise en valeur, le reste assombri.
 */
import { Eraser } from '@lucide/vue'
import { CROP_FIELDS, EMPTY_CROP, rotatedSize, type CropField, type CropFieldValues } from '#shared/schemas/transforms'
import type { TransformRegion } from '#shared/utils/transforms'

const props = defineProps<{
  /** Aperçu de l'image orientée (même rapport que l'original). */
  src: string
  /** Dimensions de l'image orientée. */
  width: number
  height: number
  rotate: string
  flip: string
  ids: Record<CropField, string>
  /** Zone valable (affichée), ou null. */
  region: TransformRegion | null
  error?: (field: CropField) => string | undefined
}>()
const emit = defineEmits<{ edit: [field: CropField] }>()
const model = defineModel<CropFieldValues>({ required: true })

const { t } = useI18n()

/** Dimensions de travail : celles de l'image tournée. */
const bounds = computed(() => rotatedSize(props.width, props.height, props.rotate))
const quarter = computed(() => props.rotate === '90' || props.rotate === '270')

/** Cadre au rapport de l'image tournée, 20 rem de haut au plus. */
const frameStyle = computed(() => ({
  aspectRatio: `${bounds.value.width} / ${bounds.value.height}`,
  width: `min(100%, ${(20 * bounds.value.width / bounds.value.height).toFixed(3)}rem)`,
}))

/**
 * Image source dans le cadre : tournée puis retournée (transformations CSS appliquées de droite à
 * gauche), aux dimensions échangées pour un quart de tour.
 */
const imageStyle = computed(() => {
  const ratio = props.width / props.height
  const scaleX = props.flip.includes('h') ? -1 : 1
  const scaleY = props.flip.includes('v') ? -1 : 1
  return {
    left: '50%',
    top: '50%',
    width: quarter.value ? `${ratio * 100}%` : '100%',
    height: quarter.value ? `${100 / ratio}%` : '100%',
    transform: `translate(-50%, -50%) scale(${scaleX}, ${scaleY}) rotate(${props.rotate}deg)`,
  }
})

const regionStyle = computed(() => {
  const region = props.region
  if (!region) return null
  const { width, height } = bounds.value
  return {
    left: `${(region.x / width) * 100}%`,
    top: `${(region.y / height) * 100}%`,
    width: `${(region.width / width) * 100}%`,
    height: `${(region.height / height) * 100}%`,
  }
})

/** Premier coin posé, en attente du second. */
const anchor = ref<{ x: number, y: number } | null>(null)
/** Annonce des actions à la souris (la saisie au clavier n'est pas annoncée à chaque frappe). */
const announcement = ref('')
watch(() => [props.rotate, props.flip], () => {
  anchor.value = null
})

function point(event: MouseEvent): { x: number, y: number } | null {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const { width, height } = bounds.value
  const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value), 0), max)
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * width, width),
    y: clamp(((event.clientY - rect.top) / rect.height) * height, height),
  }
}

function pick(event: MouseEvent) {
  const corner = point(event)
  if (!corner) return
  const first = anchor.value
  if (!first) {
    anchor.value = corner
    announcement.value = t('media.generator.crop.firstCorner', corner)
    return
  }
  const { width, height } = bounds.value
  // Zone d'au moins un pixel, entièrement dans l'image.
  const x = Math.min(first.x, corner.x, width - 1)
  const y = Math.min(first.y, corner.y, height - 1)
  const zone = {
    x,
    y,
    width: Math.max(1, Math.min(Math.abs(corner.x - first.x), width - x)),
    height: Math.max(1, Math.min(Math.abs(corner.y - first.y), height - y)),
  }
  model.value = { x: String(zone.x), y: String(zone.y), width: String(zone.width), height: String(zone.height) }
  anchor.value = null
  for (const field of CROP_FIELDS) emit('edit', field)
  announcement.value = t('media.generator.crop.current', zone)
}

function clearZone() {
  anchor.value = null
  model.value = { ...EMPTY_CROP }
  for (const field of CROP_FIELDS) emit('edit', field)
  announcement.value = t('media.generator.crop.cleared')
}

const anchorStyle = computed(() => anchor.value && {
  left: `${(anchor.value.x / bounds.value.width) * 100}%`,
  top: `${(anchor.value.y / bounds.value.height) * 100}%`,
})

/** État affiché : premier coin, zone définie, ou aucune zone. */
const status = computed(() => {
  if (anchor.value) return t('media.generator.crop.firstCorner', anchor.value)
  if (props.region) return t('media.generator.crop.current', { ...props.region })
  return t('media.generator.crop.none')
})
</script>

<template>
  <fieldset class="grid gap-4 border-t border-border pt-4">
    <legend class="float-left mb-1 w-full text-sm font-medium text-foreground">
      {{ t('media.generator.crop.title') }}
    </legend>
    <p class="text-sm text-muted-foreground">
      {{ t('media.generator.crop.description', bounds) }}
    </p>

    <!-- Deux clics : coins opposés de la zone (les champs ci-dessous en sont l'équivalent au clavier). -->
    <div class="flex justify-center">
      <div
        class="bg-checker relative max-w-full cursor-crosshair overflow-hidden rounded-lg border border-border"
        :style="frameStyle"
        @click="pick"
      >
        <img :src="src" alt="" class="pointer-events-none absolute max-w-none" :style="imageStyle" draggable="false">
        <div
          v-if="regionStyle"
          class="pointer-events-none absolute border-2 border-white shadow-[0_0_0_2px_rgb(0_0_0/0.75),0_0_0_9999px_rgb(0_0_0/0.45)]"
          :style="regionStyle"
          aria-hidden="true"
        />
        <span
          v-if="anchorStyle"
          class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/60 shadow-[0_0_0_1px_rgb(0_0_0/0.75)]"
          :style="anchorStyle"
          aria-hidden="true"
        />
      </div>
    </div>
    <p class="text-sm text-foreground">
      {{ status }}
    </p>
    <span class="sr-only" role="status">{{ announcement }}</span>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UiFormField v-for="field in CROP_FIELDS" :id="ids[field]" :key="field" v-slot="control" :label="t(`media.generator.crop.fields.${field}`)" :error="error?.(field)">
        <UiInput v-bind="control" v-model="model[field]" :name="`crop-${field}`" inputmode="numeric" autocomplete="off" @input="emit('edit', field)" />
      </UiFormField>
    </div>
    <div>
      <UiButton variant="outline" size="sm" @click="clearZone">
        <Eraser aria-hidden="true" />
        {{ t('media.generator.crop.clear') }}
      </UiButton>
    </div>
  </fieldset>
</template>
