import { isWorkerRole } from '../lib/video-processing/settings'

/**
 * Rappels au démarrage sur le compte d'amorçage (voir authenticateBootstrapAdmin). Pas dans un processus
 * de travail (phase D3) : il ne sert pas l'administration, le serveur web le signale déjà.
 */
export default defineNitroPlugin(async () => {
  if (isWorkerRole()) return
  const { bootstrapAdmin } = useRuntimeConfig()
  const credentialsSet = Boolean(bootstrapAdmin.email || bootstrapAdmin.password)

  try {
    const users = await (await usePrisma()).user.count()
    if (users === 0 && !(bootstrapAdmin.email && bootstrapAdmin.password)) {
      console.warn('[surge-media] Aucun utilisateur : définissez NUXT_BOOTSTRAP_ADMIN_EMAIL et NUXT_BOOTSTRAP_ADMIN_PASSWORD pour la première connexion.')
    }
    else if (users > 0 && credentialsSet) {
      console.warn('[surge-media] Un compte existe déjà : supprimez NUXT_BOOTSTRAP_ADMIN_EMAIL et NUXT_BOOTSTRAP_ADMIN_PASSWORD de l\'environnement.')
    }
  }
  catch {
    // Base indisponible ou non configurée : signalé par GET /api/health.
  }
})
