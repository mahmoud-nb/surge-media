import { mediaTargetSchema } from '#shared/schemas/media'
import { duplicateMedia, findMedia, toMediaDetail } from '../../../../lib/media/service'

/**
 * POST /api/admin/media/:id/duplicate — { projectId: string | null, folderId?: string | null }
 * (projectId null = bibliothèque ; folderId = dossier de l'espace cible, racine par défaut).
 * Crée une copie indépendante dans l'espace cible (le même est permis) : portée media:read sur
 * le média, media:upload dans la cible. 201 + copie. 404 (média, cible ou dossier FOLDER_NOT_FOUND) ·
 * 403 (PROJECT_ARCHIVED) · 409 IN_TRASH.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const { projectId, folderId } = await readValidatedBody(event, body => mediaTargetSchema.parse(body))
  const target = await requireSpaceAccess(event, spaceFor(projectId), 'media:upload')
  const copy = await duplicateMedia(media, target.space, { userId: target.user.id }, folderId ?? null)
  setResponseStatus(event, 201)
  return { media: toMediaDetail(copy, await sessionTagViewer(event)) }
})
