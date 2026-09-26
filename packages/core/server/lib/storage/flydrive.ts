import type { Readable } from 'node:stream'
import type { Disk } from 'flydrive'
import type { MediaStorage } from './types'

/** Erreur « fichier introuvable » des pilotes Flydrive (fs : ENOENT, S3 : NoSuchKey). */
function isNotFound(error: unknown): boolean {
  const { code, cause } = (error ?? {}) as { code?: string, cause?: { code?: string, name?: string } }
  return code === 'ENOENT' || cause?.code === 'ENOENT' || cause?.name === 'NoSuchKey' || cause?.name === 'NotFound'
}

/**
 * Adaptateur MediaStorage au-dessus d'un disque Flydrive (fs, S3, GCS…). Flydrive fournit
 * les flux, les métadonnées et la normalisation des clés (protection contre la traversée
 * de chemin) ; cet adaptateur ajoute le préfixe éventuel et une gestion homogène des absences.
 */
export function createFlydriveStorage(driver: string, disk: Disk, prefix = ''): MediaStorage {
  const full = (key: string) => `${prefix}${key}`

  return {
    driver,

    async put(key, body: Readable, info) {
      await disk.putStream(full(key), body, { contentType: info.contentType, contentLength: info.size })
    },

    getStream(key) {
      return disk.getStream(full(key))
    },

    async stat(key) {
      try {
        const meta = await disk.getMetaData(full(key))
        return { size: meta.contentLength }
      }
      catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },

    async delete(key) {
      try {
        await disk.delete(full(key))
      }
      catch (error) {
        if (!isNotFound(error)) throw error
      }
    },

    async deletePrefix(keyPrefix) {
      try {
        await disk.deleteAll(full(keyPrefix))
      }
      catch (error) {
        if (!isNotFound(error)) throw error
      }
    },

    async healthcheck() {
      await disk.exists(full('.healthcheck'))
    },
  }
}
