/**
 * Traitement des vidéos par ffmpeg (phase D3) : modes, états, étapes, codes d'erreur, rendus et règles
 * pures partagées par le serveur (file, processus de travail, diffusion) et l'interface (fiche, réglages).
 */

/**
 * Mode de traitement (NUXT_VIDEO_PROCESSING) : `off` = aucun traitement, comportement de D2 ;
 * `embedded` = le serveur web exécute les tâches (ffmpeg en priorité la plus basse) ; `external` = des
 * processus de travail séparés exécutent les tâches, le serveur web ne fait que les créer.
 */
export const VIDEO_PROCESSING_MODES = ['off', 'embedded', 'external'] as const
export type VideoProcessingMode = (typeof VIDEO_PROCESSING_MODES)[number]

/** Rôle du processus (NUXT_SERVER_ROLE) : `worker` = exécute les tâches, ne sert que /api/health. */
export const SERVER_ROLES = ['web', 'worker'] as const
export type ServerRole = (typeof SERVER_ROLES)[number]

/**
 * Production du rendu compatible (NUXT_VIDEO_RENDITION) : `auto` = seulement s'il sert (codec à
 * compatibilité variable, format converti, définition ou débit trop élevés, HDR) ; `always` ; `never`
 * (sauf format converti, illisible sans rendu).
 */
export const RENDITION_MODES = ['auto', 'always', 'never'] as const
export type RenditionMode = (typeof RENDITION_MODES)[number]

/** Préréglages x264 acceptés (NUXT_VIDEO_PRESET), du plus rapide au plus économe. */
export const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'] as const
export type X264Preset = (typeof X264_PRESETS)[number]

/** État résumé sur le média (`Media.processingState`) ; null = non concerné. */
export const PROCESSING_STATES = ['PENDING', 'PROCESSING', 'READY', 'FAILED'] as const
export type ProcessingStateValue = (typeof PROCESSING_STATES)[number]

/** Statut d'une tâche (`MediaJob.status`). */
export const MEDIA_JOB_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'] as const
export type MediaJobStatusValue = (typeof MEDIA_JOB_STATUSES)[number]

/** État exposé par l'API v1 (`Media.processing.status`). */
export const API_PROCESSING_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const
export type ApiProcessingStatus = (typeof API_PROCESSING_STATUSES)[number]

export function apiProcessingStatus(state: ProcessingStateValue): ApiProcessingStatus {
  return state.toLowerCase() as ApiProcessingStatus
}

/**
 * Étapes d'une tâche, dans l'ordre d'exécution (§ 32). Les réécritures sans perte (`sanitize`, `repair`)
 * passent avant les réencodages ; l'affiche est extraite en dernier, d'un rendu SDR s'il existe (et
 * laisse le temps à l'affiche capturée par le navigateur d'arriver la première).
 */
export const JOB_STEPS = ['probe', 'sanitize', 'repair', 'transcode', 'av1', 'poster', 'verify'] as const
export type JobStep = (typeof JOB_STEPS)[number]

/** Codes d'échec d'une tâche (`MediaJob.errorCode`), traduits par l'interface. */
export const VIDEO_JOB_ERROR_CODES = [
  'NO_VIDEO_TRACK', // aucun flux vidéo dans le fichier
  'UNREADABLE', // fichier illisible par ffprobe ou ffmpeg
  'CONVERSION_FAILED', // ffmpeg a échoué, ou sa sortie n'a pas passé la vérification
  'TOO_LONG', // durée au-delà de NUXT_VIDEO_MAX_DURATION
  'TIMEOUT', // délai de l'opération dépassé
  'SOURCE_MISSING', // fichier original introuvable dans le stockage
  'FFMPEG_UNAVAILABLE', // ffmpeg absent ou inutilisable sur le processus de travail
] as const
export type VideoJobErrorCode = (typeof VIDEO_JOB_ERROR_CODES)[number]

/** Avertissements d'une tâche (`MediaJob.result.warnings`), traduits par l'interface. */
export const VIDEO_JOB_WARNINGS = [
  'hdr_converted', // couleurs HDR converties en SDR pour le rendu H.264
  'hdr_unconverted', // HDR sans les filtres de conversion : rendu fait sans correction des couleurs
  'poster_failed', // affiche non extraite (la vidéo reste utilisable)
] as const
export type VideoJobWarning = (typeof VIDEO_JOB_WARNINGS)[number]

/** Rendus produits par réencodage (§ 32.2, § 34), dans l'ordre de préférence de `sources[]`. */
export const RENDITION_NAMES = ['av1', 'h264'] as const
export type RenditionName = (typeof RENDITION_NAMES)[number]

export const RENDITION_FORMATS: Readonly<Record<RenditionName, { container: 'mp4' | 'webm', mimeType: string }>> = {
  av1: { container: 'webm', mimeType: 'video/webm' },
  h264: { container: 'mp4', mimeType: 'video/mp4' },
}

export function isRenditionName(value: unknown): value is RenditionName {
  return (RENDITION_NAMES as readonly unknown[]).includes(value)
}

/** Constantes de la file (§ 31.2). */
export const JOB_LEASE_MS = 120_000
export const JOB_HEARTBEAT_MS = 30_000
export const JOB_POLL_MS = 5_000
export const JOB_MAX_ATTEMPTS = 3
/** Reprise différée après le 1er et le 2e échec (le 3e est définitif). */
export const JOB_RETRY_DELAYS_MS = [30_000, 300_000] as const
/** Écriture de l'avancement en base au plus toutes les… */
export const JOB_PROGRESS_WRITE_MS = 5_000
/** Priorité des tâches créées pour les vidéos déjà envoyées (passent après les envois récents). */
export const BACKFILL_PRIORITY = -10
/** Un processus de travail vu dans cette fenêtre rend le mode `external` actif. */
export const WORKER_SEEN_WINDOW_MS = 300_000
/** Présence d'un processus de travail : `Setting` `videoWorker:<id>`, réécrit toutes les 60 s. */
export const WORKER_PRESENCE_PREFIX = 'videoWorker:'
export const WORKER_PRESENCE_MS = 60_000
/** `Retry-After` (s) d'une diffusion retenue tant qu'une piste de métadonnées n'est pas retirée (§ 32.4). */
export const PROCESSING_RETRY_AFTER = 30
/** Longueur maximale des textes courts stockés (MySQL : VARCHAR(191)). */
export const JOB_TEXT_MAX = 191

/** Texte tronqué à `max` caractères (points de suspension compris). */
export function truncateText(value: string, max = JOB_TEXT_MAX): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/**
 * Délai avant la reprise d'une tâche après son `attempts`-ième échec, ou null quand les essais sont
 * épuisés (la tâche passe alors en échec définitif).
 */
export function retryDelay(attempts: number): number | null {
  if (attempts >= JOB_MAX_ATTEMPTS) return null
  return JOB_RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? JOB_RETRY_DELAYS_MS[JOB_RETRY_DELAYS_MS.length - 1]!
}

/**
 * Diffusion retenue (§ 32.4, DD31) : tant que le retrait d'une piste de métadonnées de l'appareil
 * (positions GPS…) est en attente ou en cours, l'original et ses rendus ne sont servis qu'aux liens
 * « admin » (503 PROCESSING_PENDING pour les autres). Levée dès que la réécriture est enregistrée (la
 * nouvelle analyse ne trouve plus de piste), en échec définitif, ou si le traitement est désactivé.
 */
export function deliveryHeld(
  media: { kind: string, processingState: ProcessingStateValue | null, metadata: unknown },
  mode: VideoProcessingMode,
): boolean {
  if (mode === 'off' || media.kind !== 'VIDEO') return false
  if (media.processingState !== 'PENDING' && media.processingState !== 'PROCESSING') return false
  const tracks = (media.metadata as { dataTracks?: unknown } | null)?.dataTracks
  return Array.isArray(tracks) && tracks.length > 0
}
