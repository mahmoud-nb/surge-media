import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Disk } from 'flydrive'
import { createFlydriveStorage } from './flydrive'
import type { MediaStorage, MediaStorageConfig } from './types'

export type { MediaStorage } from './types'

/**
 * Crée le stockage configuré. Ajouter un backend (GCS, Azure…) = un `case` ici et, si besoin,
 * un adaptateur implémentant MediaStorage ; rien d'autre ne change.
 * Les pilotes sont importés à la demande : le SDK S3 n'est chargé que s'il est utilisé.
 */
async function createStorage(config: MediaStorageConfig): Promise<MediaStorage> {
  switch (config.driver) {
    case 'local': {
      const { FSDriver } = await import('flydrive/drivers/fs')
      // Chemin relatif résolu depuis le dossier de lancement (packages/core), comme la base SQLite.
      const location = resolve(config.root)
      await mkdir(location, { recursive: true })
      return createFlydriveStorage('local', new Disk(new FSDriver({ location, visibility: 'private' })), config.prefix)
    }
    case 's3': {
      const { bucket, region, endpoint, accessKeyId, secretAccessKey, forcePathStyle } = config.s3
      const missing = Object.entries({ bucket, region, accessKeyId, secretAccessKey }).filter(([, value]) => !value).map(([name]) => name)
      if (missing.length > 0) {
        throw new Error(`[surge-media] Stockage S3 : paramètres manquants (${missing.join(', ')}), voir NUXT_MEDIA_STORAGE_S3_*.`)
      }
      const { S3Driver } = await import('flydrive/drivers/s3')
      const driver = new S3Driver({
        bucket,
        region,
        endpoint: endpoint || undefined,
        forcePathStyle,
        credentials: { accessKeyId, secretAccessKey },
        // Sommes de contrôle « aws-chunked » (défaut des SDK récents) seulement si le service
        // l'exige : des services compatibles S3 les stockent sinon dans le fichier (corrompu).
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        // Objets privés : la diffusion passe toujours par surgeMedia (contrôle d'accès, en-têtes).
        visibility: 'private',
        // Beaucoup de services compatibles S3 (R2, MinIO…) ne gèrent pas les ACL.
        supportsACL: false,
      })
      return createFlydriveStorage('s3', new Disk(driver), config.prefix)
    }
    default:
      throw new Error(`[surge-media] NUXT_MEDIA_STORAGE_DRIVER="${config.driver}" non supporté (valeurs : local, s3).`)
  }
}

let storage: Promise<MediaStorage> | undefined

/** Stockage des médias configuré (runtimeConfig.media.storage), créé au premier appel. */
export function useMediaStorage(): Promise<MediaStorage> {
  storage ??= createStorage(useRuntimeConfig().media.storage as MediaStorageConfig).catch((error: unknown) => {
    // Échec (dossier inaccessible, paramètre manquant…) : nouvel essai à l'appel suivant
    // plutôt qu'une erreur mémorisée jusqu'au redémarrage.
    storage = undefined
    throw error
  })
  return storage
}
