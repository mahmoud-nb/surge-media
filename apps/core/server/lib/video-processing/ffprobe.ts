import type { VideoContainer, VideoHdrTransfer } from '#shared/utils/video'
import { ffprobeArgs } from './args'
import { isMissingTool, PROBE_TIMEOUT_MS, runTool, toolFailure, VideoToolError } from './run'
import type { VideoProcessingSettings } from './settings'

/**
 * Analyse d'une vidéo par ffprobe (phase D3, étape `probe`, architecture § 32) : flux vidéo principal
 * (dimensions affichées, rotation, cadence, profondeur, HDR, entrelacement), sons, pistes de données de
 * l'appareil. Complète le lecteur de D1 (en-têtes seulement) : formats convertis (MKV, AVI…), couleur,
 * pistes de données vues par ffmpeg. Codecs ramenés aux codes du lecteur de D1 (`avc1`, `hvc1`, `av01`,
 * `vp9`, `mp4a`, `opus`…) pour que `videoPlayback` et les libellés restent les mêmes. La sortie de
 * ffprobe décrit un fichier hostile : chaque valeur est contrôlée, bornée, jamais reprise telle quelle.
 * Lecture pure, testée.
 */

export interface ProbeVideoStream {
  /** Index du flux dans le fichier (`-map 0:<index>`). */
  index: number
  /** Codec normalisé comme le lecteur de D1 (`avc1`, `hvc1`, `av01`, `vp9`, `mp4v`, `apcn`…). */
  codec: string
  /** Dimensions affichées : rotation et proportions des pixels appliquées. */
  width: number
  height: number
  /** Rotation d'affichage (sens horaire, comme `VideoMetadata.rotation`). */
  rotation: 0 | 90 | 180 | 270
  /** Cadence moyenne (i/s), null si inconnue (WebM des navigateurs). */
  fps: number | null
  pixFmt: string | null
  bitDepth: number | null
  hdr: VideoHdrTransfer | null
  /**
   * Images entrelacées d'après l'ordre des trames annoncé (`field_order` : tt, bb, tb, bt). Sert au plan
   * (les navigateurs ne désentrelacent pas : rendu utile) ; le désentrelacement lui-même décide image par
   * image (args.ts), ffprobe ne connaissant pas l'ordre des trames de tous les formats (DV).
   */
  interlaced: boolean
}

export interface ProbeAudioStream {
  index: number
  /** Codec normalisé comme le lecteur de D1 (`mp4a`, `mp3`, `opus`, `vorbis`, `ac-3`, `lpcm`…). */
  codec: string
  channels: number | null
  sampleRate: number | null
}

export interface ProbeResult {
  /** Démultiplexeur (`mov,mp4,m4a,3gp,3g2,mj2`, `matroska,webm`, `avi`…). */
  formatName: string
  /** Secondes, null si inconnue (WebM sans durée). */
  duration: number | null
  /** Débit moyen (bit/s), null si inconnu. */
  bitrate: number | null
  video: ProbeVideoStream | null
  /** Son retenu pour les rendus : le flux par défaut, sinon le premier, parmi les sons au codec identifié. */
  audio: ProbeAudioStream | null
  /**
   * Tous les sons au codec identifié, dans l'ordre du fichier (gardés par `sanitize` et `repair`). Un son
   * que ffmpeg ne sait pas nommer (audio spatial `apac` des iPhone récents) ferait échouer la copie : il
   * n'est pas repris.
   */
  audioStreams: ProbeAudioStream[]
  /** Index de `audioStreams` (`-map` des copies sans réencodage). */
  audioIndexes: number[]
  /** Pistes de données de l'appareil (`gpmd`, `camm`, `mebx`, `djmd`…) ; codes temporels (`tmcd`) exclus, comme en D1. */
  dataStreams: string[]
}

/** Pistes de données au plus listées (un fichier hostile peut en déclarer des milliers). */
const MAX_DATA_STREAMS = 16
/** Pistes de données sans intérêt pour la vie privée, ignorées (comme le lecteur de D1). */
const IGNORED_DATA_TAGS = new Set(['tmcd'])

/** Codec vidéo ffmpeg → code du lecteur de D1, quand l'étiquette du fichier ne le donne pas déjà. */
const VIDEO_CODECS: Record<string, string> = {
  h264: 'avc1',
  hevc: 'hvc1',
  av1: 'av01',
  vp9: 'vp9',
  vp8: 'vp8',
  mpeg4: 'mp4v',
  prores: 'apcn',
}
/** Étiquettes (fourcc) gardées telles quelles pour un codec donné : variantes connues du lecteur de D1. */
const VIDEO_TAGS: Record<string, readonly string[]> = {
  h264: ['avc1', 'avc3'],
  hevc: ['hvc1', 'hev1'],
  vp9: ['vp09'],
  vp8: ['vp08'],
  prores: ['apch', 'apcn', 'apcs', 'apco', 'ap4h', 'ap4x'],
}
const AUDIO_CODECS: Record<string, string> = {
  aac: 'mp4a',
  mp3: 'mp3',
  opus: 'opus',
  vorbis: 'vorbis',
  flac: 'flac',
  alac: 'alac',
  ac3: 'ac-3',
  eac3: 'ec-3',
  dts: 'dts',
}

interface RawStream {
  index?: unknown
  codec_type?: unknown
  codec_name?: unknown
  codec_tag_string?: unknown
  width?: unknown
  height?: unknown
  sample_aspect_ratio?: unknown
  pix_fmt?: unknown
  bits_per_raw_sample?: unknown
  avg_frame_rate?: unknown
  r_frame_rate?: unknown
  field_order?: unknown
  color_transfer?: unknown
  channels?: unknown
  sample_rate?: unknown
  duration?: unknown
  disposition?: { default?: unknown, attached_pic?: unknown, timed_thumbnails?: unknown }
  tags?: { rotate?: unknown }
  side_data_list?: unknown
}

const text = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null

/** Nombre d'une valeur de ffprobe (nombre ou chaîne décimale), null si absent, `N/A` ou non fini. */
function number(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

function positiveInteger(value: unknown): number | null {
  const parsed = number(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** Rapport `num/den` ou `num:den` ; null si invalide ou nul. */
function ratio(value: unknown, separator: '/' | ':'): number | null {
  const parts = typeof value === 'string' ? value.split(separator) : []
  if (parts.length !== 2) return null
  const numerator = Number(parts[0])
  const denominator = Number(parts[1])
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null
  return numerator / denominator
}

/** Code court sûr (fourcc ou nom de codec) : lettres, chiffres, `-`, `_`, `.`, 32 caractères au plus. */
function code(value: unknown): string | null {
  const candidate = text(value)?.toLowerCase()
  return candidate && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(candidate) ? candidate : null
}

export function normalizeVideoCodec(codecName: string | null, tag: string | null): string {
  const name = code(codecName)
  if (!name) return code(tag) ?? 'unknown'
  const fourcc = code(tag)
  if (fourcc && VIDEO_TAGS[name]?.includes(fourcc)) return fourcc
  return VIDEO_CODECS[name] ?? name
}

export function normalizeAudioCodec(codecName: string | null): string {
  const name = code(codecName)
  if (!name) return 'unknown'
  if (name.startsWith('pcm_')) return 'lpcm'
  return AUDIO_CODECS[name] ?? name
}

/**
 * Rotation d'affichage (sens horaire) : matrice d'affichage (`rotation` de ffprobe, sens trigonométrique,
 * d'où le signe), sinon l'ancienne étiquette `rotate` (sens horaire). Arrondie au quart de tour.
 */
function rotationOf(stream: RawStream): 0 | 90 | 180 | 270 {
  let degrees: number | null = null
  if (Array.isArray(stream.side_data_list)) {
    for (const entry of stream.side_data_list as { side_data_type?: unknown, rotation?: unknown }[]) {
      if (entry && entry.side_data_type === 'Display Matrix' && number(entry.rotation) !== null) {
        degrees = -number(entry.rotation)!
        break
      }
    }
  }
  degrees ??= number(stream.tags?.rotate)
  if (degrees === null) return 0
  return (((Math.round(degrees / 90) * 90) % 360) + 360) % 360 as 0 | 90 | 180 | 270
}

/** Profondeur d'échantillon : `bits_per_raw_sample`, sinon d'après le format des pixels (`yuv420p10le` → 10). */
function bitDepthOf(stream: RawStream, pixFmt: string | null): number | null {
  const raw = positiveInteger(stream.bits_per_raw_sample)
  if (raw !== null && raw <= 16) return raw
  if (!pixFmt) return null
  const match = /(?:p|gray|^p0)(9|10|12|14|16)(?:le|be)?$/.exec(pixFmt)
  return match ? Number(match[1]) : 8
}

function hdrOf(stream: RawStream): VideoHdrTransfer | null {
  if (stream.color_transfer === 'smpte2084') return 'pq'
  if (stream.color_transfer === 'arib-std-b67') return 'hlg'
  return null
}

/** Ordres de trames d'une vidéo entrelacée (ffprobe : `progressive`, `unknown` sinon). */
const INTERLACED_FIELD_ORDERS = new Set(['tt', 'bb', 'tb', 'bt'])

/** Cadence moyenne ; à défaut la cadence de base si elle est plausible (les WebM des navigateurs annoncent 1000). */
function fpsOf(stream: RawStream): number | null {
  const fps = ratio(stream.avg_frame_rate, '/') ?? ratio(stream.r_frame_rate, '/')
  if (fps === null || fps > 240) return null
  return Math.round(fps * 1000) / 1000
}

/** Index du flux dans le fichier, null s'il est absent ou invalide. */
function streamIndex(stream: RawStream): number | null {
  const index = number(stream.index)
  return index !== null && Number.isInteger(index) && index >= 0 ? index : null
}

/** Codec nommé par ffmpeg : un flux au codec inconnu ne peut être ni décodé ni copié dans un MP4/MOV. */
function identified(stream: RawStream): boolean {
  return code(stream.codec_name) !== null && stream.codec_name !== 'none'
}

function isAttachedPicture(stream: RawStream): boolean {
  return stream.disposition?.attached_pic === 1 || stream.disposition?.timed_thumbnails === 1
}

/** Flux à retenir parmi des candidats : celui marqué par défaut, sinon le premier. */
function preferred(streams: RawStream[]): RawStream | null {
  return streams.find(stream => stream.disposition?.default === 1) ?? streams[0] ?? null
}

function videoStream(stream: RawStream): ProbeVideoStream | null {
  const index = streamIndex(stream)
  const codedWidth = positiveInteger(stream.width)
  const height = positiveInteger(stream.height)
  if (index === null || codedWidth === null || height === null) return null
  // Pixels non carrés (HDV, DV anamorphique) : largeur affichée d'après leurs proportions.
  const aspect = ratio(stream.sample_aspect_ratio, ':')
  const width = aspect !== null && aspect !== 1 ? Math.max(1, Math.round(codedWidth * aspect)) : codedWidth
  const rotation = rotationOf(stream)
  const quarter = rotation === 90 || rotation === 270
  const pixFmt = code(stream.pix_fmt)
  return {
    index,
    codec: normalizeVideoCodec(text(stream.codec_name), text(stream.codec_tag_string)),
    width: quarter ? height : width,
    height: quarter ? width : height,
    rotation,
    fps: fpsOf(stream),
    pixFmt,
    bitDepth: bitDepthOf(stream, pixFmt),
    hdr: hdrOf(stream),
    interlaced: typeof stream.field_order === 'string' && INTERLACED_FIELD_ORDERS.has(stream.field_order),
  }
}

function audioStream(stream: RawStream, index: number): ProbeAudioStream {
  return {
    index,
    codec: normalizeAudioCodec(text(stream.codec_name)),
    channels: positiveInteger(stream.channels),
    sampleRate: positiveInteger(stream.sample_rate),
  }
}

/** Code d'une piste de données : son fourcc s'il est lisible (`gpmd`), sinon le codec (`bin_data`, `klv`). */
function dataCode(stream: RawStream): string | null {
  return code(stream.codec_tag_string) ?? code(stream.codec_name) ?? 'data'
}

/**
 * Lecture de la sortie JSON de ffprobe (`-show_format -show_streams`). Lève `VideoToolError`
 * (`UNREADABLE`) si la sortie n'est pas un JSON attendu ou si le fichier n'a aucun flux ; un fichier sans
 * flux vidéo donne `video: null` (le plan en fait un échec `NO_VIDEO_TRACK`).
 */
export function parseFfprobe(json: string): ProbeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  }
  catch {
    throw new VideoToolError('UNREADABLE', 'Analyse illisible (sortie de ffprobe invalide).')
  }
  const root = parsed && typeof parsed === 'object' ? parsed as { streams?: unknown, format?: Record<string, unknown> } : null
  const streams = Array.isArray(root?.streams)
    ? (root.streams as unknown[]).filter((stream): stream is RawStream => !!stream && typeof stream === 'object')
    : []
  if (streams.length === 0) throw new VideoToolError('UNREADABLE', 'Aucun flux lisible dans le fichier.')
  const format = root?.format && typeof root.format === 'object' ? root.format : {}

  const videos = streams.filter(stream => stream.codec_type === 'video' && !isAttachedPicture(stream))
  const videoCandidate = preferred(videos)
  const video = videoCandidate ? videoStream(videoCandidate) : null
  const audios = streams.filter(stream => stream.codec_type === 'audio' && identified(stream) && streamIndex(stream) !== null)
  const audioStreams = audios.map(stream => audioStream(stream, streamIndex(stream)!))
  const audioCandidate = preferred(audios)
  const audio = audioCandidate ? audioStreams[audios.indexOf(audioCandidate)]! : null

  const dataStreams: string[] = []
  for (const stream of streams) {
    if (stream.codec_type !== 'data') continue
    const value = dataCode(stream)
    if (value && !IGNORED_DATA_TAGS.has(value) && !dataStreams.includes(value)) dataStreams.push(value)
    if (dataStreams.length >= MAX_DATA_STREAMS) break
  }

  const formatDuration = number(format.duration)
  const streamDuration = videoCandidate ? number(videoCandidate.duration) : null
  const rawDuration = formatDuration !== null && formatDuration > 0 ? formatDuration : streamDuration !== null && streamDuration > 0 ? streamDuration : null
  const duration = rawDuration === null ? null : Math.round(rawDuration * 1000) / 1000
  const bitrate = positiveInteger(format.bit_rate)

  return {
    formatName: (text(format.format_name) ?? 'unknown').slice(0, 64),
    duration,
    bitrate,
    video,
    audio,
    audioStreams,
    audioIndexes: audioStreams.map(stream => stream.index),
    dataStreams,
  }
}

/**
 * Analyse d'un fichier local par ffprobe, format imposé (args.ts). Lève `VideoToolError` : ffprobe
 * introuvable (`FFMPEG_UNAVAILABLE`), délai dépassé (`TIMEOUT`), fichier illisible (`UNREADABLE`) ; un
 * arrêt demandé lève la raison du signal.
 */
export async function runFfprobe(
  settings: Pick<VideoProcessingSettings, 'ffprobePath' | 'memoryLimit'>,
  container: VideoContainer,
  input: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  let result
  try {
    result = await runTool(settings.ffprobePath, { args: ffprobeArgs(container, input), timeoutMs: PROBE_TIMEOUT_MS, signal, memoryLimit: settings.memoryLimit })
  }
  catch (error) {
    if (isMissingTool(error)) throw new VideoToolError('FFMPEG_UNAVAILABLE', 'ffprobe introuvable ou impossible à lancer.')
    // Machine momentanément saturée (EAGAIN, EMFILE…) : erreur passagère (pipeline.ts, classifyFailure).
    throw error
  }
  if (result.aborted) {
    signal?.throwIfAborted()
    throw new VideoToolError('UNREADABLE', 'Analyse interrompue.')
  }
  if (result.code !== 0) throw toolFailure(result, 'UNREADABLE')
  return parseFfprobe(result.stdout)
}
