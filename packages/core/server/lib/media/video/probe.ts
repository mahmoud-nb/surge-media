import { VIDEO_MAX_DIMENSION, type VideoContainer, type VideoMetadata, videoPlayback } from '#shared/utils/video'
import { probeWebm } from './ebml'
import { probeIsoBmff } from './isobmff'
import { type ByteSource, unreadable, VideoProbeError, withFileSource } from './source'

/**
 * Analyse d'une vidéo par ses seuls en-têtes (architecture phase D, DD3) : dimensions affichées (rotation
 * comprise), durée, codecs, présence d'audio, « faststart », lieu de tournage. Aucun décodage : quelques
 * lectures de quelques Kio, mémoire constante, pas de file des traitements. Pure, testée.
 */

export { VideoProbeError } from './source'

export interface VideoProbe {
  width: number
  height: number
  /** Secondes (3 décimales), null si inconnue. */
  duration: number | null
  metadata: VideoMetadata
}

const CONTAINERS: Record<string, VideoContainer> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
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
  }
}

/** Analyse depuis une source d'octets ; `mimeType` = type détecté (sniff.ts). */
export async function probeVideo(source: ByteSource, mimeType: string): Promise<VideoProbe> {
  const container = CONTAINERS[mimeType]
  if (!container) throw unreadable(`Unsupported container ${mimeType}.`)
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
    },
  }
}

/** Analyse d'un fichier (envoi reçu dans le dossier temporaire). */
export function probeVideoFile(path: string, mimeType: string): Promise<VideoProbe> {
  return withFileSource(path, source => probeVideo(source, mimeType))
}
