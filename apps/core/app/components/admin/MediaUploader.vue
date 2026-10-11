<script setup lang="ts">
/**
 * Envoi de médias (images, vidéos) : bouton « Choisir des fichiers » (champ natif, utilisable au
 * clavier et par les lecteurs d'écran) et glisser-déposer en complément. Envois un par un avec
 * progression ; chaque résultat est annoncé (role="status"). Formats et taille maximale indiqués par
 * genre ; quitter la page pendant un envoi demande une confirmation (envoi de vidéo long). Vidéo
 * créée : une image d'affiche est capturée dans le navigateur pendant l'envoi puis jointe au média
 * (phase D2) ; si le navigateur ne sait pas décoder la vidéo, elle reste sans affiche.
 * Traitement des vidéos actif (phase D3) : les formats convertis après l'envoi (MKV, AVI…) ont leur
 * propre ligne d'aide et leurs extensions dans `accept` ; inactif, rien ne change.
 *
 *   création     : <AdminMediaUploader :rules="rules" @uploaded="refresh" />
 *   remplacement : <AdminMediaUploader :rules="rules" :endpoint="`/api/admin/media/${id}/file`" method="PUT" :multiple="false" :kinds="[kind]" />
 */
import { CircleAlert, CircleCheck, Upload } from '@lucide/vue'
import type { CapturedFrame } from '~/utils/video-frame'

interface QueueItem {
  key: number
  name: string
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  message?: string
}

const props = withDefaults(defineProps<{
  rules: MediaRules
  endpoint?: string
  method?: 'POST' | 'PUT'
  multiple?: boolean
  /** Choix de la visibilité des fichiers envoyés (création uniquement). */
  withVisibility?: boolean
  /** Champs ajoutés à chaque envoi (ex. dossier de destination). */
  fields?: Record<string, string>
  /** Genres acceptés (remplacement : celui du média) ; tous par défaut. */
  kinds?: readonly string[]
}>(), {
  endpoint: '/api/admin/media',
  method: 'POST',
  multiple: true,
  withVisibility: true,
})

const emit = defineEmits<{
  uploaded: [media: { id: string, originalName: string }]
  /** Fin de la file d'envoi (au moins un fichier traité). */
  done: []
}>()

const { t, locale } = useI18n()
const { $api } = useNuxtApp()
const { send, precheck, errorMessage, acceptAttribute, acceptedExtensions, convertedExtensions, kindsOf, maxSizeFor } = useMediaUpload()

const inputId = useId()
const helpId = useId()
const visibilityId = useId()
const dragging = ref(false)
const visibility = ref<MediaVisibility>('PUBLIC')
const queue = ref<QueueItem[]>([])
const announcement = ref('')
const busy = computed(() => queue.value.some(item => item.status === 'pending' || item.status === 'uploading'))
let nextKey = 0

/** Affiche capturée pour les vidéos créées (pas pour un remplacement : l'affiche existante est gardée). */
const capturesPoster = computed(() => props.method === 'POST')
const isVideoFile = (file: File) => file.type.startsWith('video/') || /.(?:mp4|m4v|mov|webm)$/i.test(file.name)

/** Joint l'image capturée au média créé ; un échec laisse la vidéo sans affiche (ajoutable depuis sa fiche). */
async function attachPoster<T extends { id: string }>(media: T, capture: Promise<CapturedFrame | null>): Promise<T> {
  const frame = await capture
  if (!frame) return media
  const form = new FormData()
  form.append('time', String(Math.round(frame.time * 1000) / 1000))
  form.append('file', frame.blob, 'poster.jpg')
  try {
    return (await $api<{ media: T }>(`/api/admin/media/${media.id}/poster`, { method: 'PUT', body: form })).media
  }
  catch {
    return media
  }
}

const accept = computed(() => acceptAttribute(props.rules, props.kinds))
/** Formats convertis après l'envoi (traitement des vidéos actif), présentés sur leur propre ligne. */
const converted = computed(() => convertedExtensions(props.rules, props.kinds))
/** Une ligne par genre : formats et taille maximale ; puis les formats convertis, s'il y en a. */
const constraints = computed(() => [
  ...kindsOf(props.rules, props.kinds).map(kind => ({
    key: kind,
    text: t(`media.upload.constraintsByKind.${kind}`, {
      types: acceptedExtensions(props.rules, [kind], { withConverted: false }),
      max: formatBytes(maxSizeFor(props.rules, kind), locale.value),
    }),
  })),
  ...(converted.value.length > 0
    ? [{ key: 'converted', text: t('media.upload.converted', { types: converted.value.map(extension => extension.toUpperCase()).join(', ') }) }]
    : []),
])
const visibilityOptions = computed(() => MEDIA_VISIBILITIES.map(value => ({ value, label: t(`media.visibility.${value}.label`) })))

async function enqueue(files: File[]) {
  const selected = props.multiple ? files : files.slice(0, 1)
  if (selected.length === 0) return
  const items = selected.map(file => ({ file, item: reactive<QueueItem>({ key: nextKey++, name: file.name, progress: 0, status: 'pending' }) }))
  queue.value = [...items.map(({ item }) => item), ...queue.value].slice(0, 20)

  for (const { file, item } of items) {
    const invalid = precheck(file, props.rules, props.kinds)
    if (invalid) {
      Object.assign(item, { status: 'error', message: invalid })
      announcement.value = t('media.upload.failed', { name: item.name, message: invalid })
      continue
    }
    item.status = 'uploading'
    // Capture en parallèle de l'envoi : rien n'est envoyé pour la faire.
    const poster = capturesPoster.value && isVideoFile(file) ? captureVideoFile(file) : null
    try {
      const fields: Record<string, string> = { ...props.fields, ...(props.withVisibility ? { visibility: visibility.value } : {}) }
      const result = await send(props.endpoint, file, fields, { method: props.method, onProgress: percent => (item.progress = percent) })
      if (result.status >= 200 && result.status < 300) {
        let media = (result.body as { media: { id: string, originalName: string } }).media
        if (poster) media = await attachPoster(media, poster)
        Object.assign(item, { status: 'done', progress: 100 })
        announcement.value = t('media.upload.succeeded', { name: item.name })
        emit('uploaded', media)
      }
      else {
        const message = errorMessage(result, props.rules, props.kinds)
        Object.assign(item, { status: 'error', message })
        announcement.value = t('media.upload.failed', { name: item.name, message })
      }
    }
    catch {
      const message = t('media.errors.network')
      Object.assign(item, { status: 'error', message })
      announcement.value = t('media.upload.failed', { name: item.name, message })
    }
  }
  emit('done')
}

function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  enqueue([...(input.files ?? [])])
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  enqueue([...(event.dataTransfer?.files ?? [])])
}

// Fermeture ou rechargement de l'onglet pendant un envoi : le navigateur demande confirmation (son
// propre message, dans sa langue). La navigation dans l'administration n'interrompt pas l'envoi.
function confirmLeave(event: BeforeUnloadEvent) {
  event.preventDefault()
}
watch(busy, (value) => {
  if (value) window.addEventListener('beforeunload', confirmLeave)
  else window.removeEventListener('beforeunload', confirmLeave)
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', confirmLeave))
</script>

<template>
  <div class="grid gap-4">
    <div
      :class="cn(
        'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-input bg-surface px-6 py-8 text-center transition-colors',
        dragging && 'border-primary bg-primary-soft',
      )"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <Upload class="size-8 text-muted-foreground" aria-hidden="true" />
      <p class="text-sm text-foreground">
        {{ multiple ? t('media.upload.dropHint') : t('media.upload.dropHintSingle') }}
      </p>
      <div>
        <input
          :id="inputId"
          type="file"
          class="peer sr-only"
          :accept="accept"
          :multiple="multiple"
          :disabled="busy"
          :aria-describedby="helpId"
          @change="onChange"
        >
        <label
          :for="inputId"
          :class="cn(
            'inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover',
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
            'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
          )"
        >
          {{ multiple ? t('media.upload.choose') : t('media.upload.chooseSingle') }}
        </label>
      </div>
      <p :id="helpId" class="grid gap-0.5 text-sm text-muted-foreground">
        <span v-for="line in constraints" :key="line.key">{{ line.text }}</span>
      </p>
    </div>

    <div v-if="withVisibility" class="flex flex-wrap items-center gap-3">
      <label :for="visibilityId" class="text-sm font-medium text-foreground">{{ t('media.upload.visibility') }}</label>
      <UiSelect :id="visibilityId" v-model="visibility" :options="visibilityOptions" class="w-44" />
    </div>

    <ul v-if="queue.length > 0" class="grid gap-2" :aria-label="t('media.upload.queue')">
      <li v-for="item in queue" :key="item.key" class="grid gap-1.5 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <div class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate font-medium text-foreground" :title="item.name">{{ item.name }}</span>
          <span v-if="item.status === 'done'" class="flex shrink-0 items-center gap-1 text-success">
            <CircleCheck class="size-4" aria-hidden="true" />{{ t('media.upload.statusDone') }}
          </span>
          <span v-else-if="item.status === 'error'" class="flex shrink-0 items-center gap-1 text-destructive">
            <CircleAlert class="size-4" aria-hidden="true" />{{ t('media.upload.statusError') }}
          </span>
          <span v-else class="shrink-0 text-muted-foreground">{{ item.status === 'pending' ? t('media.upload.statusPending') : formatPercent(item.progress, locale) }}</span>
        </div>
        <progress
          v-if="item.status === 'uploading' || item.status === 'pending'"
          class="h-1.5 w-full overflow-hidden rounded-full accent-primary"
          :value="item.progress"
          max="100"
          :aria-label="t('media.upload.progress', { name: item.name })"
        />
        <p v-if="item.message" class="text-destructive">
          {{ item.message }}
        </p>
      </li>
    </ul>

    <p class="sr-only" role="status">
      {{ announcement }}
    </p>
  </div>
</template>
