import { freeTransformAllowed } from '#shared/utils/transforms'
import { PROCESSING_RETRY_AFTER } from '#shared/utils/video-processing'
import type { Media } from '../../generated/prisma/client'
import { createTokenBucketLimiter } from '../../lib/api/rate-limit'
import { closeWithResponse } from '../../lib/http/stream'
import { findDeliveryMedia, reloadDeliveryMedia, type DeliveryMedia } from '../../lib/media/cache'
import {
  authorizeDelivery,
  cacheControl,
  contentDisposition,
  currentTargetPath,
  deliveryReloadNeeded,
  generationRateLimited,
  holdApplies,
  originalDisposition,
  parseDeliveryPath,
  transformGrant,
  type DeliveryAccess,
} from '../../lib/media/delivery'
import type { DeliveryTarget, DerivedTarget } from '../../lib/media/delivery-path'
import { mediaError } from '../../lib/media/errors'
import { BUSY_RETRY_AFTER } from '../../lib/media/processing'
import { resolveRange } from '../../lib/media/range'
import { renditionFilename, resolveRenditionDeliverable } from '../../lib/media/renditions'
import { useTransformSettings } from '../../lib/media/transform-settings'
import { resolveTrackDeliverable } from '../../lib/media/tracks'
import { resolveDeliverable, type DeliverableObject, type DerivedRequest } from '../../lib/media/variants'
import { useMediaStorage } from '../../lib/storage'
import { resolvePreset, spaceTransformPolicy } from '../../lib/transforms/service'
import { useVideoProcessingSettings } from '../../lib/video-processing/settings'

/** Débit de nouvelles générations libres non signées, par IP (architecture phase C § 6). */
const generations = createTokenBucketLimiter()

/**
 * GET|HEAD /m/<id>/v<version>/[<préréglage>|<paramètres>/]<nom> — diffusion d'un média ;
 * /m/<id>/v<version>/tracks/<piste>.vtt — piste de texte d'une vidéo (phase D2, droit signé `track:<piste>`) ;
 * /m/<id>/v<version>/renditions/h264.mp4|av1.webm — rendu d'une vidéo (phase D3, droit signé de l'original).
 *
 * Original, préréglage (intégré `preview`/`full`, du projet ou global) ou transformation libre
 * (`w_800,h_600,q_75`), format de sortie donné par l'extension (phase C). Une transformation non
 * canonique est redirigée (301) vers sa forme canonique ; invalide → 400 INVALID_TRANSFORM ;
 * refusée par la politique de l'espace → 403 TRANSFORM_NOT_ALLOWED. Dérivés générés une fois puis
 * conservés ; nouveaux dérivés libres soumis au quota par version et au débit par IP (429
 * TRANSFORM_QUOTA). Préréglage global ou de projet : cache limité (modifiable), revalidé par l'ETag.
 *
 * Public : mis en cache sans limite (l'URL change à chaque remplacement). Privé : lien signé
 * (?exp=&kid=&sig=) ou identifiant d'API (`Authorization: Bearer`), jamais par cookie. Le chemin
 * physique n'est jamais exposé ; le type MIME vient de la base (nosniff). Requêtes partielles
 * (`Range`, une plage) : 206 / 416. Métadonnées lues via le cache de diffusion (60 s), relues pour une
 * version plus récente, un rendu ou une affiche de vidéo inconnus du cache. Flux du stockage fermé si le
 * client interrompt la réponse (`closeWithResponse`).
 *
 * Ancienne version : 302 vers l'URL courante (un rendu : vers le rendu de la version courante s'il
 * existe, sinon vers l'original). Rendu absent : 404. Original et rendus d'une vidéo dont la piste de
 * métadonnées n'est pas encore retirée : 503 PROCESSING_PENDING (`Retry-After: 30`), sauf lien « admin ».
 * Original d'un format converti (MKV, AVI…) : `Content-Disposition: attachment`.
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

  let media = await findDeliveryMedia(target.id)
  // Version plus récente que le cache, rendu ou affiche de vidéo qu'il ne connaît pas : écrits depuis par
  // un processus de travail ou une autre instance (invalidation locale) ; relus avant de décider.
  if (media && deliveryReloadNeeded(target, media)) media = await reloadDeliveryMedia(target.id)
  if (!media) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  // Ancienne version (fichier remplacé, réécrit par le traitement, affiche changée) : redirection vers
  // l'URL courante, sans mise en cache ; CORS permis, sans quoi un `<video crossorigin>` ou un fetch()
  // d'un autre site ne suivrait pas la redirection. Un média dans la corbeille n'est jamais redirigé
  // (son existence n'est pas révélée).
  if (target.version !== media.version) {
    if (media.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    setResponseHeaders(event, { 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' })
    return sendRedirect(event, currentTargetPath(media, target), 302)
  }

  const access = await authorizeDelivery(event, media, target)

  // Retrait d'une piste de métadonnées (positions GPS…) en attente : l'original et ses rendus ne sont
  // servis qu'aux liens « admin ». Après le contrôle d'accès (un média privé reste 403, rien n'est
  // révélé) ; jamais mis en cache, lisible par un script (Retry-After exposé).
  if (holdApplies(target, media, access, useVideoProcessingSettings().mode)) {
    setResponseHeaders(event, {
      'Retry-After': PROCESSING_RETRY_AFTER,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Retry-After',
    })
    throw mediaError(503, 'PROCESSING_PENDING', {
      retryAfter: PROCESSING_RETRY_AFTER,
      detail: 'This video is being processed (device metadata track removal): retry later.',
    })
  }

  const { object, mutable } = await deliverable(media, target, access, () => {
    if (!generationRateLimited(access) || settings.rateLimit === 0) return
    const result = generations.take(`gen:${getRequestIP(event) ?? 'unknown'}`, settings.rateLimit)
    if (!result.allowed) {
      throw mediaError(429, 'TRANSFORM_QUOTA', {
        retryAfter: result.retryAfter,
        detail: `Too many new transformations from this address (${settings.rateLimit} per minute): use existing sizes, a preset or a signed URL.`,
      })
    }
  }).catch((error: unknown) => {
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
    'Cache-Control': cacheControl(access, mutable ? settings.presetMaxAge : undefined),
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; sandbox',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    // Lecture par fetch() ou <canvas> depuis n'importe quel site : l'URL (publique ou signée) ou
    // l'identifiant présenté est la preuve d'accès (jamais de cookie).
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
    'Content-Disposition': dispositionHeader(media, target),
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
    return sendStream(event, closeWithResponse(event.node.res, await storage.getStream(object.key, { start: range.start, end: range.end })))
  }

  setResponseHeader(event, 'Content-Length', object.size)
  if (event.method === 'HEAD') {
    // En-têtes seuls, statut 200 (renvoyer null produirait un 204).
    event.node.res.end()
    return
  }
  return sendStream(event, closeWithResponse(event.node.res, await storage.getStream(object.key)))
})

/**
 * Fichier servi : l'original, une piste de texte, un rendu ou un dérivé (`derivedRequest`).
 * `mutable` : préréglage modifiable (cache limité, revalidé).
 */
async function deliverable(
  media: DeliveryMedia,
  target: DeliveryTarget,
  access: DeliveryAccess,
  beforeGenerate: () => void,
): Promise<{ object: DeliverableObject, mutable: boolean }> {
  switch (target.kind) {
    case 'original': return { object: await resolveDeliverable(media, 'original'), mutable: false }
    case 'track': return { object: await resolveTrackDeliverable(media, target.trackId), mutable: false }
    case 'rendition': {
      // Absent même après relecture du cache (pas encore produit, ou fichier remplacé depuis) : 404,
      // jamais mis en cache (Nitro marque toute réponse 404 `no-cache`) — le rendu peut arriver.
      const object = resolveRenditionDeliverable(media, target.name)
      if (!object) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
      return { object, mutable: false }
    }
    default: {
      const { request, mutable } = await derivedRequest(media, target, access, beforeGenerate)
      return { object: await resolveDeliverable(media, request), mutable }
    }
  }
}

/**
 * Dérivé demandé : un préréglage de l'espace (intégré, du projet ou global ; 404 s'il est inconnu) ou
 * des paramètres libres, soumis à la politique de l'espace (403 TRANSFORM_NOT_ALLOWED).
 */
async function derivedRequest(
  media: Media,
  target: DerivedTarget,
  access: DeliveryAccess,
  beforeGenerate: () => void,
): Promise<{ request: DerivedRequest, mutable: boolean }> {
  if (target.kind === 'transform') {
    const policy = await spaceTransformPolicy(media.projectId)
    if (!freeTransformAllowed(policy, transformGrant(access))) {
      throw mediaError(403, 'TRANSFORM_NOT_ALLOWED', {
        detail: policy === 'PRESETS'
          ? 'This space only serves presets: use a preset name instead of parameters.'
          : 'Free transformations in this space require a signed URL (or an API credential).',
      })
    }
    return { request: { transformation: target.transformation, format: target.format, free: true, beforeGenerate }, mutable: false }
  }

  const preset = await resolvePreset(media.projectId, target.preset)
  if (!preset) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  if (!preset.transformation) throw mediaError(400, 'INVALID_TRANSFORM', { detail: preset.error })
  return { request: { transformation: preset.transformation, format: target.format, free: false }, mutable: preset.level !== 'builtin' }
}

/**
 * Content-Disposition : nom d'origine pour l'original (en téléchargement pour un format converti, que le
 * navigateur ne lit pas), nom du média pour un rendu, nom de l'URL pour un dérivé ou une piste.
 */
function dispositionHeader(media: DeliveryMedia, target: DeliveryTarget): string {
  switch (target.kind) {
    case 'original': return contentDisposition(media.originalName, originalDisposition(media))
    case 'rendition': return contentDisposition(renditionFilename(media, target.name))
    default: return contentDisposition(decodeFilename(target.filename))
  }
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
