<script setup lang="ts">
/**
 * Envoi de fichiers (images, vidéos) avec un jeton délégué `media:upload` (architecture phase E, § 12.4) :
 * champ de fichier natif (clavier, lecteurs d'écran) et, en complément, dépôt et collage ; aide reliée au
 * champ (types et taille maximale par genre, envois restants) ; contrôle avant l'envoi d'après les règles
 * du serveur ; file avec progression, annulation et nouvel essai ; affiche capturée pendant l'envoi d'une
 * vidéo. Une annonce par fichier terminé et un résumé en fin de file (`role="status"`), jamais à chaque
 * pourcentage. Mode `details` : titre et texte alternatif saisis avant l'envoi (un jeton d'envoi ne peut
 * pas modifier un média ensuite). Toute la logique est dans le client : la file (`createUploadQueue`) et
 * son affichage (`uploadHelpLines`, `canRetryUpload`, `uploadStatusText`…).
 */
import {
  awaitingUploads,
  canCancelUpload as canCancel,
  canRemoveUpload as canRemove,
  canRetryUpload as canRetry,
  DEV_MODE,
  formatBytes,
  type Media,
  type MediaKind,
  type MediaVisibility,
  previewableUpload,
  sentUploads,
  showsUploadError,
  showsVisibilityChoice,
  takeSettledUploads,
  type UploadFields,
  type UploadItem,
  uploaderAccept,
  uploaderFields,
  uploaderKinds,
  uploadHelpLines,
  type UploadRules,
  uploadStatusText,
  VISUALLY_HIDDEN,
} from '@surge-media/client'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import { useUploadQueue, useUploadRules } from '../composables/upload'
import { useSurgeMedia } from '../context'
import { IconCircleCheck, IconRotateCcw, IconTrash, IconTriangleAlert, IconUpload, IconX } from '../icons'

const props = withDefaults(defineProps<{
  /** Genres proposés (parmi ceux que les règles acceptent) ; tous par défaut. */
  kinds?: MediaKind[]
  multiple?: boolean
  /** Visibilité des fichiers envoyés (`public` par défaut côté serveur). */
  visibility?: MediaVisibility
  /** Laisser l'utilisateur choisir la visibilité (sauf si le jeton l'impose). */
  chooseVisibility?: boolean
  /** Dossier du projet où ranger les fichiers (sauf si le jeton l'impose). */
  folderId?: string
  /** Titre et texte alternatif saisis avant l'envoi, puis « Envoyer les fichiers ». */
  details?: boolean
  /** Appareil photo du mobile : `user` (avant) ou `environment` (arrière). */
  capture?: 'user' | 'environment'
  /** Envois simultanés. */
  concurrency?: number
  /** Affiche capturée dans le navigateur pendant l'envoi d'une vidéo. */
  posterCapture?: boolean
  /** Confirmation du navigateur avant de quitter la page pendant un envoi. */
  confirmLeave?: boolean
  disabled?: boolean
  /** Règles d'envoi déjà lues ; sinon lues par le client du plugin (`GET /me`). */
  rules?: UploadRules | null
}>(), {
  kinds: undefined,
  multiple: true,
  visibility: undefined,
  folderId: undefined,
  capture: undefined,
  concurrency: 2,
  posterCapture: true,
  confirmLeave: true,
  rules: undefined,
})

const emit = defineEmits<{
  /** Un fichier est envoyé (avec son affiche pour une vidéo). */
  uploaded: [media: Media]
  /** Un fichier est refusé (pré-contrôle) ou son envoi a échoué. */
  error: [item: UploadItem]
  /** Fin de file : médias envoyés depuis la précédente. */
  done: [media: Media[]]
  /** File modifiée. */
  change: [items: readonly UploadItem[]]
}>()

defineSlots<{
  /** Texte du bouton de choix. */
  label?: () => unknown
  /** Aide supplémentaire, sous celle des types acceptés. */
  help?: () => unknown
  /** Ligne d'un fichier de la file (remplace celle par défaut). */
  item?: (props: { item: UploadItem }) => unknown
}>()

const { client, t, locale } = useSurgeMedia()
const loaded = useUploadRules(() => props.rules === undefined)
const rules = computed<UploadRules | null>(() => (props.rules !== undefined ? props.rules : loaded.rules.value))
const ready = computed(() => props.rules !== undefined || loaded.ready.value)
const kinds = computed<MediaKind[]>(() => uploaderKinds(rules.value, props.kinds))
/** Envoi possible : un client, et des règles qui acceptent au moins un genre (inconnues : en attendant, oui). */
const available = computed(() => client !== null && (!ready.value || (rules.value !== null && kinds.value.length > 0)))
const enabled = computed(() => available.value && !props.disabled)

const inputId = useId()
const helpId = useId()
const visibilityId = useId()
const fieldId = useId()
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const announcement = ref('')

/** Annonce polie ; une annonce identique à la précédente est répétée. */
function announce(text: string) {
  announcement.value = ''
  void nextTick(() => {
    announcement.value = text
  })
}

function messageOf(item: UploadItem): string {
  return item.error?.localizedMessage(locale.value) ?? ''
}

/** Médias déjà signalés par `done`. */
const reported = new Set<string>()
const { items, busy, add, update, start, cancel, retry, remove, clear } = useUploadQueue({
  rules,
  kinds: props.kinds,
  concurrency: props.concurrency,
  autoStart: !props.details,
  capturePoster: props.posterCapture,
  onUploaded(media, item) {
    announce(t('upload.announce.done', { name: item.name }))
    emit('uploaded', media)
  },
  onError(item) {
    announce(t('upload.announce.error', { name: item.name, message: messageOf(item) }))
    emit('error', item)
  },
  onSettled(all) {
    const settled = takeSettledUploads(all, reported)
    if (settled.total > 1) announce(t('upload.announce.summary', { done: settled.media.length, failed: settled.failed }))
    emit('done', settled.media)
  },
})
watch(items, next => emit('change', next))

// ─── Champs envoyés ───
const selectedVisibility = ref<MediaVisibility>(props.visibility ?? 'public')
watch(() => props.visibility, (value) => {
  if (value) selectedVisibility.value = value
})
const showVisibility = computed(() => showsVisibilityChoice(rules.value, props.chooseVisibility))

function fields(): UploadFields {
  return uploaderFields(rules.value, {
    visibility: props.visibility,
    chooseVisibility: props.chooseVisibility,
    selectedVisibility: selectedVisibility.value,
    folderId: props.folderId,
  })
}

function addFiles(files: File[]) {
  if (!enabled.value || files.length === 0) return
  add(props.multiple ? files : files.slice(0, 1), fields())
}

function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  addFiles([...(target.files ?? [])])
  target.value = ''
}

// ─── Dépôt et collage (en complément du champ) ───
const dragDepth = ref(0)
const dragging = computed(() => dragDepth.value > 0)
const carriesFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files')

function onDragEnter(event: DragEvent) {
  if (enabled.value && carriesFiles(event)) dragDepth.value++
}

function onDragOver(event: DragEvent) {
  if (event.dataTransfer) event.dataTransfer.dropEffect = enabled.value && carriesFiles(event) ? 'copy' : 'none'
}

function onDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

function onDrop(event: DragEvent) {
  dragDepth.value = 0
  addFiles([...(event.dataTransfer?.files ?? [])])
}

function onPaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files ?? [])]
  if (files.length === 0) return
  event.preventDefault()
  addFiles(files)
}

// ─── Aide : types et taille maximale par genre, envois restants ───
const accept = computed(() => uploaderAccept(rules.value, props.kinds))
const helpLines = computed(() => (ready.value && rules.value ? uploadHelpLines(rules.value, kinds.value, sentUploads(items.value), t, locale.value) : []))

// ─── File (actions possibles : canCancelUpload, canRetryUpload, canRemoveUpload du client) ───
const finished = computed(() => items.value.filter(canRemove).length)

function statusText(item: UploadItem): string {
  return uploadStatusText(item, t, locale.value)
}

/** Mode `details` : fichiers pas encore lancés par « Envoyer les fichiers ». */
const launched = ref(new Set<string>())
const awaiting = computed(() => awaitingUploads(items.value, launched.value))
const editable = (item: UploadItem) => props.details && awaiting.value.includes(item)

function sendAll() {
  launched.value = new Set([...launched.value, ...awaiting.value.map(item => item.id)])
  start()
}

function onField(item: UploadItem, name: 'title' | 'altText', event: Event) {
  update(item.id, { [name]: (event.target as HTMLInputElement).value })
}

/** Ligne à qui rendre le focus (null : le champ de fichier) après une action sur la file. */
let focusTarget: { id: string | null } | null = null

function applyFocus() {
  if (!focusTarget) return
  const row = focusTarget.id ? list.value?.querySelector<HTMLElement>(`[data-upload-id="${focusTarget.id}"] button`) : null
  ;(row ?? input.value)?.focus()
}

/** Focus sur la ligne d'un fichier (son premier bouton), sinon sur le champ de fichier. */
function focusRow(id: string | undefined) {
  focusTarget = { id: id ?? null }
  void nextTick(applyFocus)
}

// Boutons remplacés après coup (annulation, nouvel essai) : le focus perdu revient sur la ligne, une fois.
watch(items, () => {
  if (!focusTarget || typeof document === 'undefined') return
  if (document.activeElement === null || document.activeElement === document.body) applyFocus()
  focusTarget = null
}, { flush: 'post' })

function cancelItem(id: string) {
  cancel(id)
  focusRow(id)
}

function retryItem(id: string) {
  retry(id)
  focusRow(id)
}

function removeItem(id: string) {
  const index = items.value.findIndex(item => item.id === id)
  remove(id)
  focusRow((items.value[index] ?? items.value[index - 1])?.id)
}

function clearFinished() {
  clear()
  focusRow(undefined)
}

// ─── Aperçus locaux des images (décoratifs) ───
const previews = shallowRef(new Map<string, string>())
watch(items, (next) => {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const map = new Map(previews.value)
  for (const item of next) {
    if (!map.has(item.id) && previewableUpload(item)) map.set(item.id, URL.createObjectURL(item.file))
  }
  for (const [id, url] of map) {
    if (next.some(item => item.id === id)) continue
    URL.revokeObjectURL(url)
    map.delete(id)
  }
  previews.value = map
})

/** Aperçu illisible (fichier corrompu, format inconnu du navigateur) : retiré plutôt qu'une image cassée. */
function dropPreview(id: string) {
  const url = previews.value.get(id)
  if (!url) return
  URL.revokeObjectURL(url)
  const map = new Map(previews.value)
  map.set(id, '')
  previews.value = map
}

// ─── Quitter la page pendant un envoi : confirmation du navigateur (son propre message) ───
function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ''
}
watch(busy, (value) => {
  if (typeof window === 'undefined' || !props.confirmLeave) return
  if (value) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
})

let warned = false
watch(() => ready.value && !available.value, (unavailable) => {
  if (!unavailable || warned || !DEV_MODE) return
  warned = true
  console.warn('[surge-media] SmUploader: this credential cannot upload files. Give the plugin delegated tokens with the media:upload scope (UPLOAD_SCOPES of @surge-media/client/server).')
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload)
  for (const url of previews.value.values()) URL.revokeObjectURL(url)
})
</script>

<template>
  <div class="sm-uploader" :class="{ 'sm-uploader--dragging': dragging, 'sm-uploader--disabled': !enabled }">
    <p v-if="!available" class="sm-uploader__unavailable">
      {{ t('upload.unavailable') }}
    </p>
    <template v-else>
      <div
        class="sm-uploader__zone"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
        @paste="onPaste"
      >
        <IconUpload class="sm-uploader__icon" :size="24" />
        <div class="sm-uploader__pick">
          <input
            :id="inputId"
            ref="input"
            class="sm-uploader__input"
            type="file"
            :accept="accept"
            :multiple="props.multiple"
            :capture="props.capture"
            :disabled="!enabled"
            :aria-describedby="helpLines.length > 0 ? helpId : undefined"
            :style="VISUALLY_HIDDEN"
            @change="onChange"
          >
          <label :for="inputId" class="sm-uploader__button">
            <slot name="label">{{ props.multiple ? t('upload.choose') : t('upload.chooseOne') }}</slot>
          </label>
          <span class="sm-uploader__drop">{{ props.multiple ? t('upload.drop') : t('upload.dropOne') }}</span>
        </div>
        <p v-if="helpLines.length > 0" :id="helpId" class="sm-uploader__help">
          <span v-for="line in helpLines" :key="line.key">{{ line.text }}</span>
        </p>
        <slot name="help" />
      </div>

      <div v-if="showVisibility" class="sm-uploader__field">
        <label :for="visibilityId">{{ t('upload.visibility.label') }}</label>
        <select :id="visibilityId" v-model="selectedVisibility" :disabled="!enabled">
          <option value="public">
            {{ t('upload.visibility.public') }}
          </option>
          <option value="private">
            {{ t('upload.visibility.private') }}
          </option>
        </select>
      </div>
    </template>

    <ul v-if="items.length > 0" ref="list" class="sm-uploader__list" :aria-label="t('upload.queue')">
      <li
        v-for="item in items"
        :key="item.id"
        :data-upload-id="item.id"
        class="sm-uploader__item"
        :class="`sm-uploader__item--${item.status}`"
      >
        <slot name="item" :item="item">
          <img
            v-if="previews.get(item.id)"
            class="sm-uploader__preview"
            :src="previews.get(item.id)"
            alt=""
            width="48"
            height="48"
            @error="dropPreview(item.id)"
          >
          <div class="sm-uploader__body">
            <p class="sm-uploader__meta">
              <span class="sm-uploader__name" :title="item.name">{{ item.name }}</span>
              <span class="sm-uploader__size">{{ formatBytes(item.size, locale) }}</span>
            </p>
            <progress
              v-if="item.status === 'uploading' || item.status === 'poster'"
              class="sm-uploader__progress"
              max="1"
              :value="item.progress ?? undefined"
              :aria-label="t('upload.progress', { name: item.name })"
            />
            <p class="sm-uploader__state">
              <IconCircleCheck v-if="item.status === 'done'" class="sm-uploader__state-icon" />
              <IconTriangleAlert v-else-if="item.status === 'error'" class="sm-uploader__state-icon" />
              <span>{{ statusText(item) }}</span>
            </p>
            <p v-if="showsUploadError(item)" class="sm-uploader__error">
              {{ messageOf(item) }}
            </p>
            <div v-if="editable(item)" class="sm-uploader__details">
              <div class="sm-uploader__field">
                <label :for="`${fieldId}-${item.id}-title`">
                  {{ t('upload.details.title') }}
                  <span :style="VISUALLY_HIDDEN">{{ t('upload.details.ofFile', { name: item.name }) }}</span>
                </label>
                <input
                  :id="`${fieldId}-${item.id}-title`"
                  type="text"
                  maxlength="191"
                  :value="item.fields.title ?? ''"
                  @input="onField(item, 'title', $event)"
                >
              </div>
              <div v-if="item.kind === 'image'" class="sm-uploader__field">
                <label :for="`${fieldId}-${item.id}-alt`">
                  {{ t('upload.details.altText') }}
                  <span :style="VISUALLY_HIDDEN">{{ t('upload.details.ofFile', { name: item.name }) }}</span>
                </label>
                <input
                  :id="`${fieldId}-${item.id}-alt`"
                  type="text"
                  maxlength="191"
                  :aria-describedby="`${fieldId}-${item.id}-alt-hint`"
                  :value="item.fields.altText ?? ''"
                  @input="onField(item, 'altText', $event)"
                >
                <span :id="`${fieldId}-${item.id}-alt-hint`" class="sm-uploader__hint">{{ t('upload.details.altHint') }}</span>
              </div>
            </div>
          </div>
          <div class="sm-uploader__actions">
            <button
              v-if="canCancel(item)"
              type="button"
              class="sm-uploader__action"
              :aria-label="t('upload.actions.cancelFile', { name: item.name })"
              @click="cancelItem(item.id)"
            >
              <IconX /><span>{{ t('upload.actions.cancel') }}</span>
            </button>
            <button
              v-if="canRetry(item)"
              type="button"
              class="sm-uploader__action"
              :aria-label="t('upload.actions.retryFile', { name: item.name })"
              @click="retryItem(item.id)"
            >
              <IconRotateCcw /><span>{{ t('upload.actions.retry') }}</span>
            </button>
            <button
              v-if="canRemove(item)"
              type="button"
              class="sm-uploader__action"
              :aria-label="t('upload.actions.removeFile', { name: item.name })"
              @click="removeItem(item.id)"
            >
              <IconTrash /><span>{{ t('upload.actions.remove') }}</span>
            </button>
          </div>
        </slot>
      </li>
    </ul>

    <div v-if="(props.details && awaiting.length > 0) || (finished > 0 && !busy)" class="sm-uploader__footer">
      <button v-if="props.details && awaiting.length > 0" type="button" class="sm-uploader__button" :disabled="!enabled" @click="sendAll">
        {{ t('upload.details.send') }}
      </button>
      <button v-if="finished > 0 && !busy" type="button" class="sm-uploader__action" @click="clearFinished">
        {{ t('upload.actions.clear') }}
      </button>
    </div>

    <span role="status" :style="VISUALLY_HIDDEN">{{ announcement }}</span>
  </div>
</template>
