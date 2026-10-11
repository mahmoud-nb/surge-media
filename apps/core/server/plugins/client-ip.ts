import { resolveClientIp, trustedProxies } from '../lib/http/client-ip'
import { hookEvent } from '../lib/http/runtime-config'

/**
 * Adresse IP réelle du client derrière un mandataire inverse (`X-Forwarded-For`, réglage `NUXT_TRUST_PROXY`,
 * server/lib/http/client-ip.ts). Calculée une fois par requête, avant tout crochet `request` (`beforeEach`,
 * synchrone), et posée dans `event.context.clientAddress`, que `getRequestIP(event)` de h3 rend en priorité :
 * limiteurs de débit (connexion, API v1, transformations de `/m/`), journal d'audit, sessions, appareils de
 * confiance et dernière utilisation des identifiants voient tous la même adresse, sans rien changer à leur code.
 * Jamais d'exception (une erreur ici ferait échouer toutes les requêtes) : en cas de doute, l'adresse de la
 * connexion reste celle de h3.
 */
export default defineNitroPlugin((nitroApp) => {
  const trusted = trustedProxies(useRuntimeConfig().trustProxy, message => console.warn(`[surge-media] ${message}`))
  if (!trusted) return
  nitroApp.hooks.beforeEach((hook) => {
    if (hook.name !== 'request') return
    try {
      const event = hookEvent(hook.args)
      if (!event || event.context.clientAddress) return
      const { socket, headers } = event.node.req
      const address = resolveClientIp(socket?.remoteAddress, headers['x-forwarded-for'], trusted)
      if (address) event.context.clientAddress = address
    }
    catch {}
  })
})
