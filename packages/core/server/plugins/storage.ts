import { resolve } from 'node:path'
import fsDriver from 'unstorage/drivers/fs'

/**
 * Monte le stockage des médias à l'exécution (et non au build) pour que le dossier
 * reste configurable par l'environnement : NUXT_STORAGE_BASE.
 */
export default defineNitroPlugin(() => {
  const { storage } = useRuntimeConfig()
  useStorage().mount(MEDIA_STORAGE, fsDriver({ base: resolve(storage.base) }))
})
