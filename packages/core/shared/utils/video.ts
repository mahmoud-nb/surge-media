/**
 * Vidéos (phase D1) : métadonnées techniques extraites des en-têtes du fichier (aucun décodage) et
 * règles de compatibilité de lecture. Partagé par le serveur (gestionnaire vidéo) et l'interface
 * (fiche du média). Fonctions pures, testées. Architecture : .claude/architecture-phase-d.md § 5.
 */

export const VIDEO_CONTAINERS = ['mp4', 'mov', 'webm'] as const
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number]

/**
 * Compatibilité de lecture d'un fichier servi tel quel : `broad` = lu par les navigateurs courants
 * (H.264 dans MP4/MOV, VP8/VP9 dans WebM, audio AAC/MP3/Opus/Vorbis ou absent) ; `variable` = selon le
 * navigateur et le matériel (HEVC, AV1, ProRes…). Indication, jamais un refus.
 */
export const VIDEO_PLAYBACK_LEVELS = ['broad', 'variable'] as const
export type VideoPlayback = (typeof VIDEO_PLAYBACK_LEVELS)[number]

/** Côté maximal accepté (contrôle de cohérence : rien n'est décodé). */
export const VIDEO_MAX_DIMENSION = 16_384

/**
 * Préparation des MP4/MOV à l'envoi (phase D2, sans réencodage) : `faststart` = index placé avant les
 * données ; `metadata` = métadonnées d'origine retirées (lieu de tournage, appareil). Réglage serveur :
 * NUXT_MEDIA_VIDEO_PREPARE. Architecture : .claude/architecture-phase-d.md § 18.
 */
export const VIDEO_PREPARATIONS = ['faststart', 'metadata'] as const
export type VideoPreparation = (typeof VIDEO_PREPARATIONS)[number]

/** Métadonnées d'une vidéo (colonne `Media.metadata`). */
export interface VideoMetadata {
  container: VideoContainer
  /** Codec vidéo normalisé (`avc1`, `hvc1`, `av01`, `vp9`…). */
  videoCodec: string
  /** Codec audio normalisé (`mp4a`, `mp3`, `opus`…), null sans piste audio. */
  audioCodec: string | null
  /** Chaîne RFC 6381 (`avc1.64001F,mp4a.40.2`) quand elle est calculable, sinon null. */
  codecs: string | null
  hasAudio: boolean
  /** Rotation d'affichage (degrés : 0, 90, 180, 270), déjà appliquée à la largeur et à la hauteur. */
  rotation: number
  /** Débit moyen (bit/s), null si la durée est inconnue. */
  bitrate: number | null
  /** MP4/MOV : index (`moov`) avant les données ; false = une requête de plus avant la lecture. WebM : null. */
  faststart: boolean | null
  /** Lieu de tournage présent dans les métadonnées du fichier servi. */
  hasLocation: boolean
  playback: VideoPlayback
  /**
   * Préparation à l'envoi : opérations faites sur le fichier servi ; `[]` = examiné, rien à faire ou
   * préparation impossible (MP4 fragmenté…) ; null = jamais examiné (envoyé avant D2, ou préparation désactivée).
   */
  prepared: VideoPreparation[] | null
  /** Durée absente du fichier, estimée d'après la fin des données (WebM des navigateurs). */
  durationEstimated: boolean
}

const BROAD_VIDEO: Record<VideoContainer, readonly string[]> = {
  mp4: ['avc1', 'avc3'],
  mov: ['avc1', 'avc3'],
  webm: ['vp8', 'vp9'],
}
const BROAD_AUDIO: Record<VideoContainer, readonly string[]> = {
  mp4: ['mp4a', 'mp3'],
  mov: ['mp4a', 'mp3'],
  webm: ['opus', 'vorbis'],
}

/** Compatibilité de lecture d'une combinaison conteneur + codecs. */
export function videoPlayback(container: VideoContainer, videoCodec: string, audioCodec: string | null): VideoPlayback {
  const video = BROAD_VIDEO[container].includes(videoCodec)
  const audio = audioCodec === null || BROAD_AUDIO[container].includes(audioCodec)
  return video && audio ? 'broad' : 'variable'
}

const CODEC_LABELS: Record<string, string> = {
  avc1: 'H.264',
  avc3: 'H.264',
  hvc1: 'H.265 (HEVC)',
  hev1: 'H.265 (HEVC)',
  av01: 'AV1',
  vp8: 'VP8',
  vp9: 'VP9',
  vp09: 'VP9',
  vp08: 'VP8',
  mp4v: 'MPEG-4 Part 2',
  apch: 'Apple ProRes 422 HQ',
  apcn: 'Apple ProRes 422',
  apcs: 'Apple ProRes 422 LT',
  apco: 'Apple ProRes 422 Proxy',
  ap4h: 'Apple ProRes 4444',
  ap4x: 'Apple ProRes 4444 XQ',
  mp4a: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac: 'FLAC',
  alac: 'ALAC',
  'ac-3': 'Dolby Digital (AC-3)',
  'ec-3': 'Dolby Digital Plus (E-AC-3)',
  lpcm: 'PCM',
  sowt: 'PCM',
  twos: 'PCM',
}

/** Nom lisible d'un codec (noms propres : identiques dans toutes les langues). */
export function codecLabel(codec: string): string {
  return CODEC_LABELS[codec] ?? codec.toUpperCase()
}

/** Métadonnées vidéo d'un média (colonne JSON), ou null si elles manquent ou sont d'une autre forme. */
export function videoMetadata(metadata: unknown): VideoMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null
  const value = metadata as Partial<VideoMetadata>
  if (!(VIDEO_CONTAINERS as readonly unknown[]).includes(value.container) || typeof value.videoCodec !== 'string') return null
  return {
    container: value.container as VideoContainer,
    videoCodec: value.videoCodec,
    audioCodec: typeof value.audioCodec === 'string' ? value.audioCodec : null,
    codecs: typeof value.codecs === 'string' ? value.codecs : null,
    hasAudio: value.hasAudio === true,
    rotation: typeof value.rotation === 'number' ? value.rotation : 0,
    bitrate: typeof value.bitrate === 'number' ? value.bitrate : null,
    faststart: typeof value.faststart === 'boolean' ? value.faststart : null,
    hasLocation: value.hasLocation === true,
    playback: value.playback === 'broad' ? 'broad' : 'variable',
    prepared: Array.isArray(value.prepared)
      ? VIDEO_PREPARATIONS.filter(operation => (value.prepared as unknown[]).includes(operation))
      : null,
    durationEstimated: value.durationEstimated === true,
  }
}

/** Type MIME d'une source `<video>`, avec les codecs s'ils sont connus (`video/mp4; codecs="avc1.64001F, mp4a.40.2"`). */
export function videoSourceType(mimeType: string, codecs: string | null): string {
  return codecs ? `${mimeType}; codecs="${codecs.split(',').join(', ')}"` : mimeType
}
