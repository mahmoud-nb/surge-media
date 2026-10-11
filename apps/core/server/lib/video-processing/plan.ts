import { isConvertedContainer, VIDEO_MAX_DIMENSION, type VideoContainer, type VideoMetadata, videoPlayback } from '#shared/utils/video'
import {
  JOB_STEPS,
  type JobStep,
  type RenditionMode,
  type RenditionName,
  type VideoJobErrorCode,
  type VideoJobWarning,
} from '#shared/utils/video-processing'
import { webmCopyable } from './args'
import type { ProbeResult } from './ffprobe'

/**
 * Plan d'une tâche (phase D3, architecture § 32, DD28 à DD31) : quelles étapes servent, calculé une fois
 * après l'analyse (ffprobe) ; chaque étape inutile est sautée. Fonction pure, testée.
 *   - `sanitize` (MP4/MOV avec pistes de métadonnées de l'appareil) et `repair` (WebM sans durée, aux
 *     codecs que le format WebM peut porter) : réécritures sans perte qui remplacent l'original, faites en
 *     premier (une seule nouvelle version) ;
 *   - `transcode` : rendu H.264 seulement s'il sert (mode `auto`, § 32.2), `av1` en plus si demandé ;
 *     jamais au-delà de la durée maximale (§ 38) : la tâche finit alors en échec `TOO_LONG`, après les
 *     autres étapes ;
 *   - `poster` : seulement sans affiche, en dernier (extraite du rendu SDR s'il existe).
 * `probe` est toujours fait avant le plan, `verify` est fait après chaque sortie : ni l'un ni l'autre
 * n'apparaît dans `steps` (le pipeline peut les afficher comme étape en cours).
 */

/** Rendu (§ 32.2) : petit côté au plus, sans agrandissement. */
export const RENDITION_MAX_SHORT_SIDE = 1080
/** Débit moyen au-delà duquel le mode `auto` produit un rendu (bit/s). */
export const RENDITION_MAX_BITRATE = 10_000_000
/** Image presque noire (fondu d'ouverture) : luminance moyenne sous ce seuil (0 à 255), comme la capture du navigateur. */
export const POSTER_DARK_LUMINANCE = 16

export interface PlanInput {
  container: VideoContainer
  /** Métadonnées enregistrées (lecteur de D1, ou ébauche d'un format converti), null si absentes. */
  metadata: VideoMetadata | null
  /**
   * Durée enregistrée du média (s, `Media.duration`), null si inconnue : repli quand ffprobe n'en trouve
   * pas (WebM d'un navigateur, dont le lecteur de D1 estime la durée d'après le dernier bloc).
   */
  duration: number | null
  probe: ProbeResult
  hasPoster: boolean
  settings: { rendition: RenditionMode, av1: boolean, maxDuration: number }
  capabilities: { hdrFilters: boolean, av1: boolean }
  /**
   * Rendus déjà produits pour ce fichier et qu'il est inutile de refaire (reprise d'une tâche interrompue
   * après l'enregistrement d'un rendu) ; une relance volontaire passe [] pour les remplacer.
   */
  existing: RenditionName[]
}

export interface VideoJobPlan {
  /**
   * Échec de la tâche, null sinon. `steps` vide : échec immédiat, rien n'est fait. Sinon (`TOO_LONG`) :
   * échec après les étapes de `steps`, qui ne réencodent rien (retrait des pistes de métadonnées,
   * réparation, affiche) : une vidéo trop longue n'a pas de rendu, mais ses positions GPS sont retirées.
   */
  failure: VideoJobErrorCode | null
  /** Étapes à faire, dans l'ordre de JOB_STEPS (sans `probe` ni `verify`). */
  steps: JobStep[]
  /** Couleurs HDR à convertir en SDR (rendus, affiche extraite de l'original). */
  toneMap: boolean
  /** Dimensions affichées des rendus (paires), null sans rendu à produire. */
  target: { width: number, height: number } | null
  warnings: VideoJobWarning[]
  /**
   * Durée retenue (s) : celle de ffprobe, sinon la durée enregistrée ; null si inconnue. Sert à la limite
   * de durée et au délai des encodages (run.ts, `encodeTimeoutMs`).
   */
  duration: number | null
}

/** Pair inférieur ou égal (≥ 2) : H.264 en 4:2:0 exige des dimensions paires. */
function even(value: number): number {
  return Math.max(2, value - (value % 2))
}

/**
 * Dimensions d'un rendu : petit côté ramené à `maxShort` au plus (jamais agrandi), proportions gardées,
 * dimensions paires (arrondies vers le bas : jamais plus grandes que la source).
 */
export function scaledDimensions(width: number, height: number, maxShort = RENDITION_MAX_SHORT_SIDE): { width: number, height: number } {
  const scale = Math.min(1, maxShort / Math.min(width, height))
  return { width: even(Math.round(width * scale)), height: even(Math.round(height * scale)) }
}

/**
 * Instants essayés pour l'affiche (§ 32.3), comme la capture du navigateur (app/utils/video-frame.ts) :
 * 10 % de la durée (5 s au plus), puis 1 s et 2 s plus loin, jamais après 90 % de la durée. Le pipeline
 * garde la première image dont la luminance moyenne (sharp, `stats()`, voir `frameLuminance`) atteint
 * POSTER_DARK_LUMINANCE, sinon la première extraite.
 */
export function posterTimes(duration: number | null): number[] {
  const known = duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null
  const first = known === null ? 0.5 : Math.min(known * 0.1, 5)
  const times: number[] = []
  for (const offset of [0, 1, 2]) {
    const time = Math.round((known === null ? first + offset : Math.min(first + offset, known * 0.9)) * 1000) / 1000
    if (!times.includes(time)) times.push(time)
  }
  return times
}

/** Luminance moyenne (0 à 255) d'après les moyennes des canaux d'une image (R, V, B ; ou un seul canal gris). */
export function frameLuminance(channelMeans: readonly number[]): number {
  if (channelMeans.length < 3) return channelMeans[0] ?? 0
  return 0.2126 * channelMeans[0]! + 0.7152 * channelMeans[1]! + 0.0722 * channelMeans[2]!
}

/**
 * Le rendu sert-il (§ 32.2) ? Format converti (MKV, AVI…) : toujours, quel que soit le mode — sans rendu,
 * la vidéo, acceptée seulement pour être convertie, ne serait jamais lisible. Sinon `always` : oui ;
 * `never` : non ; `auto` : compatibilité de lecture qui n'est pas « large » (HEVC, AV1, ProRes…),
 * petit côté > 1080 px, débit > 10 Mbit/s, HDR, ou images entrelacées (les navigateurs les affichent sans
 * les désentrelacer : « peignes »).
 */
function renditionUseful(input: PlanInput, video: NonNullable<ProbeResult['video']>): boolean {
  if (isConvertedContainer(input.container)) return true
  const mode = input.settings.rendition
  if (mode !== 'auto') return mode === 'always'
  const playback = input.metadata?.playback ?? videoPlayback(input.container, video.codec, input.probe.audio?.codec ?? null)
  const bitrate = input.probe.bitrate ?? input.metadata?.bitrate ?? null
  return playback !== 'broad'
    || Math.min(video.width, video.height) > RENDITION_MAX_SHORT_SIDE
    || (bitrate !== null && bitrate > RENDITION_MAX_BITRATE)
    || video.hdr !== null
    || video.interlaced
}

/** Durée utilisable (s) : finie et positive, sinon null. */
function knownDuration(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null
}

function failed(failure: VideoJobErrorCode, duration: number | null): VideoJobPlan {
  return { failure, steps: [], toneMap: false, target: null, warnings: [], duration }
}

export function planVideoJob(input: PlanInput): VideoJobPlan {
  const { probe, metadata, container } = input
  const video = probe.video
  const duration = knownDuration(probe.duration) ?? knownDuration(input.duration)
  if (!video) return failed('NO_VIDEO_TRACK', duration)
  if (video.width < 1 || video.height < 1 || video.width > VIDEO_MAX_DIMENSION || video.height > VIDEO_MAX_DIMENSION) return failed('UNREADABLE', duration)

  const wanted = new Set<JobStep>()
  if ((container === 'mp4' || container === 'mov') && (probe.dataStreams.length > 0 || (metadata?.dataTracks.length ?? 0) > 0)) wanted.add('sanitize')
  // WebM d'un navigateur à réparer, seulement si la copie en WebM est possible : un WebM H.264 de Chrome
  // ne l'est pas (son rendu, s'il sert, est la version lisible).
  if (container === 'webm' && (metadata?.durationEstimated === true || probe.duration === null)
    && webmCopyable(video.codec, probe.audioStreams.map(stream => stream.codec))) wanted.add('repair')
  const useful = renditionUseful(input, video)
  if (useful && !input.existing.includes('h264')) wanted.add('transcode')
  if (useful && input.settings.av1 && input.capabilities.av1 && !input.existing.includes('av1')) wanted.add('av1')
  if (!input.hasPoster) wanted.add('poster')

  // Durée bornée pour les réencodages seulement (§ 38) : le reste (copie, affiche) ne coûte presque rien
  // et se fait quand même, la tâche finissant ensuite en échec. Durée inconnue : run.ts arrête un
  // encodage dont la sortie dépasse la limite (`maxOutputSeconds`).
  let failure: VideoJobErrorCode | null = null
  if (duration !== null && duration > input.settings.maxDuration && (wanted.has('transcode') || wanted.has('av1'))) {
    wanted.delete('transcode')
    wanted.delete('av1')
    failure = 'TOO_LONG'
  }

  const toneMap = video.hdr !== null && input.capabilities.hdrFilters
  const encodes = wanted.has('transcode') || wanted.has('av1')
  const warnings: VideoJobWarning[] = []
  // Avertissements sur le rendu seulement : sans rendu, l'original HDR est servi tel quel.
  if (encodes && video.hdr !== null) warnings.push(toneMap ? 'hdr_converted' : 'hdr_unconverted')

  return {
    failure,
    steps: JOB_STEPS.filter(step => wanted.has(step)),
    toneMap,
    target: encodes ? scaledDimensions(video.width, video.height) : null,
    warnings,
    duration,
  }
}
