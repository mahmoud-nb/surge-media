<script setup lang="ts">
/**
 * Champs structurés d'une transformation, regroupés par thème (taille, cadrage, rendu, orientation) :
 * dialogue « Préréglage » (AdminTransformSettings) et générateur d'adresses de la fiche média
 * (AdminUrlGenerator). Chaque aide décrit l'effet du choix courant ; l'ajustement et l'ancrage
 * n'apparaissent que lorsqu'ils agissent (largeur **et** hauteur, recadrage « Remplir »). Emplacements :
 * `size` (densité du générateur) et `area` (zone de recadrage). Le parent fournit les identifiants
 * des contrôles (focus sur la première erreur) et leurs messages ; `edit` signale une saisie.
 */
import type { TransformField, TransformFieldValues } from '#shared/schemas/transforms'
import {
  TRANSFORM_DEFAULT_QUALITY,
  TRANSFORM_FITS,
  TRANSFORM_FLIPS,
  TRANSFORM_GRAVITIES,
  TRANSFORM_ROTATIONS,
  type TransformFormat,
} from '#shared/utils/transforms'

const props = defineProps<{
  ids: Record<TransformField, string>
  /** Dimension maximale acceptée par le serveur (aide des champs de taille). */
  maxDimension: number
  error?: (field: TransformField) => string | undefined
  /** Format de sortie, s'il est connu (qualité par défaut affichée dans l'aide). */
  format?: TransformFormat | null
}>()
const emit = defineEmits<{ edit: [field: TransformField] }>()
const model = defineModel<TransformFieldValues>({ required: true })

const { t } = useI18n()
const FORMAT_NAMES: Record<TransformFormat, string> = { jpg: 'JPEG', png: 'PNG', webp: 'WebP', avif: 'AVIF' }

const fitOptions = computed(() => TRANSFORM_FITS.map(value => ({ value, label: t(`transforms.fit.${value}`) })))
const gravityOptions = computed(() => TRANSFORM_GRAVITIES.map(value => ({ value, label: t(`transforms.gravity.${value}`) })))
const rotateOptions = computed(() => TRANSFORM_ROTATIONS.map(value => ({ value: String(value) as TransformFieldValues['rotate'], label: t(`transforms.rotate.${value}`) })))
const flipOptions = computed(() => (['', ...TRANSFORM_FLIPS] as const).map(value => ({ value, label: t(`transforms.flip.${value || 'none'}`) })))

/** Largeur et hauteur indiquées : l'image doit remplir un cadre, l'ajustement compte. */
const box = computed(() => model.value.width.trim() !== '' && model.value.height.trim() !== '')

const gravityHint = computed(() => {
  const gravity = model.value.gravity
  if (gravity === 'focal' || gravity === 'center' || gravity === 'attention' || gravity === 'entropy') return t(`transforms.gravityHelp.${gravity}`)
  return t('transforms.gravityHelp.edge', { position: t(`transforms.gravity.${gravity}`) })
})

const qualityHint = computed(() => {
  const format = props.format
  if (!format) return t('transforms.qualityHelp.any')
  if (format === 'png') return t('transforms.qualityHelp.png')
  return t('transforms.qualityHelp.format', { format: FORMAT_NAMES[format], quality: TRANSFORM_DEFAULT_QUALITY[format] ?? '' })
})

/** Couleur de fond saisie, si elle est valable (aperçu de la teinte). */
const swatch = computed(() => {
  const value = model.value.background.trim().replace(/^#/, '')
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : null
})
</script>

<template>
  <div class="grid gap-6">
    <fieldset class="grid gap-4">
      <legend class="mb-3 text-sm font-semibold text-foreground">
        {{ t('transforms.fieldGroups.size') }}
      </legend>
      <p class="text-sm text-muted-foreground">
        {{ t('transforms.fieldGroups.sizeHelp') }}
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiFormField :id="ids.width" v-slot="field" :label="t('transforms.presets.fields.width')" :hint="t('transforms.presets.fields.widthHint', { max: maxDimension })" :error="error?.('width')">
          <UiInput v-bind="field" v-model="model.width" name="width" inputmode="numeric" autocomplete="off" @input="emit('edit', 'width')" />
        </UiFormField>
        <UiFormField :id="ids.height" v-slot="field" :label="t('transforms.presets.fields.height')" :hint="t('transforms.presets.fields.heightHint', { max: maxDimension })" :error="error?.('height')">
          <UiInput v-bind="field" v-model="model.height" name="height" inputmode="numeric" autocomplete="off" @input="emit('edit', 'height')" />
        </UiFormField>
        <slot name="size" />
      </div>
    </fieldset>

    <fieldset class="grid gap-4">
      <legend class="mb-3 text-sm font-semibold text-foreground">
        {{ t('transforms.fieldGroups.framing') }}
      </legend>
      <div v-if="box" class="grid gap-4 sm:grid-cols-2">
        <UiFormField :id="ids.fit" v-slot="field" :label="t('transforms.presets.fields.fit')" :hint="t(`transforms.fitHelp.${model.fit}`)" :error="error?.('fit')">
          <UiSelect v-bind="field" v-model="model.fit" :options="fitOptions" name="fit" @change="emit('edit', 'fit')" />
        </UiFormField>
        <UiFormField v-if="model.fit === 'cover'" :id="ids.gravity" v-slot="field" :label="t('transforms.presets.fields.gravity')" :hint="gravityHint" :error="error?.('gravity')">
          <UiSelect v-bind="field" v-model="model.gravity" :options="gravityOptions" name="gravity" @change="emit('edit', 'gravity')" />
        </UiFormField>
      </div>
      <p v-else class="text-sm text-muted-foreground">
        {{ t('transforms.fieldGroups.framingUnavailable') }}
      </p>
      <slot name="area" />
    </fieldset>

    <fieldset class="grid gap-4">
      <legend class="mb-3 text-sm font-semibold text-foreground">
        {{ t('transforms.fieldGroups.rendering') }}
      </legend>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiFormField :id="ids.quality" v-slot="field" :label="t('transforms.presets.fields.quality')" :hint="qualityHint" :error="error?.('quality')">
          <UiInput v-bind="field" v-model="model.quality" name="quality" inputmode="numeric" autocomplete="off" @input="emit('edit', 'quality')" />
        </UiFormField>
        <UiFormField :id="ids.background" v-slot="field" :label="t('transforms.presets.fields.background')" :hint="t('transforms.presets.fields.backgroundHint')" :error="error?.('background')">
          <div class="flex items-center gap-2">
            <UiInput v-bind="field" v-model="model.background" name="background" autocomplete="off" spellcheck="false" maxlength="7" :placeholder="t('transforms.presets.fields.backgroundPlaceholder')" @input="emit('edit', 'background')" />
            <span
              class="bg-checker size-10 shrink-0 rounded-lg border border-input"
              :style="swatch ? { background: swatch } : undefined"
              aria-hidden="true"
            />
          </div>
        </UiFormField>
      </div>
    </fieldset>

    <fieldset class="grid gap-4">
      <legend class="mb-3 text-sm font-semibold text-foreground">
        {{ t('transforms.fieldGroups.orientation') }}
      </legend>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiFormField :id="ids.rotate" v-slot="field" :label="t('transforms.presets.fields.rotate')" :error="error?.('rotate')">
          <UiSelect v-bind="field" v-model="model.rotate" :options="rotateOptions" name="rotate" @change="emit('edit', 'rotate')" />
        </UiFormField>
        <UiFormField :id="ids.flip" v-slot="field" :label="t('transforms.presets.fields.flip')" :hint="t('transforms.presets.fields.flipHint')" :error="error?.('flip')">
          <UiSelect v-bind="field" v-model="model.flip" :options="flipOptions" name="flip" @change="emit('edit', 'flip')" />
        </UiFormField>
      </div>
    </fieldset>
  </div>
</template>
