import type { App } from 'vue'
import { createSurgeMediaContext, SURGE_MEDIA_KEY, type SurgeMediaContext, type SurgeMediaOptions } from './context'

export interface SurgeMediaPlugin {
  readonly context: SurgeMediaContext
  install: (app: App) => void
}

/**
 * Plugin Vue de SurgeMedia : `app.use(createSurgeMedia({ baseUrl, projectId, publishableKey }))`. Fournit
 * le client, la langue et les réglages du projet à tous les composants ; dans le navigateur, lit le projet
 * (politique de transformation, formats activés) au démarrage. En rendu serveur, créer le plugin pour
 * chaque requête (jamais au niveau du module : un jeton délégué est propre à un utilisateur).
 */
export function createSurgeMedia(options: SurgeMediaOptions = {}): SurgeMediaPlugin {
  const context = createSurgeMediaContext(options)
  return {
    context,
    install(app: App) {
      app.provide(SURGE_MEDIA_KEY, context)
      const inBrowser = typeof window !== 'undefined'
      if (inBrowser && context.client && !options.project && options.loadProject !== false) void context.refreshProject()
    },
  }
}
