import { mediaMetadataSchema } from '#shared/schemas/media'
import { findMedia, toMediaDetail, updateMediaMetadata } from '../../../lib/media/service'
import { applyMediaTags, planMediaTags } from '../../../lib/tags/service'

/**
 * PATCH /api/admin/media/:id — { title?, altText?, visibility?, folderId?, focalPoint?, tagIds? } (portée
 * media:write ; folderId = dossier du même espace, null = racine, 404 FOLDER_NOT_FOUND sinon ;
 * focalPoint = point d'intérêt d'une image, null efface : nouvelle version, 409 VERSION_CONFLICT si
 * le média a changé entre-temps).
 * Passer un média en privé prend effet immédiatement pour les nouvelles requêtes ; les copies
 * déjà en cache chez les visiteurs ou un CDN restent valables jusqu'à leur expiration.
 * Un changement de visibilité est inscrit au journal d'audit.
 * `tagIds` (architecture-tags.md) : ensemble des étiquettes, vérifié avant toute écriture (404
 * TAG_NOT_FOUND, 422 TOO_MANY_TAGS) ; les confidentielles que l'utilisateur ne voit pas restent.
 */
export default defineEventHandler(async (event) => {
  const { media, access } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:write')
  const { tagIds, ...input } = await readValidatedBody(event, body => mediaMetadataSchema.parse(body))
  const viewer = tagViewerFor(access.user)
  // Étiquettes vérifiées avant toute écriture : une étiquette refusée ne laisse rien à moitié fait.
  const tagsPlan = tagIds === undefined ? null : await planMediaTags(media, tagIds, viewer)
  let updated = await updateMediaMetadata(media, input)
  if (tagsPlan?.changed) {
    await applyMediaTags(tagsPlan)
    updated = (await findMedia(media.id))!
  }
  if (updated.visibility !== media.visibility) {
    await recordAudit(event, {
      action: 'media.visibility_changed',
      projectId: media.projectId,
      targetType: 'media',
      targetId: media.id,
      data: { label: updated.title || updated.originalName, from: media.visibility, to: updated.visibility },
    })
  }
  return { media: toMediaDetail(updated, viewer) }
})
