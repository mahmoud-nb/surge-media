import { createHash } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { access, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline as streamPipeline } from 'node:stream/promises'
import sharp from 'sharp'
import { type VideoContainer, VIDEO_CONTAINER_BY_MIME, type VideoHdrTransfer, videoMetadata } from '#shared/utils/video'
import {
  JOB_HEARTBEAT_MS,
  JOB_PROGRESS_WRITE_MS,
  type JobStep,
  type RenditionName,
  truncateText,
  type VideoJobErrorCode,
  type VideoJobWarning,
} from '#shared/utils/video-processing'
import type { Media } from '../../generated/prisma/client'
import {
  applyProbeResult,
  catchUpProcessing,
  claimProcessingJob,
  commitRewrittenFile,
  completeProcessingJob,
  failProcessingJob,
  findMedia,
  reapProcessingJobs,
  releaseProcessingJob,
  saveRendition,
  setServerPoster,
} from '../media/service'
import { probeVideoFile, type VideoProbe, VideoProbeError } from '../media/video/probe'
import { useMediaStorage } from '../storage'
import { av1Args, h264Args, isSanitizableContainer, MAX_OUTPUT_SIZE, posterArgs, sanitizeArgs, webmRepairArgs } from './args'
import { type FfmpegCapabilities, useFfmpegCapabilities } from './ffmpeg'
import { runFfprobe } from './ffprobe'
import { expireLease, type JobFailure, type JobLease, JobLost, type JobResult, progressData, renewLease } from './jobs'
import { frameLuminance, planVideoJob, POSTER_DARK_LUMINANCE, posterTimes, type VideoJobPlan } from './plan'
import { createJobRunner, type JobRunner, RunnerHalt, RunnerStopping } from './runner'
import { encodeTimeoutMs, isMissingTool, POSTER_TIMEOUT_MS, REMUX_TIMEOUT_MS, type RunResult, runTool, toolFailure, VideoToolError } from './run'
import type { VideoProcessingSettings } from './settings'
import { parseWorkerId, useWorkerId } from './worker-id'

/**
 * Exécution d'une tâche vidéo prise dans la file (phase D3, architecture § 32, DD28 à DD31) :
 *   1. contrôle : le média existe, n'est pas dans la corbeille, et son fichier est celui de la tâche ;
 *   2. fichier source lu en place (stockage local) ou copié dans le dossier temporaire de la tâche (S3 :
 *      ffmpeg doit pouvoir se déplacer dans le fichier, `moov` en fin) ;
 *   3. `probe` (ffprobe) → résultat enregistré (formats convertis : dimensions, durée, codecs) → plan
 *      (plan.ts, fonction pure) → étapes dans l'ordre, chacune sautée quand elle ne sert à rien ;
 *   4. **chaque sortie est vérifiée par le lecteur de D1** (codec, dimensions, durée ± 0,5 s ou 2 %, taille)
 *      avant d'être enregistrée ; sinon elle est jetée (`CONVERSION_FAILED`) ;
 *   5. fin : média « prêt » (avertissements dans `result`) ou « en échec » (code + résumé sans chemin).
 * Pendant le calcul : étape et avancement écrits au plus toutes les 5 s (tâche seulement, sans
 * invalidation des caches), bail renouvelé toutes les 30 s ; un bail perdu (tâche annulée par un
 * remplacement, la corbeille ou une relance ; reprise ailleurs) arrête ffmpeg et rien n'est écrit.
 *
 * Erreurs (décision 3 du module D) : passagères (délai, ffmpeg tué par un signal, disque plein, stockage
 * ou base indisponibles) → nouvel essai différé ; déterministes (pas de vidéo, illisible, trop longue,
 * original absent, sortie refusée par la vérification) → échec aussitôt ; ffmpeg introuvable → tâche
 * rendue sans compter d'essai et boucle de ce processus arrêtée (processus mal configuré).
 */

/**
 * Préfixe des dossiers temporaires des tâches : `surge-media-job-<installation>-<tâche>-<aléa>`. Le dossier
 * temporaire du système peut être partagé par plusieurs installations (préproduction et production sur
 * une même machine, serveur de développement à côté d'une build) : chacune ne nettoie que les siens.
 */
export const JOB_DIR_PREFIX = 'surge-media-job-'
/** Nettoyage des dossiers temporaires abandonnés (processus arrêté net) : au démarrage, puis toutes les… */
const CLEANUP_INTERVAL_MS = 15 * 60_000
/**
 * Rattrapage (médias « en attente » sans tâche) : au démarrage, puis toutes les… — filet de sécurité :
 * une restauration ou une duplication faite pendant que le serveur web croyait le traitement inactif
 * (cache de 30 s, processus de travail tout juste revenu) ne reste pas sans tâche jusqu'au redémarrage.
 */
const CATCH_UP_INTERVAL_MS = 5 * 60_000

let installation: string | undefined

/**
 * Identifiant court de l'installation, pour les dossiers temporaires : même base (DATABASE_URL) et même
 * dossier de lancement (chemins relatifs de SQLite et du stockage local) = même file de tâches. Le
 * serveur web et un processus de travail lancés depuis le même dossier partagent donc leurs dossiers,
 * ce qui est voulu : la base dit lesquels sont vivants.
 */
export function jobDirPrefix(): string {
  installation ??= createHash('sha256').update(`${process.cwd()}\n${process.env.DATABASE_URL ?? ''}`).digest('hex').slice(0, 8)
  return `${JOB_DIR_PREFIX}${installation}-`
}

/** Échec d'une étape, avec sa suite (nouvel essai ou non). */
class StepFailure extends Error {
  constructor(readonly failure: JobFailure) {
    super(failure.detail)
    this.name = 'StepFailure'
  }
}

function fail(code: VideoJobErrorCode, detail: string, retryable = false): StepFailure {
  return new StepFailure({ code, detail, retryable })
}

/**
 * Lancement de ffmpeg en échec : délai dépassé, processus tué par un signal (mémoire, machine chargée)
 * ou disque plein → passager ; sinon (fichier refusé par ffmpeg) → déterministe, un nouvel essai
 * donnerait la même chose.
 */
/** Écriture de la sortie impossible (disque plein, dossier supprimé, erreur d'E/S) : passagère, pas un défaut du fichier. */
const WRITE_FAILURE = /No space left on device|Input\/output error|Error writing trailer|Unable to re-open .* output file|No such file or directory/i

function runFailure(result: RunResult): StepFailure {
  const error = toolFailure(result, 'CONVERSION_FAILED')
  const transient = error.code === 'TIMEOUT'
    || (error.code === 'CONVERSION_FAILED' && result.code === null)
    || WRITE_FAILURE.test(result.stderrTail)
  return fail(error.code, error.message, transient)
}

/** Échec d'un essai d'après l'erreur levée (voir l'en-tête). */
export function classifyFailure(error: unknown): JobFailure {
  if (error instanceof StepFailure) return error.failure
  if (error instanceof VideoToolError) return { code: error.code, detail: error.message, retryable: error.code === 'TIMEOUT' }
  if (error instanceof VideoProbeError) return { code: 'CONVERSION_FAILED', detail: truncateText(`Sortie illisible : ${error.message}`), retryable: false }
  // Erreurs du service des médias (mediaError) : conflit ou file d'images pleine → passagères ; sortie
  // refusée (type, genre, fichier illisible) → déterministe.
  const http = error as { statusCode?: number, data?: { code?: string } } | null
  if (typeof http?.statusCode === 'number') {
    const transient = http.statusCode === 409 || http.statusCode === 503 || http.statusCode >= 500
    return { code: 'CONVERSION_FAILED', detail: truncateText(`Enregistrement refusé (${http.data?.code ?? http.statusCode}).`), retryable: transient }
  }
  // Stockage, base, système : passager. Le message complet (chemins du serveur, noms d'utilisateur)
  // reste dans le journal ; la fiche ne reçoit qu'un résumé fixe et le code système (EACCES, ENOSPC…).
  console.error('[surge-media] Traitement des vidéos, erreur interne :', error)
  const code = (error as NodeJS.ErrnoException | null)?.code
  const known = typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? ` (${code})` : ''
  return { code: 'CONVERSION_FAILED', detail: `Erreur interne${known} : nouvel essai prévu.`, retryable: true }
}

// ─── Avancement et bail ──────────────────────────────────────────────────────

/** Avancement d'une tâche : étape (écrite aussitôt), progression (au plus toutes les 5 s), bail (toutes les 30 s). */
interface ProgressTracker {
  step: (step: JobStep) => void
  progress: (value: number) => void
  stop: () => Promise<void>
}

function trackProgress(lease: JobLease, onLost: () => void): ProgressTracker {
  let step: JobStep | null = null
  let progress: number | null = null
  let lastWrite = 0
  let writing: Promise<void> | null = null
  let again = false
  let stopped = false

  const write = async (): Promise<void> => {
    lastWrite = Date.now()
    try {
      const kept = await renewLease(await usePrisma(), lease, new Date(), progressData(step, progress))
      if (!kept) onLost()
    }
    catch (error) {
      // Base momentanément indisponible : le bail (2 min) laisse le temps d'un nouvel essai.
      console.warn(`[surge-media] Avancement de la tâche ${lease.id} non enregistré :`, error)
    }
  }
  const flush = (): void => {
    if (stopped) return
    if (writing) {
      again = true
      return
    }
    writing = write().finally(() => {
      writing = null
      if (again) {
        again = false
        flush()
      }
    })
  }
  const heartbeat = setInterval(flush, JOB_HEARTBEAT_MS)
  heartbeat.unref()

  return {
    step(next) {
      step = next
      progress = null
      flush()
    },
    progress(value) {
      progress = value
      if (Date.now() - lastWrite >= JOB_PROGRESS_WRITE_MS) flush()
    },
    async stop() {
      stopped = true
      clearInterval(heartbeat)
      await writing
    },
  }
}

// ─── Fichiers ────────────────────────────────────────────────────────────────

/**
 * Original de la tâche en fichier local : lu en place (stockage local, en lecture seule) ou copié dans le
 * dossier de la tâche. Introuvable : le média est relu ; fichier changé entre-temps → tâche caduque,
 * sinon échec définitif `SOURCE_MISSING`.
 */
async function sourceFile(lease: JobLease, dir: string, signal: AbortSignal): Promise<string> {
  const storage = await useMediaStorage()
  const local = storage.localPath?.(lease.sourceKey)
  if (local) {
    try {
      await access(local, constants.R_OK)
      return local
    }
    catch {
      return missingSource(lease)
    }
  }
  if (!await storage.stat(lease.sourceKey)) return missingSource(lease)
  const path = join(dir, 'source')
  await streamPipeline(await storage.getStream(lease.sourceKey), createWriteStream(path), { signal })
  return path
}

async function missingSource(lease: JobLease): Promise<never> {
  const media = await findMedia(lease.mediaId)
  if (!media || media.deletedAt || media.storageKey !== lease.sourceKey) throw new JobLost('Fichier du média remplacé.')
  throw fail('SOURCE_MISSING', 'Fichier original introuvable dans le stockage.')
}

/** Lance ffmpeg ; échec → StepFailure, arrêt demandé → raison du signal, ffmpeg introuvable → VideoToolError. */
async function ffmpeg(settings: VideoProcessingSettings, args: string[], options: { timeoutMs: number, signal: AbortSignal, onProgress?: (seconds: number) => void, maxOutputSeconds?: number }): Promise<void> {
  let result: RunResult
  try {
    // Développement : ffmpeg reste dans le groupe du terminal, arrêté avec `nuxt dev` (run.ts, `detached`).
    result = await runTool(settings.ffmpegPath, { args, memoryLimit: settings.memoryLimit, detached: !import.meta.dev, ...options })
  }
  catch (error) {
    if (isMissingTool(error)) throw new VideoToolError('FFMPEG_UNAVAILABLE', 'ffmpeg introuvable ou impossible à lancer.')
    // Machine momentanément saturée (EAGAIN, EMFILE, ENOMEM) : nouvel essai, la boucle continue.
    const code = (error as NodeJS.ErrnoException | null)?.code
    throw fail('CONVERSION_FAILED', `Lancement de ffmpeg impossible pour le moment${typeof code === 'string' ? ` (${code})` : ''}.`, true)
  }
  if (result.aborted) {
    options.signal.throwIfAborted()
    throw fail('CONVERSION_FAILED', 'Opération interrompue.', true)
  }
  if (result.code !== 0) throw runFailure(result)
}

// ─── Vérification des sorties ────────────────────────────────────────────────

interface Expectation {
  /** Codec vidéo attendu (code du lecteur de D1), null = non contrôlé. */
  codec: string | null
  /** Durée de référence (s), null si inconnue. */
  duration: number | null
  /** Référence estimée (WebM sans durée) : tolérance élargie. */
  estimated: boolean
  /** Dimensions exactes attendues (rendus). */
  size?: { width: number, height: number }
  /** Son attendu (rendus) ; undefined = non contrôlé. */
  audio?: boolean
  /** Plus aucune piste de métadonnées (retrait). */
  noDataTracks?: boolean
  /** Durée écrite dans le fichier (réparation d'un WebM). */
  exactDuration?: boolean
}

/** Écart de durée toléré : 0,5 s ou 2 % (cadence plafonnée, son plus long que l'image) ; 2 s ou 10 % d'une durée estimée. */
export function durationTolerance(reference: number, estimated: boolean): number {
  return estimated ? Math.max(2, reference * 0.1) : Math.max(0.5, reference * 0.02)
}

/**
 * Vérifie une sortie de ffmpeg avec le lecteur de D1 (§ 32, étape `verify`) : présente, non vide, sous
 * 2 Gio − 1 (`-fs` peut déborder de quelques Kio), lisible, codec, dimensions, son, durée. Renvoie
 * l'analyse (enregistrée avec le rendu).
 */
async function verifyOutput(path: string, mimeType: string, expect: Expectation): Promise<VideoProbe> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size === 0) throw fail('CONVERSION_FAILED', 'Aucune sortie écrite.')
  if (info.size > MAX_OUTPUT_SIZE) throw fail('CONVERSION_FAILED', 'Sortie trop volumineuse (2 Gio au plus).')
  let probe: VideoProbe
  try {
    probe = await probeVideoFile(path, mimeType)
  }
  catch (error) {
    if (error instanceof VideoProbeError) throw fail('CONVERSION_FAILED', truncateText(`Sortie illisible : ${error.message}`))
    throw error
  }
  const { metadata } = probe
  if (expect.codec && metadata.videoCodec !== expect.codec) throw fail('CONVERSION_FAILED', `Codec de sortie inattendu (${metadata.videoCodec ?? '?'}).`)
  if (expect.size && (probe.width !== expect.size.width || probe.height !== expect.size.height)) {
    throw fail('CONVERSION_FAILED', `Dimensions de sortie inattendues (${probe.width} × ${probe.height}).`)
  }
  if (expect.audio !== undefined && metadata.hasAudio !== expect.audio) throw fail('CONVERSION_FAILED', expect.audio ? 'Son absent de la sortie.' : 'Son inattendu dans la sortie.')
  if (expect.noDataTracks && metadata.dataTracks.length > 0) throw fail('CONVERSION_FAILED', `Piste de métadonnées encore présente (${metadata.dataTracks.join(', ')}).`)
  if (expect.exactDuration && (probe.duration === null || metadata.durationEstimated)) throw fail('CONVERSION_FAILED', 'Durée toujours absente de la sortie.')
  if (expect.duration !== null) {
    if (probe.duration === null) throw fail('CONVERSION_FAILED', 'Durée de la sortie inconnue.')
    const gap = Math.abs(probe.duration - expect.duration)
    if (gap > durationTolerance(expect.duration, expect.estimated)) {
      throw fail('CONVERSION_FAILED', `Durée de sortie inattendue (${probe.duration} s au lieu de ${expect.duration} s).`)
    }
  }
  return probe
}

// ─── Affiche ─────────────────────────────────────────────────────────────────

interface PosterSource {
  input: string
  container: VideoContainer
  video: number
  width: number
  height: number
  toneMap: VideoHdrTransfer | null
}

/**
 * Image d'affiche (§ 32.3) : premier instant de `posterTimes` dont l'image n'est pas presque noire
 * (luminance moyenne lue par sharp, même seuil que la capture du navigateur), sinon la première image
 * extraite. Un instant au-delà de la fin n'écrit rien (fichier absent : instant suivant). null : aucune.
 */
async function extractPoster(settings: VideoProcessingSettings, source: PosterSource, duration: number | null, dir: string, signal: AbortSignal): Promise<{ path: string, time: number } | null> {
  let first: { path: string, time: number } | null = null
  const times = posterTimes(duration)
  for (const [index, time] of times.entries()) {
    const output = join(dir, `poster-${index}.jpg`)
    const args = posterArgs({ ...source, output, threads: settings.threads, time })
    try {
      await ffmpeg(settings, args, { timeoutMs: POSTER_TIMEOUT_MS, signal })
    }
    catch (error) {
      if (signal.aborted || error instanceof VideoToolError) throw error
      continue
    }
    const info = await stat(output).catch(() => null)
    if (!info || info.size === 0) continue
    const candidate = { path: output, time }
    first ??= candidate
    const { channels } = await sharp(output).stats()
    if (frameLuminance(channels.map(channel => channel.mean)) >= POSTER_DARK_LUMINANCE) return candidate
  }
  return first
}

// ─── Exécution d'une tâche ───────────────────────────────────────────────────

/**
 * Contexte d'une tâche en cours. Le résultat accumulé est `lease.result` (étapes, avertissements, rendus) :
 * `saveRendition` le remplace quand un rendu est enregistré, il est donc toujours relu sur le bail.
 */
interface JobContext {
  settings: VideoProcessingSettings
  capabilities: FfmpegCapabilities
  dir: string
  signal: AbortSignal
  progress: ProgressTracker
}

/** Résumé d'un échec du plan (affiché dans la fiche). */
function planFailureDetail(plan: VideoJobPlan, settings: VideoProcessingSettings): string {
  switch (plan.failure) {
    case 'NO_VIDEO_TRACK': return 'Aucune piste vidéo dans le fichier.'
    case 'UNREADABLE': return 'Dimensions de la vidéo invalides ou hors limites.'
    case 'TOO_LONG': return `Durée (${Math.round(plan.duration ?? 0)} s) au-delà de la limite de ${settings.maxDuration} s : pas de rendu.`
    default: return 'Traitement impossible.'
  }
}

function addWarning(result: JobResult, warning: VideoJobWarning): void {
  if (!result.warnings.includes(warning)) result.warnings.push(warning)
}

/** Étapes d'une tâche, du contrôle du fichier à l'état final (voir l'en-tête). */
async function processJob(lease: JobLease, context: JobContext): Promise<void> {
  const { settings, capabilities, dir, signal, progress } = context
  const found = await findMedia(lease.mediaId)
  if (!found || found.deletedAt || found.kind !== 'VIDEO' || found.storageKey !== lease.sourceKey) {
    throw new JobLost('Média supprimé, dans la corbeille ou fichier remplacé.')
  }
  /** Média relu après chaque écriture (version, métadonnées, affiche). */
  let media: Media = found
  const container = VIDEO_CONTAINER_BY_MIME[media.mimeType]
  if (!container) throw fail('UNREADABLE', `Type de fichier non traité (${media.mimeType}).`)

  progress.step('probe')
  let source = await sourceFile(lease, dir, signal)
  let probe = await runFfprobe(settings, container, source, signal)
  media = await applyProbeResult(media, lease, probe)

  const plan = planVideoJob({
    container,
    metadata: videoMetadata(media.metadata),
    duration: media.duration,
    probe,
    hasPoster: Boolean(media.posterKey),
    settings,
    capabilities,
    existing: lease.result.renditions,
  })
  for (const warning of plan.warnings) addWarning(lease.result, warning)
  if (plan.failure && plan.steps.length === 0) throw fail(plan.failure, planFailureDetail(plan, settings))

  // Durée de référence des vérifications et des délais : celle du plan, puis celle des réécritures.
  let reference = plan.duration
  let estimated = probe.duration === null
  const hdr = probe.video!.hdr
  let h264: { path: string, width: number, height: number } | null = null

  /** Après une réécriture : nouvelle source (même contenu) et nouvelle analyse (index des flux changés). */
  const rewritten = async (output: string): Promise<void> => {
    source = output
    probe = await runFfprobe(settings, container, source, signal)
    if (probe.duration !== null) {
      reference = probe.duration
      estimated = false
    }
  }

  for (const step of plan.steps) {
    const video = probe.video
    if (!video) throw fail('NO_VIDEO_TRACK', 'Aucune piste vidéo dans le fichier.')
    progress.step(step)
    switch (step) {
      case 'sanitize': {
        if (!isSanitizableContainer(container)) break
        const output = join(dir, `sanitized.${container}`)
        await ffmpeg(settings, sanitizeArgs({ input: source, container, output, video: video.index, audio: probe.audioIndexes }), { timeoutMs: REMUX_TIMEOUT_MS, signal })
        progress.step('verify')
        const before = videoMetadata(media.metadata)
        await verifyOutput(output, media.mimeType, { codec: before?.videoCodec ?? null, duration: reference, estimated, noDataTracks: true })
        media = await commitRewrittenFile(media, output, { lease, rewrite: 'dataTracks', hdr })
        await rewritten(output)
        break
      }
      case 'repair': {
        const output = join(dir, 'repaired.webm')
        await ffmpeg(settings, webmRepairArgs({ input: source, output, video: video.index, audio: probe.audioIndexes }), { timeoutMs: REMUX_TIMEOUT_MS, signal })
        progress.step('verify')
        await verifyOutput(output, 'video/webm', { codec: null, duration: reference, estimated: true, exactDuration: true })
        media = await commitRewrittenFile(media, output, { lease, rewrite: 'webmIndex', hdr })
        await rewritten(output)
        break
      }
      case 'transcode':
      case 'av1': {
        const name: RenditionName = step === 'transcode' ? 'h264' : 'av1'
        const target = plan.target!
        const output = join(dir, name === 'h264' ? 'h264.mp4' : 'av1.webm')
        const encode = {
          input: source,
          container,
          output,
          threads: settings.threads,
          streams: { video: video.index, audio: probe.audio?.index ?? null },
          target,
          fps: video.fps,
          toneMap: plan.toneMap ? video.hdr : null,
        }
        const args = name === 'h264' ? h264Args({ ...encode, preset: settings.preset, crf: settings.crf }) : av1Args(encode)
        await ffmpeg(settings, args, {
          timeoutMs: encodeTimeoutMs(reference, settings.maxDuration),
          maxOutputSeconds: settings.maxDuration,
          signal,
          onProgress: (seconds) => {
            if (reference) progress.progress(seconds / reference)
          },
        })
        progress.step('verify')
        const checked = await verifyOutput(output, name === 'h264' ? 'video/mp4' : 'video/webm', {
          codec: name === 'h264' ? 'avc1' : 'av01',
          size: target,
          audio: probe.audio !== null,
          duration: reference,
          estimated,
        })
        media = await saveRendition(media, lease, name, output, checked)
        if (name === 'h264') h264 = { path: output, width: target.width, height: target.height }
        break
      }
      case 'poster': {
        // Depuis le rendu H.264 quand il existe (couleurs SDR déjà converties), sinon depuis la source.
        const posterSource: PosterSource = h264
          ? { input: h264.path, container: 'mp4', video: 0, width: h264.width, height: h264.height, toneMap: null }
          : { input: source, container, video: video.index, width: video.width, height: video.height, toneMap: plan.toneMap ? video.hdr : null }
        try {
          const picked = await extractPoster(settings, posterSource, reference, dir, signal)
          const saved = picked ? await setServerPoster(media, lease, picked.path, picked.time) : null
          if (saved) media = saved
          else if (!picked) addWarning(lease.result, 'poster_failed')
        }
        catch (error) {
          if (signal.aborted || error instanceof JobLost || error instanceof VideoToolError) throw error
          // Affiche : jamais un échec de la tâche, la vidéo reste utilisable.
          console.warn(`[surge-media] Affiche du média ${lease.mediaId} non extraite :`, error)
          addWarning(lease.result, 'poster_failed')
        }
        break
      }
      default:
        break
    }
    if (!lease.result.steps.includes(step)) lease.result.steps.push(step)
  }

  // Trop longue : étapes sans réencodage faites (positions GPS retirées, affiche), puis échec sans nouvel essai.
  if (plan.failure) throw fail(plan.failure, planFailureDetail(plan, settings))
  // Plus d'écriture d'avancement après la fin (elle serait refusée : la tâche n'est plus en cours).
  await progress.stop()
  await completeProcessingJob(lease, lease.result)
}

/**
 * Exécute une tâche prise (boucle runner.ts) ; `stop` = arrêt du processus. Ne rejette jamais, sauf
 * `RunnerHalt` (ffmpeg introuvable : la tâche est rendue à la file et la boucle de ce processus s'arrête).
 */
export async function runVideoJob(lease: JobLease, stop: AbortSignal, settings: VideoProcessingSettings): Promise<void> {
  const controller = new AbortController()
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason)
  }
  const onStop = () => abort(stop.reason ?? new RunnerStopping())
  if (stop.aborted) onStop()
  else stop.addEventListener('abort', onStop, { once: true })
  const progress = trackProgress(lease, () => abort(new JobLost()))
  let dir: string | null = null

  try {
    dir = await mkdtemp(join(tmpdir(), `${jobDirPrefix()}${lease.id.replace(/[^\w]/g, '')}-`))
    const capabilities = await useFfmpegCapabilities()
    if (!capabilities.ok) throw new VideoToolError('FFMPEG_UNAVAILABLE', 'ffmpeg introuvable ou inutilisable.')
    await processJob(lease, { settings, capabilities, dir, signal: controller.signal, progress })
  }
  catch (error) {
    await progress.stop()
    await settle(lease, error, controller.signal)
  }
  finally {
    await progress.stop()
    stop.removeEventListener('abort', onStop)
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((error: unknown) => console.warn(`[surge-media] Dossier temporaire de la tâche ${lease.id} non supprimé :`, error))
  }
}

/** Suite d'une tâche interrompue ou en échec (voir l'en-tête). */
async function settle(lease: JobLease, error: unknown, signal: AbortSignal): Promise<void> {
  const reason = signal.aborted ? signal.reason : null
  const result = lease.result
  try {
    if (reason instanceof RunnerStopping) {
      await releaseProcessingJob(lease, result)
      return
    }
    if (reason instanceof JobLost || error instanceof JobLost) {
      // Tâche annulée (remplacement, corbeille, relance) ou reprise ailleurs : l'écriture, conditionnée au
      // bail, ne fait rien. Encore à nous (média modifié d'une façon imprévue) : essai compté, nouvel essai
      // différé puis échec définitif, l'état du média suivant chaque fois — jamais une vidéo laissée « en
      // cours » sans tâche (sa diffusion publique pourrait rester retenue).
      await failProcessingJob(lease, { code: 'CONVERSION_FAILED', detail: 'Traitement interrompu : média modifié pendant le calcul.', retryable: true }, result)
      return
    }
    if (error instanceof VideoToolError && error.code === 'FFMPEG_UNAVAILABLE') {
      await releaseProcessingJob(lease, result)
      throw new RunnerHalt(`[surge-media] Traitement des vidéos arrêté sur ce processus : ${error.message} La tâche ${lease.id} est rendue à la file.`)
    }
    const failure = classifyFailure(error)
    const outcome = await failProcessingJob(lease, failure, result)
    if (outcome !== 'lost') {
      const next = outcome === 'retry' ? 'nouvel essai différé' : 'échec définitif'
      console.warn(`[surge-media] Tâche vidéo ${lease.id} (média ${lease.mediaId}) : ${failure.code} — ${failure.detail} (${next}).`)
    }
  }
  catch (settleError) {
    if (settleError instanceof RunnerHalt) throw settleError
    // Base indisponible : la tâche reste RUNNING, reprise à l'expiration de son bail.
    console.error(`[surge-media] Fin de la tâche vidéo ${lease.id} non enregistrée :`, settleError)
  }
}

// ─── Dossiers temporaires, boucle du processus ───────────────────────────────

/**
 * Supprime les dossiers temporaires de tâches qui ne sont plus en cours (processus arrêté net : ffmpeg
 * orphelin, sorties à moitié écrites). Un dossier n'est supprimé que si sa tâche n'est pas en cours avec
 * un bail valide : jamais celui d'une tâche vivante d'un autre processus de la même machine.
 */
export async function cleanupJobDirectories(): Promise<number> {
  const root = tmpdir()
  const prefix = jobDirPrefix()
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const prisma = await usePrisma()
  let removed = 0
  for (const entry of entries) {
    // Dossiers de cette installation seulement (préfixe : voir JOB_DIR_PREFIX).
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    const jobId = entry.name.slice(prefix.length).split('-')[0] ?? ''
    const live = jobId
      ? await prisma.mediaJob.count({ where: { id: jobId, status: 'RUNNING', leaseUntil: { gt: new Date() } } })
      : 0
    if (live > 0) continue
    await rm(join(root, entry.name), { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
      .then(() => removed++)
      .catch(() => {})
  }
  return removed
}

/**
 * Développement seulement : tâches encore « en cours » au nom d'un processus de cette machine qui
 * n'existe plus (`nuxt dev` arrêté par Ctrl+C, qui n'appelle pas le crochet `close`) : leur bail est
 * rendu échu tout de suite, la reprise ordinaire s'en charge (un essai compté) sans attendre 2 min. Pas
 * en production : deux conteneurs peuvent partager un nom d'hôte avec des pid indépendants.
 */
export async function expireDeadHolderLeases(): Promise<number> {
  const self = parseWorkerId(useWorkerId())
  if (!self) return 0
  const prisma = await usePrisma()
  const running = await prisma.mediaJob.findMany({ where: { status: 'RUNNING', lockedBy: { startsWith: `${self.host}:` } } })
  let expired = 0
  for (const job of running) {
    const holder = job.lockedBy ? parseWorkerId(job.lockedBy) : null
    if (!holder || holder.host !== self.host || holder.pid === process.pid || processAlive(holder.pid)) continue
    if (await expireLease(prisma, { id: job.id, lockedBy: job.lockedBy! }, new Date())) expired++
  }
  return expired
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    // EPERM : le processus existe (autre utilisateur).
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Boucle d'exécution des tâches de ce processus (plugin 0.video-processing.ts) : prise des tâches,
 * exécution, entretien (baux échus toutes les 30 s ; dossiers temporaires abandonnés tous les quarts
 * d'heure, et aussitôt après la reprise d'un bail échu : celui de l'essai interrompu, souvent sur cette
 * machine, peut peser autant que la vidéo ; rattrapage toutes les 5 min). `onHalt` : ffmpeg devenu
 * inutilisable (superviseur, runner.ts).
 */
export function createVideoJobRunner(settings: VideoProcessingSettings, workerId: string, onHalt?: (error: RunnerHalt) => void): JobRunner {
  let lastCleanup = 0
  // Le rattrapage vient d'être fait au démarrage (plugin) : le premier passage attend l'intervalle.
  let lastCatchUp = Date.now()
  return createJobRunner<JobLease>({
    concurrency: settings.concurrency,
    claim: () => claimProcessingJob(workerId),
    execute: (lease, signal) => runVideoJob(lease, signal, settings),
    onHalt,
    maintenance: async () => {
      const reaped = await reapProcessingJobs()
      for (const job of reaped) {
        console.warn(`[surge-media] Tâche vidéo ${job.id} (média ${job.mediaId}) : bail expiré, ${job.outcome === 'retry' ? 'remise en file' : 'échec définitif'}.`)
      }
      if (reaped.length > 0 || Date.now() - lastCleanup >= CLEANUP_INTERVAL_MS) {
        lastCleanup = Date.now()
        await cleanupJobDirectories()
      }
      if (Date.now() - lastCatchUp >= CATCH_UP_INTERVAL_MS) {
        lastCatchUp = Date.now()
        const caught = await catchUpProcessing()
        if (caught > 0) console.info(`[surge-media] Traitement des vidéos : ${caught} tâche(s) recréée(s) (médias en attente sans tâche).`)
      }
    },
    onError: (error) => {
      if (error instanceof RunnerHalt) console.error(error.message)
      else console.error('[surge-media] Traitement des vidéos :', error)
    },
  })
}
