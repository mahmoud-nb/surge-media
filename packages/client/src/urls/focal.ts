import type { FocalPoint, Media } from '../types'

/**
 * Recadrage CSS sur le point d'intérêt (`object-fit: cover`) d'une image `width` × `height` affichée au
 * rapport `ratio` (largeur / hauteur) : position `object-position` (fractions 0 à 1) qui reproduit la zone
 * que le serveur garde autour du point (zone centrée sur le point, bornée à l'image). Sans point : le centre.
 * Repris d'apps/core/shared/utils/transforms.ts.
 */
export function focalObjectPosition(width: number, height: number, ratio: number, focal: FocalPoint | null): FocalPoint {
  if (!focal) return { x: 0.5, y: 0.5 }
  const wider = width / height > ratio
  const cropWidth = wider ? height * ratio : width
  const cropHeight = wider ? height : width / ratio
  const axis = (point: number, size: number, crop: number) =>
    size - crop <= 0 ? 0.5 : Math.min(Math.max((point * size - crop / 2) / (size - crop), 0), 1)
  return { x: axis(focal.x, width, cropWidth), y: axis(focal.y, height, cropHeight) }
}

/** Valeur CSS d'`object-position` (« 35% 60% »). */
export function objectPosition(point: FocalPoint): string {
  const percent = (value: number) => `${Math.round(value * 10_000) / 100}%`
  return `${percent(point.x)} ${percent(point.y)}`
}

/**
 * Position CSS du recadrage d'un média sur son point d'intérêt (`object-fit: cover`) : exacte si le rapport
 * affiché est connu, sinon le point lui-même ; sans point, le centre.
 */
export function focusPosition(media: Pick<Media, 'width' | 'height' | 'focalPoint'>, aspect: number | null): string {
  const focal = media.focalPoint
  if (!focal) return '50% 50%'
  if (aspect && media.width && media.height) return objectPosition(focalObjectPosition(media.width, media.height, aspect, focal))
  return objectPosition(focal)
}
