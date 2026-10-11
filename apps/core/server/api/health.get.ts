import { useMediaStorage } from '../lib/storage'
import { useVideoProcessingSettings } from '../lib/video-processing/settings'
import { listWorkers, videoProcessingActive } from '../lib/video-processing/status'

type CheckStatus = 'ok' | 'error'

async function probe(check: () => unknown): Promise<CheckStatus> {
  try {
    await check()
    return 'ok'
  }
  catch {
    return 'error'
  }
}

/**
 * Traitement des vidéos (phase D3, § 35) : `workers` = processus en état de traiter la file — processus de
 * travail vus récemment, plus ce serveur en mode `embedded` quand sa boucle tourne (il traite sans écrire
 * de présence) ; `queued` = tâches en attente (une file qui grossit se voit dans la supervision). Null quand
 * rien n'est lu (mode `off`, base injoignable) ou si la lecture échoue : jamais d'erreur, jamais
 * d'influence sur le statut de la sonde. Ni hôte ni version (sonde publique).
 */
async function videoProcessingHealth(database: CheckStatus) {
  const { mode, role } = useVideoProcessingSettings()
  if (mode === 'off' || database !== 'ok') return { mode, workers: null, queued: null }
  try {
    const prisma = await usePrisma()
    const [workers, queued, local] = await Promise.all([
      listWorkers(),
      prisma.mediaJob.count({ where: { status: 'QUEUED' } }),
      mode === 'embedded' && role !== 'worker' ? videoProcessingActive() : false,
    ])
    return { mode, workers: workers.filter(worker => worker.active).length + (local ? 1 : 0), queued }
  }
  catch {
    return { mode, workers: null, queued: null }
  }
}

/**
 * Sonde de santé (Docker, orchestrateur, supervision) : 200 si tout répond, 503 sinon.
 * Ne renvoie que des statuts, jamais de détail d'erreur ni de version. `videoProcessing` (phase D3) est
 * une information, hors `checks` : il ne change jamais le statut (traitement inactif ≠ serveur malade).
 */
export default defineEventHandler(async (event) => {
  const checks = {
    database: await probe(async () => (await usePrisma()).$queryRaw`SELECT 1`),
    storage: await probe(async () => (await useMediaStorage()).healthcheck()),
    // Import dynamique : un binaire sharp absent ou incompatible est signalé sans faire tomber la route.
    imageProcessing: await probe(async () => (await import('sharp')).default.versions.vips),
  }
  const healthy = Object.values(checks).every(status => status === 'ok')
  const videoProcessing = await videoProcessingHealth(checks.database)

  setResponseStatus(event, healthy ? 200 : 503)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { status: healthy ? 'ok' : 'error', checks, videoProcessing }
})
