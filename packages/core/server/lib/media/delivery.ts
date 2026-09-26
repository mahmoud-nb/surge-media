import { Readable } from 'node:stream'
import type { H3Event } from 'h3'
import { hasPermission } from '#shared/utils/permissions'
import type { Media } from '../../generated/prisma/client'
import { useMediaStorage } from '../storage'
import { mediaError } from './errors'
import { handlerFor } from './handlers'
import { variantKey } from './keys'
import { verifyMediaSignature } from './signing'
import { MEDIA_VARIANTS, type MediaVariantName } from './urls'

/**
 * Diffusion des médias (/m/…) : analyse de l'URL, contrôle d'accès et dérivés.
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
  | { mode: 'session' }

/**
 * Média public : libre. Média privé : lien signé valable, ou session d'administration
 * avec la permission media:manage (aperçus). Phase B : jeton d'accès (Bearer, media:read).
 */
export async function authorizeDelivery(event: H3Event, media: Media, target: DeliveryTarget): Promise<DeliveryAccess> {
  // Corbeille : plus diffusé (ni public, ni lien signé), sauf aperçu dans l'administration.
  if (media.deletedAt) {
    if (await hasAdminSession(event)) return { mode: 'session' }
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  if (media.visibility === 'PUBLIC') return { mode: 'public' }

  const { exp, sig } = getQuery(event)
  if (exp !== undefined || sig !== undefined) {
    const check = verifyMediaSignature({ mediaId: media.id, version: media.version, variant: target.variant }, exp, sig)
    if (check.status === 'valid') return { mode: 'signed', expires: check.expires }
    throw mediaError(403, check.status === 'expired' ? 'SIGNATURE_EXPIRED' : 'SIGNATURE_INVALID')
  }

  if (await hasAdminSession(event)) return { mode: 'session' }
  throw mediaError(403, 'MEDIA_FORBIDDEN')
}

/** Session d'administration valide avec la permission media:manage. */
async function hasAdminSession(event: H3Event): Promise<boolean> {
  const user = await resolveSession(await getUserSession(event))
  return Boolean(user && hasPermission(user.role, 'media:manage'))
}

export interface DeliverableObject {
  key: string
  mimeType: string
  size: number
  etag: string
}

const VARIANT_MIME_TYPES: Record<string, string> = { webp: 'image/webp', avif: 'image/avif', jpg: 'image/jpeg', png: 'image/png' }
const pendingVariants = new Map<string, Promise<DeliverableObject>>()

/** Fichier à servir : l'original, ou un dérivé généré à la première demande puis conservé. */
export async function resolveDeliverable(media: Media, variant: DeliveryTarget['variant']): Promise<DeliverableObject> {
  if (variant === 'original') {
    return { key: media.storageKey, mimeType: media.mimeType, size: media.size, etag: media.checksum.slice(0, 32) }
  }

  // Un dérivé par version et par transformation (« v3/preview ») : un remplacement n'en réutilise aucun.
  const transformation = `v${media.version}/${variant}`
  const etag = `${media.checksum.slice(0, 24)}-${variant}`
  const prisma = await usePrisma()
  const existing = await prisma.mediaVariant.findUnique({
    where: { mediaId_transformation: { mediaId: media.id, transformation } },
  })
  if (existing) {
    return { key: existing.storageKey, mimeType: VARIANT_MIME_TYPES[existing.format] ?? 'application/octet-stream', size: existing.size, etag }
  }

  // Demandes simultanées du même dérivé : une seule génération par processus.
  const pendingKey = `${media.id}:${transformation}`
  let pending = pendingVariants.get(pendingKey)
  if (!pending) {
    pending = renderVariant(media, transformation, etag).finally(() => pendingVariants.delete(pendingKey))
    pendingVariants.set(pendingKey, pending)
  }
  return pending
}

async function renderVariant(media: Media, transformation: string, etag: string): Promise<DeliverableObject> {
  const handler = handlerFor(media.kind)
  if (!handler?.preview) throw createError({ statusCode: 404, statusMessage: 'Variant not available' })

  const storage = await useMediaStorage()
  const rendered = await handler.preview(await storage.getStream(media.storageKey))
  const key = variantKey(media.id, media.version, transformation, rendered.extension)
  await storage.put(key, Readable.from(rendered.data), { contentType: rendered.mimeType, size: rendered.data.length })

  const prisma = await usePrisma()
  try {
    await prisma.mediaVariant.create({
      data: {
        mediaId: media.id,
        transformation,
        storageKey: key,
        format: rendered.extension,
        size: rendered.data.length,
        width: rendered.width,
        height: rendered.height,
      },
    })
  }
  catch (error) {
    // Déjà enregistré par un autre processus : même fichier, même clé.
    if (!isUniqueViolation(error)) throw error
  }
  return { key, mimeType: rendered.mimeType, size: rendered.data.length, etag }
}

/** Cache HTTP selon le mode d'accès. */
export function cacheControl(access: DeliveryAccess): string {
  switch (access.mode) {
    // URL versionnée : son contenu ne change jamais.
    case 'public': return 'public, max-age=31536000, immutable'
    // Lien signé : jamais au-delà de son échéance, et pas dans les caches partagés.
    case 'signed': return `private, max-age=${Math.max(0, Math.min(access.expires - Math.floor(Date.now() / 1000), 3600))}`
    // Session d'administration : revalidation systématique (ETag → 304).
    case 'session': return 'private, no-cache'
  }
}

/** En-tête Content-Disposition (affichage dans le navigateur, nom lisible si téléchargé). */
export function contentDisposition(filename: string): string {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '_') || 'media'
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
