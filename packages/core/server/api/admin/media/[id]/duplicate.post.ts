import { mediaTargetSchema } from '#shared/schemas/media'
import { duplicateMedia, findMedia, toMediaDetail } from '../../../../lib/media/service'

/**
 * POST /api/admin/media/:id/duplicate — { projectId: string | null } (null = bibliothèque).
 * Crée une copie indépendante dans l'espace cible (le même est permis) : portée media:read sur
 * le média, media:upload dans la cible. 201 + copie. 404 (média ou cible invisible) ·
 * 403 (PROJECT_ARCHIVED) · 409 IN_TRASH.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const { projectId } = await readValidatedBody(event, body => mediaTargetSchema.parse(body))
  const target = await requireSpaceAccess(event, spaceFor(projectId), 'media:upload')
  const copy = await duplicateMedia(media, target.space, target.user)
  setResponseStatus(event, 201)
  return { media: toMediaDetail(copy) }
})
