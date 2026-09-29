import { findDeliveryMedia } from '../../lib/media/cache'
import { authorizeDelivery, cacheControl, contentDisposition, parseDeliveryPath } from '../../lib/media/delivery'
import { BUSY_RETRY_AFTER } from '../../lib/media/processing'
import { resolveRange } from '../../lib/media/range'
import { mediaPath } from '../../lib/media/urls'
import { resolveDeliverable } from '../../lib/media/variants'
import { useMediaStorage } from '../../lib/storage'

/**
 * GET|HEAD /m/<id>/v<version>/[<dérivé>/]<nom> — diffusion d'un média.
 *
 * Public : mis en cache sans limite (l'URL change à chaque remplacement). Privé : lien signé
 * (?exp=&kid=&sig=) ou identifiant d'API (`Authorization: Bearer`), jamais par cookie. Le chemin
 * physique n'est jamais exposé ; le type MIME vient de la base (nosniff). Requêtes partielles
 * (`Range`, une plage) : 206 / 416. Métadonnées lues via le cache de diffusion (60 s).
 * OPTIONS : preflight CORS (lecture avec en-tête Authorization ou Range depuis un script).
 */
export default defineEventHandler(async (event) => {
  if (event.method === 'OPTIONS') {
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD',
      'Access-Control-Allow-Headers': 'Authorization, Range, If-None-Match, If-Range',
      'Access-Control-Max-Age': '7200',
    })
    setResponseStatus(event, 204)
    return null
  }
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    setResponseHeader(event, 'Allow', 'GET, HEAD, OPTIONS')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  const target = parseDeliveryPath(getRouterParam(event, 'path') ?? '')
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  const media = await findDeliveryMedia(target.id)
  if (!media) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  // Ancienne version (fichier remplacé) : redirection vers l'URL courante, sans mise en cache.
  // Un média dans la corbeille n'est jamais redirigé (son existence n'est pas révélée).
  if (target.version !== media.version) {
    if (media.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    return sendRedirect(event, mediaPath(media, target.variant === 'original' ? undefined : target.variant), 302)
  }

  const access = await authorizeDelivery(event, media, target)
  const object = await resolveDeliverable(media, target.variant).catch((error: unknown) => {
    // Génération d'un dérivé refusée (file des traitements pleine) : réessayer plus tard.
    if ((error as { data?: { code?: string } } | null)?.data?.code === 'SERVER_BUSY') setResponseHeader(event, 'Retry-After', BUSY_RETRY_AFTER)
    throw error
  })
  const etag = `"${object.etag}"`

  setResponseHeaders(event, {
    'Content-Type': object.mimeType,
    'ETag': etag,
    'Cache-Control': cacheControl(access),
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; sandbox',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    // Lecture par fetch() ou <canvas> depuis n'importe quel site : l'URL (publique ou signée) ou
    // l'identifiant présenté est la preuve d'accès (jamais de cookie).
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
    'Content-Disposition': contentDisposition(target.variant === 'original' ? media.originalName : target.filename),
  })
  if (access.mode === 'credential') setResponseHeader(event, 'Vary', 'Authorization')
  if (access.mode !== 'public') setResponseHeader(event, 'X-Robots-Tag', 'noindex')

  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }

  // Plage demandée ; ignorée si If-Range désigne une autre version du fichier.
  const ifRange = getRequestHeader(event, 'if-range')
  const range = event.method === 'GET' && (!ifRange || ifRange === etag)
    ? resolveRange(getRequestHeader(event, 'range'), object.size)
    : { type: 'full' as const }

  if (range.type === 'unsatisfiable') {
    setResponseHeader(event, 'Content-Range', `bytes */${object.size}`)
    setResponseStatus(event, 416)
    event.node.res.end()
    return
  }

  const storage = await useMediaStorage()
  if (range.type === 'partial') {
    setResponseStatus(event, 206)
    setResponseHeaders(event, {
      'Content-Range': `bytes ${range.start}-${range.end}/${object.size}`,
      'Content-Length': range.end - range.start + 1,
    })
    return sendStream(event, await storage.getStream(object.key, { start: range.start, end: range.end }))
  }

  setResponseHeader(event, 'Content-Length', object.size)
  if (event.method === 'HEAD') {
    // En-têtes seuls, statut 200 (renvoyer null produirait un 204).
    event.node.res.end()
    return
  }
  return sendStream(event, await storage.getStream(object.key))
})
