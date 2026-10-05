import type { Readable } from 'node:stream'
import type { MediaKind } from '#shared/utils/media'
import type { TransformPlan } from '../transform-plan'

/** Caractéristiques extraites d'un fichier par son gestionnaire. */
export interface InspectedMedia {
  width: number | null
  height: number | null
  /** Durée en secondes (vidéo, audio). */
  duration: number | null
  /** Métadonnées techniques propres au genre (format, orientation, pages…), stockées en JSON. */
  metadata: Record<string, string | number | boolean | null>
}

/** Dérivé produit par un gestionnaire (préréglage ou transformation libre). */
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
   * L'analyse passe-t-elle par la file bornée des traitements (décodage coûteux) ? Défaut : oui.
   * Non pour la vidéo (lecture d'en-têtes) : une file pleine refuserait un envoi déjà long.
   */
  queued?: boolean
  /**
   * Analyse un fichier dont le type (détecté d'après son contenu) appartient à ce genre.
   * Lève une erreur métier (422) si le fichier est illisible ou hors limites.
   */
  inspect: (path: string, mimeType: string) => Promise<InspectedMedia>
  /**
   * Applique une transformation déjà résolue (transform-plan.ts) : aperçu, préréglages, paramètres
   * libres. Absent si le genre ne produit pas de dérivés (aucune transformation, aucun aperçu).
   */
  transform?: (source: Readable, plan: TransformPlan) => Promise<RenderedVariant>
}
