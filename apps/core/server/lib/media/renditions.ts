import { RENDITION_FORMATS, type RenditionName } from '#shared/utils/video-processing'
import type { MediaRendition } from '../../generated/prisma/client'
import { urlSlug } from './urls'
import type { DeliverableObject } from './variants'

/**
 * Rendus d'une vidéo côté diffusion (phase D3, architecture § 34) : `/m/<id>/v<n>/renditions/<rendu>.<ext>`.
 * Un rendu (`MediaRendition`, produit par une tâche ffmpeg) est lié au **fichier** de la vidéo, pas à sa
 * version : la ligne et sa clé de stockage survivent aux changements de version qui ne touchent pas le
 * fichier (affiche, point d'intérêt) et sont supprimées quand le fichier change. Il est donc servi sous la
 * version courante du média, avec les règles de l'original (signature `file`, cache, plages, corbeille).
 *
 * Fonctions pures sur le média en cache (cache.ts, `findDeliveryMedia`), testées dans
 * tests/renditions-delivery.test.ts : aucune requête en base par diffusion.
 */

type RenditionRow = Pick<MediaRendition, 'name' | 'container' | 'mimeType' | 'size' | 'checksum' | 'storageKey'>

/** Rendu `name` d'un média, dans le seul conteneur de son URL ; null s'il n'existe pas (encore). */
export function findRendition<R extends Pick<MediaRendition, 'name' | 'container'>>(
  media: { renditions: readonly R[] },
  name: RenditionName,
): R | null {
  return media.renditions.find(rendition => rendition.name === name && rendition.container === RENDITION_FORMATS[name].container) ?? null
}

/**
 * Fichier d'un rendu pour la diffusion : clé de stockage et type MIME de la base (jamais devinés),
 * ETag tiré de l'empreinte du rendu. Null si le média n'a pas ce rendu.
 */
export function resolveRenditionDeliverable(media: { renditions: readonly RenditionRow[] }, name: RenditionName): DeliverableObject | null {
  const rendition = findRendition(media, name)
  if (!rendition) return null
  return { key: rendition.storageKey, mimeType: rendition.mimeType, size: rendition.size, etag: rendition.checksum.slice(0, 32) }
}

/**
 * Nom proposé au téléchargement d'un rendu (Content-Disposition) : celui du média, avec l'extension du
 * rendu (`vacances-2026.mp4`) plutôt que le nom technique de l'URL (`h264.mp4`).
 */
export function renditionFilename(media: { title: string | null, originalName: string }, name: RenditionName): string {
  return `${urlSlug(media.title || media.originalName)}.${RENDITION_FORMATS[name].container}`
}
