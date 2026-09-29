import { authorizeDelivery, cacheControl, contentDisposition, parseDeliveryPath, resolveDeliverable } from '../../lib/media/delivery'
import { mediaPath } from '../../lib/media/urls'
import { useMediaStorage } from '../../lib/storage'

/**
 * GET|HEAD /m/<id>/v<version>/[<dérivé>/]<nom> — diffusion d'un média.
 *
 * Public : mis en cache sans limite (l'URL change à chaque remplacement). Privé : lien signé
 * (?exp=&kid=&sig=), jamais par cookie. Le chemin physique n'est jamais exposé ; le type
 * MIME vient de la base (jamais déduit du contenu par le navigateur : nosniff).
 */
export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    setResponseHeader(event, 'Allow', 'GET, HEAD')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  const target = parseDeliveryPath(getRouterParam(event, 'path') ?? '')
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  const prisma = await usePrisma()
  const media = await prisma.media.findUnique({ where: { id: target.id } })
  if (!media) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  // Ancienne version (fichier remplacé) : redirection vers l'URL courante, sans mise en cache.
  // Un média dans la corbeille n'est jamais redirigé (son existence n'est pas révélée).
  if (target.version !== media.version) {
    if (media.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    return sendRedirect(event, mediaPath(media, target.variant === 'original' ? undefined : target.variant), 302)
  }

  const access = authorizeDelivery(event, media, target)
  const object = await resolveDeliverable(media, target.variant)
  const etag = `"${object.etag}"`

  setResponseHeaders(event, {
    'Content-Type': object.mimeType,
    'ETag': etag,
    'Cache-Control': cacheControl(access),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; sandbox',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    // Lecture par fetch() ou <canvas> depuis n'importe quel site : l'URL (publique ou signée) est la preuve d'accès.
    'Access-Control-Allow-Origin': '*',
    'Content-Disposition': contentDisposition(target.variant === 'original' ? media.originalName : target.filename),
  })
  if (access.mode !== 'public') setResponseHeader(event, 'X-Robots-Tag', 'noindex')

  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }

  setResponseHeader(event, 'Content-Length', object.size)
  if (event.method === 'HEAD') {
    // En-têtes seuls, statut 200 (renvoyer null produirait un 204).
    event.node.res.end()
    return
  }

  const storage = await useMediaStorage()
  return sendStream(event, await storage.getStream(object.key))
})
