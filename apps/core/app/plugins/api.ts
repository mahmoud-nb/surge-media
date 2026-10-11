/**
 * `$api` : $fetch pour les appels de l'administration. Une réponse 401 (session expirée,
 * révoquée ou compte désactivé) renvoie vers /login en conservant la page courante.
 * Utilisé par useApiFetch() et directement : `await useNuxtApp().$api('/api/…', { method: 'POST' })`.
 */
export default defineNuxtPlugin((nuxtApp) => {
  // Rendu serveur : le plugin s'exécute pour chaque requête ; on transmet aux appels internes
  // son cookie de session (useFetch ne le fait que pour son $fetch par défaut), ainsi que son hôte
  // et son protocole : sans NUXT_SITE_URL, les URL absolues renvoyées par l'API (adresse de l'API,
  // liens de médias) en dépendent — un appel interne recevrait sinon « http://localhost ».
  const headers = import.meta.server ? useRequestHeaders(['cookie', 'host', 'x-forwarded-proto']) : undefined

  const api = $fetch.create({
    headers,
    async onResponseError({ response }) {
      if (response.status !== 401 || import.meta.server) return
      await nuxtApp.runWithContext(async () => {
        const route = useRoute()
        await useUserSession().fetch()
        await navigateTo({ path: '/login', query: { redirect: route.fullPath, expired: '1' } })
      })
    },
  })

  return { provide: { api } }
})
