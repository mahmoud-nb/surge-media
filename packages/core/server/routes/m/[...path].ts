import { findDeliveryMedia } from '../../lib/media/cache'
import { authorizeDelivery, cacheControl, contentDisposition, generationRateLimited, parseDeliveryPath } from '../../lib/media/delivery'
import { derivedSegment, type DeliveryTarget } from '../../lib/media/delivery-path'
import { mediaError } from '../../lib/media/errors'
import { BUSY_RETRY_AFTER } from '../../lib/media/processing'
import { resolveRange } from '../../lib/media/range'
import { useTransformSettings } from '../../lib/media/transform-settings'
import { derivedPath, mediaPath } from '../../lib/media/urls'
import { builtinPresetTransformation, resolveDeliverable, type DerivedRequest } from '../../lib/media/variants'
import { createTokenBucketLimiter } from '../../lib/api/rate-limit'
import { useMediaStorage } from '../../lib/storage'

/** Débit de nouvelles générations libres non signées, par IP (architecture phase C § 6). */
const generations = createTokenBucketLimiter()

/**
 * GET|HEAD /m/<id>/v<version>/[<préréglage>|<paramètres>/]<nom> — diffusion d'un média.
 *
 * Original, préréglage (`preview`, `full`) ou transformation libre (`w_800,h_600,q_75`), format de
 * sortie donné par l'extension (phase C). Une transformation non canonique est redirigée (301) vers
 * sa forme canonique ; invalide → 400 INVALID_TRANSFORM. Dérivés générés une fois puis conservés ;
 * nouveaux dérivés libres soumis au quota par version et au débit par IP (429 TRANSFORM_QUOTA).
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

  const settings = useTransformSettings()
  const parsed = parseDeliveryPath(getRouterParam(event, 'path') ?? '', settings)
  if (!parsed) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  if (parsed.type === 'invalid') throw mediaError(400, 'INVALID_TRANSFORM', { detail: parsed.message })
  if (parsed.type === 'redirect') {
    // Forme canonique : un résultat = une URL = un fichier en cache. La signature éventuelle
    // (chaîne de requête) couvre la transformation canonique : elle est conservée.
    const { search } = getRequestURL(event)
    setResponseHeaders(event, { 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' })
    return sendRedirect(event, `/m/${parsed.path}${search}`, 301)
  }
  const target = parsed.target

  const media = await findDeliveryMedia(target.id)
  if (!media) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  // Ancienne version (fichier remplacé) : redirection vers l'URL courante, sans mise en cache.
  // Un média dans la corbeille n'est jamais redirigé (son existence n'est pas révélée).
  if (target.version !== media.version) {
    if (media.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    setResponseHeader(event, 'Cache-Control', 'no-cache')
    const current = target.kind === 'original' ? mediaPath(media) : derivedPath(media, derivedSegment(target), target.format)
    return sendRedirect(event, current, 302)
  }

  const access = await authorizeDelivery(event, media, target)
  const request = derivedRequest(target, () => {
    if (!generationRateLimited(access) || settings.rateLimit === 0) return
    const result = generations.take(`gen:${getRequestIP(event) ?? 'unknown'}`, settings.rateLimit)
    if (!result.allowed) {
      throw mediaError(429, 'TRANSFORM_QUOTA', {
        retryAfter: result.retryAfter,
        detail: `Too many new transformations from this address (${settings.rateLimit} per minute): use existing sizes, a preset or a signed URL.`,
      })
    }
  })
  const object = await resolveDeliverable(media, request).catch((error: unknown) => {
    // File des traitements pleine, ou débit atteint : réessayer plus tard.
    const data = (error as { data?: { code?: string, retryAfter?: number } } | null)?.data
    if (data?.code === 'SERVER_BUSY') setResponseHeader(event, 'Retry-After', BUSY_RETRY_AFTER)
    else if (data?.retryAfter) setResponseHeader(event, 'Retry-After', data.retryAfter)
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
    'Content-Disposition': contentDisposition(target.kind === 'original' ? media.originalName : decodeFilename(target.filename)),
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

/** Fichier demandé : l'original, un préréglage (404 s'il est inconnu) ou des paramètres libres. */
function derivedRequest(target: DeliveryTarget, beforeGenerate: () => void): 'original' | DerivedRequest {
  if (target.kind === 'original') return 'original'
  if (target.kind === 'transform') return { transformation: target.transformation, format: target.format, free: true, beforeGenerate }
  const transformation = builtinPresetTransformation(target.preset)
  if (!transformation) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  return { transformation, format: target.format, free: false }
}

/** Nom de fichier de l'URL (encodé) → texte, pour Content-Disposition. */
function decodeFilename(filename: string): string {
  try {
    return decodeURIComponent(filename)
  }
  catch {
    return filename
  }
}
