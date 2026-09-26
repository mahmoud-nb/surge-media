import { createReadStream } from 'node:fs'
import type { MediaListQuery, MediaMetadataInput } from '#shared/schemas/media'
import { MEDIA_PAGE_SIZE } from '#shared/schemas/media'
import { ACCEPTED_MEDIA_TYPES, extensionForMime, mediaKindForMime, type MediaKind } from '#shared/utils/media'
import type { Media, Prisma, User } from '../../generated/prisma/client'
import { useMediaStorage } from '../storage'
import { mediaError } from './errors'
import { handlerFor, type InspectedMedia } from './handlers'
import { originalKey, variantPrefix } from './keys'
import { sniffMimeType } from './sniff'
import type { ReceivedUpload } from './upload'
import { mediaPath } from './urls'

/**
 * Logique métier des médias. Indépendante du stockage physique (MediaStorage) et du genre
 * de média (gestionnaires) : les API d'administration, l'API publique (phase B) et la
 * diffusion passent toutes par ce module.
 */

const UPLOADER = { select: { id: true, name: true, email: true } } as const
type MediaWithUploader = Media & { uploadedBy: { id: string, name: string | null, email: string } | null }

// ─── Projet par défaut ───────────────────────────────────────────────────────

const DEFAULT_PROJECT_SLUG = 'default'
let defaultProject: Promise<string> | undefined

/** Projet utilisé tant que l'écran Projets n'existe pas (créé au premier besoin). */
export function defaultProjectId(): Promise<string> {
  defaultProject ??= (async () => {
    const prisma = await usePrisma()
    const project = await prisma.project.upsert({
      where: { slug: DEFAULT_PROJECT_SLUG },
      create: { slug: DEFAULT_PROJECT_SLUG, name: 'Default project' },
      update: {},
      select: { id: true },
    })
    return project.id
  })().catch((error: unknown) => {
    defaultProject = undefined
    throw error
  })
  return defaultProject
}

// ─── Représentation API ──────────────────────────────────────────────────────

export function toMediaSummary(media: MediaWithUploader) {
  return {
    id: media.id,
    kind: media.kind,
    visibility: media.visibility,
    originalName: media.originalName,
    title: media.title,
    altText: media.altText,
    mimeType: media.mimeType,
    extension: extensionForMime(media.mimeType) ?? null,
    size: media.size,
    width: media.width,
    height: media.height,
    duration: media.duration,
    version: media.version,
    /** Chemin de diffusion ; pour un média privé, accessible avec une session ou un lien signé. */
    url: mediaPath(media),
    previewUrl: handlerFor(media.kind)?.preview ? mediaPath(media, 'preview') : null,
    uploadedBy: media.uploadedBy,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    deletedAt: media.deletedAt,
  }
}

export function toMediaDetail(media: MediaWithUploader) {
  return { ...toMediaSummary(media), checksum: media.checksum, metadata: media.metadata }
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

/** Média par identifiant (corbeille comprise) ou 404. */
export async function findMediaOr404(id: string): Promise<MediaWithUploader> {
  const prisma = await usePrisma()
  const media = await prisma.media.findUnique({ where: { id }, include: { uploadedBy: UPLOADER } })
  if (!media) throw createError({ statusCode: 404, statusMessage: 'Media not found' })
  return media
}

const SORTS: Record<MediaListQuery['sort'], Prisma.MediaOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  name: [{ originalName: 'asc' }, { id: 'asc' }],
  size: [{ size: 'desc' }, { id: 'desc' }],
}

export async function listMedia(query: MediaListQuery) {
  const where: Prisma.MediaWhereInput = {
    projectId: await defaultProjectId(),
    deletedAt: query.status === 'trash' ? { not: null } : null,
  }
  if (query.q) {
    where.OR = textSearch(['originalName', 'title', 'altText'], query.q)
  }
  if (query.kind) where.kind = query.kind as MediaKind
  if (query.visibility) where.visibility = query.visibility

  const prisma = await usePrisma()
  const [total, items] = await Promise.all([
    prisma.media.count({ where }),
    prisma.media.findMany({
      where,
      include: { uploadedBy: UPLOADER },
      orderBy: SORTS[query.sort],
      skip: (query.page - 1) * MEDIA_PAGE_SIZE,
      take: MEDIA_PAGE_SIZE,
    }),
  ])
  return { items: items.map(toMediaSummary), total, page: query.page, pageSize: MEDIA_PAGE_SIZE }
}

// ─── Écriture ────────────────────────────────────────────────────────────────

interface AnalyzedUpload {
  kind: MediaKind
  mimeType: string
  extension: string
  inspected: InspectedMedia
}

/**
 * Identifie le fichier d'après son contenu (signature binaire), jamais d'après le nom ou le
 * type annoncés par le client, puis le fait analyser par le gestionnaire de son genre.
 */
async function analyze(upload: ReceivedUpload): Promise<AnalyzedUpload> {
  const mimeType = await sniffMimeType(upload.path)
  const kind = mimeType ? mediaKindForMime(mimeType) : undefined
  const handler = kind ? handlerFor(kind) : undefined
  if (!mimeType || !kind || !handler) {
    const accepted = Object.values(ACCEPTED_MEDIA_TYPES).flatMap(types => Object.keys(types ?? {}))
    throw mediaError(415, 'UNSUPPORTED_TYPE', { accepted })
  }
  return {
    kind,
    mimeType,
    extension: extensionForMime(mimeType)!,
    inspected: await handler.inspect(upload.path, mimeType),
  }
}

async function storeOriginal(upload: ReceivedUpload, analyzed: AnalyzedUpload): Promise<string> {
  const storage = await useMediaStorage()
  const key = originalKey(analyzed.extension)
  await storage.put(key, createReadStream(upload.path), { contentType: analyzed.mimeType, size: upload.size })
  return key
}

function fileData(upload: ReceivedUpload, analyzed: AnalyzedUpload, storageKey: string) {
  return {
    kind: analyzed.kind,
    storageKey,
    originalName: upload.filename,
    mimeType: analyzed.mimeType,
    size: upload.size,
    checksum: upload.checksum,
    width: analyzed.inspected.width,
    height: analyzed.inspected.height,
    duration: analyzed.inspected.duration,
    metadata: analyzed.inspected.metadata,
  }
}

/** Nouveau média : fichier écrit dans le stockage puis enregistré en base (annulé si l'une échoue). */
export async function createMedia(upload: ReceivedUpload, input: MediaMetadataInput, actor: User): Promise<MediaWithUploader> {
  const analyzed = await analyze(upload)
  const storage = await useMediaStorage()
  const key = await storeOriginal(upload, analyzed)
  try {
    const prisma = await usePrisma()
    return await prisma.media.create({
      data: {
        ...fileData(upload, analyzed, key),
        projectId: await defaultProjectId(),
        visibility: input.visibility ?? 'PUBLIC',
        title: input.title ?? null,
        altText: input.altText ?? null,
        uploadedById: actor.id,
      },
      include: { uploadedBy: UPLOADER },
    })
  }
  catch (error) {
    await storage.delete(key)
    throw error
  }
}

/**
 * Remplace le fichier en conservant l'identifiant et les métadonnées éditoriales (titre, texte
 * alternatif, visibilité). Nouvelle clé + version incrémentée : les URL changent, les caches ne
 * servent jamais l'ancien fichier. Mise à jour conditionnée à la version lue (409 si concurrente).
 */
export async function replaceMediaFile(media: Media, upload: ReceivedUpload): Promise<MediaWithUploader> {
  const analyzed = await analyze(upload)
  if (analyzed.kind !== media.kind) throw mediaError(422, 'KIND_MISMATCH')

  const storage = await useMediaStorage()
  const key = await storeOriginal(upload, analyzed)
  const prisma = await usePrisma()
  const { count } = await prisma.media.updateMany({
    where: { id: media.id, version: media.version },
    data: { ...fileData(upload, analyzed, key), version: { increment: 1 } },
  })
  if (count !== 1) {
    await storage.delete(key)
    throw mediaError(409, 'VERSION_CONFLICT')
  }

  // Ancien fichier et dérivés de l'ancienne version.
  await prisma.mediaVariant.deleteMany({ where: { mediaId: media.id, transformation: { startsWith: `v${media.version}/` } } })
  await storage.delete(media.storageKey)
  await storage.deletePrefix(`${variantPrefix(media.id)}v${media.version}-`)
  return findMediaOr404(media.id)
}

export async function updateMediaMetadata(media: Media, input: MediaMetadataInput): Promise<MediaWithUploader> {
  const prisma = await usePrisma()
  return prisma.media.update({ where: { id: media.id }, data: input, include: { uploadedBy: UPLOADER } })
}

/** Corbeille : le média n'est plus diffusé mais reste restaurable. */
export async function trashMedia(media: Media): Promise<void> {
  const prisma = await usePrisma()
  await prisma.media.update({ where: { id: media.id }, data: { deletedAt: new Date() } })
}

export async function restoreMedia(media: Media): Promise<MediaWithUploader> {
  const prisma = await usePrisma()
  return prisma.media.update({ where: { id: media.id }, data: { deletedAt: null }, include: { uploadedBy: UPLOADER } })
}

/**
 * Suppression définitive (depuis la corbeille uniquement) : enregistrement d'abord (plus aucune
 * référence), fichiers ensuite. Un échec de suppression physique ne laisse qu'un fichier orphelin.
 */
export async function purgeMedia(media: Media): Promise<void> {
  if (!media.deletedAt) throw mediaError(409, 'NOT_IN_TRASH')
  const prisma = await usePrisma()
  await prisma.media.delete({ where: { id: media.id } })

  const storage = await useMediaStorage()
  try {
    await storage.delete(media.storageKey)
    await storage.deletePrefix(variantPrefix(media.id))
  }
  catch (error) {
    console.error(`[surge-media] Fichiers du média ${media.id} non supprimés du stockage :`, error)
  }
}
