import type { Readable } from 'node:stream'
import type { MediaKind } from '#shared/utils/media'

/** Caractéristiques extraites d'un fichier par son gestionnaire. */
export interface InspectedMedia {
  width: number | null
  height: number | null
  /** Durée en secondes (vidéo, audio). */
  duration: number | null
  /** Métadonnées techniques propres au genre (format, orientation, pages…), stockées en JSON. */
  metadata: Record<string, string | number | boolean | null>
}

/** Dérivé produit par un gestionnaire (aperçu, plus tard transformations). */
export interface RenderedVariant {
  data: Buffer
  mimeType: string
  extension: string
  width: number
  height: number
}

/**
 * Gestionnaire d'un genre de média. Le métier (MediaService) ne connaît que cette interface :
 * ajouter la vidéo ou les documents consiste à écrire un nouveau gestionnaire et à
 * l'inscrire au registre (./index.ts).
 */
export interface MediaTypeHandler {
  kind: MediaKind
  /**
   * Analyse un fichier dont le type (détecté d'après son contenu) appartient à ce genre.
   * Lève une erreur métier (422) si le fichier est illisible ou hors limites.
   */
  inspect: (path: string, mimeType: string) => Promise<InspectedMedia>
  /** Aperçu réduit pour l'administration ; absent si le genre n'en produit pas. */
  preview?: (source: Readable) => Promise<RenderedVariant>
}
