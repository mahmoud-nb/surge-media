<script setup lang="ts">
/**
 * Champs structurés d'une transformation (taille, ajustement, ancrage, qualité, fond, rotation,
 * miroir) : dialogue « Préréglage » (AdminTransformSettings) et générateur d'adresses de la fiche
 * média (AdminUrlGenerator). Le parent fournit les identifiants des contrôles (focus sur la première
 * erreur) et leurs messages d'erreur ; `edit` signale une saisie (effacer l'erreur du champ).
 */
import type { TransformField, TransformFieldValues } from '#shared/schemas/transforms'
import { TRANSFORM_FITS, TRANSFORM_FLIPS, TRANSFORM_GRAVITIES, TRANSFORM_ROTATIONS } from '#shared/utils/transforms'

defineProps<{
  ids: Record<TransformField, string>
  /** Dimension maximale acceptée par le serveur (aide des champs de taille). */
  maxDimension: number
  error?: (field: TransformField) => string | undefined
}>()
const emit = defineEmits<{ edit: [field: TransformField] }>()
const model = defineModel<TransformFieldValues>({ required: true })

const { t } = useI18n()

const fitOptions = computed(() => TRANSFORM_FITS.map(value => ({ value, label: t(`transforms.fit.${value}`) })))
const gravityOptions = computed(() => TRANSFORM_GRAVITIES.map(value => ({ value, label: t(`transforms.gravity.${value}`) })))
const rotateOptions = computed(() => TRANSFORM_ROTATIONS.map(value => ({ value: String(value) as TransformFieldValues['rotate'], label: t(`transforms.rotate.${value}`) })))
const flipOptions = computed(() => (['', ...TRANSFORM_FLIPS] as const).map(value => ({ value, label: t(`transforms.flip.${value || 'none'}`) })))
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <UiFormField v-slot="field" :id="ids.width" :label="t('transforms.presets.fields.width')" :hint="t('transforms.presets.fields.sizeHint', { max: maxDimension })" :error="error?.('width')">
      <UiInput v-bind="field" v-model="model.width" name="width" inputmode="numeric" autocomplete="off" @input="emit('edit', 'width')" />
    </UiFormField>
    <UiFormField v-slot="field" :id="ids.height" :label="t('transforms.presets.fields.height')" :hint="t('transforms.presets.fields.sizeHint', { max: maxDimension })" :error="error?.('height')">
      <UiInput v-bind="field" v-model="model.height" name="height" inputmode="numeric" autocomplete="off" @input="emit('edit', 'height')" />
    </UiFormField>
    <UiFormField v-slot="field" :id="ids.fit" :label="t('transforms.presets.fields.fit')" :hint="t('transforms.presets.fields.fitHint')" :error="error?.('fit')">
      <UiSelect v-bind="field" v-model="model.fit" :options="fitOptions" name="fit" @change="emit('edit', 'fit')" />
    </UiFormField>
    <UiFormField v-slot="field" :id="ids.gravity" :label="t('transforms.presets.fields.gravity')" :hint="t('transforms.presets.fields.gravityHint')" :error="error?.('gravity')">
      <UiSelect v-bind="field" v-model="model.gravity" :options="gravityOptions" name="gravity" @change="emit('edit', 'gravity')" />
    </UiFormField>
    <UiFormField v-slot="field" :id="ids.quality" :label="t('transforms.presets.fields.quality')" :hint="t('transforms.presets.fields.qualityHint')" :error="error?.('quality')">
      <UiInput v-bind="field" v-model="model.quality" name="quality" inputmode="numeric" autocomplete="off" @input="emit('edit', 'quality')" />
    </UiFormField>
    <UiFormField v-slot="field" :id="ids.background" :label="t('transforms.presets.fields.background')" :hint="t('transforms.presets.fields.backgroundHint')" :error="error?.('background')">
      <UiInput v-bind="field" v-model="model.background" name="background" autocomplete="off" spellcheck="false" maxlength="7" @input="emit('edit', 'background')" />
    </UiFormField>
    <UiFormField v-slot="field" :id="ids.rotate" :label="t('transforms.presets.fields.rotate')" :error="error?.('rotate')">
      <UiSelect v-bind="field" v-model="model.rotate" :options="rotateOptions" name="rotate" @change="emit('edit', 'rotate')" />
    </UiFormField>
    <UiFormField v-slot="field" :id="ids.flip" :label="t('transforms.presets.fields.flip')" :error="error?.('flip')">
      <UiSelect v-bind="field" v-model="model.flip" :options="flipOptions" name="flip" @change="emit('edit', 'flip')" />
    </UiFormField>
  </div>
</template>
