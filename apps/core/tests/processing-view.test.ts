import { describe, expect, it } from 'vitest'
import { displayedAttempt, failureDetailParts, type ProcessingPage, processingNeedsReload, processingTransition, type ProcessingView } from '../app/utils/processing-view'
import type { ProcessingSnapshot } from '../app/composables/useProcessingPoll'

/**
 * Règles d'affichage du traitement dans la fiche d'une vidéo (phase D3, § 37) : annonces, rechargement
 * de la fiche par le suivi, essai affiché, langue du détail technique d'un échec.
 */

const JOB_A = '2026-10-09T10:00:00.000Z'
const JOB_B = '2026-10-09T10:05:00.000Z'

function view(state: ProcessingView['state'], createdAt: string | null = JOB_A, attempts = 0, inTrash = false): ProcessingView {
  return { state, job: createdAt === null ? null : { createdAt, attempts }, inTrash }
}

describe('processingTransition', () => {
  it('début, fin et échec du traitement', () => {
    expect(processingTransition(view('PENDING'), view('PROCESSING'))).toBe('started')
    expect(processingTransition(view('PROCESSING'), view('READY'))).toBe('finished')
    expect(processingTransition(view('PENDING'), view('READY'))).toBe('finished')
    expect(processingTransition(view('PROCESSING'), view('FAILED'))).toBe('failed')
  })

  it('remise en file de la même tâche : échec passager si un essai est compté, sinon interruption sans échec', () => {
    expect(processingTransition(view('PROCESSING', JOB_A, 0), view('PENDING', JOB_A, 1))).toBe('retry')
    expect(processingTransition(view('PROCESSING', JOB_A, 1), view('PENDING', JOB_A, 1))).toBe('requeued')
  })

  it('nouvelle tâche (fichier remplacé, relance depuis une autre page) : rien à annoncer', () => {
    expect(processingTransition(view('PROCESSING', JOB_A, 0), view('PENDING', JOB_B, 0))).toBeNull()
    expect(processingTransition(view('PROCESSING', JOB_A, 1), view('PENDING', JOB_B, 0))).toBeNull()
    expect(processingTransition(view('PROCESSING', null), view('PENDING', JOB_B))).toBeNull()
  })

  it('mise à la corbeille, restauration : rien à annoncer', () => {
    // Restauration d'une vidéo mise à la corbeille pendant le calcul : nouvelle tâche, ou même tâche annulée
    // quand le traitement est inactif.
    expect(processingTransition(view('PROCESSING', JOB_A, 0, true), view('PENDING', JOB_B, 0))).toBeNull()
    expect(processingTransition(view('PROCESSING', JOB_A, 0, true), view('PENDING', JOB_A, 0))).toBeNull()
    expect(processingTransition(view('PROCESSING'), view('PROCESSING', JOB_A, 0, true))).toBeNull()
    expect(processingTransition(view('PENDING', JOB_A, 0, true), view('READY', JOB_A, 0, true))).toBeNull()
  })

  it('pas de changement d\'état, ou état sans tâche suivie : rien', () => {
    expect(processingTransition(view('PROCESSING'), view('PROCESSING'))).toBeNull()
    expect(processingTransition(view('READY'), view('PENDING', JOB_B))).toBeNull()
    expect(processingTransition(view(null, null), view('PENDING'))).toBeNull()
    expect(processingTransition(view('FAILED'), view('READY'))).toBeNull()
  })
})

describe('processingNeedsReload', () => {
  function page(overrides: Partial<ProcessingPage> = {}): ProcessingPage {
    return { version: 2, processingState: 'PROCESSING', processing: { status: 'RUNNING', step: 'probe', createdAt: JOB_A }, renditions: [], ...overrides }
  }
  function snapshot(job: Partial<NonNullable<ProcessingSnapshot['processing']>> | null, overrides: Partial<ProcessingSnapshot> = {}): ProcessingSnapshot {
    return {
      version: 2,
      processingState: 'PROCESSING',
      processing: job && {
        status: 'RUNNING',
        step: 'probe',
        progress: null,
        attempts: 0,
        errorCode: null,
        errorDetail: null,
        warnings: [],
        createdAt: JOB_A,
        startedAt: JOB_A,
        finishedAt: null,
        runAfter: JOB_A,
        updatedAt: JOB_A,
        ...job,
      },
      ...overrides,
    }
  }

  it('nouvelle version, tâche terminée ou en échec : rechargement', () => {
    expect(processingNeedsReload(page(), snapshot({}, { version: 3 }))).toBe(true)
    expect(processingNeedsReload(page(), snapshot({ status: 'DONE' }, { processingState: 'READY' }))).toBe(true)
    expect(processingNeedsReload(page(), snapshot({ status: 'FAILED' }, { processingState: 'FAILED' }))).toBe(true)
  })

  it('avancement de la même tâche : état reporté sans rechargement', () => {
    expect(processingNeedsReload(page(), snapshot({ step: 'sanitize' }))).toBe(false)
    expect(processingNeedsReload(page(), snapshot({ step: 'transcode' }))).toBe(false)
    expect(processingNeedsReload(page(), snapshot(null, { processingState: 'PENDING' }))).toBe(false)
  })

  it('tâche annulée, média toujours en cours (corbeille ailleurs) : rechargement une seule fois', () => {
    expect(processingNeedsReload(page(), snapshot({ status: 'CANCELLED' }))).toBe(true)
    const cancelled = page({ processing: { status: 'CANCELLED', step: 'probe', createdAt: JOB_A } })
    expect(processingNeedsReload(cancelled, snapshot({ status: 'CANCELLED' }, { processingState: 'PENDING' }))).toBe(false)
    // Autre tâche annulée que celle affichée : nouvel état à montrer.
    expect(processingNeedsReload(cancelled, snapshot({ status: 'CANCELLED', createdAt: JOB_B }))).toBe(true)
  })

  it('rendu H.264 enregistré en cours de tâche : rechargement au passage de l\'étape de conversion', () => {
    const transcoding = page({ processing: { status: 'RUNNING', step: 'transcode', createdAt: JOB_A } })
    expect(processingNeedsReload(transcoding, snapshot({ step: 'av1' }))).toBe(true)
    expect(processingNeedsReload(transcoding, snapshot({ step: 'poster' }))).toBe(true)
    // Étape de conversion manquée entre deux lectures.
    expect(processingNeedsReload(page(), snapshot({ step: 'verify' }))).toBe(true)
    // Déjà rechargée (rendu présent, ou étape suivante déjà vue), ou autre tâche : rien.
    expect(processingNeedsReload({ ...transcoding, renditions: [{ name: 'h264' }] }, snapshot({ step: 'av1' }))).toBe(false)
    expect(processingNeedsReload(page({ processing: { status: 'RUNNING', step: 'av1', createdAt: JOB_A } }), snapshot({ step: 'poster' }))).toBe(false)
    expect(processingNeedsReload(transcoding, snapshot({ step: 'poster', createdAt: JOB_B }))).toBe(false)
  })
})

describe('displayedAttempt', () => {
  it('pendant la tâche, après un échec passager : essai à venir ou en cours', () => {
    expect(displayedAttempt('PENDING', { attempts: 0 }, false)).toBeNull()
    expect(displayedAttempt('PENDING', { attempts: 1 }, false)).toBe(2)
    expect(displayedAttempt('PROCESSING', { attempts: 2 }, false)).toBe(3)
    expect(displayedAttempt('PROCESSING', { attempts: 5 }, false)).toBe(3)
  })

  it('échec définitif : seulement quand tous les essais ont été faits', () => {
    expect(displayedAttempt('FAILED', { attempts: 1 }, false)).toBeNull()
    expect(displayedAttempt('FAILED', { attempts: 2 }, false)).toBeNull()
    expect(displayedAttempt('FAILED', { attempts: 3 }, false)).toBe(3)
  })

  it('tâche interrompue par la corbeille, terminée ou absente : rien', () => {
    expect(displayedAttempt('PROCESSING', { attempts: 1 }, true)).toBeNull()
    expect(displayedAttempt('READY', { attempts: 1 }, false)).toBeNull()
    expect(displayedAttempt('PENDING', null, false)).toBeNull()
  })
})

describe('failureDetailParts', () => {
  it('sortie de ffmpeg ou ffprobe : début en français, sortie de l\'outil en anglais', () => {
    expect(failureDetailParts('code 1 : …: Invalid data found when processing input')).toEqual([
      { text: 'code 1 : ', lang: 'fr' },
      { text: '…: Invalid data found when processing input', lang: 'en' },
    ])
    expect(failureDetailParts('signal SIGKILL : Killed')).toEqual([{ text: 'signal SIGKILL : ', lang: 'fr' }, { text: 'Killed', lang: 'en' }])
    expect(failureDetailParts('Sortie illisible : Truncated box header.')).toEqual([
      { text: 'Sortie illisible : ', lang: 'fr' },
      { text: 'Truncated box header.', lang: 'en' },
    ])
  })

  it('texte fixe du serveur : français', () => {
    expect(failureDetailParts('Délai de l\'opération dépassé.')).toEqual([{ text: 'Délai de l\'opération dépassé.', lang: 'fr' }])
    expect(failureDetailParts('Erreur interne (ENOSPC).')).toEqual([{ text: 'Erreur interne (ENOSPC).', lang: 'fr' }])
    expect(failureDetailParts('code 1')).toEqual([{ text: 'code 1', lang: 'fr' }])
  })
})
