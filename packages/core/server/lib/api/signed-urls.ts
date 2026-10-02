import type { ApiSignedUrlBody } from '#shared/schemas/api'
import { API_DEFAULT_TRANSFORM_FORMAT } from '#shared/utils/api'
import { parseTransformation, transformationSegment, type TransformPolicy } from '#shared/utils/transforms'
import type { Media } from '../../generated/prisma/client'
import { signMediaAccess } from '../media/signing'
import { useTransformSettings } from '../media/transform-settings'
import { derivedPath, mediaPath } from '../media/urls'
import { hasDerivedFiles } from '../media/variants'
import { resolvePreset } from '../transforms/service'
import { apiProblem } from './problem'
import { signaturePlan, type SignedFile } from './signature-plan'

/**
 * Liens signés délivrés par l'API v1 (`POST …/media/{mediaId}/signed-url` et le lot
 * `POST …/signed-urls`) : l'original, un préréglage du projet, une transformation libre (canonisée),
 * ou le droit « derived » (tout dérivé de la version). Architecture phase C § 5.3 et § 7.
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
}

/**
 * Fichier demandé : format activé, transformation canonisée (vide = préréglage `full`), préréglage
 * de l'espace (intégré, du projet ou global). Problèmes : INVALID_REQUEST (média sans dérivés),
 * INVALID_TRANSFORM, PRESET_NOT_FOUND.
 */
async function resolveSignedFile(media: Media, request: SignedUrlRequest): Promise<SignedFile> {
  if (request.target === 'file') return { kind: 'file' }
  if (!hasDerivedFiles(media)) throw apiProblem('INVALID_REQUEST', 'This media item has no derived files (images only).')

  const settings = useTransformSettings()
  const format = request.format ?? API_DEFAULT_TRANSFORM_FORMAT
  if (!settings.formats.includes(format)) {
    throw apiProblem('INVALID_TRANSFORM', `Output format "${format}" is not enabled on this server (${settings.formats.join(', ')}).`)
  }
  if (request.transform !== undefined) {
    const parsed = parseTransformation(request.transform, settings)
    if (!parsed.ok) throw apiProblem('INVALID_TRANSFORM', parsed.message)
    // Transformation vide : sa forme canonique est le préréglage intégré `full`.
    return parsed.canonical === '' ? { kind: 'preset', name: 'full', format } : { kind: 'transform', canonical: parsed.canonical, format }
  }

  const name = request.preset ?? 'preview'
  const preset = await resolvePreset(media.projectId, name)
  if (!preset) throw apiProblem('PRESET_NOT_FOUND', `No preset "${name}" in this project (see GET /projects/{projectId}/presets).`)
  if (!preset.transformation) throw apiProblem('INVALID_TRANSFORM', preset.error ?? undefined)
  return { kind: 'preset', name, format }
}

/**
 * Lien vers un média actif du projet, signé selon sa visibilité et la politique du projet
 * (`signaturePlan`) ; 403 TRANSFORM_NOT_ALLOWED pour une transformation libre en politique `presets`.
 */
export async function issueSignedUrl(media: Media, request: SignedUrlRequest, options: SignedUrlOptions): Promise<SignedUrlResult> {
  const file = await resolveSignedFile(media, request)
  const plan = signaturePlan(file, request.target === 'derived', {
    visibility: media.visibility,
    policy: options.policy,
    delegated: options.delegated,
  })
  if (plan.type === 'refused') throw apiProblem('TRANSFORM_NOT_ALLOWED', plan.detail)

  const path = file.kind === 'file'
    ? mediaPath(media)
    : derivedPath(media, file.kind === 'preset' ? file.name : transformationSegment(file.canonical), file.format)
  const url = `${options.base}${path}`
  if (plan.type === 'none') return { url, query: '', expiresAt: null }
  if (plan.type === 'permanent') {
    const query = signMediaAccess(media, plan.access, null)
    return { url: `${url}?${query}`, query, expiresAt: null }
  }
  const query = signMediaAccess(media, plan.access, options.expires)
  return { url: `${url}?${query}`, query, expiresAt: new Date(options.expires * 1000).toISOString() }
}
