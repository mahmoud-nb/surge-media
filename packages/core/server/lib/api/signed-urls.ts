import type { ApiMediaSource, ApiSignedUrlBody } from '#shared/schemas/api'
import { API_DEFAULT_TRANSFORM_FORMAT } from '#shared/utils/api'
import { transformationSegment, type TransformPolicy } from '#shared/utils/transforms'
import { apiProblem } from './problem'
import { mediaError } from '../media/errors'
import { signMediaAccess } from '../media/signing'
import { derivedPath, mediaPath, trackPath } from '../media/urls'
import { apiVideoSources, type ApiMediaRecord } from './serializers'
import { hasDerivedFiles } from '../media/variants'
import { resolveTransformRequest } from '../transforms/service'
import { signaturePlan, type SignedFile } from './signature-plan'

/**
 * Adresses de médias et de dérivés, signées si nécessaire : liens de l'API v1 (`POST …/media/
 * {mediaId}/signed-url` et le lot `POST …/signed-urls`) et générateur d'adresses de la fiche média
 * (`POST /api/admin/media/:id/links`). L'original, un préréglage de l'espace, une transformation libre
 * (canonisée), ou le droit « derived » (tout dérivé de la version). Architecture phase C § 5.3 et § 7.
 * L'original d'une vidéo est accompagné de ses sources de lecture (`sources`, phase D3) : le droit sur le
 * fichier couvre ses rendus (DD33), les sources reprennent donc la signature et l'échéance du lien.
 *
 * Erreurs métier (`data.code` : INVALID_TRANSFORM, PRESET_NOT_FOUND, TRANSFORM_NOT_ALLOWED ; 400 sans
 * code pour un média sans dérivés) : l'API v1 les convertit en problèmes RFC 9457 (`toProblem`).
 */

export type SignedUrlRequest = Omit<ApiSignedUrlBody, 'expiresIn'>

export interface SignedUrlOptions {
  /** Base absolue des URL de diffusion (urls.ts, `mediaBaseUrl`). */
  base: string
  policy: TransformPolicy
  delegated: boolean
  /** Échéance (secondes Unix) d'un lien à échéance : la même pour tout un lot. */
  expires: number
}

export interface SignedUrlResult {
  url: string
  /** Paramètres de signature seuls (vide sans signature). */
  query: string
  expiresAt: string | null
  /** Cible `file` d'une vidéo : ses sources de lecture, signées comme `url`. */
  sources?: ApiMediaSource[]
}

/**
 * Fichier demandé : format activé, transformation canonisée (vide = préréglage `full`), préréglage
 * de l'espace (intégré, du projet ou global ; l'aperçu par défaut).
 */
async function resolveSignedFile(media: ApiMediaRecord, request: SignedUrlRequest): Promise<SignedFile> {
  if (request.target === 'file') return { kind: 'file' }
  if (request.target === 'track') {
    if (!media.textTracks.some(track => track.id === request.trackId)) throw apiProblem('TRACK_NOT_FOUND')
    return { kind: 'track', trackId: request.trackId! }
  }
  if (!hasDerivedFiles(media)) throw createError({ statusCode: 400, statusMessage: 'This media item has no derived files (images only).' })

  const format = request.format ?? API_DEFAULT_TRANSFORM_FORMAT
  const resolved = await resolveTransformRequest(media.projectId, { preset: request.preset, transform: request.transform, format })
  if (resolved.kind === 'preset') return { kind: 'preset', name: resolved.name, format }
  // Transformation vide : sa forme canonique est le préréglage intégré `full`.
  return resolved.canonical === '' ? { kind: 'preset', name: 'full', format } : { kind: 'transform', canonical: resolved.canonical, format }
}

/**
 * Lien vers un média actif du projet, signé selon sa visibilité et la politique du projet
 * (`signaturePlan`) ; 403 TRANSFORM_NOT_ALLOWED pour une transformation libre en politique `presets`.
 */
export async function issueSignedUrl(media: ApiMediaRecord, request: SignedUrlRequest, options: SignedUrlOptions): Promise<SignedUrlResult> {
  const file = await resolveSignedFile(media, request)
  const plan = signaturePlan(file, request.target === 'derived', {
    visibility: media.visibility,
    policy: options.policy,
    delegated: options.delegated,
  })
  if (plan.type === 'refused') throw mediaError(403, 'TRANSFORM_NOT_ALLOWED', { detail: plan.detail })

  const path = file.kind === 'file'
    ? mediaPath(media)
    : file.kind === 'track' ? trackPath(media, file.trackId) : derivedPath(media, file.kind === 'preset' ? file.name : transformationSegment(file.canonical), file.format)
  const url = `${options.base}${path}`
  const query = plan.type === 'none' ? '' : signMediaAccess(media, plan.access, plan.type === 'permanent' ? null : options.expires)
  const result: SignedUrlResult = {
    url: query ? `${url}?${query}` : url,
    query,
    expiresAt: plan.type === 'expiring' ? new Date(options.expires * 1000).toISOString() : null,
  }
  if (file.kind === 'file' && media.kind === 'VIDEO') result.sources = apiVideoSources(media, media.renditions, options.base, query ? `?${query}` : '')
  return result
}
