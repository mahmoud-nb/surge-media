import { runTool } from './run'
import { useVideoProcessingSettings, type VideoProcessingSettings } from './settings'

/**
 * Détection de ffmpeg au démarrage (phase D3, architecture § 30.1, DD25) : binaire du système
 * (NUXT_FFMPEG_PATH, NUXT_FFPROBE_PATH), jamais embarqué. Exigé : ffmpeg ≥ 6, encodeurs `libx264` et
 * `aac`, ffprobe utilisable. Facultatif : filtres `zscale` + `tonemap` (HDR ramené en SDR, sinon rendu
 * fait sans correction et signalé), `libsvtav1` + `libopus` (rendu AV1). Un échec désactive le
 * traitement avec un message clair (journal, « Réglages »), jamais l'arrêt du serveur : `detectFfmpeg`
 * ne lève jamais d'erreur. Lecture des sorties pure, testée.
 */

export const FFMPEG_MIN_MAJOR = 6

/** Problèmes qui empêchent le traitement (codes traduits par l'interface, `settings.video.problems.*`). */
export const FFMPEG_PROBLEMS = ['ffmpeg_unavailable', 'ffmpeg_outdated', 'ffprobe_unavailable', 'libx264_missing', 'aac_missing'] as const
export type FfmpegProblem = (typeof FFMPEG_PROBLEMS)[number]

/** Encodeurs utiles, seuls gardés dans les capacités (présence du processus de travail, « Réglages »). */
export const RELEVANT_ENCODERS = ['libx264', 'aac', 'libsvtav1', 'libopus'] as const

export interface FfmpegCapabilities {
  /** Traitement possible : aucun problème. */
  ok: boolean
  /** Version annoncée (`6.1.1-3ubuntu5`, `7.1-full_build-www.gyan.dev`…), null si ffmpeg est introuvable. */
  version: string | null
  major: number | null
  /** Encodeurs utiles présents (parmi RELEVANT_ENCODERS). */
  encoders: string[]
  /** Conversion HDR → SDR possible (`zscale` + `tonemap`). */
  hdrFilters: boolean
  /** Rendu AV1 possible (`libsvtav1` + `libopus`). */
  av1: boolean
  problems: FfmpegProblem[]
}

/** Délai de chaque commande de détection. */
const DETECTION_TIMEOUT_MS = 10_000
const DETECTION_OUTPUT_LIMIT = 2 * 1024 * 1024

/**
 * Version de ffmpeg (`ffmpeg version 6.1.1-3ubuntu5 Copyright…`). Version majeure lue au début du numéro
 * (`6.1`, `n7.0.2`) ; pour les versions de développement (`N-117000-g…`, `2024-10-10-git-…`), déduite de
 * libavformat (60 = ffmpeg 6, 61 = ffmpeg 7…). Null si la sortie n'est pas celle de ffmpeg.
 */
export function parseFfmpegVersion(output: string): { version: string, major: number | null } | null {
  const match = /^\s*ffmpeg version (\S+)/m.exec(output)
  if (!match) return null
  const version = match[1]!.slice(0, 64)
  const numbered = /^n?(\d+)\.\d+/.exec(version)
  if (numbered) return { version, major: Number(numbered[1]) }
  const libavformat = /^\s*libavformat\s+(\d+)\./m.exec(output)
  const major = libavformat ? Number(libavformat[1]) - 54 : null
  return { version, major: major !== null && major > 0 ? major : null }
}

/** Noms des encodeurs de `ffmpeg -encoders` (lignes ` V....D libx264  …` après la légende). */
export function parseEncoders(output: string): Set<string> {
  const encoders = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s([VAS][A-Z.]{5})\s+(\S+)/.exec(line)
    // La légende (` V..... = Video`) a la même forme : son « nom » est `=`.
    if (match && match[2] !== '=') encoders.add(match[2]!)
  }
  return encoders
}

/** Noms des filtres de `ffmpeg -filters` (lignes ` .SC zscale  V->V  …`). */
export function parseFilters(output: string): Set<string> {
  const filters = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s[A-Z.]{3}\s+(\S+)\s+\S*->\S*/.exec(line)
    if (match) filters.add(match[1]!)
  }
  return filters
}

/** Sorties des commandes de détection ; null = commande impossible à lancer ou en échec. */
export interface DetectionOutputs {
  version: string | null
  encoders: string | null
  filters: string | null
  ffprobe: string | null
}

/** Capacités et problèmes d'après les sorties de `-version`, `-encoders`, `-filters` et `ffprobe -version`. */
export function evaluateCapabilities(outputs: DetectionOutputs): FfmpegCapabilities {
  const parsed = outputs.version === null ? null : parseFfmpegVersion(outputs.version)
  const problems: FfmpegProblem[] = []
  if (!parsed) {
    problems.push('ffmpeg_unavailable')
    if (outputs.ffprobe === null) problems.push('ffprobe_unavailable')
    return { ok: false, version: null, major: null, encoders: [], hdrFilters: false, av1: false, problems }
  }
  const encoders = parseEncoders(outputs.encoders ?? '')
  const filters = parseFilters(outputs.filters ?? '')
  // Version de développement illisible : acceptée (ces versions sont plus récentes que les publiées).
  if (parsed.major !== null && parsed.major < FFMPEG_MIN_MAJOR) problems.push('ffmpeg_outdated')
  if (outputs.ffprobe === null) problems.push('ffprobe_unavailable')
  if (!encoders.has('libx264')) problems.push('libx264_missing')
  if (!encoders.has('aac')) problems.push('aac_missing')
  return {
    ok: problems.length === 0,
    version: parsed.version,
    major: parsed.major,
    encoders: RELEVANT_ENCODERS.filter(name => encoders.has(name)),
    hdrFilters: filters.has('zscale') && filters.has('tonemap'),
    av1: encoders.has('libsvtav1') && encoders.has('libopus'),
    problems,
  }
}

const PROBLEM_MESSAGES: Record<FfmpegProblem, string> = {
  ffmpeg_unavailable: 'ffmpeg introuvable ou inutilisable (NUXT_FFMPEG_PATH)',
  ffmpeg_outdated: `ffmpeg trop ancien (version ${FFMPEG_MIN_MAJOR} ou plus exigée)`,
  ffprobe_unavailable: 'ffprobe introuvable ou inutilisable (NUXT_FFPROBE_PATH)',
  libx264_missing: 'encodeur libx264 absent de ce ffmpeg',
  aac_missing: 'encodeur aac absent de ce ffmpeg',
}

/** Message (journal du serveur, en français) d'un problème de détection. */
export function ffmpegProblemMessage(problem: FfmpegProblem): string {
  return PROBLEM_MESSAGES[problem]
}

/** Sortie d'une commande de détection, null si elle ne peut pas être lancée ou échoue. */
async function detectionOutput(binary: string, args: string[]): Promise<string | null> {
  try {
    const result = await runTool(binary, { args, timeoutMs: DETECTION_TIMEOUT_MS, stdoutLimit: DETECTION_OUTPUT_LIMIT })
    return result.code === 0 ? result.stdout : null
  }
  catch {
    return null
  }
}

/** Contrôle de ffmpeg et ffprobe (quatre commandes courtes, en parallèle). Ne lève jamais d'erreur. */
export async function detectFfmpeg(settings: Pick<VideoProcessingSettings, 'ffmpegPath' | 'ffprobePath'>): Promise<FfmpegCapabilities> {
  const [version, encoders, filters, ffprobe] = await Promise.all([
    detectionOutput(settings.ffmpegPath, ['-hide_banner', '-version']),
    detectionOutput(settings.ffmpegPath, ['-hide_banner', '-encoders']),
    detectionOutput(settings.ffmpegPath, ['-hide_banner', '-filters']),
    detectionOutput(settings.ffprobePath, ['-hide_banner', '-version']),
  ])
  return evaluateCapabilities({ version, encoders, filters, ffprobe })
}

let cached: Promise<FfmpegCapabilities> | undefined

/** Capacités de ffmpeg de ce processus (détectées une fois ; un changement de ffmpeg exige un redémarrage). */
export function useFfmpegCapabilities(): Promise<FfmpegCapabilities> {
  cached ??= detectFfmpeg(useVideoProcessingSettings())
  return cached
}

/** Oublie la détection (tests). */
export function resetFfmpegCapabilities(): void {
  cached = undefined
}
