import { transformLinksSchema } from '#shared/schemas/transforms'
import { issueSignedUrl, type SignedUrlResult } from '../../../../lib/api/signed-urls'
import { mediaError } from '../../../../lib/media/errors'
import { findMedia } from '../../../../lib/media/service'
import { mediaBaseUrl } from '../../../../lib/media/urls'
import { hasDerivedFiles } from '../../../../lib/media/variants'
import { spaceTransformPolicy } from '../../../../lib/transforms/service'

interface LinkError {
  error: { code: string | null, param?: string, detail?: string }
}

/**
 * POST /api/admin/media/:id/links — { items: [{ preset? | transform?, format }] (1 à 4), expiresIn? }
 * (portée media:read) → { items: [{ url, query, expiresAt } | { error: { code, param?, detail? } }] } :
 * adresses absolues du générateur de la fiche média, construites comme les liens de l'API v1
 * (lib/api/signed-urls.ts) avec la politique de l'espace du média (bibliothèque comprise) :
 * sans signature quand elle est inutile, signature permanente pour des paramètres libres d'un média
 * public en politique SIGNED, lien à échéance (`expiresIn`) pour un média privé ; paramètres libres
 * refusés en politique PRESETS (TRANSFORM_NOT_ALLOWED). Une erreur par lien, à sa place.
 * 400 si le média n'a pas de dérivés · 409 IN_TRASH.
 */
export default defineEventHandler(async (event) => {
  const { media } = await requireMediaAccess(event, () => findMedia(getRouterParam(event, 'id') ?? ''), 'media:read')
  const { items, expiresIn } = await readValidatedBody(event, body => transformLinksSchema.parse(body))
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
  if (!hasDerivedFiles(media)) throw createError({ statusCode: 400, statusMessage: 'This media item has no derived files.' })

  const options = {
    base: mediaBaseUrl(event),
    policy: await spaceTransformPolicy(media.projectId),
    delegated: false,
    expires: Math.floor(Date.now() / 1000) + expiresIn,
  }
  const results: (SignedUrlResult | LinkError)[] = []
  for (const item of items) {
    const target = item.preset === undefined ? 'transform' as const : 'preset' as const
    try {
      results.push(await issueSignedUrl(media, { target, ...item }, options))
    }
    catch (error) {
      const data = (error as { data?: { code?: unknown, param?: unknown, detail?: unknown } } | null)?.data
      if (typeof data?.code !== 'string') throw error
      results.push({
        error: {
          code: data.code,
          ...(typeof data.param === 'string' ? { param: data.param } : {}),
          ...(typeof data.detail === 'string' ? { detail: data.detail } : {}),
        },
      })
    }
  }
  return { items: results }
})
