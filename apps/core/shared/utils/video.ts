/**
 * Vidéos (phase D1) : métadonnées techniques extraites des en-têtes du fichier (aucun décodage) et
 * règles de compatibilité de lecture. Partagé par le serveur (gestionnaire vidéo) et l'interface
 * (fiche du média). Fonctions pures, testées.
 */

/** Conteneurs servis tels quels et lus par `<video>` (phase D1). */
export const PLAYABLE_VIDEO_CONTAINERS = ['mp4', 'mov', 'webm'] as const
/**
 * Conteneurs acceptés seulement quand le traitement est actif (phase D3, DD32) : jamais lus par
 * `<video>` (original proposé en téléchargement), la lecture passe par le rendu H.264.
 */
export const CONVERTED_VIDEO_CONTAINERS = ['mkv', 'avi', '3gp', 'ts', 'ogv', 'wmv'] as const
export const VIDEO_CONTAINERS = [...PLAYABLE_VIDEO_CONTAINERS, ...CONVERTED_VIDEO_CONTAINERS] as const
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number]
export type PlayableVideoContainer = (typeof PLAYABLE_VIDEO_CONTAINERS)[number]
export type ConvertedVideoContainer = (typeof CONVERTED_VIDEO_CONTAINERS)[number]

export function isConvertedContainer(container: string): container is ConvertedVideoContainer {
  return (CONVERTED_VIDEO_CONTAINERS as readonly string[]).includes(container)
}

/** Conteneur d'un type MIME vidéo accepté (détecté d'après le contenu). */
export const VIDEO_CONTAINER_BY_MIME: Readonly<Record<string, VideoContainer>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/3gpp': '3gp',
  'video/3gpp2': '3gp',
  'video/mp2t': 'ts',
  'video/ogg': 'ogv',
  'video/x-ms-wmv': 'wmv',
}

/**
 * Compatibilité de lecture d'un fichier servi tel quel : `broad` = lu par les navigateurs courants
 * (H.264 dans MP4/MOV, VP8/VP9 dans WebM, audio AAC/MP3/Opus/Vorbis ou absent) ; `variable` = selon le
 * navigateur et le matériel (HEVC, AV1, ProRes…). Indication, jamais un refus. `none` (phase D3) = conteneur
 * converti (MKV, AVI…) : jamais lu tel quel, seulement par son rendu.
 */
export const VIDEO_PLAYBACK_LEVELS = ['broad', 'variable', 'none'] as const
export type VideoPlayback = (typeof VIDEO_PLAYBACK_LEVELS)[number]

/** Côté maximal accepté (contrôle de cohérence : rien n'est décodé). */
export const VIDEO_MAX_DIMENSION = 16_384

/**
 * Préparation des MP4/MOV à l'envoi (phase D2, sans réencodage) : `faststart` = index placé avant les
 * données ; `metadata` = métadonnées d'origine retirées (lieu de tournage, appareil). Réglage serveur :
 * NUXT_MEDIA_VIDEO_PREPARE.
 */
export const VIDEO_PREPARATIONS = ['faststart', 'metadata'] as const
export type VideoPreparation = (typeof VIDEO_PREPARATIONS)[number]

/**
 * Réécritures sans perte faites après l'envoi par une tâche ffmpeg (phase D3, § 32.4) : `dataTracks` =
 * pistes de métadonnées de l'appareil retirées (positions GPS…) ; `webmIndex` = durée et index des
 * repères écrits dans un WebM qui n'en avait pas.
 */
export const VIDEO_REWRITES = ['dataTracks', 'webmIndex'] as const
export type VideoRewrite = (typeof VIDEO_REWRITES)[number]

/** Courbe de transfert HDR détectée par ffprobe : PQ (HDR10, Dolby Vision), HLG ; null = SDR ou inconnue. */
export const VIDEO_HDR_TRANSFERS = ['pq', 'hlg'] as const
export type VideoHdrTransfer = (typeof VIDEO_HDR_TRANSFERS)[number]

/** Métadonnées d'une vidéo (colonne `Media.metadata`). */
export interface VideoMetadata {
  container: VideoContainer
  /** Codec vidéo normalisé (`avc1`, `hvc1`, `av01`, `vp9`…) ; null tant qu'un conteneur converti n'est pas analysé. */
  videoCodec: string | null
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
  /**
   * Pistes de métadonnées de l'appareil (codes des pistes : `gpmd` GoPro, `camm`, `mebx` iPhone, `djmd`
   * DJI…), souvent des positions GPS, détectées dès l'envoi ; retirées par le traitement (phase D3).
   */
  dataTracks: string[]
  /** Courbe HDR (détectée par ffprobe pendant le traitement), null = SDR ou inconnue. */
  hdr: VideoHdrTransfer | null
  /** Réécritures sans perte faites par le traitement (phase D3). */
  rewrites: VideoRewrite[]
}

const BROAD_VIDEO: Record<PlayableVideoContainer, readonly string[]> = {
  mp4: ['avc1', 'avc3'],
  mov: ['avc1', 'avc3'],
  webm: ['vp8', 'vp9'],
}
const BROAD_AUDIO: Record<PlayableVideoContainer, readonly string[]> = {
  mp4: ['mp4a', 'mp3'],
  mov: ['mp4a', 'mp3'],
  webm: ['opus', 'vorbis'],
}

/** Compatibilité de lecture d'une combinaison conteneur + codecs. */
export function videoPlayback(container: VideoContainer, videoCodec: string | null, audioCodec: string | null): VideoPlayback {
  if (isConvertedContainer(container)) return 'none'
  const video = videoCodec !== null && BROAD_VIDEO[container].includes(videoCodec)
  const audio = audioCodec === null || BROAD_AUDIO[container].includes(audioCodec)
  return video && audio ? 'broad' : 'variable'
}

const CODEC_LABELS: Record<string, string> = {
  'avc1': 'H.264',
  'avc3': 'H.264',
  'hvc1': 'H.265 (HEVC)',
  'hev1': 'H.265 (HEVC)',
  'av01': 'AV1',
  'vp8': 'VP8',
  'vp9': 'VP9',
  'vp09': 'VP9',
  'vp08': 'VP8',
  'mp4v': 'MPEG-4 Part 2',
  'apch': 'Apple ProRes 422 HQ',
  'apcn': 'Apple ProRes 422',
  'apcs': 'Apple ProRes 422 LT',
  'apco': 'Apple ProRes 422 Proxy',
  'ap4h': 'Apple ProRes 4444',
  'ap4x': 'Apple ProRes 4444 XQ',
  'mp4a': 'AAC',
  'mp3': 'MP3',
  'opus': 'Opus',
  'vorbis': 'Vorbis',
  'flac': 'FLAC',
  'alac': 'ALAC',
  'ac-3': 'Dolby Digital (AC-3)',
  'ec-3': 'Dolby Digital Plus (E-AC-3)',
  'lpcm': 'PCM',
  'sowt': 'PCM',
  'twos': 'PCM',
}

/**
 * Nom lisible d'un codec (noms propres : identiques dans toutes les langues). null : codec pas encore
 * connu (format converti en attente d'analyse, phase D3) → « ? ».
 */
export function codecLabel(codec: string | null): string {
  if (codec === null) return '?'
  return CODEC_LABELS[codec] ?? codec.toUpperCase()
}

/** Métadonnées vidéo d'un média (colonne JSON), ou null si elles manquent ou sont d'une autre forme. */
export function videoMetadata(metadata: unknown): VideoMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null
  const value = metadata as Partial<VideoMetadata>
  if (!(VIDEO_CONTAINERS as readonly unknown[]).includes(value.container)) return null
  const container = value.container as VideoContainer
  const converted = isConvertedContainer(container)
  // Un conteneur lu par `<video>` a toujours un codec vidéo ; un conteneur converti peut ne pas encore en avoir.
  if (typeof value.videoCodec !== 'string' && !(converted && value.videoCodec === null)) return null
  return {
    container,
    videoCodec: typeof value.videoCodec === 'string' ? value.videoCodec : null,
    audioCodec: typeof value.audioCodec === 'string' ? value.audioCodec : null,
    codecs: typeof value.codecs === 'string' ? value.codecs : null,
    hasAudio: value.hasAudio === true,
    rotation: typeof value.rotation === 'number' ? value.rotation : 0,
    bitrate: typeof value.bitrate === 'number' ? value.bitrate : null,
    faststart: typeof value.faststart === 'boolean' ? value.faststart : null,
    hasLocation: value.hasLocation === true,
    playback: converted ? 'none' : value.playback === 'broad' ? 'broad' : 'variable',
    prepared: Array.isArray(value.prepared)
      ? VIDEO_PREPARATIONS.filter(operation => (value.prepared as unknown[]).includes(operation))
      : null,
    durationEstimated: value.durationEstimated === true,
    dataTracks: Array.isArray(value.dataTracks)
      ? (value.dataTracks as unknown[]).filter((code): code is string => typeof code === 'string')
      : [],
    hdr: (VIDEO_HDR_TRANSFERS as readonly unknown[]).includes(value.hdr) ? value.hdr as VideoHdrTransfer : null,
    rewrites: Array.isArray(value.rewrites)
      ? VIDEO_REWRITES.filter(rewrite => (value.rewrites as unknown[]).includes(rewrite))
      : [],
  }
}

/**
 * Type MIME d'une source `<video>`, avec les codecs s'ils sont connus (`video/mp4; codecs="avc1.64001F, mp4a.40.2"`).
 * Un MOV (`video/quicktime`) est annoncé `video/mp4` : même famille de fichiers (ISO BMFF), lue par les
 * navigateurs quand ses codecs le sont, mais `canPlayType('video/quicktime')` répond « non » dans Chrome et
 * Firefox, qui ignoreraient la source (le type n'est qu'une indication : le fichier reste servi tel quel).
 */
export function videoSourceType(mimeType: string, codecs: string | null): string {
  const type = mimeType === 'video/quicktime' ? 'video/mp4' : mimeType
  return codecs ? `${type}; codecs="${codecs.split(',').join(', ')}"` : type
}
