<script setup lang="ts">
/**
 * Sous-titres et pistes de texte d'une vidéo (phase D2, architecture § 20.4) : liste, ajout (fichier
 * WebVTT ou SRT, type, langue, libellé, par défaut), modification, remplacement du fichier,
 * téléchargement, suppression. Le serveur vérifie et réécrit chaque fichier ; un fichier refusé l'est
 * avec le numéro de la ligne en cause. Après chaque action, le parent recharge le média (`changed`) et
 * le focus va au message de résultat (le bouton utilisé a pu disparaître).
 */
import { Download, FileText, Pencil, Plus, RefreshCw, Trash2 } from '@lucide/vue'
import { canonicalLanguage, TEXT_TRACK_KINDS, TEXT_TRACK_LABEL_MAX_LENGTH, TEXT_TRACKS_MAX, type TextTrackKind } from '#shared/utils/text-tracks'

interface Track {
  id: string
  kind: TextTrackKind
  language: string
  label: string
  isDefault: boolean
  cueCount: number
  url: string
}

const props = defineProps<{
  mediaId: string
  tracks: readonly Track[]
  canWrite: boolean
}>()

const emit = defineEmits<{ changed: [] }>()

const { t, locale } = useI18n()
const { errorFallback } = useDemoErrors()
const { $api } = useNuxtApp()

/** Langues proposées (les autres : code BCP 47 saisi). */
const COMMON_LANGUAGES = ['fr', 'en', 'es', 'de', 'it', 'pt', 'pt-BR', 'nl', 'ar', 'zh', 'ja', 'ko', 'ru', 'pl', 'tr', 'uk', 'ro', 'sv', 'da', 'nb', 'fi', 'el', 'he', 'hi', 'cs', 'ca'] as const
const OTHER = 'other'

function languageName(code: string, inLocale: string = locale.value): string {
  try {
    return new Intl.DisplayNames([inLocale], { type: 'language' }).of(code) ?? code
  }
  catch {
    return code
  }
}
/** Nom de la langue dans cette langue (« Français », « English ») : libellé proposé par défaut. */
function nativeName(code: string): string {
  const name = languageName(code, code)
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
}

const kindOptions = computed(() => TEXT_TRACK_KINDS.map(kind => ({ value: kind, label: t(`media.tracks.kinds.${kind}`) })))
const languageOptions = computed(() => [
  ...COMMON_LANGUAGES.map(code => ({ value: code, label: languageName(code) })).sort((a, b) => a.label.localeCompare(b.label, locale.value)),
  { value: OTHER, label: t('media.tracks.fields.otherLanguage') },
])

// ─── Statut (focus après chaque action) ──────────────────────────────────────

const status = ref<{ variant: 'success' | 'error', message: string } | null>(null)
const statusEl = useTemplateRef<HTMLElement>('statusEl')
async function announce(variant: 'success' | 'error', message: string) {
  status.value = { variant, message }
  await nextTick()
  statusEl.value?.focus()
}

/** Message d'un refus du serveur. */
function errorMessage(error: unknown): string {
  const response = error as { statusCode?: number, data?: { data?: { code?: string, line?: number | null } } } | null
  const data = response?.data?.data
  if (data?.code === 'INVALID_TEXT_TRACK') {
    return typeof data.line === 'number' ? t('media.tracks.errors.invalidLine', { line: data.line }) : t('media.tracks.errors.invalid')
  }
  if (data?.code === 'TRACK_LIMIT_REACHED') return t('media.tracks.errors.limit', { max: TEXT_TRACKS_MAX })
  if (response?.statusCode === 413) return t('media.tracks.errors.tooLarge')
  if (response?.statusCode === 400) return t('media.tracks.errors.fields')
  return errorFallback(error)
}

// ─── Formulaire (ajout, modification) ────────────────────────────────────────

const dialogOpen = ref(false)
const editing = ref<Track | null>(null)
const busy = ref(false)
const form = reactive({ kind: 'SUBTITLES' as TextTrackKind, language: 'fr', otherLanguage: '', label: '', isDefault: false })
const file = ref<File | null>(null)
const labelEdited = ref(false)
const errors = reactive<{ file?: string, language?: string, label?: string, submit?: string }>({})
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

const languageCode = computed(() => (form.language === OTHER ? form.otherLanguage.trim() : form.language))

/** Libellé pré-rempli avec le nom de la langue, tant qu'il n'a pas été modifié. */
watch(languageCode, (code) => {
  if (!labelEdited.value && code) form.label = canonicalLanguage(code) ? nativeName(canonicalLanguage(code)!) : form.label
})

function openAdd() {
  editing.value = null
  Object.assign(form, { kind: 'SUBTITLES', language: (COMMON_LANGUAGES as readonly string[]).includes(locale.value) ? locale.value : 'fr', otherLanguage: '', isDefault: props.tracks.length === 0 })
  form.label = nativeName(form.language)
  file.value = null
  labelEdited.value = false
  Object.assign(errors, { file: undefined, language: undefined, label: undefined, submit: undefined })
  dialogOpen.value = true
}

function openEdit(track: Track) {
  editing.value = track
  const common = (COMMON_LANGUAGES as readonly string[]).includes(track.language)
  Object.assign(form, { kind: track.kind, language: common ? track.language : OTHER, otherLanguage: common ? '' : track.language, label: track.label, isDefault: track.isDefault })
  labelEdited.value = true
  Object.assign(errors, { file: undefined, language: undefined, label: undefined, submit: undefined })
  dialogOpen.value = true
}

function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  errors.file = undefined
}

function validate(): boolean {
  errors.file = !editing.value && !file.value ? t('media.tracks.errors.fileRequired') : undefined
  errors.language = canonicalLanguage(languageCode.value) ? undefined : t('media.tracks.errors.language')
  const label = form.label.trim()
  errors.label = !label ? t('validation.required') : label.length > TEXT_TRACK_LABEL_MAX_LENGTH ? t('validation.tooLong') : undefined
  return !errors.file && !errors.language && !errors.label
}

async function submit() {
  errors.submit = undefined
  if (!validate()) return
  busy.value = true
  const fields = { kind: form.kind, language: languageCode.value, label: form.label.trim(), isDefault: form.isDefault }
  try {
    if (editing.value) {
      await $api(`/api/admin/media/${props.mediaId}/tracks/${editing.value.id}`, { method: 'PATCH', body: fields })
    }
    else {
      const body = new FormData()
      for (const [key, value] of Object.entries(fields)) body.append(key, String(value))
      body.append('file', file.value!, file.value!.name)
      await $api(`/api/admin/media/${props.mediaId}/tracks`, { method: 'POST', body })
    }
    const message = editing.value ? t('media.tracks.updated') : t('media.tracks.added')
    dialogOpen.value = false
    emit('changed')
    await announce('success', message)
  }
  catch (error) {
    errors.submit = errorMessage(error)
  }
  finally {
    busy.value = false
  }
}

// ─── Remplacement du fichier, suppression ────────────────────────────────────

const replacing = ref<Track | null>(null)
const replaceInput = useTemplateRef<HTMLInputElement>('replaceInput')
function chooseReplacement(track: Track) {
  replacing.value = track
  replaceInput.value?.click()
}
async function onReplacement(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0]
  input.value = ''
  const track = replacing.value
  if (!chosen || !track) return
  status.value = null
  try {
    const body = new FormData()
    body.append('file', chosen, chosen.name)
    await $api(`/api/admin/media/${props.mediaId}/tracks/${track.id}/file`, { method: 'PUT', body })
    emit('changed')
    await announce('success', t('media.tracks.replaced', { label: track.label }))
  }
  catch (error) {
    await announce('error', errorMessage(error))
  }
}

const removing = ref<Track | null>(null)
/** Suppression confirmée : le bouton d'origine disparaît, le focus ira au message de résultat. */
const removeConfirmed = ref(false)
const removeOpen = computed({ get: () => removing.value !== null, set: (value) => { if (!value) removing.value = null } })
async function remove() {
  const track = removing.value
  removeConfirmed.value = true
  removing.value = null
  if (!track) return
  try {
    await $api(`/api/admin/media/${props.mediaId}/tracks/${track.id}`, { method: 'DELETE' })
    emit('changed')
    await announce('success', t('media.tracks.removed', { label: track.label }))
  }
  catch (error) {
    await announce('error', errorMessage(error))
  }
  finally {
    removeConfirmed.value = false
  }
}
</script>

<template>
  <section aria-labelledby="tracks-title" class="grid gap-4 rounded-xl border border-border bg-surface p-6 shadow-xs">
    <div>
      <h2 id="tracks-title" class="text-lg font-semibold text-foreground">
        {{ t('media.tracks.title') }}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ t('media.tracks.description', { max: TEXT_TRACKS_MAX }) }}
      </p>
    </div>

    <ul v-if="tracks.length > 0" class="grid gap-2">
      <li v-for="track in tracks" :key="track.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border px-3 py-2.5">
        <FileText class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span class="break-words">{{ track.label }}</span>
            <UiBadge v-if="track.isDefault">
              {{ t('media.tracks.default') }}
            </UiBadge>
          </p>
          <p class="text-xs text-muted-foreground">
            {{ t(`media.tracks.kinds.${track.kind}`) }} · {{ languageName(track.language) }} ({{ track.language }}) · {{ t('media.tracks.cues', { count: track.cueCount }, track.cueCount) }}
          </p>
        </div>
        <div class="flex flex-wrap gap-1">
          <UiButton :to="track.url" variant="ghost" size="sm" :download="`${track.label}.vtt`" external>
            <Download aria-hidden="true" />
            {{ t('media.tracks.download') }}<span class="sr-only"> : {{ track.label }}</span>
          </UiButton>
          <template v-if="canWrite">
            <UiButton variant="ghost" size="sm" @click="openEdit(track)">
              <Pencil aria-hidden="true" />
              {{ t('media.tracks.edit') }}<span class="sr-only"> : {{ track.label }}</span>
            </UiButton>
            <UiButton variant="ghost" size="sm" @click="chooseReplacement(track)">
              <RefreshCw aria-hidden="true" />
              {{ t('media.tracks.replace') }}<span class="sr-only"> : {{ track.label }}</span>
            </UiButton>
            <UiButton variant="ghost" size="sm" @click="removing = track">
              <Trash2 aria-hidden="true" />
              {{ t('media.tracks.delete') }}<span class="sr-only"> : {{ track.label }}</span>
            </UiButton>
          </template>
        </div>
      </li>
    </ul>
    <p v-else class="text-sm text-muted-foreground">
      {{ t('media.tracks.none') }}
    </p>

    <div v-if="status" ref="statusEl" tabindex="-1" class="rounded-lg">
      <UiAlert :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'">
        {{ status.message }}
      </UiAlert>
    </div>

    <div v-if="canWrite">
      <UiButton variant="secondary" :disabled="tracks.length >= TEXT_TRACKS_MAX" @click="openAdd">
        <Plus aria-hidden="true" />
        {{ t('media.tracks.add') }}
      </UiButton>
      <input ref="replaceInput" type="file" class="hidden" accept=".vtt,.srt,text/vtt" @change="onReplacement">
    </div>

    <UiDialog v-model:open="dialogOpen" :title="editing ? t('media.tracks.editTitle') : t('media.tracks.addTitle')" :description="editing ? undefined : t('media.tracks.addDescription')">
      <form id="track-form" class="grid gap-4" novalidate @submit.prevent="submit">
        <UiAlert v-if="errors.submit" variant="error" live="assertive">
          {{ errors.submit }}
        </UiAlert>
        <UiFormField v-if="!editing" v-slot="field" :label="t('media.tracks.fields.file')" :hint="t('media.tracks.fields.fileHint')" :error="errors.file" required>
          <input
            v-bind="field"
            ref="fileInput"
            type="file"
            accept=".vtt,.srt,text/vtt"
            class="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
            @change="onFile"
          >
        </UiFormField>
        <UiFormField v-slot="field" :label="t('media.tracks.fields.kind')" :hint="t(`media.tracks.kindHints.${form.kind}`)">
          <UiSelect v-bind="field" v-model="form.kind" :options="kindOptions" />
        </UiFormField>
        <UiFormField v-slot="field" :label="t('media.tracks.fields.language')" :error="form.language === OTHER ? undefined : errors.language">
          <UiSelect v-bind="field" v-model="form.language" :options="languageOptions" />
        </UiFormField>
        <UiFormField v-if="form.language === OTHER" v-slot="field" :label="t('media.tracks.fields.languageCode')" :hint="t('media.tracks.fields.languageCodeHint')" :error="errors.language" required>
          <UiInput v-bind="field" v-model="form.otherLanguage" autocomplete="off" spellcheck="false" maxlength="35" />
        </UiFormField>
        <UiFormField v-slot="field" :label="t('media.tracks.fields.label')" :hint="t('media.tracks.fields.labelHint')" :error="errors.label" required>
          <UiInput v-bind="field" v-model="form.label" autocomplete="off" :maxlength="TEXT_TRACK_LABEL_MAX_LENGTH" @input="labelEdited = true" />
        </UiFormField>
        <UiSwitch v-model="form.isDefault" :label="t('media.tracks.fields.default')" :description="t('media.tracks.fields.defaultHint')" />
      </form>
      <template #actions>
        <UiButton variant="outline" @click="dialogOpen = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" form="track-form" :loading="busy">
          {{ editing ? t('common.save') : t('media.tracks.add') }}
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model:open="removeOpen" :return-focus="!removeConfirmed" :title="t('media.tracks.removeTitle')" :description="t('media.tracks.removeDescription', { label: removing?.label ?? '' })">
      <template #actions>
        <UiButton variant="outline" autofocus @click="removing = null">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton variant="destructive" @click="remove">
          {{ t('media.tracks.delete') }}
        </UiButton>
      </template>
    </UiDialog>
  </section>
</template>
