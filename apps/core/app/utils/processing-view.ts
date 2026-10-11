/**
 * Règles d'affichage du traitement d'une vidéo dans sa fiche (phase D3, architecture § 37), sans Vue ni
 * Nuxt (tests/processing-view.test.ts) : changements d'état à annoncer, réponses du suivi qui demandent de
 * recharger la fiche, essai affiché, langue des parties du détail technique d'un échec.
 */
import { type JobStep, JOB_MAX_ATTEMPTS, JOB_STEPS, type ProcessingStateValue } from '#shared/utils/video-processing'
import { type ProcessingJobView, type ProcessingSnapshot, processingInProgress } from '../composables/useProcessingPoll'

// ─── Annonces ────────────────────────────────────────────────────────────────

export type ProcessingTransition = 'started' | 'finished' | 'failed' | 'retry' | 'requeued'

/** Ce que la fiche montre du traitement à un instant donné. */
export interface ProcessingView {
  /** État du média (et non le statut de la tâche). */
  state: ProcessingStateValue | null
  /** Dernière tâche : sa date de création l'identifie. */
  job: Pick<ProcessingJobView, 'createdAt' | 'attempts'> | null
  /** Média dans la corbeille : tâche annulée, affichée « interrompue ». */
  inTrash: boolean
}

/**
 * Changement à annoncer entre deux vues du même média, ou null :
 *   - corbeille avant ou après (mise à la corbeille, restauration) : rien, la bannière et la section le
 *     disent ;
 *   - en attente → en cours : début ; en attente ou en cours → prête ou en échec : fin, échec ;
 *   - en cours → en attente : remise en file de la même tâche (même date de création), échec passager si
 *     un essai de plus a été compté, sinon tâche rendue sans échec (serveur arrêté pendant le calcul,
 *     jobs.ts `releaseJob`). Nouvelle tâche (fichier remplacé, traitement relancé depuis une autre page) :
 *     rien, ce n'est pas une interruption.
 */
export function processingTransition(before: ProcessingView, after: ProcessingView): ProcessingTransition | null {
  if (before.inTrash || after.inTrash) return null
  if (before.state === 'PENDING' && after.state === 'PROCESSING') return 'started'
  if (before.state === 'PROCESSING' && after.state === 'PENDING') {
    if (!before.job || !after.job || before.job.createdAt !== after.job.createdAt) return null
    return after.job.attempts > before.job.attempts ? 'retry' : 'requeued'
  }
  if (!processingInProgress(before.state)) return null
  if (after.state === 'READY') return 'finished'
  return after.state === 'FAILED' ? 'failed' : null
}

// ─── Rechargement de la fiche par le suivi ───────────────────────────────────

/** Ce que la fiche affiche quand arrive la réponse du suivi. */
export interface ProcessingPage {
  version: number
  processingState: ProcessingStateValue | null
  processing: Pick<ProcessingJobView, 'status' | 'step' | 'createdAt'> | null
  renditions: readonly { name: string }[]
}

const TRANSCODE_STEP = JOB_STEPS.indexOf('transcode')

function stepIndex(step: JobStep | null | undefined): number {
  return step ? JOB_STEPS.indexOf(step) : -1
}

/**
 * Réponse du suivi (ou de « Relancer ») qui demande de recharger toute la fiche plutôt que d'y reporter
 * l'état et la tâche :
 *   - nouvelle version (fichier réécrit par la tâche, rendu remplacé) ;
 *   - tâche terminée ou en échec : sources du lecteur, rendus, affiche, métadonnées ;
 *   - dernière tâche annulée alors que le média reste en attente ou en cours : seule la mise à la corbeille
 *     fait cela (un remplacement ou une relance crée aussitôt une autre tâche), ici faite ailleurs (autre
 *     onglet, autre compte) — bannière, sections masquées, suivi arrêté. Une fois par tâche annulée : une
 *     restauration quand le traitement est inactif laisse le média en attente avec cette tâche ;
 *   - même tâche passée au-delà de la conversion H.264 alors que la fiche n'a pas ce rendu : il est enregistré
 *     en cours de tâche, sans nouvelle version (lecteur, téléchargement, format converti enfin lisible). Une
 *     fois par essai (sans conversion prévue, un rechargement inutile au plus).
 */
export function processingNeedsReload(page: ProcessingPage, snapshot: ProcessingSnapshot): boolean {
  if (snapshot.version !== page.version || !processingInProgress(snapshot.processingState)) return true
  const job = snapshot.processing
  if (!job) return false
  const sameJob = page.processing?.createdAt === job.createdAt
  if (job.status === 'CANCELLED') return !(sameJob && page.processing?.status === 'CANCELLED')
  if (!sameJob || page.renditions.some(rendition => rendition.name === 'h264')) return false
  return stepIndex(page.processing?.step) <= TRANSCODE_STEP && stepIndex(job.step) > TRANSCODE_STEP
}

// ─── Essai affiché ───────────────────────────────────────────────────────────

/**
 * Essai à afficher (« 2 sur 3 »), ou null :
 *   - tâche en attente ou en cours après un échec passager : essai à venir ou en cours (`attempts` = essais
 *     déjà échoués) ;
 *   - échec définitif : seulement quand tous les essais ont été faits (« 3 sur 3 ») ; un échec définitif
 *     plus tôt (erreur déterministe après un échec passager) laisserait croire à d'autres essais ;
 *   - tâche interrompue (corbeille), terminée, ou sans échec : rien.
 */
export function displayedAttempt(state: ProcessingStateValue | null, job: Pick<ProcessingJobView, 'attempts'> | null, interrupted: boolean): number | null {
  if (!job || job.attempts === 0 || interrupted) return null
  if (processingInProgress(state)) return Math.min(job.attempts + 1, JOB_MAX_ATTEMPTS)
  return state === 'FAILED' && job.attempts >= JOB_MAX_ATTEMPTS ? JOB_MAX_ATTEMPTS : null
}

// ─── Détail technique d'un échec ─────────────────────────────────────────────

export interface DetailPart {
  text: string
  lang: 'fr' | 'en'
}

/**
 * Début du détail suivi de la sortie d'un outil, en anglais : ffmpeg et ffprobe (run.ts `toolFailure` :
 * « code 1 : <dernières lignes> », « signal SIGKILL : … ») et lecteur de vidéos de D1 (pipeline.ts :
 * « Sortie illisible : <message> »).
 */
const TOOL_OUTPUT = /^((?:code -?\d+|signal \S+|Sortie illisible) : )(\S[\s\S]*)$/

/**
 * Parties du détail technique d'un échec (`errorDetail`) avec leur langue (WCAG 3.1.2), quelle que soit
 * celle de l'interface : texte fixe du serveur en français, sortie des outils en anglais.
 */
export function failureDetailParts(detail: string): DetailPart[] {
  const match = TOOL_OUTPUT.exec(detail)
  if (!match) return [{ text: detail, lang: 'fr' }]
  return [{ text: match[1]!, lang: 'fr' }, { text: match[2]!, lang: 'en' }]
}
