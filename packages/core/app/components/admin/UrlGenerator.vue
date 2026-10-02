<script setup lang="ts">
/**
 * Générateur d'adresses d'une image (fiche média, phase C4) : préréglage de l'espace ou paramètres,
 * format, aperçu rendu à la volée par l'administration (jamais enregistré ni compté dans le quota de
 * dérivés), adresse à copier — signée quand l'espace ou la visibilité l'exige — et extraits HTML
 * (<img>, <picture>, srcset 2x). Les requêtes partent après une courte pause de saisie ; une nouvelle
 * demande annule la précédente. Architecture : .claude/architecture-phase-c.md § 10.
 */
import { LoaderCircle } from '@lucide/vue'
import {
  presetFieldsToDefinition,
  transformFieldsSchema,
  type TransformField,
  type TransformFieldValues,
} from '#shared/schemas/transforms'
import { imageSnippets } from '#shared/utils/snippets'
import type { PresetLevel, TransformFormat, TransformPolicy } from '#shared/utils/transforms'

interface GeneratorOptions {
  policy: TransformPolicy
  presets: { name: string, transformation: string, description: string | null, level: PresetLevel }[]
  formats: readonly TransformFormat[]
  maxDimension: number
}

const props = defineProps<{
  mediaId: string
  /** Version courante : une nouvelle version (point d'intérêt, fichier) change les adresses et l'aperçu. */
  version: number
  width: number
  height: number
  altText: string | null
  visibility: 'PUBLIC' | 'PRIVATE'
  options: GeneratorOptions
  /** Projet du média (lien vers ses préréglages) ; null = bibliothèque. */
  projectId: string | null
}>()

const { t, locale } = useI18n()
const { $api } = useNuxtApp()
const { can } = useAuth()
const uid = useId()

const FORMAT_NAMES: Record<TransformFormat, string> = { jpg: 'JPEG', png: 'PNG', webp: 'WebP', avif: 'AVIF' }
const DURATION_KEYS: Record<(typeof SIGNED_URL_DURATIONS)[number], string> = { 3600: 'hour', 86400: 'day', 604800: 'week' }

// ─── Réglages ────────────────────────────────────────────────────────────────

type Mode = 'params' | 'preset'
const mode = ref<Mode>(props.options.policy === 'PRESETS' ? 'preset' : 'params')
const modeOptions = computed(() => (['params', 'preset'] as const).map(value => ({
  value,
  label: t(`media.generator.modes.${value}.label`),
  description: t(`media.generator.modes.${value}.description`),
})))

const presetName = ref(props.options.presets.find(preset => preset.name === 'preview')?.name ?? props.options.presets[0]?.name ?? '')
const presetOptions = computed(() => props.options.presets.map(preset => ({
  value: preset.name,
  label: t('media.generator.presetOption', { name: preset.name, level: t(`transforms.presets.levels.${preset.level}`) }),
})))
const selectedPreset = computed(() => props.options.presets.find(preset => preset.name === presetName.value) ?? null)

const FIELD_IDS: Record<TransformField, string> = {
  width: `${uid}-width`,
  height: `${uid}-height`,
  fit: `${uid}-fit`,
  gravity: `${uid}-gravity`,
  quality: `${uid}-quality`,
  background: `${uid}-background`,
  rotate: `${uid}-rotate`,
  flip: `${uid}-flip`,
}
const fields = reactive<TransformFieldValues>({
  width: String(Math.min(800, props.width)),
  height: '',
  fit: 'cover',
  gravity: 'focal',
  quality: '',
  background: '',
  rotate: '0',
  flip: '',
})
const parsedFields = computed(() => transformFieldsSchema.safeParse(fields))
/** Erreurs des champs (contrôle immédiat, sans déplacer le focus) : schéma partagé + borne du serveur. */
const fieldErrorMap = computed<Partial<Record<TransformField, FieldError>>>(() => {
  const parsed = parsedFields.value
  if (!parsed.success) return fieldErrors(parsed.error)
  const errors: Partial<Record<TransformField, FieldError>> = {}
  for (const field of ['width', 'height'] as const) {
    if ((parsed.data[field] ?? 0) > props.options.maxDimension) {
      errors[field] = { key: 'validation.integerRange', params: { min: 1, max: props.options.maxDimension } }
    }
  }
  return errors
})
function fieldError(field: TransformField): string | undefined {
  const error = fieldErrorMap.value[field]
  return error ? t(error.key, error.params) : undefined
}

const formatId = `${uid}-format`
const format = ref<TransformFormat>(props.options.formats.includes('webp') ? 'webp' : props.options.formats[0] ?? 'webp')
const formatOptions = computed(() => props.options.formats.map(value => ({ value, label: FORMAT_NAMES[value] })))

const durationId = `${uid}-duration`
const duration = ref(String(SIGNED_URL_DURATIONS[0]))
const durationOptions = computed(() => SIGNED_URL_DURATIONS.map(seconds => ({ value: String(seconds), label: t(`media.links.durations.${DURATION_KEYS[seconds]}`) })))

// ─── Dérivés demandés ────────────────────────────────────────────────────────

type Target = { preset: string } | { transform: string }

/** Préréglage choisi, ou paramètres sous forme canonique ; null tant qu'un champ est invalide. */
const target = computed<Target | null>(() => {
  if (mode.value === 'preset') return presetName.value ? { preset: presetName.value } : null
  const parsed = parsedFields.value
  if (!parsed.success || Object.keys(fieldErrorMap.value).length > 0) return null
  return { transform: presetFieldsToDefinition(parsed.data) }
})

/** Densité 2x (écrans haute résolution) : paramètres avec une dimension que l'image dépasse. */
const target2x = computed<Target | null>(() => {
  const value = target.value
  const parsed = parsedFields.value
  if (!value || !('transform' in value) || !parsed.success) return null
  const quarter = parsed.data.rotate === '90' || parsed.data.rotate === '270'
  const sourceWidth = quarter ? props.height : props.width
  const sourceHeight = quarter ? props.width : props.height
  const { width, height } = parsed.data
  const larger = (width !== null && sourceWidth > width) || (height !== null && sourceHeight > height)
  return larger ? { transform: `${value.transform},dpr_2` } : null
})

// ─── Aperçu et adresses ──────────────────────────────────────────────────────

interface Preview {
  src: string
  width: number
  height: number
  size: number
}
interface Link {
  url: string
  query: string
  expiresAt: string | null
}
type LinkResult = Link | { error: { code: string | null, detail?: string } }

const preview = ref<Preview | null>(null)
const previewError = ref<string>()
const link = ref<Link | null>(null)
const link2x = ref<Link | null>(null)
const linkError = ref<{ code: string | null } | null>(null)
const loading = ref(false)
let controller: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function errorMessage(code: string | null | undefined): string {
  if (code === 'SERVER_BUSY') return t('media.errors.SERVER_BUSY')
  if (code === 'PRESET_NOT_FOUND' || code === 'INVALID_TRANSFORM') return t(`media.generator.errors.${code}`)
  return t('common.unexpectedError')
}

function setPreview(next: Preview | null) {
  if (preview.value) URL.revokeObjectURL(preview.value.src)
  preview.value = next
}

async function loadPreview(request: Target, signal: AbortSignal): Promise<void> {
  const query = new URLSearchParams({ ...request, format: format.value })
  const response = await fetch(`/api/admin/media/${props.mediaId}/transform?${query}`, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { data?: { code?: string } } | null
    setPreview(null)
    previewError.value = errorMessage(body?.data?.code)
    return
  }
  const blob = await response.blob()
  setPreview({
    src: URL.createObjectURL(blob),
    width: Number(response.headers.get('x-transform-width')),
    height: Number(response.headers.get('x-transform-height')),
    size: blob.size,
  })
  previewError.value = undefined
}

async function loadLinks(request: Target, double: Target | null, signal: AbortSignal): Promise<void> {
  const items = [request, ...(double ? [double] : [])].map(item => ({ ...item, format: format.value }))
  const result = await $api<{ items: LinkResult[] }>(`/api/admin/media/${props.mediaId}/links`, {
    method: 'POST',
    body: { items, expiresIn: Number(duration.value) },
    signal,
  })
  const [main, second] = result.items
  link.value = main && 'url' in main ? main : null
  linkError.value = main && 'error' in main ? main.error : null
  link2x.value = second && 'url' in second ? second : null
}

async function refresh() {
  controller?.abort()
  const request = target.value
  if (!request) {
    loading.value = false
    return
  }
  const current = new AbortController()
  controller = current
  loading.value = true
  try {
    await Promise.all([
      loadPreview(request, current.signal),
      loadLinks(request, target2x.value, current.signal).catch((error: unknown) => {
        if (current.signal.aborted) throw error
        link.value = null
        link2x.value = null
        linkError.value = { code: apiError(error).code ?? null }
      }),
    ])
  }
  catch (error) {
    if (current.signal.aborted) return
    setPreview(null)
    previewError.value = errorMessage(apiError(error).code)
  }
  finally {
    if (controller === current) loading.value = false
  }
}

/** Nouvelle demande après une courte pause de saisie. */
function schedule() {
  clearTimeout(timer)
  timer = setTimeout(refresh, 400)
}

watch([target, target2x, format, duration, () => props.version], schedule, { deep: true })
onMounted(refresh)
onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
  setPreview(null)
})

// ─── Présentation ────────────────────────────────────────────────────────────

const stale = computed(() => target.value === null)

/** Résultat réduit faute d'image assez grande (jamais d'agrandissement). */
const reduced = computed(() => {
  const parsed = parsedFields.value
  const result = preview.value
  if (mode.value !== 'params' || !parsed.success || !result) return false
  const { width, height, fit } = parsed.data
  if (width !== null && height !== null && (fit === 'inside' || fit === 'outside')) return false
  return (width !== null && result.width < width) || (height !== null && result.height < height)
})

const caption = computed(() => {
  const result = preview.value
  if (!result) return ''
  return t('media.generator.result', {
    width: result.width,
    height: result.height,
    format: FORMAT_NAMES[format.value],
    size: formatBytes(result.size, locale.value),
  })
})

/** Nature de l'adresse produite. */
const linkKind = computed(() => {
  const value = link.value
  if (!value) return null
  if (value.expiresAt) return 'expiring'
  if (value.query) return 'signed'
  return mode.value === 'preset' && selectedPreset.value?.level !== 'builtin' ? 'preset' : 'permanent'
})

const refused = computed(() => linkError.value?.code === 'TRANSFORM_NOT_ALLOWED')
const presetsLink = computed(() => {
  if (props.projectId) return `/admin/projects/${props.projectId}/transforms`
  return can('settings:manage') ? '/admin/settings' : null
})

// ─── Extraits HTML ───────────────────────────────────────────────────────────

const snippets = computed(() => {
  const main = link.value
  if (!main || stale.value) return []
  return imageSnippets({
    url: main.url,
    url2x: link2x.value?.url,
    width: preview.value?.width,
    height: preview.value?.height,
    alt: props.altText ?? '',
    formats: props.options.formats,
    format: format.value,
  })
})
</script>

<template>
  <section aria-labelledby="generator-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
    <h2 id="generator-title" class="text-lg font-semibold text-foreground">
      {{ t('media.generator.title') }}
    </h2>
    <p class="mt-2 text-sm text-muted-foreground">
      {{ t('media.generator.description') }}
    </p>

    <div class="mt-5 grid gap-5">
      <UiRadioCards v-model="mode" :legend="t('media.generator.mode')" :options="modeOptions" :columns="2" />

      <div v-if="mode === 'preset'" class="grid gap-1.5">
        <UiFormField v-slot="field" :id="`${uid}-preset`" :label="t('media.generator.preset')">
          <UiSelect v-bind="field" v-model="presetName" :options="presetOptions" name="preset" />
        </UiFormField>
        <p v-if="selectedPreset" class="text-sm text-muted-foreground">
          <template v-if="selectedPreset.transformation">
            {{ t('transforms.presets.parameters') }}
            <code class="font-mono text-xs break-all text-foreground">{{ selectedPreset.transformation }}</code>
          </template>
          <template v-else>
            {{ t('transforms.presets.fullDescription') }}
          </template>
          <template v-if="selectedPreset.description">
            — {{ selectedPreset.description }}
          </template>
        </p>
      </div>
      <AdminTransformFields v-else v-model="fields" :ids="FIELD_IDS" :max-dimension="options.maxDimension" :error="fieldError" />

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5">
          <label :for="formatId" class="text-sm font-medium text-foreground">{{ t('media.generator.format') }}</label>
          <UiSelect :id="formatId" v-model="format" :options="formatOptions" name="format" />
        </div>
        <div v-if="visibility === 'PRIVATE'" class="grid gap-1.5">
          <label :for="durationId" class="text-sm font-medium text-foreground">{{ t('media.generator.duration') }}</label>
          <UiSelect :id="durationId" v-model="duration" :options="durationOptions" name="duration" />
        </div>
      </div>

      <!-- Résultat : aperçu (non enregistré) et adresse. -->
      <div class="grid gap-4 border-t border-border pt-5">
        <h3 class="text-base font-semibold text-foreground">
          {{ t('media.generator.resultTitle') }}
        </h3>
        <p v-if="stale" class="text-sm text-foreground">
          {{ t('media.generator.invalid') }}
        </p>

        <figure class="grid gap-2" :aria-busy="loading">
          <div class="bg-checker relative flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-border">
            <img v-if="preview" :src="preview.src" alt="" :width="preview.width" :height="preview.height" class="block h-auto max-h-80 w-auto max-w-full" :class="{ 'opacity-50': loading || stale }">
            <LoaderCircle v-if="loading" class="absolute size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
          <figcaption class="grid gap-0.5 text-sm">
            <span role="status" class="text-foreground">{{ loading ? '' : caption }}</span>
            <span v-if="reduced && !loading" class="text-muted-foreground">{{ t('media.generator.reduced') }}</span>
            <span class="text-muted-foreground">{{ t('media.generator.previewNote') }}</span>
          </figcaption>
        </figure>
        <UiAlert v-if="previewError" variant="error" live="assertive">
          {{ previewError }}
        </UiAlert>

        <UiAlert v-if="refused && !stale" variant="warning" live="polite" :title="t('media.generator.refusedTitle')">
          <p>{{ t('media.generator.refused') }}</p>
          <NuxtLink v-if="presetsLink" :to="presetsLink" class="mt-2 inline-block font-medium text-primary underline underline-offset-4">
            {{ t('media.generator.managePresets') }}
          </NuxtLink>
        </UiAlert>
        <UiAlert v-else-if="linkError && !stale" variant="error" live="assertive">
          {{ errorMessage(linkError.code) }}
        </UiAlert>

        <div v-if="link && !stale" class="grid gap-1">
          <UiCopyField :label="t('media.generator.url')" :value="link.url" />
          <p class="text-sm text-muted-foreground">
            <i18n-t v-if="linkKind === 'expiring' && link.expiresAt" keypath="media.generator.urlExpiring" tag="span" scope="global">
              <template #date>
                <NuxtTime :datetime="link.expiresAt" :locale="locale" date-style="long" time-style="short" class="font-medium text-foreground" />
              </template>
            </i18n-t>
            <template v-else>
              {{ t(`media.generator.urlKinds.${linkKind}`) }}
            </template>
          </p>
        </div>
      </div>

      <!-- Extraits HTML, construits avec les adresses ci-dessus. -->
      <div v-if="snippets.length > 0" class="grid gap-4 border-t border-border pt-5">
        <div class="grid gap-1">
          <h3 class="text-base font-semibold text-foreground">
            {{ t('media.generator.snippetsTitle') }}
          </h3>
          <p class="text-sm text-muted-foreground">
            {{ t('media.generator.snippetsDescription') }}
          </p>
        </div>
        <div v-for="snippet in snippets" :key="snippet.kind" class="grid gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-sm font-medium text-foreground">
              {{ t(`media.generator.snippets.${snippet.kind}.title`) }}
            </h4>
            <UiCopyButton :value="snippet.code" :label="t(`media.generator.snippets.${snippet.kind}.copy`)" />
          </div>
          <p class="text-sm text-muted-foreground">
            {{ t(`media.generator.snippets.${snippet.kind}.description`) }}
          </p>
          <pre class="rounded-lg border border-border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground"><code>{{ snippet.code }}</code></pre>
        </div>
      </div>
    </div>
  </section>
</template>
