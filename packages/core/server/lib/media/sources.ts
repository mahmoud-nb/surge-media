import { videoMetadata, videoSourceType } from '#shared/utils/video'
import { isRenditionName, RENDITION_NAMES, type RenditionName } from '#shared/utils/video-processing'
import type { Media, MediaJob, MediaRendition } from '../../generated/prisma/client'

/**
 * Sources d'une vidéo (contrat `sources[]`, phase D3, architecture § 35) : liste ordonnée par préférence,
 * prête pour `<video><source src type>` — le navigateur prend la première qu'il sait lire. Partagée par
 * l'API v1 (URL absolues, signées si privé) et l'administration (chemins relatifs, liens « admin »).
 *
 * Règle :
 *   - rendus présents → les rendus, AV1 d'abord (plus léger, pas lu partout), H.264 en dernier (lu
 *     partout) ; l'original reste dans `url` ;
 *   - aucun rendu → l'original seul s'il est lisible (`playback` ≠ `none`), `type` avec ses codecs ;
 *   - un rendu AV1 sans rendu H.264 (cas anormal : rendu H.264 perdu) garde l'original en dernier recours
 *     s'il est lisible, pour les navigateurs sans AV1 ;
 *   - image, ou format converti (MKV, AVI…) sans rendu → `[]` (l'original n'est proposé qu'en téléchargement).
 *
 * Signature : le droit `file` couvre l'original et ses rendus (même vidéo, même public, DD33) ; `link` reçoit
 * donc le même suffixe de signature pour toutes les entrées. Fonction pure, testée.
 */

/** Une source de `<video>`. `rendition` : nom du rendu, null = fichier original. */
export interface VideoSource {
  url: string
  /** Type MIME avec codecs (`video/mp4; codecs="avc1.640028, mp4a.40.2"`), pour l'attribut `type`. */
  type: string
  width: number | null
  height: number | null
  /** Débit moyen (bit/s), null s'il est inconnu. */
  bitrate: number | null
  size: number
  rendition: RenditionName | null
}

/** Champs d'un rendu lus pour ses sources. */
export type SourceRendition = Pick<MediaRendition, 'name' | 'mimeType' | 'codecs' | 'width' | 'height' | 'bitrate' | 'size'>

/** Champs d'un média lus pour ses sources. */
export type SourceMedia = Pick<Media, 'kind' | 'mimeType' | 'metadata' | 'width' | 'height' | 'size'>

/**
 * Relations d'un média lues pour ses sources et son traitement (fiche de l'administration, API v1) : ses
 * rendus et sa dernière tâche. Jamais dans les listes de l'administration (requêtes légères).
 */
export const PROCESSING_INCLUDE = {
  renditions: true,
  jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
} as const

/** Média lu avec `PROCESSING_INCLUDE`. `jobs` : la dernière tâche seulement (0 ou 1 élément). */
export interface ProcessingRelations {
  renditions: MediaRendition[]
  jobs: MediaJob[]
}

/** Sources d'une vidéo (voir l'en-tête) ; `link(null)` = adresse de l'original, `link(nom)` = celle d'un rendu. */
export function videoSources(
  media: SourceMedia,
  renditions: readonly SourceRendition[],
  link: (rendition: RenditionName | null) => string,
): VideoSource[] {
  if (media.kind !== 'VIDEO') return []
  const byName = new Map<RenditionName, SourceRendition>()
  for (const rendition of renditions) {
    if (isRenditionName(rendition.name)) byName.set(rendition.name, rendition)
  }
  const sources: VideoSource[] = RENDITION_NAMES.flatMap((name) => {
    const rendition = byName.get(name)
    if (!rendition) return []
    return [{
      url: link(name),
      type: videoSourceType(rendition.mimeType, rendition.codecs || null),
      width: rendition.width,
      height: rendition.height,
      bitrate: rendition.bitrate,
      size: rendition.size,
      rendition: name,
    }]
  })
  const metadata = videoMetadata(media.metadata)
  if (metadata && metadata.playback !== 'none' && !byName.has('h264')) {
    sources.push({
      url: link(null),
      type: videoSourceType(media.mimeType, metadata.codecs),
      width: media.width,
      height: media.height,
      bitrate: metadata.bitrate,
      size: media.size,
      rendition: null,
    })
  }
  return sources
}
