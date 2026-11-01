import { setDemoUploadGuard } from '../lib/demo/quota'
import { isWorkerRole } from '../lib/video-processing/settings'

/**
 * Mode démo (NUXT_DEMO_MODE, architecture : .claude/architecture-demo.md) :
 *   - `X-Robots-Tag: noindex, nofollow` sur toutes les réponses, médias compris (aucune page de la démo ne doit
 *     être indexée ; pas de `Disallow` dans robots.txt : les robots ne liraient plus cet en-tête) ;
 *   - arrêt du serveur web à l'heure de la remise à zéro (`demoNextResetAt`) par le gestionnaire de SIGTERM de
 *     Nitro, qui ferme proprement les connexions ; Docker relance le conteneur et l'image restaure l'instantané
 *     avant de démarrer (docker/entrypoint.sh). En `nuxt dev`, un message seulement ;
 *   - volume d'envoi du cycle branché sur la réception des fichiers (`429 DEMO_QUOTA`).
 */
export default defineNitroPlugin((nitroApp) => {
  const demo = useDemo()
  if (!demo.enabled) return

  setDemoUploadGuard({ check: assertDemoUploadAllowed, record: recordDemoUpload })

  nitroApp.hooks.hook('request', (event) => {
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  })

  const { media, siteUrl } = useRuntimeConfig()
  const publicUrl = String(media?.publicUrl ?? '').trim()
  if (publicUrl && originOf(publicUrl) !== originOf(String(siteUrl ?? ''))) {
    console.warn('[surge-media] Démo : NUXT_MEDIA_PUBLIC_URL désigne un autre site ; le cookie de session n\'y est pas envoyé et les médias des visiteurs y restent invisibles.')
  }

  if (isWorkerRole()) return
  const resetAt = demoNextResetAt()
  console.info(`[surge-media] Démo : remise à zéro prévue le ${new Date(resetAt).toISOString()} (toutes les ${demo.resetInterval} min).`)
  const timer = setTimeout(() => {
    if (import.meta.dev) {
      console.info('[surge-media] Démo : heure de la remise à zéro (développement : le serveur n\'est pas arrêté).')
      return
    }
    console.info('[surge-media] Démo : remise à zéro, arrêt du serveur.')
    // Arrêt propre de Nitro (connexions en cours, crochet `close`) sur toutes les plateformes : son gestionnaire de
    // SIGTERM est appelé directement (sous Windows, process.kill arrêterait le processus net, sans arrêt propre).
    if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM', 'SIGTERM')
    else process.exit(0)
    // Filet : processus encore là après le délai d'arrêt de Nitro (30 s par défaut) → sortie forcée.
    setTimeout(() => process.exit(0), 45_000).unref()
  }, Math.max(0, resetAt - Date.now()))
  timer.unref()
})

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  }
  catch {
    return null
  }
}
