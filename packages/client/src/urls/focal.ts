import type { FocalPoint } from '../types'

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
