import { availableParallelism } from 'node:os'
import {
  RENDITION_MODES,
  SERVER_ROLES,
  VIDEO_PROCESSING_MODES,
  X264_PRESETS,
  type RenditionMode,
  type ServerRole,
  type VideoProcessingMode,
  type X264Preset,
} from '#shared/utils/video-processing'

/**
 * Réglages du traitement des vidéos (phase D3, architecture § 38). `resolveVideoProcessingSettings`
 * est pur (testé) : les valeurs viennent de `runtimeConfig` (variables NUXT_*, converties par destr :
 * nombres, booléens, chaînes) ; une valeur invalide reprend la valeur par défaut avec un avertissement,
 * jamais d'arrêt du serveur.
 */

export interface VideoProcessingSettings {
  mode: VideoProcessingMode
  role: ServerRole
  ffmpegPath: string
  ffprobePath: string
  /** Tâches simultanées par processus (≥ 1). */
  concurrency: number
  /** Fils par ffmpeg (≥ 1). */
  threads: number
  rendition: RenditionMode
  preset: X264Preset
  crf: number
  av1: boolean
  /** Durée maximale convertie (s). */
  maxDuration: number
  /** Mémoire maximale par ffmpeg (octets, Linux), null = sans limite. */
  memoryLimit: number | null
}

export interface VideoProcessingRaw {
  serverRole?: unknown
  ffmpegPath?: unknown
  ffprobePath?: unknown
  video?: {
    processing?: unknown
    concurrency?: unknown
    threads?: unknown
    rendition?: unknown
    preset?: unknown
    crf?: unknown
    av1?: unknown
    maxDuration?: unknown
    memoryLimit?: unknown
  }
}

const MIB = 1024 * 1024

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T, name: string, warn: (message: string) => void): T {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T
  warn(`${name} : valeur « ${String(value)} » inconnue (${allowed.join(', ')}), « ${fallback} » utilisé.`)
  return fallback
}

function integer(value: unknown, fallback: number, min: number, max: number, name: string, warn: (message: string) => void): number {
  if (value === undefined || value === null || value === '') return fallback
  const number = typeof value === 'number' ? value : Number(String(value).trim())
  if (Number.isInteger(number) && number >= min && number <= max) return number
  warn(`${name} : valeur « ${String(value)} » invalide (entier de ${min} à ${max}), ${fallback} utilisé.`)
  return fallback
}

function flag(value: unknown, fallback: boolean, name: string, warn: (message: string) => void): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['on', 'true', '1', 'yes'].includes(normalized)) return true
  if (['off', 'false', '0', 'no'].includes(normalized)) return false
  warn(`${name} : valeur « ${String(value)} » invalide (on ou off), « ${fallback ? 'on' : 'off'} » utilisé.`)
  return fallback
}

function path(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function resolveVideoProcessingSettings(
  raw: VideoProcessingRaw,
  cpus: number,
  warn: (message: string) => void = () => {},
): VideoProcessingSettings {
  const video = raw.video ?? {}
  const threads = integer(video.threads, 0, 0, 64, 'NUXT_VIDEO_THREADS', warn)
  const memory = integer(video.memoryLimit, 4096, 0, 1_048_576, 'NUXT_VIDEO_MEMORY_LIMIT', warn)
  return {
    mode: choice(video.processing, VIDEO_PROCESSING_MODES, 'off', 'NUXT_VIDEO_PROCESSING', warn),
    role: choice(raw.serverRole, SERVER_ROLES, 'web', 'NUXT_SERVER_ROLE', warn),
    ffmpegPath: path(raw.ffmpegPath, 'ffmpeg'),
    ffprobePath: path(raw.ffprobePath, 'ffprobe'),
    concurrency: integer(video.concurrency, 1, 1, 16, 'NUXT_VIDEO_CONCURRENCY', warn),
    threads: threads === 0 ? Math.max(1, Math.floor(cpus / 2)) : threads,
    rendition: choice(video.rendition, RENDITION_MODES, 'auto', 'NUXT_VIDEO_RENDITION', warn),
    preset: choice(video.preset, X264_PRESETS, 'veryfast', 'NUXT_VIDEO_PRESET', warn),
    crf: integer(video.crf, 23, 0, 51, 'NUXT_VIDEO_CRF', warn),
    av1: flag(video.av1, false, 'NUXT_VIDEO_AV1', warn),
    maxDuration: integer(video.maxDuration, 10_800, 1, 86_400, 'NUXT_VIDEO_MAX_DURATION', warn),
    memoryLimit: memory === 0 ? null : memory * MIB,
  }
}

let cached: VideoProcessingSettings | undefined

/** Réglages de l'installation (lus une fois ; un changement de variable exige un redémarrage). */
export function useVideoProcessingSettings(): VideoProcessingSettings {
  if (!cached) {
    const config = useRuntimeConfig() as unknown as VideoProcessingRaw
    cached = resolveVideoProcessingSettings(config, availableParallelism(), message => console.warn(`[surge-media] ${message}`))
  }
  return cached
}

/** Processus de travail (NUXT_SERVER_ROLE=worker) : exécute les tâches et ne sert que /api/health. */
export function isWorkerRole(): boolean {
  return useVideoProcessingSettings().role === 'worker'
}
