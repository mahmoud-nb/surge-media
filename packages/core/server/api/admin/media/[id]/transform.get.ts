import { transformPreviewQuerySchema } from '#shared/schemas/transforms'
import { mediaError } from '../../../../lib/media/errors'
import { BUSY_RETRY_AFTER } from '../../../../lib/media/processing'
import { findMedia } from '../../../../lib/media/service'
import { renderTransient } from '../../../../lib/media/variants'
import { resolveTransformRequest } from '../../../../lib/transforms/service'

/**
 * GET /api/admin/media/:id/transform?preset=<nom>|transform=<paramètres>&format=<jpg|png|webp|avif>
 * (portée media:read) — aperçu d'un dérivé pour le générateur d'adresses de la fiche média, rendu à
 * la volée dans la file des traitements : **jamais enregistré** ni compté dans le quota de dérivés
 * (architecture phase C, CD11), sans contrôle de la politique de l'espace (l'adresse elle-même la
 * respecte : POST …/links). En-têtes X-Transform-Width, X-Transform-Height et X-Transform-Operation
 * (opération effective : réduction sans agrandissement, recadrage…).
 * 400 INVALID_TRANSFORM (data.param, data.detail) · 404 PRESET_NOT_FOUND · 409 IN_TRASH · 503 SERVER_BUSY.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const query = await getValidatedQuery(event, value => transformPreviewQuerySchema.parse(value))
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')

  const { transformation } = await resolveTransformRequest(media.projectId, query)
  const rendered = await renderTransient(media, transformation, query.format).catch((error: unknown) => {
    if ((error as { data?: { code?: string } } | null)?.data?.code === 'SERVER_BUSY') setResponseHeader(event, 'Retry-After', BUSY_RETRY_AFTER)
    throw error
  })

  setResponseHeaders(event, {
    'Content-Type': rendered.mimeType,
    'Content-Length': rendered.data.length,
    // Même demande, même rendu : le navigateur peut le réutiliser un moment (retour à un réglage précédent).
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; sandbox',
    'X-Transform-Width': rendered.width,
    'X-Transform-Height': rendered.height,
    'X-Transform-Operation': rendered.operation,
  })
  return rendered.data
})
