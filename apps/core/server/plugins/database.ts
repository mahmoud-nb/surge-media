/**
 * Ferme proprement les connexions à l'arrêt du serveur (SIGTERM, redémarrage…). Les crochets `close`
 * s'exécutent dans l'ordre des fichiers : tout plugin qui écrit encore en base à l'arrêt doit être nommé
 * pour passer avant celui-ci (0.video-processing.ts : tâches vidéo rendues à la file).
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => disconnectPrisma())
})
