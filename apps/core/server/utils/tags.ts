import type { H3Event } from 'h3'
import type { TagErrorCode, TagViewer } from '#shared/utils/tags'
import type { Tag } from '../generated/prisma/client'
import type { SpaceAccess } from './access'

/**
 * Accès aux étiquettes dans l'administration (architecture-tags.md, TG2, TG4, TG5) :
 *   - liste globale : lecture pour tout compte connecté qui voit la bibliothèque, gestion avec la
 *     permission `tags:global` (ADMIN) ;
 *   - liste d'un projet : lecture `media:read`, gestion `tags:manage` (propriétaire du projet) ;
 *   - étiquettes confidentielles : seulement pour la permission `tags:confidential` (ADMIN, MANAGER).
 */

/** Erreur métier des étiquettes : statut HTTP + code (`data.code`) traduit par l'interface et l'API v1. */
export function tagError(statusCode: 403 | 404 | 409 | 422, code: TagErrorCode, details: Record<string, unknown> = {}) {
  return createError({ statusCode, statusMessage: code, data: { code, ...details } })
}

/** Lecteur des étiquettes dans l'interface connectée, d'après le rôle du compte. */
export function tagViewerFor(user: { role: Role }): TagViewer {
  return { confidential: hasPermission(user.role, 'tags:confidential') }
}

/** Lecteur des étiquettes de la session (requireAuth déjà passé par la route). */
export async function sessionTagViewer(event: H3Event): Promise<TagViewer> {
  return tagViewerFor(await requireAuth(event))
}

/**
 * Étiquette modifiable par l'utilisateur : 404 TAG_NOT_FOUND si elle n'existe pas, si son projet est
 * invisible ou si elle est confidentielle pour lui ; 403 sans la permission ou la portée de son niveau.
 */
export async function requireTagManagement(event: H3Event, tag: Tag | null): Promise<{ tag: Tag, access: SpaceAccess | null, viewer: TagViewer }> {
  const user = await requireAuth(event)
  const viewer = tagViewerFor(user)
  if (!tag || (tag.confidential && !viewer.confidential)) throw tagError(404, 'TAG_NOT_FOUND')
  if (!tag.projectId) {
    if (!hasPermission(user.role, 'tags:global')) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    return { tag, access: null, viewer }
  }
  const access = await resolveSpaceAccess(user, spaceFor(tag.projectId))
  if (!access || !hasScope(access.scopes, 'media:read')) throw tagError(404, 'TAG_NOT_FOUND')
  assertScope(access, 'tags:manage')
  return { tag, access, viewer }
}
