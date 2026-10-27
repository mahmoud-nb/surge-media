import { listenErrorMessage } from '../lib/listen-error'
import { isWorkerRole } from '../lib/video-processing/settings'

/**
 * Échec de l'écoute (port déjà utilisé, interdit, hôte invalide). Le serveur de Nitro (preset node-server)
 * n'écoute pas l'événement `error` de `server.listen` : l'erreur devient une exception non interceptée que
 * Nitro se contente de journaliser (trace brute), puis le processus se termine avec le code 0, un échec
 * invisible pour systemd, pm2 ou une politique de redémarrage « on-failure ». Ce plugin, chargé avant
 * l'écoute, affiche un message clair et sort avec le code 1. La CLI essaie déjà le port avant de lancer le
 * serveur (cli/server.ts) ; ce plugin couvre l'image Docker, `pnpm start` et un port pris entre-temps.
 * En développement, l'écoute appartient à `nuxt dev`. À revérifier avec Nitro 3.
 */
export default defineNitroPlugin(() => {
  if (import.meta.dev) return
  const worker = isWorkerRole()
  process.prependListener('uncaughtException', (error) => {
    const message = listenErrorMessage(error, worker)
    if (!message) return
    console.error(message)
    process.exit(1)
  })
})
