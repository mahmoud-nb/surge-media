import { hookEvent, sharesRuntimeConfig } from '../lib/http/runtime-config'

/**
 * Configuration d'exécution calculée une seule fois par processus (test de charge du 2026-10-10).
 *
 * Nitro 2 reconstruit toute la configuration à chaque requête dès qu'un code appelle
 * `useRuntimeConfig(event)` : copie profonde (≈ 520 entrées, dont la configuration OAuth de tous les
 * fournisseurs connus de nuxt-auth-utils), puis pour chaque entrée conversion du nom en `NITRO_…`/`NUXT_…`
 * et deux lectures de `process.env` (≈ 0,7 µs chacune sous Windows). Le module @nuxtjs/i18n l'appelle sur
 * **toutes** les requêtes (crochet `request`, diffusion `/m/` et API comprises) : mesuré ≈ 9 ms de calcul
 * par requête, 80 % du processeur, ~110 requêtes/s au plus par processus sur `/m/` (304 compris).
 *
 * Ce plugin donne à chaque requête, avant tout crochet `request` (`beforeEach`, indépendant de l'ordre
 * d'enregistrement des plugins), la configuration calculée au démarrage par Nitro (`useRuntimeConfig()` :
 * mêmes variables d'environnement, objet gelé) :
 *   - diffusion, API et fichiers de l'application (`sharesRuntimeConfig`) : l'objet partagé tel quel ;
 *   - pages et autres chemins : une copie modifiable (un module pourrait l'écrire pendant le rendu ; coût
 *     négligeable devant celui du rendu).
 * Mesuré : × 17 sur les réponses 304 de `/m/` (111 → 1 874 requêtes/s). Conséquence : une variable
 * d'environnement modifiée après le démarrage n'est plus vue par les requêtes — redémarrer le serveur
 * après tout changement de `.env`, comme déjà documenté.
 *
 * Jamais d'exception : une erreur ici ferait échouer toutes les requêtes ; en cas de doute, rien n'est fait
 * et Nitro calcule la configuration lui-même (comportement d'origine).
 */
export default defineNitroPlugin((nitroApp) => {
  const shared = useRuntimeConfig()
  nitroApp.hooks.beforeEach((hook) => {
    if (hook.name !== 'request') return
    try {
      const event = hookEvent(hook.args)
      const context = event?.context.nitro as { runtimeConfig?: unknown } | undefined
      if (!event || !context || context.runtimeConfig) return
      context.runtimeConfig = sharesRuntimeConfig(event.path) ? shared : structuredClone(shared)
    }
    catch {}
  })
})
