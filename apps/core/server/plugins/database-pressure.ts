import { PRESSURE_MINUTE_MS } from '#shared/utils/database-pressure'
import { reportDatabasePressure, useDatabasePressureMonitor } from '../lib/database/pressure'
import { isWorkerRole } from '../lib/video-processing/settings'

/**
 * Alerte « base SQLite sous pression » (server/lib/database/pressure.ts) : compte les requêtes HTTP du
 * serveur web et enregistre chaque minute le constat de ce processus (serveur web ou processus de
 * travail). En production, rappelle une fois au démarrage les limites de SQLite. Rien avec PostgreSQL ou
 * MySQL.
 */
export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return
  const monitor = useDatabasePressureMonitor()
  if (!monitor) return
  if (!isWorkerRole()) {
    // `beforeEach` (synchrone) plutôt qu'un crochet `request` : hookable enchaîne chaque crochet par une
    // promesse et une tâche, mesuré −16 % de débit sur les réponses 304 de `/m/`.
    nitroApp.hooks.beforeEach((hook) => {
      if (hook.name === 'request') monitor.request()
    })
    if (!import.meta.dev) {
      console.info('[surge-media] Base SQLite : adaptée à un seul serveur et à un trafic modéré (chaque accès à la base bloque le processus). '
        + 'Pour un trafic soutenu ou plusieurs processus, préférez PostgreSQL ou MySQL ; le tableau de bord signale une base sous pression.')
    }
  }
  const timer = setInterval(() => {
    void usePrisma().then(prisma => reportDatabasePressure(prisma)).catch(() => {})
  }, PRESSURE_MINUTE_MS)
  timer.unref()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
