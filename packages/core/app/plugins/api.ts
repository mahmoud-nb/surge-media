/**
 * `$api` : $fetch pour les appels de l'administration. Une réponse 401 (session expirée,
 * révoquée ou compte désactivé) renvoie vers /login en conservant la page courante.
 * Utilisé par useApiFetch() et directement : `await useNuxtApp().$api('/api/…', { method: 'POST' })`.
 */
export default defineNuxtPlugin((nuxtApp) => {
  // Rendu serveur : le plugin s'exécute pour chaque requête ; on transmet son cookie de
  // session aux appels internes (useFetch ne le fait que pour son $fetch par défaut).
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined

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
