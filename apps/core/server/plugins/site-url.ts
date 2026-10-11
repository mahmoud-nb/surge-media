import { isWorkerRole } from '../lib/video-processing/settings'

/**
 * Rappel au démarrage : sans NUXT_SITE_URL, les URL absolues (liens de partage, puis API
 * publique) sont déduites de l'en-tête Host de chaque requête. Acceptable en développement ; en
 * production, l'URL publique doit être fixée (proxy, CDN, en-tête Host non maîtrisé).
 */
export default defineNitroPlugin(() => {
  // Processus de travail (phase D3) : il ne produit aucune URL absolue.
  if (isWorkerRole()) return
  const { siteUrl } = useRuntimeConfig()
  if (!siteUrl && !import.meta.dev) {
    console.warn('[surge-media] NUXT_SITE_URL non défini : les URL absolues sont déduites de chaque requête. Définissez l\'URL publique de l\'installation (ex. https://media.example.com).')
  }
})
