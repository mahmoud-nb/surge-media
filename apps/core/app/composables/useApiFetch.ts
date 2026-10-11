// Signature d'exécution de useFetch : Nuxt ajoute la clé automatique en dernier argument.
const useFetchWithKey = useFetch as unknown as (url: unknown, options: object, ...autoKey: string[]) => unknown

/**
 * useFetch() branché sur `$api` (gestion des sessions expirées), avec la même signature :
 * le type de la réponse reste déduit de la route Nitro.
 * Déclaré dans `optimization.keyedComposables` (nuxt.config.ts) : Nuxt ajoute la clé de
 * cache automatique en dernier argument, transmise telle quelle à useFetch.
 */
export const useApiFetch = ((url: unknown, options: object = {}, ...autoKey: string[]) =>
  useFetchWithKey(url, { ...options, $fetch: useNuxtApp().$api }, ...autoKey)) as typeof useFetch
