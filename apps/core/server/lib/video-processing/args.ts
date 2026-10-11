import { isAbsolute } from 'node:path'
import { VIDEO_MAX_DIMENSION, type VideoContainer, type VideoHdrTransfer } from '#shared/utils/video'
import type { X264Preset } from '#shared/utils/video-processing'

/**
 * Arguments de ffmpeg et ffprobe (phase D3, sécurité : architecture § 36, DD35). **Seul endroit** qui
 * les construit : ffmpeg décode des fichiers envoyés par des tiers, c'est la plus grande surface d'attaque
 * du projet. Règles appliquées à chaque commande :
 *   - **format d'entrée imposé** (`-f mov|matroska|avi|…`, d'après la détection de sniff.ts) : ffmpeg ne
 *     devine jamais le format. Attaque connue : un « .avi » qui est en réalité une liste HLS et fait lire
 *     au serveur ses propres fichiers (`/etc/passwd`) ou des URL internes, incrustés dans la vidéo produite.
 *     Les démultiplexeurs `hls`, `concat`, `dash`, `image2` ne peuvent donc jamais être choisis ;
 *   - **protocoles** : `-protocol_whitelist file`, option **d'entrée** (placée avant `-i`, sinon elle ne
 *     s'applique pas), chemins écrits `file:/…` ; MOV/MP4 : références externes (`dref`) refusées ;
 *   - **ressources** : fils bornés (décodage, filtres, encodage ; 16 au plus, voir MAX_THREADS), image
 *     décodée de 16 384 × 16 384 px au plus, cadence de sortie ≤ 60 i/s, taille de sortie bornée (`-fs`,
 *     2 Gio − 1 : colonne `size` des médias), file de multiplexage bornée ; le délai, la priorité et la
 *     mémoire sont appliqués par run.ts ;
 *   - **sorties** : chemin explicite (absolu, dans le dossier temporaire de la tâche), `-y`, format de
 *     sortie imposé ; aucune métadonnée d'origine reprise dans un rendu (lieu de tournage) ;
 *   - `-nostdin`, `-hide_banner`, `-loglevel error` : rien à lire au clavier, journal court.
 * Fonctions pures, testées (et exécutées sur de vrais fichiers dans tests/video-ffmpeg.test.ts).
 */

/** Format d'entrée imposé à ffmpeg pour chaque conteneur détecté (§ 33). */
export const INPUT_FORMATS: Readonly<Record<VideoContainer, string>> = {
  'mp4': 'mov',
  'mov': 'mov',
  '3gp': 'mov',
  'webm': 'matroska',
  'mkv': 'matroska',
  'avi': 'avi',
  'ts': 'mpegts',
  'ogv': 'ogg',
  'wmv': 'asf',
}

/** Pixels d'une image décodée au plus (`-max_pixels`) : 16 384 × 16 384, comme le lecteur de D1. */
export const MAX_DECODED_PIXELS = VIDEO_MAX_DIMENSION * VIDEO_MAX_DIMENSION
/**
 * Taille d'une sortie au plus (`-fs`), celle de la colonne `size` d'un média. ffmpeg s'arrête au premier
 * paquet au-delà : le fichier peut dépasser de quelques Kio (index final) et sa durée est alors trop
 * courte, ce que la vérification de chaque sortie (durée, taille) refuse.
 */
export const MAX_OUTPUT_SIZE = 2 ** 31 - 1
/** Côté maximal de l'image d'affiche extraite (celui de l'affiche normalisée, handlers/image.ts). */
export const POSTER_FRAME_MAX_DIMENSION = 3840
/** Taille maximale de l'image d'affiche extraite (un JPEG 4K de qualité 2 pèse quelques Mio). */
export const POSTER_MAX_SIZE = 64 * 1024 * 1024

/**
 * Fils au plus par usage (décodage, filtres, encodage), quel que soit NUXT_VIDEO_THREADS. La mémoire de
 * ffmpeg croît avec les fils (images en vol de chaque fil, tampons des filtres en virgule flottante de la
 * conversion HDR) : mesuré sur un rendu 4K HDR (HLG), 16 fils tiennent dans la limite par défaut de
 * 4 Gio (≈ 2,6 Gio d'espace d'adressage au plus haut, réserves de malloc bornées par run.ts), 32 fils
 * échouent (« Cannot allocate memory »). Au-delà de 16 fils, un seul encodage ne gagne presque plus
 * rien : une grosse machine sert mieux plusieurs tâches simultanées (NUXT_VIDEO_CONCURRENCY), chacune
 * avec sa propre limite. Une source 8K HDR peut demander plus : NUXT_VIDEO_MEMORY_LIMIT.
 */
export const MAX_THREADS = 16
/** Rendus (§ 32.2) : image clé toutes les 2 s, cadence plafonnée à 60 i/s, son AAC stéréo 48 kHz. */
export const KEYFRAME_INTERVAL = 2
export const MAX_RENDITION_FPS = 60
/**
 * Désentrelacement : chaque image que le décodeur marque comme entrelacée (MPEG-2 et H.264 de la TNT ou
 * des caméscopes AVCHD, DV) est désentrelacée en gardant la cadence (une image par image), les autres
 * passent telles quelles (référence, sans calcul ni copie). Sans lui, un rendu progressif garderait les
 * « peignes » des deux trames et la mise à l'échelle les mélangerait. Décision image par image plutôt que
 * d'après l'analyse : ffprobe ne donne pas l'ordre des trames d'un DV (`field_order` inconnu), le
 * décodeur, si. Toujours en tête de la chaîne : avant toute mise à l'échelle.
 */
export const DEINTERLACE_FILTER = 'bwdif=mode=send_frame:parity=auto:deint=interlaced'
const AUDIO_CHANNELS = '2'
const AUDIO_SAMPLE_RATE = '48000'
const H264_AUDIO_BITRATE = '128k'
const AV1_AUDIO_BITRATE = '96k'
const AV1_PRESET = '10'
const AV1_CRF = '35'
/** Niveau de parallélisme de SVT-AV1 (`lp`), qui ignore `-threads` ; borné aux valeurs que toutes ses versions acceptent. */
const SVT_MAX_LP = 6

/** Chemin d'un fichier pour ffmpeg : absolu (jamais relatif au dossier courant), préfixé `file:` (jamais un autre protocole). */
export function fileUrl(path: string): string {
  if (!isAbsolute(path)) throw new Error('ffmpeg paths must be absolute.')
  return `file:${path}`
}

/** Fils effectivement demandés à ffmpeg : 1 à MAX_THREADS. */
export function boundedThreads(threads: number): number {
  return Number.isFinite(threads) ? Math.min(MAX_THREADS, Math.max(1, Math.floor(threads))) : 1
}

function threadCount(threads: number): string {
  return String(boundedThreads(threads))
}

/** Options générales de toute commande ffmpeg. */
function globalArgs(threads: number): string[] {
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-filter_threads', threadCount(threads)]
}

/**
 * Règles d'ouverture d'un fichier hostile, communes à ffmpeg et ffprobe (options d'entrée, avant `-i`) :
 * image décodée bornée, protocole `file` seul, format imposé, références externes d'un MOV/MP4 (`dref`)
 * refusées explicitement (désactivées par défaut depuis longtemps, jamais à réactiver).
 */
function demuxerArgs(container: VideoContainer): string[] {
  const args = ['-max_pixels', String(MAX_DECODED_PIXELS), '-protocol_whitelist', 'file', '-f', INPUT_FORMATS[container]]
  if (INPUT_FORMATS[container] === 'mov') args.push('-enable_drefs', '0')
  return args
}

/**
 * Options d'entrée puis `-i` : fils de décodage bornés, règles d'ouverture. `seek` = position de départ
 * (s) avant `-i` (déplacement rapide par les images clés, pour l'affiche).
 */
export function inputArgs(container: VideoContainer, input: string, options: { threads: number, seek?: number }): string[] {
  const args = ['-threads', threadCount(options.threads), ...demuxerArgs(container)]
  if (options.seek !== undefined && options.seek > 0) args.push('-ss', seconds(options.seek))
  args.push('-i', fileUrl(input))
  return args
}

/** Fin de toute sortie : file de multiplexage bornée, taille bornée, format imposé, écrasement d'un reste de tentative précédente. */
function outputArgs(format: string, output: string, maxSize = MAX_OUTPUT_SIZE): string[] {
  return ['-max_muxing_queue_size', '1024', '-fs', String(maxSize), '-f', format, '-y', fileUrl(output)]
}

function seconds(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/** Analyse JSON des flux et du format (ffprobe), format imposé. */
export function ffprobeArgs(container: VideoContainer, input: string): string[] {
  return ['-v', 'error', '-hide_banner', ...demuxerArgs(container), '-print_format', 'json', '-show_format', '-show_streams', '-i', fileUrl(input)]
}

// ─── Filtres ─────────────────────────────────────────────────────────────────

/**
 * HDR (HLG, PQ) → SDR BT.709 (§ 32.2) : passage en lumière linéaire, conversion des primaires, courbe
 * « hable » sans désaturation, puis BT.709 en 8 bits. Caractéristiques d'entrée imposées (BT.2020, courbe
 * détectée par ffprobe) : un fichier qui ne les déclare pas toutes ne fait pas échouer `zscale`.
 */
export function toneMapFilter(transfer: VideoHdrTransfer): string {
  const input = transfer === 'pq' ? 'smpte2084' : 'arib-std-b67'
  return [
    `zscale=tin=${input}:pin=bt2020:min=bt2020nc:t=linear:npl=100`,
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ].join(',')
}

/**
 * Chaîne de filtres d'un rendu : désentrelacement des images entrelacées, cadence plafonnée (seulement
 * au-delà de 60 i/s), mise à l'échelle en pixels carrés (dimensions paires, calculées par plan.ts),
 * conversion HDR éventuelle, 8 bits 4:2:0. La rotation est appliquée avant par ffmpeg (`autorotate`, par
 * défaut) : `target` est en dimensions affichées.
 */
export function renditionFilters(options: { target: { width: number, height: number }, fps: number | null, toneMap: VideoHdrTransfer | null }): string {
  const filters = [DEINTERLACE_FILTER]
  if (options.fps !== null && options.fps > MAX_RENDITION_FPS) filters.push(`fps=${MAX_RENDITION_FPS}`)
  filters.push(`scale=${options.target.width}:${options.target.height}`, 'setsar=1')
  filters.push(options.toneMap ? toneMapFilter(options.toneMap) : 'format=yuv420p')
  return filters.join(',')
}

/**
 * Cadence et images clés d'un rendu. `-fpsmax 60` borne la cadence que ffmpeg choisit seul quand celle
 * de la source est inconnue (`fps` null) : les WebM et MKV de `MediaRecorder` annoncent 1000 i/s
 * (`r_frame_rate`), et le MP4 (cadence constante) dupliquerait les images jusque-là (40 × plus d'images,
 * niveau H.264 6.1 que bien des lecteurs refusent), SVT-AV1 refusant même tout au-delà de 240 i/s. La
 * sortie est alors à 60 i/s constants, images répétées à la sortie des filtres (mesuré en 1080p : 1,4 ×
 * le temps d'encodage des seules images d'origine, contre 9 × sans borne). La cadence variable
 * (`-fps_mode vfr`) coûterait moins mais garderait la cadence annoncée (niveau, SVT-AV1), et ffmpeg 6 ne
 * la combine pas avec `-fpsmax`. Cadence connue : sans effet (≤ 60, ou déjà ramenée à 60 par le filtre
 * `fps`). Images clés : intervalle maximal en images d'après la cadence de sortie, et images clés
 * forcées toutes les 2 s par le temps.
 */
function cadenceArgs(fps: number | null): string[] {
  const output = fps !== null && fps > 0 ? Math.min(fps, MAX_RENDITION_FPS) : MAX_RENDITION_FPS
  return [
    '-fpsmax', String(MAX_RENDITION_FPS),
    '-g', String(Math.max(1, Math.round(output * KEYFRAME_INTERVAL))),
    '-force_key_frames', `expr:gte(t,n_forced*${KEYFRAME_INTERVAL})`,
  ]
}

// ─── Commandes ───────────────────────────────────────────────────────────────

/** Flux choisis par l'analyse (ffprobe) : vidéo principale (jamais une pochette) et premier son. */
export interface StreamSelection {
  video: number
  audio: number | null
}

export interface EncodeOptions {
  input: string
  container: VideoContainer
  output: string
  threads: number
  streams: StreamSelection
  /** Dimensions affichées du rendu (paires, plan.ts `scaledDimensions`). */
  target: { width: number, height: number }
  /** Cadence de la source (i/s), null si inconnue. */
  fps: number | null
  /** Courbe HDR de la source à convertir en SDR ; null = aucune conversion. */
  toneMap: VideoHdrTransfer | null
}

function streamMaps(streams: StreamSelection): string[] {
  const args = ['-map', `0:${streams.video}`]
  if (streams.audio !== null) args.push('-map', `0:${streams.audio}`)
  // Ni métadonnées d'origine (lieu de tournage, appareil), ni chapitres, ni sous-titres, ni données.
  args.push('-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn')
  return args
}

/** Couleurs déclarées du rendu converti : BT.709 (sinon la sortie garderait les étiquettes HDR de la source). */
function colorArgs(toneMap: VideoHdrTransfer | null): string[] {
  return toneMap ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : []
}

/**
 * Rendu compatible H.264/AAC (§ 32.2) : MP4 « faststart », H.264 High 8 bits 4:2:0, CRF et préréglage
 * réglables, petit côté ≤ 1080 px, ≤ 60 i/s, image clé toutes les 2 s, rotation appliquée aux pixels,
 * AAC 128 kbit/s stéréo 48 kHz ou sans son. Progression sur la sortie standard.
 */
export function h264Args(options: EncodeOptions & { preset: X264Preset, crf: number }): string[] {
  return [
    ...globalArgs(options.threads),
    ...inputArgs(options.container, options.input, { threads: options.threads }),
    ...streamMaps(options.streams),
    '-vf', renditionFilters(options),
    '-c:v', 'libx264', '-preset', options.preset, '-crf', String(options.crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    ...cadenceArgs(options.fps),
    ...colorArgs(options.toneMap),
    '-threads', threadCount(options.threads),
    ...(options.streams.audio === null
      ? ['-an']
      : ['-c:a', 'aac', '-b:a', H264_AUDIO_BITRATE, '-ac', AUDIO_CHANNELS, '-ar', AUDIO_SAMPLE_RATE]),
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    ...outputArgs('mp4', options.output),
  ]
}

/** Rendu AV1/Opus en WebM (§ 32.2, NUXT_VIDEO_AV1) : SVT-AV1 préréglage 10, CRF 35, Opus 96 kbit/s. */
export function av1Args(options: EncodeOptions): string[] {
  const threads = boundedThreads(options.threads)
  return [
    ...globalArgs(threads),
    ...inputArgs(options.container, options.input, { threads }),
    ...streamMaps(options.streams),
    '-vf', renditionFilters(options),
    '-c:v', 'libsvtav1', '-preset', AV1_PRESET, '-crf', AV1_CRF, '-pix_fmt', 'yuv420p',
    '-svtav1-params', `lp=${Math.min(threads, SVT_MAX_LP)}`,
    ...cadenceArgs(options.fps),
    ...colorArgs(options.toneMap),
    '-threads', threadCount(threads),
    ...(options.streams.audio === null
      ? ['-an']
      : ['-c:a', 'libopus', '-b:a', AV1_AUDIO_BITRATE, '-ac', AUDIO_CHANNELS, '-ar', AUDIO_SAMPLE_RATE]),
    '-progress', 'pipe:1', '-nostats',
    ...outputArgs('webm', options.output),
  ]
}

/** Dimensions de l'image d'affiche : dimensions affichées ramenées dans 3840 × 3840 px, sans agrandissement. */
export function posterDimensions(width: number, height: number): { width: number, height: number } {
  const scale = Math.min(1, POSTER_FRAME_MAX_DIMENSION / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface PosterOptions {
  input: string
  container: VideoContainer
  output: string
  threads: number
  /** Flux vidéo (index ffprobe). */
  video: number
  /** Instant de l'image (s), atteint par déplacement avant le décodage. */
  time: number
  /** Dimensions affichées de la source (rotation et proportions des pixels comprises). */
  width: number
  height: number
  toneMap: VideoHdrTransfer | null
}

/**
 * Image d'affiche (§ 32.3) : une image JPEG (qualité 2) à l'instant demandé, désentrelacée si besoin, en
 * pixels carrés, ≤ 3840 px, couleurs HDR converties si demandé. Normalisée ensuite comme une affiche
 * envoyée (normalizePoster). Instant au-delà de la fin : aucune image écrite (le pipeline vérifie la
 * présence du fichier).
 */
export function posterArgs(options: PosterOptions): string[] {
  const size = posterDimensions(options.width, options.height)
  const filters = [DEINTERLACE_FILTER, `scale=${size.width}:${size.height}`, 'setsar=1']
  if (options.toneMap) filters.push(toneMapFilter(options.toneMap))
  return [
    ...globalArgs(options.threads),
    ...inputArgs(options.container, options.input, { threads: options.threads, seek: options.time }),
    '-map', `0:${options.video}`, '-map_metadata', '-1', '-an', '-sn', '-dn',
    '-vf', filters.join(','),
    '-frames:v', '1', '-q:v', '2',
    // Image unique, nom pris tel quel (sans motif `%d`).
    '-update', '1',
    ...outputArgs('image2', options.output, POSTER_MAX_SIZE),
  ]
}

/** Conteneurs dont les pistes de métadonnées sont retirées (§ 32.4) et format de la copie produite. */
const SANITIZE_FORMATS = { 'mp4': 'mp4', 'mov': 'mov', '3gp': 'mov' } as const
export type SanitizableContainer = keyof typeof SANITIZE_FORMATS

export function isSanitizableContainer(container: VideoContainer): container is SanitizableContainer {
  return container in SANITIZE_FORMATS
}

/**
 * Retrait des pistes de métadonnées de l'appareil (§ 32.4 : GPS GoPro `gpmd`, `camm`, `mebx` des iPhone,
 * DJI…) : copie **sans réencodage** de la vidéo principale et des sons (ceux au codec identifié par
 * ffprobe, `audioIndexes`), rien d'autre (ni données, ni sous-titres intégrés, ni chapitres). Métadonnées
 * globales copiées : la préparation de D2 (liste de ce qui est conservé, « faststart ») s'applique
 * ensuite à la sortie, une seule règle pour les deux.
 */
export function sanitizeArgs(options: { input: string, container: SanitizableContainer, output: string, video: number, audio: readonly number[] }): string[] {
  return [
    ...globalArgs(1),
    ...inputArgs(options.container, options.input, { threads: 1 }),
    '-map', `0:${options.video}`, ...options.audio.flatMap(index => ['-map', `0:${index}`]),
    '-c', 'copy', '-map_metadata', '0', '-map_chapters', '-1', '-sn', '-dn',
    ...outputArgs(SANITIZE_FORMATS[options.container], options.output),
  ]
}

/**
 * Codecs que le format WebM peut porter (le multiplexeur `webm` de ffmpeg refuse tout autre), codes de
 * ffprobe.ts. Chrome enregistre aussi du H.264 (`video/webm;codecs=h264`) ou du PCM dans un fichier dont
 * l'en-tête dit « webm » : une copie en WebM est alors impossible.
 */
const WEBM_VIDEO_CODECS: ReadonlySet<string> = new Set(['vp8', 'vp08', 'vp9', 'vp09', 'av01'])
const WEBM_AUDIO_CODECS: ReadonlySet<string> = new Set(['opus', 'vorbis'])

/** La copie sans réencodage en WebM (`webmRepairArgs`) est-elle possible avec ces codecs ? */
export function webmCopyable(videoCodec: string, audioCodecs: readonly string[]): boolean {
  return WEBM_VIDEO_CODECS.has(videoCodec) && audioCodecs.every(codec => WEBM_AUDIO_CODECS.has(codec))
}

/**
 * Réparation d'un WebM sans durée ni index (§ 32.4, enregistrements `MediaRecorder`) : copie sans
 * réencodage de la vidéo principale et des sons (ceux au codec identifié par ffprobe, `audioIndexes`),
 * ffmpeg écrit la durée et l'index des repères (`Cues`). Seulement si `webmCopyable` (plan.ts) : un flux
 * que le format WebM ne peut pas porter ferait échouer la copie. Flux choisis explicitement, comme pour
 * `sanitizeArgs` : ni pochette, ni son illisible, ni sous-titres, ni données.
 */
export function webmRepairArgs(options: { input: string, output: string, video: number, audio: readonly number[] }): string[] {
  return [
    ...globalArgs(1),
    ...inputArgs('webm', options.input, { threads: 1 }),
    '-map', `0:${options.video}`, ...options.audio.flatMap(index => ['-map', `0:${index}`]),
    '-c', 'copy', '-map_chapters', '-1', '-sn', '-dn',
    ...outputArgs('webm', options.output),
  ]
}
