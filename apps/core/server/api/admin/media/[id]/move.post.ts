import { mediaTargetSchema } from '#shared/schemas/media'
import { findMedia, moveMedia, toMediaDetail } from '../../../../lib/media/service'

/**
 * POST /api/admin/media/:id/move — { projectId: string | null, folderId?: string | null }
 * (projectId null = bibliothèque ; folderId = dossier de l'espace cible, racine par défaut).
 * Change l'espace du média sans changer son identifiant ni ses URL : portée media:delete dans
 * l'espace d'origine, media:upload dans la cible. Même espace : aucun changement (changer de
 * dossier dans l'espace : PATCH { folderId }).
 * 404 (média, cible ou dossier FOLDER_NOT_FOUND) · 403 (PROJECT_ARCHIVED) · 409 IN_TRASH.
 * Journal d'audit : rattaché au projet d'origine (sinon à la cible), avec les deux espaces.
 */
export default defineEventHandler(async (event) => {
  const { media, access } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:delete')
  const { projectId, folderId } = await readValidatedBody(event, body => mediaTargetSchema.parse(body))
  const target = await requireSpaceAccess(event, spaceFor(projectId), 'media:upload')
  if (sameSpace(access.space, target.space)) return { media: toMediaDetail(media, await sessionTagViewer(event)) }

  const moved = await moveMedia(media, target.space, folderId ?? null)
  await recordAudit(event, {
    action: 'media.moved',
    projectId: media.projectId ?? moved.projectId,
    targetType: 'media',
    targetId: media.id,
    data: {
      label: media.title || media.originalName,
      from: access.project ? { id: access.project.id, name: access.project.name } : null,
      to: target.project ? { id: target.project.id, name: target.project.name } : null,
    },
  })
  return { media: toMediaDetail(moved, await sessionTagViewer(event)) }
})
