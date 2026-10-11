<script setup lang="ts">
import { ArchiveRestore, ArrowLeft, Camera, Copy, Download, Film, FolderInput, ImageUp, Link2, Trash2 } from '@lucide/vue'
import { type ProcessingSnapshot, processingInProgress, useProcessingPoll } from '~/composables/useProcessingPoll'
import { processingNeedsReload } from '~/utils/processing-view'
import { MEDIA_TEXT_MAX_LENGTH, mediaMetadataSchema } from '#shared/schemas/media'
import { videoSnippet } from '#shared/utils/snippets'
import { htmlTrackKind } from '#shared/utils/text-tracks'
import { codecLabel, videoMetadata } from '#shared/utils/video'
import { deliveryHeld } from '#shared/utils/video-processing'

// Accès décidé par l'espace du média (bibliothèque ou projet) : vérifié par l'API (404 sinon).
definePageMeta({ layout: 'admin' })

interface StatusMessage {
  variant: 'success' | 'error'
  message: string
}

const { t, locale } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()
const flash = useFlash()

const mediaId = computed(() => String(route.params.id))
const { data, error, refresh } = await useApiFetch(() => `/api/admin/media/${mediaId.value}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Media not found', fatal: true })
}
const { data: rules } = await useApiFetch('/api/admin/config/media')

const media = computed(() => data.value?.media)
const displayName = computed(() => media.value?.title || media.value?.originalName || '')
const inTrash = computed(() => Boolean(media.value?.deletedAt))

// ─── Vidéo (phase D : MP4/MOV préparés à l'envoi, traitement par ffmpeg en D3) ───

const isVideo = computed(() => media.value?.kind === 'VIDEO')
const video = computed(() => (isVideo.value ? videoMetadata(media.value?.metadata) : null))
const videoDescriptionId = useId()
/** Tâche en attente ou en cours (avancement suivi, « Optimiser » masqué, avertissements adaptés). */
const processingRunning = computed(() => isVideo.value && processingInProgress(media.value?.processingState))
/**
 * Tâche qui avance vraiment : en attente ou en cours, hors corbeille (la mise à la corbeille annule la
 * tâche et garde l'état ; la section « Traitement » la dit interrompue). Textes « en préparation ».
 */
const processingLive = computed(() => processingRunning.value && !inTrash.value)
const processingEnabled = computed(() => rules.value?.videoProcessing.active ?? false)
/** Rendu H.264 présent : la vidéo est lue partout, quel que soit le codec de l'original. */
const hasH264 = computed(() => media.value?.renditions.some(rendition => rendition.name === 'h264') ?? false)
/**
 * Rendu H.264 attendu de la tâche en cours pour une vidéo lue selon les navigateurs : traitement actif,
 * rendu permis (NUXT_VIDEO_RENDITION=never : formats convertis seulement) et durée dans la limite
 * (au-delà, la tâche échoue « trop longue » sans rendu).
 */
const h264Expected = computed(() => {
  const config = rules.value?.videoProcessing
  const duration = media.value?.duration ?? null
  if (!processingLive.value || !config?.active || config.rendition === 'never') return false
  return duration === null || duration <= config.maxDuration
})

const player = useTemplateRef<HTMLVideoElement>('player')
/**
 * Lecteur : `<source>` dans l'ordre de `sources` (rendus AV1 puis H.264, ou l'original lisible). Clé =
 * leurs adresses : le lecteur n'est recréé que si elles changent (rendu prêt, nouvelle version), pas à
 * chaque rechargement de la fiche (liens « admin » stables pendant une heure).
 * Changement pendant une lecture, ou quand le lecteur a le focus (rechargement par le suivi du
 * traitement) : reporté à la pause, à la fin ou à la sortie du focus, et repris au même moment de la
 * vidéo (même contenu : copie sans perte ou rendu) ; la lecture n'est pas coupée, le focus pas perdu.
 * Autre média, ou plus aucune source lisible : tout de suite.
 */
const playerSources = shallowRef(media.value?.sources ?? [])
let playerMediaId = media.value?.id
/** Moment de la vidéo à reprendre dans le lecteur recréé (s), ou 0. */
let resumeAt = 0

function playerInUse(): boolean {
  const element = player.value
  return Boolean(element && ((!element.paused && !element.ended) || element === document.activeElement))
}

function sourcesSignature(sources: readonly { url: string }[]): string {
  return sources.map(source => source.url).join(' ')
}

function syncPlayerSources() {
  const value = media.value
  const next = value?.sources ?? []
  const sameMedia = value?.id === playerMediaId
  // Mêmes adresses : lecteur gardé tel quel.
  if (sameMedia && sourcesSignature(next) === sourcesSignature(playerSources.value)) return
  if (sameMedia && next.length > 0 && playerInUse()) return
  resumeAt = sameMedia && player.value && !player.value.ended ? player.value.currentTime : 0
  playerMediaId = value?.id
  playerSources.value = next
}
watch(() => media.value?.sources, syncPlayerSources)

function onPlayerMetadata() {
  if (resumeAt > 0 && player.value) player.value.currentTime = resumeAt
  resumeAt = 0
}

const sourcesKey = computed(() => sourcesSignature(playerSources.value))
const playable = computed(() => playerSources.value.length > 0)
/**
 * Section « Traitement » : état connu, rendus, ou première fois proposée (traitement actif, droit d'écrire,
 * hors corbeille). Vidéo jamais traitée sans rien à proposer : pas de section.
 */
const showProcessing = computed(() => {
  const value = media.value
  if (!isVideo.value || !value) return false
  return value.processingState !== null || value.renditions.length > 0 || (processingEnabled.value && canWrite.value && !inTrash.value)
})
/** MP4/MOV : seuls formats préparés (index en tête, métadonnées d'origine retirées). */
const preparable = computed(() => video.value?.container === 'mp4' || video.value?.container === 'mov')
const preparation = computed<readonly string[]>(() => rules.value?.videoPreparation ?? [])

/** État de la préparation : jamais examinée, rien à faire, ou opérations faites. */
const preparationLabel = computed(() => {
  const prepared = video.value?.prepared
  if (prepared === null || prepared === undefined) return t('media.detail.preparationValues.none')
  if (prepared.length === 0) return t('media.detail.preparationValues.unchanged')
  return prepared.map(operation => t(`media.detail.preparationValues.${operation}`)).join(' · ')
})

/**
 * Format converti pas encore analysé par le traitement (ou dont l'analyse a échoué) : codecs et son
 * inconnus — l'analyse de l'envoi n'en lit rien (« Vidéo : ? », « Sans son » seraient faux).
 */
const analysed = computed(() => video.value !== null && !(video.value.playback === 'none' && video.value.videoCodec === null))

/** Codecs lisibles (« Vidéo : H.264 », « Son : AAC » ou « Sans son »). */
const codecLines = computed(() => {
  const meta = video.value
  if (!meta) return []
  if (!analysed.value) return [t('media.detail.notAnalysed')]
  return [
    t('media.detail.videoTrack', { codec: codecLabel(meta.videoCodec) }),
    meta.audioCodec ? t('media.detail.audioTrack', { codec: codecLabel(meta.audioCodec) }) : t('media.detail.noAudio'),
  ]
})

interface VideoNotice {
  key: string
  variant: 'info' | 'warning'
  title: string
  text: string
}

/**
 * Points d'attention d'une vidéo : compatibilité (et rendu en préparation), format converti, pistes de
 * données de l'appareil, HDR, lieu de tournage, index, sous-titres, durée.
 */
const videoNotices = computed(() => {
  const meta = video.value
  const value = media.value
  if (!meta || !value) return []
  const notices: VideoNotice[] = []
  const add = (key: string, variant: VideoNotice['variant'], title: string, text: string) => notices.push({ key, variant, title, text })
  const codec = codecLabel(meta.videoCodec)
  // Format converti (MKV, AVI…) : jamais lu tel quel, seulement par son rendu H.264.
  if (meta.playback === 'none' && !hasH264.value) {
    if (value.processingState === 'FAILED') add('convertFailed', 'warning', t('media.video.notices.convertFailed.title'), t('media.video.notices.convertFailed.text'))
    else add('converting', 'info', t('media.video.notices.converting.title'), t('media.video.notices.converting.text'))
  }
  // Codec lu selon le navigateur : sans objet dès que le rendu H.264 existe, « en préparation » tant que
  // la tâche en cours doit le produire.
  if (meta.playback === 'variable' && !hasH264.value) {
    if (h264Expected.value) add('compatPending', 'info', t('media.video.notices.compatPending.title'), t('media.video.notices.compatPending.text', { codec }))
    else add('variable', 'warning', t('media.video.notices.variable.title'), t('media.video.notices.variable.text', { codec }))
  }
  // Pistes de données (positions GPS…) : diffusion retenue (503) jusqu'à leur retrait par le traitement,
  // puis l'avertissement disparaît (la réécriture les retire des métadonnées).
  if (meta.dataTracks.length > 0) {
    // Même règle que la diffusion (503 tant que le retrait est en attente ou en cours, traitement actif) ;
    // dans la corbeille, rien n'est servi ni retiré (tâche annulée).
    const held = !inTrash.value && rules.value ? deliveryHeld(value, rules.value.videoProcessing.mode) : false
    const exposed = value.visibility === 'PUBLIC' && !inTrash.value
    const text = held
      ? t(value.visibility === 'PUBLIC' ? 'media.video.notices.dataTracks.held' : 'media.video.notices.dataTracks.heldPrivate')
      : value.processingState === 'FAILED' ? t('media.video.notices.dataTracks.failed') : t('media.video.notices.dataTracks.text')
    add('dataTracks', held || exposed ? 'warning' : 'info', t('media.video.notices.dataTracks.title'), text)
  }
  // HDR : couleurs converties en SDR pour le rendu, ou rendu fait sans conversion (filtres absents),
  // d'après la dernière tâche terminée, qui a produit le rendu présent. Tâche en attente, en cours ou en
  // échec : rien (rendu absent, ou fait par une tâche précédente avec d'autres réglages).
  const job = value.processing
  if (hasH264.value && job?.status === 'DONE') {
    if (job.warnings.includes('hdr_unconverted')) add('hdrUnconverted', 'warning', t('media.video.notices.hdrUnconverted.title'), t('media.video.notices.hdrUnconverted.text'))
    else if (job.warnings.includes('hdr_converted')) add('hdr', 'info', t('media.video.notices.hdr.title'), t('media.video.notices.hdr.text'))
  }
  if (meta.hasLocation) add('location', value.visibility === 'PUBLIC' ? 'warning' : 'info', t('media.video.notices.location.title'), t('media.video.notices.location.text'))
  // Envoyée avant la préparation automatique : l'appareil peut figurer dans le fichier.
  else if (canPrepare.value && preparation.value.includes('metadata')) add('device', 'info', t('media.video.notices.device.title'), t('media.video.notices.device.text'))
  if (meta.faststart === false) add('faststart', 'info', t('media.video.notices.faststart.title'), t('media.video.notices.faststart.text'))
  // Son sans sous-titres : WCAG 1.2.2 (sous-titres des contenus préenregistrés). Format converti pas
  // encore analysé : présence du son inconnue.
  if (analysed.value && meta.hasAudio && !value.textTracks.some(track => track.kind === 'SUBTITLES' || track.kind === 'CAPTIONS')) {
    add('captions', 'info', t('media.video.notices.captions.title'), t('media.video.notices.captions.text'))
  }
  // Format converti : durée inconnue jusqu'à l'analyse par le traitement (pas un défaut du fichier).
  if (value.duration === null) {
    if (meta.playback !== 'none') add('duration', 'info', t('media.video.notices.duration.title'), t('media.video.notices.duration.text'))
  }
  else if (meta.durationEstimated) add('estimated', 'info', t('media.video.notices.estimated.title'), t('media.video.notices.estimated.text'))
  return notices
})

/** Source de l'aperçu et des dérivés : l'image elle-même, ou l'affiche d'une vidéo. */
const derivedSize = computed(() => {
  const value = media.value
  if (!value) return null
  if (value.kind === 'VIDEO') return value.poster ? { width: value.poster.width, height: value.poster.height } : null
  return value.width && value.height ? { width: value.width, height: value.height } : null
})

/** Compte à l'origine de l'envoi ; sans compte, une application (clé d'API) ou un auteur supprimé. */
const uploaderName = computed(() => {
  const value = media.value
  if (value?.uploadedBy) return value.uploadedBy.name || value.uploadedBy.email
  return value?.uploadedByToken ? t('media.detail.apiUploader') : t('media.detail.unknownUploader')
})

useSeoMeta({ title: () => displayName.value || t('media.list.title') })

// ─── Espace et droits ────────────────────────────────────────────────────────

const space = computed(() => data.value?.space)
const project = computed(() => space.value?.project ?? null)
const scopes = computed<readonly string[]>(() => data.value?.scopes ?? [])
const canWrite = computed(() => scopes.value.includes('media:write'))
const canDelete = computed(() => scopes.value.includes('media:delete'))
/**
 * « Optimiser » : vidéo MP4/MOV jamais examinée (envoyée avant D2), préparation activée sur le serveur.
 * Masqué pendant un traitement : le nouveau fichier annulerait la tâche en cours.
 */
const canPrepare = computed(() => canWrite.value && !inTrash.value && preparable.value && preparation.value.length > 0
  && video.value?.prepared === null && !processingRunning.value)
const spaceLabel = computed(() => (project.value ? t('space.project', { name: project.value.name }) : t('space.library')))

/** Liste d'où l'on vient : médias du projet ou bibliothèque (corbeille le cas échéant). */
const listPath = computed(() => (project.value ? `/admin/projects/${project.value.id}/media` : '/admin/media'))
const backLink = computed(() => (inTrash.value
  ? { path: listPath.value, query: { status: 'trash' } }
  : { path: listPath.value, query: { folder: media.value?.folderId ?? undefined } }))

// Dossiers de l'espace du média (dossier affiché dans les informations, choix de rangement).
const { data: spaceFolders } = await useApiFetch('/api/admin/folders', { query: computed(() => ({ project: project.value?.id })) })
const spaceFolderIndex = computed(() => indexFolders(spaceFolders.value?.folders ?? []))
const folderPath = computed(() => (media.value?.folderId ? folderPathLabel(spaceFolderIndex.value, media.value.folderId) : ''))

// Barre latérale : la fiche d'un média de projet relève de la section Projets.
const section = useAdminSection()
watch(project, (value) => {
  section.value = value ? '/admin/projects' : null
}, { immediate: true })
onBeforeUnmount(() => {
  section.value = null
})

// ─── Métadonnées ─────────────────────────────────────────────────────────────

const FIELD_IDS = { title: 'media-title', altText: 'media-alt', visibility: 'media-visibility' } as const
const form = reactive<{ title: string, altText: string, visibility: MediaVisibility | '' }>({ title: '', altText: '', visibility: '' })
// Recopié seulement quand le média ou ces valeurs changent sur le serveur : le suivi du traitement et
// les rechargements qui ne les touchent pas (affiche, pistes, rendu prêt…) gardent la saisie en cours.
// Sources séparées : chaque valeur est comparée à la précédente (un nouvel objet `media` ne suffit pas).
watch([() => media.value?.id, () => media.value?.title, () => media.value?.altText, () => media.value?.visibility], ([id, title, altText, visibility]) => {
  if (id && visibility) Object.assign(form, { title: title ?? '', altText: altText ?? '', visibility })
}, { immediate: true })

const { validate, message, clear } = useFormValidation(mediaMetadataSchema, FIELD_IDS)
const saveStatus = ref<StatusMessage | null>(null)
const saving = ref(false)

async function save() {
  saveStatus.value = null
  const input = validate(form)
  if (!input) return
  saving.value = true
  try {
    await $api(`/api/admin/media/${mediaId.value}`, { method: 'PATCH', body: input })
    await refresh()
    link.value = null
    saveStatus.value = { variant: 'success', message: t('media.detail.saved') }
  }
  catch {
    saveStatus.value = { variant: 'error', message: t('common.unexpectedError') }
  }
  finally {
    saving.value = false
  }
}

const visibilityOptions = computed(() => MEDIA_VISIBILITIES.map(value => ({
  value,
  label: t(`media.visibility.${value}.label`),
  description: t(`media.visibility.${value}.description`),
})))

// ─── Liens d'accès ───────────────────────────────────────────────────────────

const publicUrl = computed(() => data.value?.publicUrl ?? '')
const durationId = useId()
const duration = ref(String(SIGNED_URL_DURATIONS[0]))
const DURATION_KEYS: Record<(typeof SIGNED_URL_DURATIONS)[number], string> = { 3600: 'hour', 86400: 'day', 604800: 'week' }
const durationOptions = computed(() => SIGNED_URL_DURATIONS.map(seconds => ({ value: String(seconds), label: t(`media.links.durations.${DURATION_KEYS[seconds]}`) })))
/** Lien temporaire et adresses signées jusqu'à la même échéance (affiche, pistes, sources du lecteur). */
const link = ref<{
  url: string
  expiresAt: string
  posterUrl: string | null
  tracks: { id: string, url: string }[]
  sources: { url: string, type: string }[]
} | null>(null)
const linkError = ref<string>()
const generating = ref(false)
/** Lien temporaire retiré par un rechargement automatique (traitement) : un message le remplace. */
const linkOutdated = ref(false)
watch(mediaId, () => {
  linkOutdated.value = false
})

async function generateLink() {
  linkError.value = undefined
  linkOutdated.value = false
  generating.value = true
  try {
    const result = await $api(`/api/admin/media/${mediaId.value}/signed-url`, { method: 'POST', body: { expiresIn: Number(duration.value) } })
    link.value = { url: result.url, expiresAt: String(result.expiresAt), posterUrl: result.posterUrl, tracks: result.tracks, sources: result.sources }
  }
  catch {
    linkError.value = t('common.unexpectedError')
  }
  finally {
    generating.value = false
  }
}

/**
 * Sources de l'extrait <video> : permanentes (public) ou signées avec le lien temporaire (privé) ; null
 * tant que le lien n'est pas créé. [] : aucune source lisible (format converti sans rendu).
 */
const snippetSources = computed(() => {
  const value = media.value
  if (!value || !video.value) return null
  return value.visibility === 'PUBLIC' ? (publicUrl.value ? data.value?.publicSources ?? [] : null) : link.value?.sources ?? null
})

/** Extrait <video> : adresse publique, ou lien temporaire une fois créé (média privé). */
const snippet = computed(() => {
  const value = media.value
  const sources = snippetSources.value
  // Sans source lisible, l'extrait proposerait l'original (MKV…) qu'aucun navigateur ne lit.
  if (!value || !video.value || !sources?.length) return null
  const isPublic = value.visibility === 'PUBLIC'
  const url = isPublic ? publicUrl.value : link.value?.url
  if (!url) return null
  // Adresses absolues des pistes : permanentes (public) ou signées avec le lien temporaire (privé).
  const trackUrls = new Map((isPublic ? data.value?.publicTrackUrls : link.value?.tracks)?.map(track => [track.id, track.url]) ?? [])
  return videoSnippet({
    url,
    mimeType: value.mimeType,
    codecs: video.value.codecs,
    sources,
    width: value.width,
    height: value.height,
    label: value.altText || value.title || '',
    poster: isPublic ? data.value?.publicPosterUrl : link.value?.posterUrl,
    tracks: value.textTracks.filter(track => trackUrls.has(track.id)).map(track => ({
      src: trackUrls.get(track.id)!,
      kind: htmlTrackKind(track.kind),
      srclang: track.language,
      label: track.label,
      default: track.isDefault,
    })),
  })
})

/** Aucune source lisible (format converti sans rendu) : pas d'extrait, une explication à la place. */
const snippetUnavailable = computed(() => snippetSources.value?.length === 0)

/** Nouveau point d'intérêt = nouvelle version : adresses rechargées, lien temporaire périmé. */
async function onFocalSaved() {
  await refresh()
  link.value = null
}

// ─── Image d'affiche (vidéos, phase D2) ──────────────────────────────────────

const posterInput = useTemplateRef<HTMLInputElement>('posterInput')
const posterStatusEl = useTemplateRef<HTMLElement>('posterStatusEl')
const posterStatus = ref<StatusMessage | null>(null)
const posterBusy = ref<'capture' | 'upload' | 'remove' | null>(null)
const removePosterOpen = ref(false)
const posterAccept = computed(() => Object.keys(rules.value?.acceptedTypes.IMAGE ?? {}).join(','))

class PosterError extends Error {}

/** Message d'un refus du serveur (type, taille, fichier illisible) ou d'une capture impossible. */
function posterErrorMessage(error: unknown): string {
  if (error instanceof PosterError) return error.message
  const status = (error as { statusCode?: number } | null)?.statusCode
  if (status === 415) return t('media.poster.errors.unsupported')
  if (status === 413) return t('media.poster.errors.tooLarge', { max: formatBytes(rules.value?.maxUploadSizes.IMAGE ?? 0, locale.value) })
  if (status === 422) return t('media.poster.errors.unreadable')
  return t('common.unexpectedError')
}

async function posterAction(kind: 'capture' | 'upload' | 'remove', task: () => Promise<string>) {
  posterStatus.value = null
  posterBusy.value = kind
  try {
    const message = await task()
    await refresh()
    link.value = null
    posterStatus.value = { variant: 'success', message }
  }
  catch (error) {
    posterStatus.value = { variant: 'error', message: posterErrorMessage(error) }
  }
  finally {
    posterBusy.value = null
    // Le bouton utilisé a pu disparaître (« Retirer ») : le focus va au message de résultat.
    await nextTick()
    posterStatusEl.value?.focus()
  }
}

async function sendPoster(blob: Blob, filename: string, time: number | null) {
  const form = new FormData()
  if (time !== null) form.append('time', String(Math.round(time * 1000) / 1000))
  form.append('file', blob, filename)
  await $api(`/api/admin/media/${mediaId.value}/poster`, { method: 'PUT', body: form })
}

/** Image affichée par le lecteur (mis en pause à l'endroit voulu). */
function useDisplayedFrame() {
  return posterAction('capture', async () => {
    const frame = player.value ? await captureCurrentFrame(player.value) : null
    if (!frame) throw new PosterError(t('media.poster.captureFailed'))
    await sendPoster(frame.blob, 'poster.jpg', frame.time)
    return t('media.poster.saved')
  })
}

function onPosterFile(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0]
  input.value = ''
  if (!chosen) return
  posterAction('upload', async () => {
    await sendPoster(chosen, chosen.name, null)
    return t('media.poster.saved')
  })
}

function removePoster() {
  removePosterOpen.value = false
  posterAction('remove', async () => {
    await $api(`/api/admin/media/${mediaId.value}/poster`, { method: 'DELETE' })
    return t('media.poster.removed')
  })
}

/** Pistes modifiées : média rechargé (lecteur, extrait), lien temporaire à refaire. */
async function onTracksChanged() {
  await refresh()
  link.value = null
}

// ─── Préparation d'une vidéo envoyée avant D2 ────────────────────────────────

const prepareStatus = ref<StatusMessage | null>(null)
const preparing = ref(false)
const prepareStatusEl = useTemplateRef<HTMLElement>('prepareStatusEl')

async function prepareVideo() {
  prepareStatus.value = null
  preparing.value = true
  const before = media.value?.version
  try {
    const result = await $api(`/api/admin/media/${mediaId.value}/prepare`, { method: 'POST' })
    await refresh()
    link.value = null
    const version = result.media.version
    prepareStatus.value = { variant: 'success', message: version === before ? t('media.video.prepare.unchanged') : t('media.video.prepare.done', { version }) }
  }
  catch {
    prepareStatus.value = { variant: 'error', message: t('common.unexpectedError') }
  }
  finally {
    preparing.value = false
    // Le bouton utilisé a pu disparaître (vidéo préparée) : le focus va au message de résultat.
    await nextTick()
    prepareStatusEl.value?.focus()
  }
}

// ─── Traitement (vidéos, phase D3) ───────────────────────────────────────────

/**
 * Nouvel état du traitement (suivi toutes les 5 s, ou réponse de « Relancer ») : reporté dans la fiche
 * sans la recharger, sauf quand il faut la recharger entière (processingNeedsReload : nouvelle version,
 * tâche terminée ou en échec, mise à la corbeille ailleurs, rendu H.264 enregistré en cours de tâche).
 * Le formulaire n'est pas touché (observateur sur ses seules valeurs).
 */
async function applyProcessing(id: string, snapshot: ProcessingSnapshot) {
  const current = data.value
  if (!current || current.media.id !== id) return
  const before = current.media
  if (processingNeedsReload(before, snapshot)) {
    await reloadForProcessing(id)
    return
  }
  if (snapshot.processingState === before.processingState && snapshot.processing?.updatedAt === before.processing?.updatedAt) return
  data.value = { ...current, media: { ...before, processingState: snapshot.processingState, processing: snapshot.processing } }
}

/** Noms des rendus : un nouveau rendu change les sources du lecteur et de l'extrait. */
function renditionNames(value: { renditions: readonly { name: string }[] }): string {
  return value.renditions.map(rendition => rendition.name).join(' ')
}

/**
 * Rechargement que l'utilisateur n'a pas demandé (suivi du traitement) :
 *   - lu à part puis reporté d'un bloc : en échec (serveur redémarré, proxy), la fiche reste telle quelle
 *     — ni page d'erreur, ni saisie perdue — et la lecture suivante du suivi réessaie ;
 *   - le focus ne tombe jamais sur <body> : si l'élément qui l'avait disparaît (« Télécharger l'original »
 *     remplacé par le lecteur, lien temporaire retiré), il va au cadre du lecteur ou au titre de sa
 *     section (WCAG 2.4.3) ; le lecteur lui-même attend la fin de son utilisation (`playerSources`) ;
 *   - le lien temporaire n'est retiré que si la version ou les rendus changent (adresse, sources de
 *     l'extrait), avec un message à sa place.
 */
async function reloadForProcessing(id: string) {
  let fresh: typeof data.value
  try {
    fresh = await $api(`/api/admin/media/${id}`)
  }
  catch {
    return
  }
  const current = data.value
  if (!fresh || !current || current.media.id !== id) return
  const focus = focusFallback()
  const changed = fresh.media.version !== current.media.version || renditionNames(fresh.media) !== renditionNames(current.media)
  data.value = fresh
  if (changed && link.value) {
    link.value = null
    linkOutdated.value = true
  }
  await restoreFocus(focus)
}

/**
 * Élément qui a le focus, et la cible qui le recevra s'il disparaît : cadre du lecteur, ou titre de sa
 * section (focusable par programme : `tabindex="-1"`).
 */
function focusFallback(): { element: HTMLElement, target: HTMLElement | null } | null {
  const element = document.activeElement
  if (!(element instanceof HTMLElement) || element === document.body) return null
  const container = element.closest<HTMLElement>('figure, section')
  const target = container?.matches('figure') ? container : container?.querySelector<HTMLElement>('h2[tabindex="-1"]')
  return { element, target: target ?? null }
}

async function restoreFocus(focus: ReturnType<typeof focusFallback>) {
  if (!focus) return
  await nextTick()
  if (!focus.element.isConnected && focus.target?.isConnected && document.activeElement === document.body) focus.target.focus()
}

// Suivi dans le navigateur, seulement pendant la tâche (pas dans la corbeille : tâche annulée).
useProcessingPoll({
  target: () => (processingLive.value ? media.value?.id ?? null : null),
  fetch: (id, signal) => $api(`/api/admin/media/${id}/processing`, { signal }),
  onResult: applyProcessing,
})

/** « Traiter » / « Relancer » accepté : tâche en file, état reporté sans recharger la fiche. */
async function onProcessingRequested(snapshot: ProcessingSnapshot) {
  if (media.value) await applyProcessing(media.value.id, snapshot)
}

const trashBanner = useTemplateRef<HTMLElement>('trashBanner')

/** Fiche périmée (fichier remplacé, corbeille) signalée par « Relancer ». */
async function onProcessingStale() {
  await refresh()
  link.value = null
  // Vidéo jamais traitée mise à la corbeille ailleurs : la section « Traitement » disparaît avec son
  // message, qui avait le focus ; il va à la bannière de la corbeille, qui l'explique.
  await nextTick()
  if (!showProcessing.value && inTrash.value && document.activeElement === document.body) trashBanner.value?.focus()
}

// ─── Remplacement, corbeille ─────────────────────────────────────────────────

const replaceStatus = ref<StatusMessage | null>(null)

async function onReplaced() {
  await refresh()
  link.value = null
  replaceStatus.value = { variant: 'success', message: t('media.replace.success') }
}

const actionError = ref<string>()
const busy = ref(false)

async function moveToTrash() {
  actionError.value = undefined
  busy.value = true
  try {
    await $api(`/api/admin/media/${mediaId.value}`, { method: 'DELETE' })
    flash.set({ variant: 'success', message: t('media.trash.moved', { name: displayName.value }) })
    await navigateTo(listPath.value)
  }
  catch {
    actionError.value = t('common.unexpectedError')
  }
  finally {
    busy.value = false
  }
}

async function restore() {
  actionError.value = undefined
  busy.value = true
  try {
    await $api(`/api/admin/media/${mediaId.value}/restore`, { method: 'POST' })
    await refresh()
  }
  catch {
    actionError.value = t('common.unexpectedError')
  }
  finally {
    busy.value = false
  }
}

const purgeOpen = ref(false)
const purgeError = ref<string>()

async function purge() {
  purgeError.value = undefined
  busy.value = true
  try {
    await $api(`/api/admin/media/${mediaId.value}?permanent=true`, { method: 'DELETE' })
    flash.set({ variant: 'success', message: t('media.trash.purged', { name: displayName.value }) })
    purgeOpen.value = false
    await navigateTo({ path: listPath.value, query: { status: 'trash' } })
  }
  catch {
    purgeError.value = t('common.unexpectedError')
  }
  finally {
    busy.value = false
  }
}

// ─── Duplication, déplacement ────────────────────────────────────────────────

const { data: targets } = await useApiFetch('/api/admin/spaces', { query: { scope: 'media:upload' } })
const targetId = useId()
const organizeStatus = ref<StatusMessage | null>(null)
const organizing = ref<'duplicate' | 'move' | null>(null)

/** Valeur du sélecteur : identifiant du projet, ou « library ». */
const LIBRARY_VALUE = 'library'
const currentTarget = computed(() => project.value?.id ?? LIBRARY_VALUE)
const target = ref('')
watch(currentTarget, (value) => {
  target.value = value
}, { immediate: true })

const targetOptions = computed(() => (targets.value?.spaces ?? []).map((item) => {
  const value = item.type === 'project' ? item.id : LIBRARY_VALUE
  const label = item.type === 'project' ? t('space.project', { name: item.name }) : t('space.library')
  return { value, label: value === currentTarget.value ? t('media.organize.current', { space: label }) : label }
}))

// Dossier cible dans l'espace choisi (racine par défaut ; dossier actuel pour l'espace du média).
const ROOT_FOLDER = 'root'
const targetFolderId = useId()
const targetFolder = ref(ROOT_FOLDER)
const sameSpace = computed(() => target.value === currentTarget.value)
const currentFolderValue = computed(() => media.value?.folderId ?? ROOT_FOLDER)
const { data: targetFolders } = await useApiFetch('/api/admin/folders', {
  query: computed(() => ({ project: target.value && target.value !== LIBRARY_VALUE ? target.value : undefined })),
})
const targetFolderIndex = computed(() => indexFolders(targetFolders.value?.folders ?? []))
const targetFolderOptions = computed(() => [
  { value: ROOT_FOLDER, label: t('folders.root') },
  ...flattenFolders(targetFolderIndex.value).map(({ folder }) => ({ value: folder.id, label: folderPathLabel(targetFolderIndex.value, folder.id) })),
].map(option => (sameSpace.value && option.value === currentFolderValue.value
  ? { ...option, label: t('media.organize.current', { space: option.label }) }
  : option)))
watch([target, currentFolderValue], () => {
  targetFolder.value = sameSpace.value ? currentFolderValue.value : ROOT_FOLDER
}, { immediate: true })

/** Déplacer : vers un autre espace (media:delete) ou un autre dossier du même espace (media:write). */
const canMove = computed(() => (sameSpace.value ? canWrite.value && targetFolder.value !== currentFolderValue.value : canDelete.value))

function spaceRequest(action: 'duplicate' | 'move', body: { projectId: string | null, folderId: string | null }) {
  return $api(`/api/admin/media/${mediaId.value}/${action}`, { method: 'POST', body })
}

function folderRequest(folderId: string | null) {
  return $api(`/api/admin/media/${mediaId.value}`, { method: 'PATCH', body: { folderId } })
}

async function organize(action: 'duplicate' | 'move') {
  if (!target.value) return
  organizeStatus.value = null
  organizing.value = action
  const folderId = targetFolder.value === ROOT_FOLDER ? null : targetFolder.value
  const targetProject = targets.value?.spaces.find(item => item.type === 'project' && item.id === target.value)
  const spaceName = targetProject?.type === 'project' ? t('space.project', { name: targetProject.name }) : t('space.library')
  const destination = folderId ? `${spaceName} / ${folderPathLabel(targetFolderIndex.value, folderId)}` : spaceName
  try {
    if (action === 'duplicate') {
      const result = await spaceRequest('duplicate', { projectId: target.value === LIBRARY_VALUE ? null : target.value, folderId })
      flash.set({ variant: 'success', message: t('media.organize.duplicated', { space: destination }) })
      await navigateTo(`/admin/media/${result.media.id}`)
      return
    }
    if (sameSpace.value) await folderRequest(folderId)
    else await spaceRequest('move', { projectId: target.value === LIBRARY_VALUE ? null : target.value, folderId })
    await refresh()
    organizeStatus.value = { variant: 'success', message: t('media.organize.moved', { space: destination }) }
  }
  catch (error) {
    const { code } = apiError(error)
    organizeStatus.value = {
      variant: 'error',
      message: code && (FOLDER_ERROR_CODES as readonly string[]).includes(code) ? t(`folders.errors.${code}`) : t('common.unexpectedError'),
    }
  }
  finally {
    organizing.value = null
  }
}

// Message laissé par une duplication (redirection vers la copie).
const pageFlash = flash.consume()
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <NuxtLink :to="backLink" class="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" />
      {{ inTrash ? t('media.detail.backToTrash') : project ? t('media.detail.backToProject') : t('media.detail.backToList') }}
    </NuxtLink>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('media.detail.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="media">
      <AdminPageHeader :title="displayName" :description="media.title ? media.originalName : undefined">
        <template #actions>
          <UiBadge :variant="media.visibility === 'PRIVATE' ? 'neutral' : 'primary'">
            {{ t(`media.visibility.${media.visibility}.label`) }}
          </UiBadge>
        </template>
      </AdminPageHeader>

      <UiAlert v-if="pageFlash" :variant="pageFlash.variant" live="polite" class="mb-6">
        {{ pageFlash.message }}
      </UiAlert>

      <UiAlert v-if="!canWrite" variant="info" class="mb-6">
        {{ project?.archivedAt ? t('media.detail.archivedProject') : t('media.detail.readOnly') }}
      </UiAlert>

      <!-- Focusable par programme : cible du focus quand la section qui l'avait disparaît (mise à la corbeille ailleurs). -->
      <div v-if="inTrash" ref="trashBanner" tabindex="-1" class="mb-6 rounded-lg">
        <UiAlert variant="warning" :title="t('media.trash.bannerTitle')">
          <p>{{ t('media.trash.bannerDescription') }}</p>
          <div v-if="canDelete" class="mt-3 flex flex-wrap gap-3">
            <UiButton variant="outline" size="sm" :loading="busy" @click="restore">
              <ArchiveRestore aria-hidden="true" />
              {{ t('media.trash.restore') }}
            </UiButton>
            <UiButton variant="destructive" size="sm" @click="purgeOpen = true">
              <Trash2 aria-hidden="true" />
              {{ t('media.trash.purge') }}
            </UiButton>
          </div>
        </UiAlert>
      </div>
      <UiAlert v-if="actionError" variant="error" live="assertive" class="mb-6">
        {{ actionError }}
      </UiAlert>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <!-- Aperçu et informations -->
        <div class="grid content-start gap-6">
          <!-- Focusable par programme : cible du focus quand le lien « Télécharger l'original » laisse place au lecteur. -->
          <figure :tabindex="isVideo ? -1 : undefined" :class="cn('overflow-hidden rounded-xl border border-border', isVideo ? 'bg-muted' : 'bg-checker')">
            <!-- Lecteur natif : commandes au clavier, jamais de lecture automatique (WCAG 1.4.2), métadonnées seules chargées. -->
            <video
              v-if="isVideo && playable"
              :key="sourcesKey"
              ref="player"
              :poster="media.poster?.url ?? undefined"
              controls
              preload="metadata"
              playsinline
              :width="media.width ?? undefined"
              :height="media.height ?? undefined"
              :aria-label="displayName"
              :aria-describedby="media.altText ? videoDescriptionId : undefined"
              class="mx-auto block h-auto max-h-[28rem] w-auto max-w-full"
              @loadedmetadata="onPlayerMetadata"
              @pause="syncPlayerSources"
              @ended="syncPlayerSources"
              @focusout="syncPlayerSources"
            >
              <source v-for="source in playerSources" :key="source.url" :src="source.url" :type="source.type">
              <track
                v-for="track in media.textTracks"
                :key="track.id"
                :kind="htmlTrackKind(track.kind)"
                :srclang="track.language"
                :label="track.label"
                :src="track.url"
                :default="track.isDefault"
              >
              <p class="p-4 text-sm text-foreground">
                {{ t('media.video.fallback') }}
                <a :href="media.url" class="text-primary underline underline-offset-4">{{ t('media.video.download') }}</a>
              </p>
            </video>
            <!-- Aucune source lisible (format converti sans rendu) : même emplacement, original en téléchargement. -->
            <div v-else-if="isVideo" class="flex aspect-video max-h-[28rem] w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <Film class="size-8 text-muted-foreground" aria-hidden="true" />
              <p class="max-w-sm text-sm text-foreground">
                {{ processingLive ? t('media.video.placeholder.pending') : t('media.video.placeholder.unplayable') }}
              </p>
              <a :href="media.url" class="inline-flex min-h-6 items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline underline-offset-4">
                <Download class="size-4" aria-hidden="true" />
                {{ t('media.video.downloadOriginal') }}
              </a>
            </div>
            <img
              v-else
              :src="media.url"
              :alt="media.altText ?? ''"
              :width="media.width ?? undefined"
              :height="media.height ?? undefined"
              class="mx-auto max-h-[28rem] w-auto object-contain"
            >
            <p v-if="isVideo && media.altText" :id="videoDescriptionId" class="sr-only">
              {{ media.altText }}
            </p>
          </figure>

          <div v-if="videoNotices.length > 0 || prepareStatus" class="grid gap-3">
            <UiAlert v-for="notice in videoNotices" :key="notice.key" :variant="notice.variant" :title="notice.title">
              {{ notice.text }}
            </UiAlert>
            <div v-if="prepareStatus" ref="prepareStatusEl" tabindex="-1" class="rounded-lg">
              <UiAlert :variant="prepareStatus.variant" :live="prepareStatus.variant === 'error' ? 'assertive' : 'polite'">
                {{ prepareStatus.message }}
              </UiAlert>
            </div>
          </div>

          <!-- Traitement par ffmpeg (phase D3) : état, avancement suivi pendant la tâche, rendus, « Relancer ». -->
          <AdminVideoProcessingPanel
            v-if="showProcessing"
            :media-id="media.id"
            :state="media.processingState"
            :processing="media.processing"
            :renditions="media.renditions"
            :can-write="canWrite"
            :in-trash="inTrash"
            :active="processingEnabled"
            :has-poster="Boolean(media.poster)"
            @updated="onProcessingRequested"
            @stale="onProcessingStale"
          />

          <!-- Image d'affiche : vignette, attribut poster, source des dérivés de la vidéo. -->
          <section v-if="isVideo && !inTrash" aria-labelledby="poster-title" class="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs">
            <div>
              <h2 id="poster-title" class="text-base font-semibold text-foreground">
                {{ t('media.poster.title') }}
              </h2>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ t('media.poster.description') }}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-4">
              <img
                v-if="media.poster && media.previewUrl"
                :src="media.previewUrl"
                alt=""
                class="h-24 w-auto max-w-40 rounded-md border border-border bg-muted object-contain"
              >
              <div v-else class="flex h-24 w-40 items-center justify-center rounded-md border border-dashed border-input bg-muted px-2 text-center text-xs text-muted-foreground">
                {{ t('media.poster.none') }}
              </div>
              <p v-if="media.poster" class="text-sm text-foreground">
                {{ media.poster.time === null ? t('media.poster.uploaded') : t('media.poster.captured', { time: formatClock(Math.floor(media.poster.time)) }) }}
                <span class="block text-muted-foreground">{{ t('media.dimensions', { width: media.poster.width, height: media.poster.height }) }}</span>
              </p>
            </div>
            <div v-if="posterStatus" ref="posterStatusEl" tabindex="-1" class="rounded-lg">
              <UiAlert :variant="posterStatus.variant" :live="posterStatus.variant === 'error' ? 'assertive' : 'polite'">
                {{ posterStatus.message }}
              </UiAlert>
            </div>
            <template v-if="canWrite">
              <div class="flex flex-wrap gap-2">
                <!-- Capture : seulement avec un lecteur (format converti sans rendu : rien à afficher). -->
                <UiButton v-if="playable" variant="secondary" :loading="posterBusy === 'capture'" :disabled="posterBusy !== null" @click="useDisplayedFrame">
                  <Camera aria-hidden="true" />
                  {{ t('media.poster.capture') }}
                </UiButton>
                <UiButton variant="outline" :loading="posterBusy === 'upload'" :disabled="posterBusy !== null" @click="posterInput?.click()">
                  <ImageUp aria-hidden="true" />
                  {{ t('media.poster.upload') }}
                </UiButton>
                <UiButton v-if="media.poster" variant="outline" :loading="posterBusy === 'remove'" :disabled="posterBusy !== null" @click="removePosterOpen = true">
                  <Trash2 aria-hidden="true" />
                  {{ t('media.poster.remove') }}
                </UiButton>
              </div>
              <input ref="posterInput" type="file" class="hidden" :accept="posterAccept" @change="onPosterFile">
              <!-- Vidéo pas encore lisible : la capture viendra avec sa version compatible, si la tâche la prépare. -->
              <p class="text-xs text-muted-foreground">
                <template v-if="playable">
                  {{ t('media.poster.hint') }}
                </template>
                <template v-else>
                  {{ t('media.video.posterHintUnplayable') }}
                  <template v-if="processingLive">
                    {{ t('media.video.posterHintLater') }}
                  </template>
                </template>
              </p>
            </template>
          </section>

          <!-- Sous-titres et pistes de texte (WCAG 1.2.2). -->
          <AdminTextTracksPanel v-if="isVideo && !inTrash" :media-id="media.id" :tracks="media.textTracks" :can-write="canWrite" @changed="onTracksChanged" />

          <!-- Vidéo envoyée avant la préparation automatique : même traitement à la demande. -->
          <section v-if="canPrepare" aria-labelledby="prepare-title" class="grid gap-3 rounded-xl border border-border bg-surface p-5 shadow-xs">
            <h2 id="prepare-title" class="text-base font-semibold text-foreground">
              {{ t('media.video.prepare.title') }}
            </h2>
            <p class="text-sm text-muted-foreground">
              {{ t('media.video.prepare.description') }}
            </p>
            <div>
              <UiButton variant="secondary" :loading="preparing" @click="prepareVideo">
                {{ t('media.video.prepare.button') }}
              </UiButton>
            </div>
          </section>

          <section aria-labelledby="info-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="info-title" class="text-lg font-semibold text-foreground">
              {{ t('media.detail.infoTitle') }}
            </h2>
            <dl class="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.space') }}
                </dt>
                <dd class="font-medium text-foreground">
                  <NuxtLink v-if="project" :to="`/admin/projects/${project.id}`" class="text-primary underline-offset-4 hover:underline">
                    {{ spaceLabel }}
                  </NuxtLink>
                  <template v-else>
                    {{ spaceLabel }}
                  </template>
                </dd>
              </div>
              <div class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.folder') }}
                </dt>
                <dd class="font-medium break-words text-foreground">
                  <NuxtLink v-if="media.folderId && folderPath" :to="{ path: listPath, query: { folder: media.folderId } }" class="text-primary underline-offset-4 hover:underline">
                    {{ folderPath }}
                  </NuxtLink>
                  <template v-else>
                    {{ t('media.detail.noFolder') }}
                  </template>
                </dd>
              </div>
              <div v-if="media.duplicatedFromId" class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.duplicatedFrom') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ t('media.detail.duplicatedFromValue') }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.format') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ media.extension?.toUpperCase() }} <span class="text-muted-foreground">({{ media.mimeType }})</span>
                </dd>
              </div>
              <div v-if="media.width && media.height" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.dimensions') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ t('media.dimensions', { width: media.width, height: media.height }) }}
                </dd>
              </div>
              <div v-if="isVideo" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.duration') }}
                </dt>
                <dd class="font-medium text-foreground">
                  <template v-if="media.duration !== null">
                    <span aria-hidden="true">{{ video?.durationEstimated ? t('media.detail.estimatedDuration', { duration: formatClock(media.duration) }) : formatClock(media.duration) }}</span>
                    <span class="sr-only">{{ video?.durationEstimated ? t('media.detail.estimatedDuration', { duration: formatDuration(media.duration, locale) }) : formatDuration(media.duration, locale) }}</span>
                  </template>
                  <template v-else>
                    {{ t('media.detail.unknownDuration') }}
                  </template>
                </dd>
              </div>
              <div v-if="codecLines.length > 0" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.codecs') }}
                </dt>
                <dd class="font-medium text-foreground">
                  <span v-for="line in codecLines" :key="line" class="block">{{ line }}</span>
                </dd>
              </div>
              <div v-if="preparable" class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.preparation') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ preparationLabel }}
                </dd>
              </div>
              <div v-if="video?.bitrate" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.bitrate') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ formatBitrate(video.bitrate, locale) }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.size') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ formatBytes(media.size, locale) }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.version') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ media.version }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.uploadedBy') }}
                </dt>
                <dd class="font-medium break-all text-foreground">
                  {{ uploaderName }}
                </dd>
              </div>
              <div v-if="media.uploadedByToken" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.credential') }}
                </dt>
                <dd class="font-medium break-all text-foreground">
                  {{ t(`credentials.named.${media.uploadedByToken.type}`, { name: media.uploadedByToken.name }) }}
                  <code class="block font-mono text-xs font-normal text-muted-foreground">{{ media.uploadedByToken.prefix }}…</code>
                </dd>
              </div>
              <div v-if="media.uploadSubject" class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.subject') }}
                </dt>
                <dd class="font-medium break-all text-foreground">
                  {{ media.uploadSubject }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.createdAt') }}
                </dt>
                <dd class="font-medium text-foreground">
                  <NuxtTime :datetime="media.createdAt" :locale="locale" date-style="medium" time-style="short" />
                </dd>
              </div>
              <div class="grid gap-0.5 sm:col-span-2">
                <dt class="text-muted-foreground">
                  {{ t('media.detail.checksum') }}
                </dt>
                <dd class="font-mono text-xs break-all text-foreground">
                  {{ media.checksum }}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <div class="grid content-start gap-6">
          <!-- Métadonnées éditoriales -->
          <section aria-labelledby="edit-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="edit-title" class="text-lg font-semibold text-foreground">
              {{ t('media.detail.editTitle') }}
            </h2>
            <!-- Lecture seule : les valeurs restent lisibles (pas de champs désactivés). -->
            <dl v-if="!canWrite" class="mt-4 grid gap-3 text-sm">
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.fields.title') }}
                </dt>
                <dd class="font-medium break-words text-foreground">
                  {{ media.title || '—' }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ isVideo ? t('media.fields.videoDescription') : t('media.fields.altText') }}
                </dt>
                <dd class="font-medium break-words text-foreground">
                  {{ media.altText || '—' }}
                </dd>
              </div>
              <div class="grid gap-0.5">
                <dt class="text-muted-foreground">
                  {{ t('media.fields.visibility') }}
                </dt>
                <dd class="font-medium text-foreground">
                  {{ t(`media.visibility.${media.visibility}.label`) }}
                </dd>
              </div>
            </dl>
            <form v-else class="mt-5 grid gap-5" novalidate @submit.prevent="save">
              <UiAlert v-if="saveStatus" :variant="saveStatus.variant" :live="saveStatus.variant === 'error' ? 'assertive' : 'polite'">
                {{ saveStatus.message }}
              </UiAlert>
              <UiFormField :id="FIELD_IDS.title" v-slot="field" :label="t('media.fields.title')" :hint="t('media.fields.titleHint')" :error="message('title')">
                <UiInput v-bind="field" v-model="form.title" name="title" autocomplete="off" :maxlength="MEDIA_TEXT_MAX_LENGTH" @input="clear('title')" />
              </UiFormField>
              <UiFormField
                :id="FIELD_IDS.altText"
                v-slot="field"
                :label="isVideo ? t('media.fields.videoDescription') : t('media.fields.altText')"
                :hint="isVideo ? t('media.fields.videoDescriptionHint') : t('media.fields.altTextHint')"
                :error="message('altText')"
              >
                <UiInput v-bind="field" v-model="form.altText" name="altText" autocomplete="off" :maxlength="MEDIA_TEXT_MAX_LENGTH" @input="clear('altText')" />
              </UiFormField>
              <UiRadioCards
                :id="FIELD_IDS.visibility"
                v-model="form.visibility"
                :legend="t('media.fields.visibility')"
                :options="visibilityOptions"
                :columns="2"
                :error="message('visibility')"
              />
              <div class="flex justify-end">
                <UiButton type="submit" :loading="saving" :disabled="inTrash">
                  {{ t('common.save') }}
                </UiButton>
              </div>
            </form>
          </section>

          <!-- Point d'intérêt (images, affiche d'une vidéo) : sa modification crée une nouvelle version. -->
          <AdminFocalPointEditor
            v-if="!inTrash && media.previewUrl && derivedSize"
            :media-id="media.id"
            :src="media.previewUrl"
            :width="derivedSize.width"
            :height="derivedSize.height"
            :focal-point="media.focalPoint"
            :can-edit="canWrite"
            @saved="onFocalSaved"
          />

          <!-- Générateur d'adresses (images) : aperçu à la volée, adresse signée si nécessaire, extraits HTML. -->
          <AdminUrlGenerator
            v-if="!inTrash && data?.transforms && media.previewUrl && derivedSize"
            :media-id="media.id"
            :version="media.version"
            :src="media.previewUrl"
            :width="derivedSize.width"
            :height="derivedSize.height"
            :alt-text="media.altText"
            :visibility="media.visibility"
            :options="data.transforms"
            :project-id="project?.id ?? null"
          />

          <!-- Liens -->
          <section v-if="!inTrash" aria-labelledby="links-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <!-- Focusable par programme : cible du focus quand le lien temporaire est retiré par le suivi du traitement. -->
            <h2 id="links-title" tabindex="-1" class="rounded-sm text-lg font-semibold text-foreground">
              {{ t('media.links.title') }}
            </h2>
            <div v-if="media.visibility === 'PUBLIC'" class="mt-4 grid gap-2">
              <p class="text-sm text-muted-foreground">
                {{ t('media.links.publicDescription') }}
              </p>
              <UiCopyField :label="t('media.links.publicUrl')" :value="publicUrl" />
            </div>
            <div v-else class="mt-4 grid gap-4">
              <p class="text-sm text-muted-foreground">
                {{ t('media.links.privateDescription') }}
              </p>
              <div class="flex flex-wrap items-end gap-3">
                <div class="grid gap-1.5">
                  <label :for="durationId" class="text-sm font-medium text-foreground">{{ t('media.links.duration') }}</label>
                  <UiSelect :id="durationId" v-model="duration" :options="durationOptions" class="w-44" />
                </div>
                <UiButton variant="outline" :loading="generating" @click="generateLink">
                  <Link2 aria-hidden="true" />
                  {{ t('media.links.generate') }}
                </UiButton>
              </div>
              <UiAlert v-if="linkError" variant="error" live="assertive">
                {{ linkError }}
              </UiAlert>
              <UiAlert v-if="linkOutdated && !link" variant="info" live="polite">
                {{ t('media.links.outdated') }}
              </UiAlert>
              <div v-if="link" class="grid gap-1">
                <UiCopyField :label="t('media.links.temporaryUrl')" :value="link.url" />
                <p class="text-sm text-muted-foreground">
                  <i18n-t keypath="media.links.expires" tag="span" scope="global">
                    <template #date>
                      <NuxtTime :datetime="link.expiresAt" :locale="locale" date-style="long" time-style="short" class="font-medium text-foreground" />
                    </template>
                  </i18n-t>
                </p>
              </div>
            </div>
            <div v-if="snippet" class="mt-5 grid gap-2 border-t border-border pt-5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="text-sm font-semibold text-foreground">
                  {{ t('media.video.snippet.title') }}
                </h3>
                <UiCopyButton :value="snippet" :label="t('media.video.snippet.copy')" />
              </div>
              <p class="text-sm text-muted-foreground">
                {{ t('media.video.snippet.description') }}
                <template v-if="media.visibility === 'PRIVATE'">
                  {{ t('media.video.snippet.privateNote') }}
                </template>
              </p>
              <pre class="rounded-lg border border-border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap text-foreground"><code>{{ snippet }}</code></pre>
            </div>
            <div v-else-if="snippetUnavailable" class="mt-5 grid gap-2 border-t border-border pt-5">
              <h3 class="text-sm font-semibold text-foreground">
                {{ t('media.video.snippet.title') }}
              </h3>
              <p class="text-sm text-muted-foreground">
                {{ processingLive ? t('media.video.snippet.pending') : t('media.video.snippet.unavailable') }}
              </p>
            </div>
          </section>

          <!-- Remplacement -->
          <section v-if="!inTrash && rules && canWrite" aria-labelledby="replace-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="replace-title" class="text-lg font-semibold text-foreground">
              {{ t('media.replace.title') }}
            </h2>
            <p class="mt-2 mb-4 text-sm text-muted-foreground">
              {{ t('media.replace.description') }}
            </p>
            <UiAlert v-if="replaceStatus" :variant="replaceStatus.variant" live="polite" class="mb-4">
              {{ replaceStatus.message }}
            </UiAlert>
            <AdminMediaUploader
              :rules="rules"
              :endpoint="`/api/admin/media/${media.id}/file`"
              method="PUT"
              :multiple="false"
              :with-visibility="false"
              :kinds="[media.kind]"
              @uploaded="onReplaced"
            />
          </section>

          <!-- Duplication, déplacement -->
          <section v-if="!inTrash" aria-labelledby="organize-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="organize-title" class="text-lg font-semibold text-foreground">
              {{ t('media.organize.title') }}
            </h2>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ t('media.organize.description') }}
            </p>
            <p v-if="targetOptions.length === 0" class="mt-4 text-sm text-foreground">
              {{ t('media.organize.noTargets') }}
            </p>
            <div v-else class="mt-4 grid gap-4">
              <div class="flex flex-wrap items-end gap-3">
                <div class="grid min-w-56 flex-1 gap-1.5">
                  <label :for="targetId" class="text-sm font-medium text-foreground">{{ t('media.organize.target') }}</label>
                  <UiSelect :id="targetId" v-model="target" :options="targetOptions" />
                </div>
                <div class="grid min-w-56 flex-1 gap-1.5">
                  <label :for="targetFolderId" class="text-sm font-medium text-foreground">{{ t('media.organize.folder') }}</label>
                  <UiSelect :id="targetFolderId" v-model="targetFolder" :options="targetFolderOptions" />
                </div>
                <UiButton variant="outline" :loading="organizing === 'duplicate'" @click="organize('duplicate')">
                  <Copy aria-hidden="true" />
                  {{ t('media.organize.duplicate') }}
                </UiButton>
                <UiButton
                  v-if="canDelete || canWrite"
                  variant="outline"
                  :disabled="!canMove"
                  :loading="organizing === 'move'"
                  @click="organize('move')"
                >
                  <FolderInput aria-hidden="true" />
                  {{ t('media.organize.move') }}
                </UiButton>
              </div>
              <p v-if="(canDelete || canWrite) && !canMove" class="text-sm text-muted-foreground">
                {{ t('media.organize.moveDisabled') }}
              </p>
              <UiAlert v-if="organizeStatus" :variant="organizeStatus.variant" :live="organizeStatus.variant === 'error' ? 'assertive' : 'polite'">
                {{ organizeStatus.message }}
              </UiAlert>
            </div>
          </section>

          <!-- Corbeille -->
          <section v-if="!inTrash && canDelete" aria-labelledby="trash-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
            <h2 id="trash-title" class="text-lg font-semibold text-foreground">
              {{ t('media.trash.title') }}
            </h2>
            <p class="mt-2 text-sm text-muted-foreground">
              {{ t('media.trash.description') }}
            </p>
            <UiButton variant="outline" class="mt-4" :loading="busy" @click="moveToTrash">
              <Trash2 aria-hidden="true" />
              {{ t('media.trash.move') }}
            </UiButton>
          </section>
        </div>
      </div>

      <UiDialog
        v-model:open="removePosterOpen"
        :title="t('media.poster.removeTitle')"
        :description="t('media.poster.removeDescription')"
      >
        <template #actions>
          <UiButton variant="outline" autofocus @click="removePosterOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton variant="destructive" @click="removePoster">
            {{ t('media.poster.removeConfirm') }}
          </UiButton>
        </template>
      </UiDialog>

      <UiDialog
        v-model:open="purgeOpen"
        :title="t('media.trash.confirmTitle')"
        :description="t('media.trash.confirmDescription', { name: displayName })"
      >
        <UiAlert v-if="purgeError" variant="error" live="assertive">
          {{ purgeError }}
        </UiAlert>
        <template #actions>
          <UiButton variant="outline" autofocus @click="purgeOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton variant="destructive" :loading="busy" @click="purge">
            {{ t('media.trash.confirm') }}
          </UiButton>
        </template>
      </UiDialog>
    </template>
  </div>
</template>
