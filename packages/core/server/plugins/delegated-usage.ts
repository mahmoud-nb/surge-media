import { purgeDelegatedUsage } from '../lib/access/delegated'

/**
 * Purge périodique des compteurs d'envois des jetons délégués expirés (DelegatedTokenUsage) :
 * une fois par heure, et une minute après le démarrage. Un échec est seulement journalisé.
 */
const INTERVAL_MS = 60 * 60_000

export default defineNitroPlugin((nitroApp) => {
  const purge = () => {
    purgeDelegatedUsage().catch((error: unknown) => console.error('[surge-media] Purge des compteurs de jetons délégués impossible :', error))
  }
  const first = setTimeout(purge, 60_000)
  const timer = setInterval(purge, INTERVAL_MS)
  first.unref()
  timer.unref()
  nitroApp.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(timer)
  })
})
