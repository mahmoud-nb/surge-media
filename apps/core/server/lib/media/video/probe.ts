import {
  type ConvertedVideoContainer,
  isConvertedContainer,
  VIDEO_CONTAINER_BY_MIME,
  VIDEO_MAX_DIMENSION,
  type VideoContainer,
  type VideoMetadata,
  videoPlayback,
} from '#shared/utils/video'
import { probeWebm } from './ebml'
import { type IsoTrack, probeIsoBmff } from './isobmff'
import { type ByteSource, unreadable, VideoProbeError, withFileSource } from './source'

/**
 * Analyse d'une vidéo par ses seuls en-têtes (architecture phase D, DD3) : dimensions affichées (rotation
 * comprise), durée, codecs, présence d'audio, « faststart », lieu de tournage, pistes de données de
 * l'appareil (phase D3). Aucun décodage : quelques lectures de quelques Kio, mémoire constante, pas de
 * file des traitements. Pure, testée.
 *
 * Seuls les conteneurs lus tels quels par `<video>` (MP4, MOV, WebM) passent par ici. Les conteneurs
 * convertis (MKV, AVI…, phase D3) ne sont jamais lus à l'envoi : trop de formats et de variantes pour
 * un lecteur maison, alors que ffprobe les lit de toute façon dans la tâche de traitement, hors requête.
 */

export { VideoProbeError } from './source'

export interface VideoProbe {
  width: number
  height: number
  /** Secondes (3 décimales), null si inconnue. */
  duration: number | null
  metadata: VideoMetadata
}

function containerFor(mimeType: string): VideoContainer | undefined {
  return Object.hasOwn(VIDEO_CONTAINER_BY_MIME, mimeType) ? VIDEO_CONTAINER_BY_MIME[mimeType] : undefined
}

/** Conteneur converti (MKV, AVI…) d'un type détecté ; null pour un conteneur lu ici ou un autre type. */
export function convertedContainerFor(mimeType: string): ConvertedVideoContainer | null {
  const container = containerFor(mimeType)
  return container && isConvertedContainer(container) ? container : null
}

/**
 * Métadonnées d'une vidéo convertie à l'envoi (phase D3, DD32) : rien n'est lu, tout reste inconnu
 * jusqu'à l'étape `probe` de la tâche (ffprobe), qui remplit dimensions, durée et codecs sans changer de
 * version. `playback: 'none'` : l'original n'est jamais proposé à `<video>` ; `prepared: []` : examiné,
 * rien à préparer (la préparation de D2 ne concerne que les MP4/MOV servis tels quels).
 */
export function convertedVideoMetadata(container: ConvertedVideoContainer): VideoMetadata {
  return {
    container,
    videoCodec: null,
    audioCodec: null,
    codecs: null,
    hasAudio: false,
    rotation: 0,
    bitrate: null,
    faststart: null,
    hasLocation: false,
    playback: 'none',
    prepared: [],
    durationEstimated: false,
    dataTracks: [],
    hdr: null,
    rewrites: [],
  }
}

interface Stream {
  codec: string
  codecString: string | null
}

interface Analysis {
  width: number
  height: number
  rotation: number
  duration: number | null
  video: Stream
  audio: Stream | null
  faststart: boolean | null
  hasLocation: boolean
  durationEstimated: boolean
  dataTracks: string[]
}

/** Pistes lues ou gérées ailleurs : image, son, indications de diffusion, code temporel, texte et sous-titres. */
const MEDIA_HANDLERS = new Set(['vide', 'soun', 'hint', 'tmcd', 'text', 'sbtl', 'subt', 'clcp'])
/** Gestionnaires des pistes de métadonnées temporisées (ISO `meta`, caméras 360° `camm`, données génériques). */
const DATA_HANDLERS = new Set(['meta', 'camm', 'data'])
/**
 * Formats d'échantillon des pistes de l'appareil, souvent des positions GPS : GoPro `gpmd`, caméras 360°
 * `camm`, iPhone `mebx`, DJI `djmd` et `dbgi`, métadonnées texte `mett`, Sony `rtmd`.
 */
const DATA_CODECS = new Set(['gpmd', 'camm', 'mebx', 'djmd', 'dbgi', 'mett', 'rtmd'])

/**
 * Pistes de données de l'appareil (phase D3, § 32.4), désactivées comprises (elles restent dans le fichier
 * servi) : code du format d'échantillon s'il est connu, sinon le gestionnaire ; chaque code une fois. La
 * préparation de D2 les garde (elle ne retire jamais une piste) ; le traitement les retire (ffmpeg).
 */
function deviceDataTracks(tracks: IsoTrack[]): string[] {
  const codes = new Set<string>()
  for (const track of tracks) {
    if (MEDIA_HANDLERS.has(track.handler)) continue
    if (track.codec !== null && DATA_CODECS.has(track.codec)) codes.add(track.codec)
    else if (DATA_HANDLERS.has(track.handler)) codes.add(track.handler)
  }
  return [...codes]
}

async function analyzeIsoBmff(source: ByteSource): Promise<Analysis> {
  const movie = await probeIsoBmff(source)
  const videos = movie.tracks.filter(track => track.handler === 'vide' && track.codec)
  const video = videos.find(track => track.enabled) ?? videos[0]
  if (!video) throw new VideoProbeError('no-video', 'No video track.')
  const audio = movie.tracks.find(track => track.handler === 'soun' && track.enabled && track.codec) ?? null
  // Dimensions de présentation (`tkhd`), sinon dimensions codées ; pivotées d'un quart de tour si besoin.
  const width = video.width || video.codedWidth
  const height = video.height || video.codedHeight
  const quarter = video.rotation === 90 || video.rotation === 270
  return {
    width: quarter ? height : width,
    height: quarter ? width : height,
    rotation: video.rotation,
    // MP4 fragmenté : durée du film seule (celle d'une piste ne couvre que l'en-tête).
    duration: movie.fragmented ? movie.duration : movie.duration ?? video.duration,
    video: { codec: video.codec!, codecString: video.codecString },
    audio: audio && { codec: audio.codec!, codecString: audio.codecString },
    faststart: movie.faststart,
    hasLocation: movie.hasLocation,
    durationEstimated: false,
    dataTracks: deviceDataTracks(movie.tracks),
  }
}

async function analyzeWebm(source: ByteSource): Promise<Analysis> {
  const file = await probeWebm(source)
  const videos = file.tracks.filter(track => track.type === 'video')
  const video = videos.find(track => track.enabled) ?? videos[0]
  if (!video) throw new VideoProbeError('no-video', 'No video track.')
  const audio = file.tracks.find(track => track.type === 'audio' && track.enabled) ?? null
  return {
    width: video.width,
    height: video.height,
    rotation: 0,
    duration: file.duration,
    video,
    audio,
    faststart: null,
    hasLocation: false,
    durationEstimated: file.durationEstimated,
    // Pistes de données des enregistreurs : propres aux MP4/MOV (un WebM n'en porte pas en pratique).
    dataTracks: [],
  }
}

/**
 * Analyse depuis une source d'octets ; `mimeType` = type détecté (sniff.ts), MP4, MOV ou WebM. Un conteneur
 * converti (voir `convertedVideoMetadata`) ou un autre type : illisible ici.
 */
export async function probeVideo(source: ByteSource, mimeType: string): Promise<VideoProbe> {
  const container = containerFor(mimeType)
  if (!container || isConvertedContainer(container)) throw unreadable(`Unsupported container ${mimeType}.`)
  const analysis = container === 'webm' ? await analyzeWebm(source) : await analyzeIsoBmff(source)

  const { width, height } = analysis
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > VIDEO_MAX_DIMENSION || height > VIDEO_MAX_DIMENSION) {
    throw unreadable(`Invalid video dimensions (${width} × ${height}).`)
  }
  const duration = analysis.duration === null ? null : Math.round(analysis.duration * 1000) / 1000 || null
  const audio = analysis.audio
  const codecs = analysis.video.codecString && (!audio || audio.codecString)
    ? [analysis.video.codecString, audio?.codecString].filter(Boolean).join(',')
    : null

  return {
    width,
    height,
    duration,
    metadata: {
      container,
      videoCodec: analysis.video.codec,
      audioCodec: audio?.codec ?? null,
      codecs,
      hasAudio: audio !== null,
      rotation: analysis.rotation,
      bitrate: duration ? Math.round(source.size * 8 / duration) : null,
      faststart: analysis.faststart,
      hasLocation: analysis.hasLocation,
      playback: videoPlayback(container, analysis.video.codec, audio?.codec ?? null),
      // Renseigné par la préparation à l'envoi (prepare.ts), après cette analyse.
      prepared: null,
      durationEstimated: duration !== null && analysis.durationEstimated,
      dataTracks: analysis.dataTracks,
      // Courbe HDR : lue par ffprobe dans la tâche (les en-têtes lus ici ne décrivent pas les couleurs).
      hdr: null,
      // Réécritures du traitement : ajoutées par la tâche après cette analyse du fichier réécrit.
      rewrites: [],
    },
  }
}

/** Analyse d'un fichier (envoi reçu dans le dossier temporaire). */
export function probeVideoFile(path: string, mimeType: string): Promise<VideoProbe> {
  return withFileSource(path, source => probeVideo(source, mimeType))
}
