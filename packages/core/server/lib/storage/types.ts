import type { Readable } from 'node:stream'

/**
 * Stockage physique des fichiers médias (port de l'architecture hexagonale).
 *
 * Le métier (MediaService) et les API ne connaissent que cette interface : passer du disque
 * local à S3 (ou à un autre backend) ne modifie que la configuration. Les clés sont
 * générées par le serveur (server/lib/media/keys.ts) et ne sont jamais exposées.
 */
export interface MediaStorage {
  /** Nom du backend (local, s3…), pour les journaux et la sonde de santé. */
  readonly driver: string
  /** Écrit un fichier en flux (mémoire constante, quelle que soit sa taille). */
  put: (key: string, body: Readable, info: { contentType: string, size: number }) => Promise<void>
  /**
   * Lit un fichier en flux, en entier ou seulement les octets [start, end] (requêtes `Range` :
   * reprise de téléchargement, lecture vidéo). Sous S3, la plage est demandée au service.
   */
  getStream: (key: string, range?: ByteRange) => Promise<Readable>
  /**
   * Copie un fichier sous une nouvelle clé (duplication d'un média). Sous S3, la copie se fait
   * côté service (CopyObject), sans transit par surgeMedia.
   */
  copy: (fromKey: string, toKey: string) => Promise<void>
  /** Taille du fichier, ou null s'il n'existe pas. */
  stat: (key: string) => Promise<{ size: number } | null>
  /** Supprime un fichier (sans erreur s'il n'existe plus). */
  delete: (key: string) => Promise<void>
  /** Supprime tous les fichiers dont la clé commence par `prefix`. */
  deletePrefix: (prefix: string) => Promise<void>
  /** Vérifie que le backend répond (GET /api/health). */
  healthcheck: () => Promise<void>
}

/** Plage d'octets incluse aux deux bornes. */
export interface ByteRange {
  start: number
  end: number
}

export type MediaStorageDriver = 'local' | 's3'

/** Configuration du stockage (runtimeConfig.media.storage, variables NUXT_MEDIA_STORAGE_*). */
export interface MediaStorageConfig {
  driver: string
  /** Dossier racine du pilote local (relatif au dossier de lancement ou absolu). */
  root: string
  /** Préfixe ajouté à toutes les clés (partage d'un bucket entre plusieurs instances). */
  prefix: string
  s3: {
    bucket: string
    region: string
    /** Point d'accès des services compatibles S3 (R2, MinIO, Scaleway, OVH…) ; vide pour AWS. */
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    /** URL de type https://endpoint/bucket/clé (MinIO et la plupart des services auto-hébergés). */
    forcePathStyle: boolean
  }
}
