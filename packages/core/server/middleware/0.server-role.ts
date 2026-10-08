import { isWorkerRole } from '../lib/video-processing/settings'
import { servedByWorker } from '../lib/video-processing/status'

/**
 * Processus de travail (NUXT_SERVER_ROLE=worker, phase D3, § 30.2) : même build que le serveur web, mais
 * il n'exécute que les tâches vidéo et ne sert que `/api/health` (sonde des conteneurs). Toute autre
 * route répond 404 en texte brut — ni administration, ni API, ni diffusion, ni rendu de pages (pas de
 * page d'erreur Nuxt à produire). Nommé « 0. » pour passer avant les autres middlewares.
 *
 * Limite connue : en production, Nitro sert les fichiers statiques (`/_nuxt/*`, `public/`) avant les
 * middlewares ; ce sont des fichiers publics, sans données.
 */
export default defineEventHandler((event) => {
  if (!isWorkerRole()) return
  if (servedByWorker(event.path.split('?')[0]!)) return
  setResponseStatus(event, 404)
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return 'Not Found'
})
