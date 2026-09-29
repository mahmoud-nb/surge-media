import type { H3Event } from 'h3'
import type { TokenScope } from '#shared/utils/permissions'
import type { Media } from '../../generated/prisma/client'
import { touchCredential } from '../access/credentials'
import { browserGuard, principalLibraryScopes, principalProjectScopes, resolvePrincipal } from '../access/principal'
import { getProjectState } from '../projects/state'
import { mediaError } from './errors'
import { verifyMediaSignature } from './signing'
import { MEDIA_VARIANTS, type MediaVariantName } from './urls'

/**
 * Diffusion des médias (/m/…) : analyse de l'URL et contrôle d'accès (fichiers : variants.ts).
 * Le chemin physique n'est jamais exposé : l'URL ne contient que l'identifiant,
 * la version et un nom indicatif.
 */

export interface DeliveryTarget {
  id: string
  version: number
  variant: 'original' | MediaVariantName
  /** Nom de fichier de l'URL : indicatif, ignoré pour retrouver le fichier. */
  filename: string
}

/** `<id>/v<version>/<nom>` ou `<id>/v<version>/<dérivé>/<nom>`, sinon null (404). */
export function parseDeliveryPath(path: string): DeliveryTarget | null {
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 3 || segments.length > 4) return null
  const [id, versionSegment] = segments as [string, string]
  const version = /^v(\d{1,9})$/.exec(versionSegment)
  const variant = segments.length === 4 ? segments[2]! : 'original'
  if (!/^[a-z0-9]{8,64}$/i.test(id) || !version) return null
  if (variant !== 'original' && !(MEDIA_VARIANTS as readonly string[]).includes(variant)) return null
  return { id, version: Number(version[1]), variant: variant as DeliveryTarget['variant'], filename: segments.at(-1)! }
}

/** Mode d'accès accordé, qui détermine la mise en cache de la réponse. */
export type DeliveryAccess =
  | { mode: 'public' }
  | { mode: 'signed', expires: number }
  | { mode: 'credential' }

/**
 * Diffusion sans cookie (aucune session lue) :
 *   - média public : libre ;
 *   - média privé : lien signé valable (fichier précis, droit « derived » ou « admin »), ou
 *     identifiant d'API (`Authorization: Bearer`) ayant `media:read` dans l'espace du média
 *     (jamais une clé publique ; jamais une clé secrète ou un jeton personnel depuis un navigateur ;
 *     un jeton délégué depuis une origine autorisée du projet) ;
 *   - média dans la corbeille : 404, sauf lien signé « admin » (aperçus de l'administration).
 */
export async function authorizeDelivery(event: H3Event, media: Media, target: DeliveryTarget): Promise<DeliveryAccess> {
  const query = getQuery(event)
  if (query.sig !== undefined || query.exp !== undefined) {
    const check = verifyMediaSignature({ mediaId: media.id, version: media.version, variant: target.variant }, query)
    if (check.status === 'valid' && (!media.deletedAt || check.scope === 'admin')) {
      return { mode: 'signed', expires: check.expires }
    }
    // Corbeille : on ne révèle pas que le média existe.
    if (media.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    throw mediaError(403, check.status === 'expired' ? 'SIGNATURE_EXPIRED' : 'SIGNATURE_INVALID')
  }

  if (media.deletedAt) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  if (media.visibility === 'PUBLIC') return { mode: 'public' }
  const authorization = getRequestHeader(event, 'authorization')
  if (authorization) {
    await authorizeCredential(event, authorization, media)
    return { mode: 'credential' }
  }
  throw mediaError(403, 'MEDIA_FORBIDDEN')
}

/** Identifiant d'API présenté pour un média privé : 401 s'il n'est pas valable, 403 sans `media:read`. */
async function authorizeCredential(event: H3Event, authorization: string, media: Media): Promise<void> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization)
  const resolution = match ? await resolvePrincipal(match[1]!) : { ok: false as const, code: 'TOKEN_INVALID' as const }
  if (!resolution.ok) {
    setResponseHeader(event, 'WWW-Authenticate', 'Bearer realm="surgeMedia", error="invalid_token"')
    throw createError({ statusCode: 401, statusMessage: resolution.code, data: { code: resolution.code } })
  }
  const { principal } = resolution
  const refused = await browserGuard(event, principal)
  if (refused) throw createError({ statusCode: 403, statusMessage: refused, data: { code: refused } })

  let scopes: TokenScope[] = []
  if (media.projectId) {
    const project = await getProjectState(media.projectId)
    // Projet archivé : ses identifiants sont refusés.
    if (project && !project.archived) scopes = await principalProjectScopes(principal, project)
  }
  else {
    scopes = principalLibraryScopes(principal)
  }
  // Une clé publique ne lit jamais un média privé ; un jeton délégué seulement avec media:read.
  if (principal.type === 'publishable' || !scopes.includes('media:read')) throw mediaError(403, 'MEDIA_FORBIDDEN')
  if (!principal.delegated) touchCredential(principal.credential, getRequestIP(event))
}

/** Cache HTTP selon le mode d'accès. */
export function cacheControl(access: DeliveryAccess): string {
  switch (access.mode) {
    // URL versionnée : son contenu ne change jamais.
    case 'public': return 'public, max-age=31536000, immutable'
    // Lien signé : jamais au-delà de son échéance, et pas dans les caches partagés.
    case 'signed': return `private, max-age=${Math.max(0, Math.min(access.expires - Math.floor(Date.now() / 1000), 3600))}`
    // Identifiant d'API : réponse propre à l'appelant, toujours revalidée (ETag).
    case 'credential': return 'private, no-cache'
  }
}

/** En-tête Content-Disposition (affichage dans le navigateur, nom lisible si téléchargé). */
export function contentDisposition(filename: string): string {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '_') || 'media'
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
