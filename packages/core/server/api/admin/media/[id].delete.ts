import { findMedia, purgeMedia, trashMedia } from '../../../lib/media/service'

/**
 * DELETE /api/admin/media/:id — mise à la corbeille (le média n'est plus diffusé).
 * DELETE /api/admin/media/:id?permanent=true — suppression définitive d'un média déjà dans la
 * corbeille (409 NOT_IN_TRASH sinon) : enregistrement, fichier original et dérivés.
 * Portée media:delete dans l'espace du média.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:delete')

  if (getQuery(event).permanent === 'true') await purgeMedia(media)
  else await trashMedia(media)

  setResponseStatus(event, 204)
  return null
})
