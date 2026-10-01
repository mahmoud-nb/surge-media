import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  BUILTIN_PRESETS,
  parseTransformation,
  TRANSFORM_MIME_TYPES,
  type TransformFormat,
  type Transformation,
} from '#shared/utils/transforms'
import type { Media } from '../../generated/prisma/client'
import { useMediaStorage } from '../storage'
import { variantCache } from './cache'
import { mediaError } from './errors'
import { handlerFor, type MediaTypeHandler } from './handlers'
import { variantKey } from './keys'
import { runProcessing, useMediaProcessing } from './processing'
import { planTransform, type TransformPlan, type TransformSource } from './transform-plan'
import { useTransformSettings } from './transform-settings'

/**
 * Fichiers servis par /m/ : l'original, ou un dérivé (préréglage, paramètres libres) généré une fois
 * puis conservé (`MediaVariant`, clé de stockage immuable). Un dérivé est identifié par son
 * **opération effective** (transform-plan.ts) : deux demandes qui produisent la même image partagent
 * un fichier. Générations dédoublonnées par processus, bornées par la file des traitements
 * (processing.ts) ; les paramètres libres sont en plus soumis à un quota de dérivés par version et
 * au débit de nouvelles générations (garde-fous, architecture phase C § 6). L'aperçu est
 * **pré-généré** en tâche de fond après un envoi, un remplacement ou une duplication.
 */

export interface DeliverableObject {
  key: string
  mimeType: string
  size: number
  etag: string
}

/** Dérivé demandé : transformation canonique et format de sortie. */
export interface DerivedRequest {
  transformation: Transformation
  format: TransformFormat
  /** Paramètres libres : soumis au quota de dérivés par version (un préréglage ne l'est pas). */
  free: boolean
  /** Appelé juste avant une nouvelle génération libre (débit par IP) ; lève une erreur pour la refuser. */
  beforeGenerate?: () => void
}

const pendingVariants = new Map<string, Promise<DeliverableObject>>()

/** Transformations des préréglages intégrés (`preview`, `full`), analysées une fois. */
const BUILTIN_TRANSFORMATIONS = new Map(Object.entries(BUILTIN_PRESETS).map(([name, definition]) => {
  const parsed = parseTransformation(definition)
  if (!parsed.ok) throw new Error(`[surge-media] Préréglage intégré « ${name} » invalide : ${parsed.message}`)
  return [name, parsed.transformation]
}))

export function builtinPresetTransformation(name: string): Transformation | null {
  return BUILTIN_TRANSFORMATIONS.get(name) ?? null
}

/** Aperçu de l'administration et de l'API (`previewUrl`) : préréglage intégré, en WebP. */
export function previewRequest(): DerivedRequest {
  return { transformation: builtinPresetTransformation('preview')!, format: 'webp', free: false }
}

/** Le genre de ce média produit-il des dérivés (transformations, aperçu) ? */
export function hasDerivedFiles(media: Pick<Media, 'kind'>): boolean {
  return Boolean(handlerFor(media.kind)?.transform)
}

/** Source d'une transformation : dimensions orientées, transparence (point d'intérêt : phase C3). */
export function transformSource(media: Media): TransformSource | null {
  if (!media.width || !media.height) return null
  const metadata = media.metadata as { hasAlpha?: unknown } | null
  return { width: media.width, height: media.height, hasAlpha: metadata?.hasAlpha === true, focal: null }
}

/** Fichier à servir : l'original, ou un dérivé généré à la première demande puis conservé. */
export async function resolveDeliverable(media: Media, request: 'original' | DerivedRequest): Promise<DeliverableObject> {
  if (request === 'original') {
    return { key: media.storageKey, mimeType: media.mimeType, size: media.size, etag: media.checksum.slice(0, 32) }
  }

  const handler = handlerFor(media.kind)
  const source = transformSource(media)
  if (!handler?.transform || !source) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  const planned = planTransform(request.transformation, source, request.format, useTransformSettings().maxDimension)
  if (!planned.ok) throw mediaError(400, 'INVALID_TRANSFORM', { detail: planned.message })
  const { plan } = planned

  // Un dérivé par version et par opération effective (« v3/size_800x533,q_80.webp ») : un
  // remplacement n'en réutilise aucun.
  const transformation = `v${media.version}/${plan.key}`
  const etag = `${media.checksum.slice(0, 24)}-${createHash('sha256').update(plan.key).digest('hex').slice(0, 10)}`
  const cacheKey = `${media.id}:${transformation}`
  const cached = variantCache.get(cacheKey)
  if (cached) return { ...cached, etag }

  const prisma = await usePrisma()
  const existing = await prisma.mediaVariant.findUnique({
    where: { mediaId_transformation: { mediaId: media.id, transformation } },
  })
  if (existing) {
    const mimeType = TRANSFORM_MIME_TYPES[existing.format as TransformFormat] ?? 'application/octet-stream'
    const object = { key: existing.storageKey, mimeType, size: existing.size }
    variantCache.set(cacheKey, object)
    return { ...object, etag }
  }

  // Demandes simultanées du même dérivé : une seule génération par processus (garde-fous compris).
  let pending = pendingVariants.get(cacheKey)
  if (!pending) {
    pending = (async () => {
      if (request.free) {
        await assertVariantQuota(media)
        request.beforeGenerate?.()
      }
      return renderVariant(media, handler, plan, transformation, etag)
    })().finally(() => pendingVariants.delete(cacheKey))
    pendingVariants.set(cacheKey, pending)
  }
  const rendered = await pending
  variantCache.set(cacheKey, { key: rendered.key, mimeType: rendered.mimeType, size: rendered.size })
  return rendered
}

/** Quota de dérivés par version : au-delà, plus de nouveaux dérivés libres (les existants restent servis). */
async function assertVariantQuota(media: Media): Promise<void> {
  const { maxVariants } = useTransformSettings()
  const prisma = await usePrisma()
  const count = await prisma.mediaVariant.count({ where: { mediaId: media.id, transformation: { startsWith: `v${media.version}/` } } })
  if (count >= maxVariants) {
    throw mediaError(429, 'TRANSFORM_QUOTA', { detail: `This media version already has ${count} derived files (${maxVariants} at most): use an existing size or a preset.` })
  }
}

async function renderVariant(
  media: Media,
  handler: MediaTypeHandler,
  plan: TransformPlan,
  transformation: string,
  etag: string,
): Promise<DeliverableObject> {
  const transform = handler.transform!
  const storage = await useMediaStorage()
  // Le fichier source n'est ouvert qu'une fois la place obtenue dans la file.
  const rendered = await runProcessing(async () => transform(await storage.getStream(media.storageKey), plan))
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
  if (!hasDerivedFiles(media) || media.deletedAt) return
  if (useMediaProcessing().pending > 0) return
  resolveDeliverable(media, previewRequest()).catch((error: unknown) => {
    if ((error as { data?: { code?: string } } | null)?.data?.code === 'SERVER_BUSY') return
    console.error(`[surge-media] Aperçu du média ${media.id} non pré-généré :`, error)
  })
}
