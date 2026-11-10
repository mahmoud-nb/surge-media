import type { Tag } from '../../generated/prisma/client'

/**
 * Lecture des étiquettes avec un média (architecture-tags.md) : module sans dépendance, partagé par
 * l'administration (server/lib/media/service.ts) et l'API v1 (server/lib/api/serializers.ts).
 */

/** Étiquettes d'un média telles que lues avec lui (`TAG_LINK_INCLUDE`), confidentielles comprises. */
export interface MediaTagLink { tag: Tag }

/** Inclusion Prisma des étiquettes d'un média (deux lectures groupées par page). */
export const TAG_LINK_INCLUDE = { tags: { select: { tag: true } } } as const

/** Ordre d'affichage : globales d'abord, puis par nom (sans casse ni accents). */
export function compareTags(a: Pick<Tag, 'projectId' | 'nameKey'>, b: Pick<Tag, 'projectId' | 'nameKey'>): number {
  const level = Number(a.projectId !== null) - Number(b.projectId !== null)
  return level || a.nameKey.localeCompare(b.nameKey)
}
