import { createSurgeMedia } from '@surge-media/vue'
import { createApp } from 'vue'
import '@surge-media/vue/style.css'
import App from './App.vue'
import { config, configured, locale } from './state'

/**
 * Bac à sable : le plugin reçoit des jetons délégués émis par le serveur Vite (`POST /api/token`), qui
 * couvrent les médias publics et privés du projet ; la page « Clé publique » crée son propre client.
 */
const app = createApp(App)
if (configured) {
  app.use(createSurgeMedia({
    baseUrl: config.baseUrl,
    projectId: config.projectId,
    getToken: async () => {
      const response = await fetch('/api/token', { method: 'POST' })
      if (!response.ok) throw new Error(`Delegated token: HTTP ${response.status}`)
      return response.json()
    },
    locale,
  }))
}
app.mount('#app')
