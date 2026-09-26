/** Ferme proprement les connexions à l'arrêt du serveur (SIGTERM, redémarrage…). */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => disconnectPrisma())
})
