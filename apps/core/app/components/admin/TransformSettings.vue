<script setup lang="ts">
/**
 * Transformations d'images d'un niveau : politique des transformations libres, préréglages et
 * bornes du serveur. Projet (`projectId`) : onglet « Transformations » (lecture pour tout membre,
 * modification avec project:settings) ; sans projet : page « Réglages » (bibliothèque et
 * préréglages globaux, settings:manage).
 */
import { Pencil, Plus, SlidersHorizontal, Trash2 } from '@lucide/vue'
import {
  presetFieldsToDefinition,
  presetFormSchema,
  presetFormValues,
  transformFieldsSchema,
  type PresetFormValues,
} from '#shared/schemas/transforms'
import {
  parseTransformation,
  PRESET_DESCRIPTION_MAX_LENGTH,
  TRANSFORM_ERROR_CODES,
  TRANSFORM_MAX_DIMENSION,
  TRANSFORM_POLICIES,
  type TransformPolicy,
} from '#shared/utils/transforms'

const props = withDefaults(defineProps<{
  /** Projet ; absent = installation (bibliothèque, préréglages globaux). */
  projectId?: string
  /** Niveau des titres de section (la page fournit le h1). */
  headingLevel?: 2 | 3
}>(), { headingLevel: 2 })

const { t } = useI18n()
const { $api } = useNuxtApp()
const heading = computed(() => `h${props.headingLevel}`)
const ids = { policy: useId(), presets: useId(), limits: useId() }

const { data, error, refresh } = await useApiFetch('/api/admin/transforms', {
  query: computed(() => ({ project: props.projectId })),
})
/** Réponse de GET|PATCH /api/admin/transforms (typée une fois : le typage des routes Nitro sature sinon). */
type TransformsState = NonNullable<typeof data.value>
type Preset = TransformsState['presets'][number]

const level = computed(() => (props.projectId ? 'project' : 'installation'))
const editableLevel = computed(() => (props.projectId ? 'project' : 'global'))
const canEdit = computed(() => data.value?.canEdit ?? false)
const ownPresets = computed(() => data.value?.presets.filter(preset => preset.level === editableLevel.value) ?? [])
const limitReached = computed(() => ownPresets.value.length >= (data.value?.limits.presetsMax ?? Infinity))

function errorMessage(error: unknown): string {
  const { code } = apiError(error)
  return code && (TRANSFORM_ERROR_CODES as readonly string[]).includes(code) ? t(`transforms.errors.${code}`) : t('common.unexpectedError')
}

// ─── Politique ───────────────────────────────────────────────────────────────

const policy = ref<TransformPolicy | ''>('')
watch(() => data.value?.policy, (value) => {
  if (value) policy.value = value
}, { immediate: true })
const policyOptions = computed(() => TRANSFORM_POLICIES.map(value => ({
  value,
  label: t(`transforms.policy.options.${value}.label`),
  description: t(`transforms.policy.options.${value}.description`),
})))
const policyStatus = ref<{ variant: 'success' | 'error', message: string } | null>(null)
const savingPolicy = ref(false)

async function savePolicy() {
  if (!policy.value || savingPolicy.value) return
  policyStatus.value = null
  savingPolicy.value = true
  try {
    data.value = await $api<TransformsState>('/api/admin/transforms', { method: 'PATCH', query: { project: props.projectId }, body: { policy: policy.value } })
    policyStatus.value = { variant: 'success', message: t('transforms.policy.saved', { policy: t(`transforms.policy.options.${policy.value}.label`) }) }
  }
  catch (error) {
    policyStatus.value = { variant: 'error', message: errorMessage(error) }
  }
  finally {
    savingPolicy.value = false
  }
}

// ─── Préréglages ─────────────────────────────────────────────────────────────

const presetStatus = ref<{ variant: 'success' | 'error', message: string } | null>(null)

const FIELD_IDS = {
  name: useId(),
  description: useId(),
  width: useId(),
  height: useId(),
  fit: useId(),
  gravity: useId(),
  quality: useId(),
  background: useId(),
  rotate: useId(),
  flip: useId(),
} as const
type Field = keyof typeof FIELD_IDS

const EMPTY_FORM: PresetFormValues = { name: '', description: '', width: '', height: '', fit: 'cover', gravity: 'focal', quality: '', background: '', rotate: '0', flip: '' }
const form = reactive<PresetFormValues>({ ...EMPTY_FORM })
const { validate, message, clear, setError } = useFormValidation(presetFormSchema, FIELD_IDS)

const editOpen = ref(false)
const editing = ref<Preset | null>(null)
const editError = ref<string>()
const savingPreset = ref(false)

/** Forme canonique des champs de transformation (affichée dès la saisie, sans attendre le nom), ou null. */
const definition = computed(() => {
  const result = transformFieldsSchema.safeParse(form)
  return result.success ? presetFieldsToDefinition(result.data) || null : null
})

function openCreate() {
  editing.value = null
  Object.assign(form, EMPTY_FORM)
  for (const field of Object.keys(FIELD_IDS) as Field[]) clear(field)
  editError.value = undefined
  editOpen.value = true
}

function openEdit(preset: Preset) {
  const parsed = parseTransformation(preset.transformation)
  editing.value = preset
  Object.assign(form, parsed.ok ? presetFormValues(parsed.transformation, preset.name, preset.description ?? '') : { ...EMPTY_FORM, name: preset.name })
  for (const field of Object.keys(FIELD_IDS) as Field[]) clear(field)
  editError.value = undefined
  editOpen.value = true
}

/** Paramètre refusé par le serveur (`data.param`) → champ du formulaire. */
const PARAM_FIELDS: Record<string, Field> = { w: 'width', h: 'height', fit: 'fit', g: 'gravity', q: 'quality', bg: 'background', r: 'rotate', flip: 'flip' }

async function submitPreset() {
  editError.value = undefined
  const input = validate(form)
  if (!input) return
  const max = data.value?.limits.maxDimension ?? TRANSFORM_MAX_DIMENSION
  for (const field of ['width', 'height'] as const) {
    if ((input[field] ?? 0) > max) return setError(field, 'validation.integerRange', { min: 1, max })
  }
  const body = { name: input.name, transformation: presetFieldsToDefinition(input), description: input.description || null }
  savingPreset.value = true
  try {
    const current = editing.value
    const { preset } = current?.id
      ? await $api(`/api/admin/presets/${current.id}`, { method: 'PATCH', body })
      : await $api('/api/admin/presets', { method: 'POST', query: { project: props.projectId }, body })
    await refresh()
    presetStatus.value = { variant: 'success', message: t(current ? 'transforms.presets.updated' : 'transforms.presets.created', { name: preset.name }) }
    editOpen.value = false
  }
  catch (error) {
    const { code, details } = apiError(error)
    const field = PARAM_FIELDS[String(details?.param ?? '')]
    if (code === 'PRESET_NAME_TAKEN') setError('name', 'transforms.errors.PRESET_NAME_TAKEN')
    else if (code === 'INVALID_TRANSFORM' && field) setError(field, field === 'width' || field === 'height' ? 'validation.integerRange' : 'transforms.errors.INVALID_TRANSFORM', { min: 1, max })
    else editError.value = errorMessage(error)
  }
  finally {
    savingPreset.value = false
  }
}

const deleteTarget = ref<Preset | null>(null)
const deleteOpen = computed({
  get: () => deleteTarget.value !== null,
  set: (value) => {
    if (!value) deleteTarget.value = null
  },
})
const deleteReturnFocus = ref(true)
const deleteError = ref<string>()
const deleting = ref(false)
/** Préréglage global qu'un préréglage de projet supprimé cesserait de masquer. */
const revealsGlobal = computed(() => Boolean(deleteTarget.value && data.value?.presets.some(preset => preset.level === 'global' && preset.name === deleteTarget.value?.name)))

function askDelete(preset: Preset) {
  deleteError.value = undefined
  deleteReturnFocus.value = true
  deleteTarget.value = preset
}

async function confirmDelete() {
  const preset = deleteTarget.value
  if (!preset?.id) return
  deleteError.value = undefined
  deleting.value = true
  try {
    await $api(`/api/admin/presets/${preset.id}`, { method: 'DELETE' })
    await refresh()
    presetStatus.value = { variant: 'success', message: t('transforms.presets.deleted', { name: preset.name }) }
    // La ligne a disparu avec son bouton : focus sur le titre de la liste.
    deleteReturnFocus.value = false
    deleteTarget.value = null
    await nextTick()
    document.getElementById(ids.presets)?.focus()
  }
  catch (error) {
    deleteError.value = errorMessage(error)
  }
  finally {
    deleting.value = false
  }
}

// ─── Bornes ──────────────────────────────────────────────────────────────────

const FORMAT_NAMES: Record<string, string> = { jpg: 'JPEG', png: 'PNG', webp: 'WebP', avif: 'AVIF' }

function duration(seconds: number): string {
  if (seconds % 86_400 === 0) return t('transforms.limits.days', { count: seconds / 86_400 }, seconds / 86_400)
  if (seconds % 3600 === 0) return t('transforms.limits.hours', { count: seconds / 3600 }, seconds / 3600)
  return t('transforms.limits.seconds', { count: seconds }, seconds)
}
</script>

<template>
  <UiAlert v-if="error" variant="error" live="assertive" :title="t('transforms.loadError')">
    <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
      {{ t('common.retry') }}
    </UiButton>
  </UiAlert>

  <div v-else-if="data" class="grid gap-8">
    <section :aria-labelledby="ids.policy" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
      <component :is="heading" :id="ids.policy" class="text-lg font-semibold text-foreground">
        {{ t('transforms.policy.title') }}
      </component>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">
        {{ t(`transforms.policy.description.${level}`) }}
      </p>
      <form novalidate class="mt-5 grid gap-4" @submit.prevent="savePolicy">
        <UiRadioCards
          v-model="policy"
          :legend="t(`transforms.policy.legend.${level}`)"
          :options="policyOptions"
          :disabled="!canEdit"
          :hint="canEdit ? undefined : t('transforms.policy.readOnly')"
        />
        <UiAlert v-if="policyStatus" :variant="policyStatus.variant" :live="policyStatus.variant === 'error' ? 'assertive' : 'polite'">
          {{ policyStatus.message }}
        </UiAlert>
        <div v-if="canEdit">
          <UiButton type="submit" :loading="savingPolicy">
            {{ t('common.save') }}
          </UiButton>
        </div>
      </form>
    </section>

    <section :aria-labelledby="ids.presets">
      <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div class="grid max-w-3xl gap-1">
          <component :is="heading" :id="ids.presets" tabindex="-1" class="text-lg font-semibold text-foreground">
            {{ t('transforms.presets.title') }}
          </component>
          <p class="text-sm text-muted-foreground">
            <i18n-t keypath="transforms.presets.usage" scope="global" tag="span">
              <template #url>
                <code class="font-mono text-xs break-all text-foreground">/m/&lt;id&gt;/v&lt;n&gt;/&lt;{{ t('transforms.presets.urlName') }}&gt;/&lt;{{ t('transforms.presets.urlFile') }}&gt;.webp</code>
              </template>
            </i18n-t>
          </p>
        </div>
        <UiButton v-if="canEdit && !limitReached" variant="secondary" @click="openCreate">
          <Plus aria-hidden="true" />
          {{ t('transforms.presets.add') }}
        </UiButton>
      </div>

      <UiAlert v-if="presetStatus" :variant="presetStatus.variant" :live="presetStatus.variant === 'error' ? 'assertive' : 'polite'" class="mb-4">
        {{ presetStatus.message }}
      </UiAlert>
      <UiAlert v-if="canEdit && limitReached" variant="warning" class="mb-4">
        {{ t('transforms.errors.PRESET_LIMIT_REACHED', { max: data.limits.presetsMax }) }}
      </UiAlert>

      <ul class="divide-y divide-border rounded-xl border border-border bg-surface">
        <li v-for="preset in data.presets" :key="`${preset.level}-${preset.name}`" class="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div class="grid min-w-0 gap-1">
            <p class="flex flex-wrap items-center gap-2">
              <code class="font-mono text-sm font-semibold break-all text-foreground">{{ preset.name }}</code>
              <UiBadge :variant="preset.level === 'project' ? 'primary' : 'neutral'">
                {{ t(`transforms.presets.levels.${preset.level}`) }}
              </UiBadge>
              <UiBadge v-if="preset.shadowed" variant="warning">
                {{ t('transforms.presets.shadowed') }}
              </UiBadge>
            </p>
            <p class="text-sm text-muted-foreground">
              <span v-if="preset.transformation">
                {{ t('transforms.presets.parameters') }}
                <code class="font-mono text-xs break-all text-foreground">{{ preset.transformation }}</code>
              </span>
              <span v-else>{{ t('transforms.presets.fullDescription') }}</span>
            </p>
            <p v-if="preset.level === 'builtin'" class="text-sm text-muted-foreground">
              {{ t(`transforms.presets.builtin.${preset.name}`) }}
            </p>
            <p v-else-if="preset.description" class="text-sm text-foreground">
              {{ preset.description }}
            </p>
          </div>
          <div v-if="canEdit && preset.level === editableLevel" class="flex flex-wrap gap-2">
            <UiButton variant="outline" size="sm" :aria-label="t('transforms.presets.editLabel', { name: preset.name })" @click="openEdit(preset)">
              <Pencil aria-hidden="true" />
              {{ t('transforms.presets.edit') }}
            </UiButton>
            <UiButton variant="outline" size="sm" :aria-label="t('transforms.presets.deleteLabel', { name: preset.name })" @click="askDelete(preset)">
              <Trash2 aria-hidden="true" />
              {{ t('transforms.presets.delete') }}
            </UiButton>
          </div>
        </li>
      </ul>
      <p v-if="ownPresets.length === 0" class="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <SlidersHorizontal class="size-4 shrink-0" aria-hidden="true" />
        {{ t(`transforms.presets.empty.${level}`) }}
      </p>
    </section>

    <section :aria-labelledby="ids.limits" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
      <component :is="heading" :id="ids.limits" class="text-lg font-semibold text-foreground">
        {{ t('transforms.limits.title') }}
      </component>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ t('transforms.limits.description') }}
      </p>
      <dl class="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('transforms.limits.maxDimension') }}
          </dt>
          <dd class="font-medium text-foreground">
            {{ t('transforms.limits.pixels', { max: data.limits.maxDimension }) }}
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('transforms.limits.formats') }}
          </dt>
          <dd class="font-medium text-foreground">
            {{ data.limits.formats.map(format => FORMAT_NAMES[format] ?? format).join(', ') }}
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('transforms.limits.maxVariants') }}
          </dt>
          <dd class="font-medium text-foreground">
            {{ data.limits.maxVariants }}
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('transforms.limits.rateLimit') }}
          </dt>
          <dd class="font-medium text-foreground">
            {{ data.limits.rateLimit ? t('transforms.limits.perMinute', { count: data.limits.rateLimit }) : t('transforms.limits.unlimited') }}
          </dd>
        </div>
        <div class="grid gap-0.5">
          <dt class="text-muted-foreground">
            {{ t('transforms.limits.presetCache') }}
          </dt>
          <dd class="font-medium text-foreground">
            {{ duration(data.limits.presetMaxAge) }}
          </dd>
        </div>
      </dl>
    </section>

    <UiDialog
      v-model:open="editOpen"
      :title="editing ? t('transforms.presets.editTitle', { name: editing.name }) : t('transforms.presets.createTitle')"
      :description="t('transforms.presets.dialogDescription')"
    >
      <form :id="`${ids.presets}-form`" novalidate class="grid gap-4" @submit.prevent="submitPreset">
        <UiAlert v-if="editError" variant="error" live="assertive">
          {{ editError }}
        </UiAlert>
        <UiFormField
          :id="FIELD_IDS.name"
          v-slot="field"
          :label="t('transforms.presets.fields.name')"
          :hint="editing ? t('transforms.presets.fields.renameHint') : t('transforms.presets.fields.nameHint')"
          :error="message('name')"
          required
        >
          <UiInput v-bind="field" v-model="form.name" name="name" autocomplete="off" spellcheck="false" maxlength="32" @input="clear('name')" />
        </UiFormField>
        <UiFormField :id="FIELD_IDS.description" v-slot="field" :label="t('transforms.presets.fields.description')" :error="message('description')">
          <UiInput v-bind="field" v-model="form.description" name="description" autocomplete="off" :maxlength="PRESET_DESCRIPTION_MAX_LENGTH" @input="clear('description')" />
        </UiFormField>
        <AdminTransformFields v-model="form" :ids="FIELD_IDS" :max-dimension="data.limits.maxDimension" :error="message" @edit="clear" />
        <p class="text-sm text-muted-foreground">
          {{ t('transforms.presets.parameters') }}
          <code class="font-mono text-xs break-all text-foreground">{{ definition ?? '—' }}</code>
        </p>
      </form>
      <template #actions>
        <UiButton variant="outline" @click="editOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" :form="`${ids.presets}-form`" :loading="savingPreset">
          {{ editing ? t('common.save') : t('transforms.presets.create') }}
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog
      v-model:open="deleteOpen"
      :title="t('transforms.presets.deleteTitle', { name: deleteTarget?.name ?? '' })"
      :description="revealsGlobal ? t('transforms.presets.deleteRevealsGlobal') : t('transforms.presets.deleteDescription')"
      :return-focus="deleteReturnFocus"
    >
      <UiAlert v-if="deleteError" variant="error" live="assertive">
        {{ deleteError }}
      </UiAlert>
      <template #actions>
        <UiButton variant="outline" autofocus @click="deleteOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton variant="destructive" :loading="deleting" @click="confirmDelete">
          {{ t('transforms.presets.delete') }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
