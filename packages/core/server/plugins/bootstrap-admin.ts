/** Rappels au démarrage sur le compte d'amorçage (voir authenticateBootstrapAdmin). */
export default defineNitroPlugin(async () => {
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
