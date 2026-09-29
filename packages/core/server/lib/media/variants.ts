import { Readable } from 'node:stream'
import type { Media } from '../../generated/prisma/client'
import { useMediaStorage } from '../storage'
import { variantCache } from './cache'
import { handlerFor } from './handlers'
import { variantKey } from './keys'
import { runProcessing, useMediaProcessing } from './processing'
import type { MediaVariantName } from './urls'

/**
 * Fichiers servis par /m/ : l'original, ou un dérivé nommé (aperçu) généré une fois puis conservé
 * (`MediaVariant`, clé de stockage immuable). Générations dédoublonnées par processus, bornées par
 * la file des traitements (processing.ts), et **pré-générées** en tâche de fond après un envoi, un
 * remplacement ou une duplication (architecture § 9.2) : le premier affichage n'attend pas sharp.
 */

export interface DeliverableObject {
  key: string
  mimeType: string
  size: number
  etag: string
}

const VARIANT_MIME_TYPES: Record<string, string> = { webp: 'image/webp', avif: 'image/avif', jpg: 'image/jpeg', png: 'image/png' }
const pendingVariants = new Map<string, Promise<DeliverableObject>>()

/** Fichier à servir : l'original, ou un dérivé généré à la première demande puis conservé. */
export async function resolveDeliverable(media: Media, variant: 'original' | MediaVariantName): Promise<DeliverableObject> {
  if (variant === 'original') {
    return { key: media.storageKey, mimeType: media.mimeType, size: media.size, etag: media.checksum.slice(0, 32) }
  }

  // Un dérivé par version et par transformation (« v3/preview ») : un remplacement n'en réutilise aucun.
  const transformation = `v${media.version}/${variant}`
  const etag = `${media.checksum.slice(0, 24)}-${variant}`
  const cacheKey = `${media.id}:${transformation}`
  const cached = variantCache.get(cacheKey)
  if (cached) return { ...cached, etag }

  const prisma = await usePrisma()
  const existing = await prisma.mediaVariant.findUnique({
    where: { mediaId_transformation: { mediaId: media.id, transformation } },
  })
  if (existing) {
    const object = { key: existing.storageKey, mimeType: VARIANT_MIME_TYPES[existing.format] ?? 'application/octet-stream', size: existing.size }
    variantCache.set(cacheKey, object)
    return { ...object, etag }
  }

  // Demandes simultanées du même dérivé : une seule génération par processus.
  let pending = pendingVariants.get(cacheKey)
  if (!pending) {
    pending = renderVariant(media, transformation, etag).finally(() => pendingVariants.delete(cacheKey))
    pendingVariants.set(cacheKey, pending)
  }
  const rendered = await pending
  variantCache.set(cacheKey, { key: rendered.key, mimeType: rendered.mimeType, size: rendered.size })
  return rendered
}

async function renderVariant(media: Media, transformation: string, etag: string): Promise<DeliverableObject> {
  const handler = handlerFor(media.kind)
  if (!handler?.preview) throw createError({ statusCode: 404, statusMessage: 'Variant not available' })
  const preview = handler.preview

  const storage = await useMediaStorage()
  // Le fichier source n'est ouvert qu'une fois la place obtenue dans la file.
  const rendered = await runProcessing(async () => preview(await storage.getStream(media.storageKey)))
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

/**
 * Pré-génère l'aperçu d'un média qui vient d'être envoyé, remplacé ou dupliqué, sans le faire
 * attendre à l'appelant. Ignorée quand des traitements attendent déjà (la génération se fera à la
 * première demande) ; un échec est seulement journalisé.
 */
export function pregenerateVariants(media: Media): void {
  if (!handlerFor(media.kind)?.preview || media.deletedAt) return
  if (useMediaProcessing().pending > 0) return
  resolveDeliverable(media, 'preview').catch((error: unknown) => {
    if ((error as { data?: { code?: string } } | null)?.data?.code === 'SERVER_BUSY') return
    console.error(`[surge-media] Aperçu du média ${media.id} non pré-généré :`, error)
  })
}
