import { createReadStream } from 'node:fs'
import type { MediaListQuery, MediaMetadataInput } from '#shared/schemas/media'
import { MEDIA_PAGE_SIZE } from '#shared/schemas/media'
import { ACCEPTED_MEDIA_TYPES, extensionForMime, mediaKindForMime, type MediaKind } from '#shared/utils/media'
import { mediaSearchColumns, normalizeSearchText } from '#shared/utils/search'
import type { AccessToken, Media, Prisma } from '../../generated/prisma/client'
import type { Space } from '../../utils/access'
import { folderWhere, requireFolderInSpace } from '../folders/service'
import { useMediaStorage } from '../storage'
import { mediaChanged } from './cache'
import { mediaError } from './errors'
import { handlerFor, type InspectedMedia } from './handlers'
import { originalKey, variantPrefix } from './keys'
import { sniffMimeType } from './sniff'
import { runProcessing } from './processing'
import type { ReceivedUpload } from './upload'
import { adminMediaPaths } from './urls'
import { pregenerateVariants } from './variants'

/**
 * Logique métier des médias. Indépendante du stockage physique (MediaStorage) et du genre
 * de média (gestionnaires) : les API d'administration, l'API publique (phase B) et la
 * diffusion passent toutes par ce module.
 *
 * Chaque média appartient à un seul espace : un projet, ou la bibliothèque de l'organisation
 * (projectId null), et à 0 ou 1 dossier de cet espace (vérifié ici à chaque affectation). Les
 * contrôles d'accès sont faits par les routes (server/utils/access.ts).
 *
 * Toute écriture passe par `mediaChanged` (cache de diffusion invalidé, révision de l'espace
 * incrémentée pour les ETag de l'API) et tient à jour les colonnes de recherche normalisées. Les
 * analyses de fichiers passent par la file bornée des traitements ; l'aperçu d'un nouveau fichier
 * est pré-généré en tâche de fond.
 */

const MEDIA_INCLUDE = {
  uploadedBy: { select: { id: true, name: true, email: true } },
  uploadedByToken: { select: { id: true, name: true, type: true, prefix: true } },
} as const
type MediaWithUploader = Media & {
  uploadedBy: { id: string, name: string | null, email: string } | null
  uploadedByToken: { id: string, name: string, type: AccessToken['type'], prefix: string } | null
}

/**
 * Provenance d'un nouveau média : compte (session ou propriétaire d'un jeton personnel), identifiant
 * d'API (émetteur pour un jeton délégué) et sujet final déclaré par l'application cliente.
 */
export interface MediaProvenance {
  userId: string | null
  tokenId?: string | null
  subject?: string | null
}

/** Options d'analyse d'un fichier reçu : types restreints (contrainte d'un jeton délégué). */
export interface UploadOptions {
  acceptedTypes?: readonly string[]
}

function provenanceData(provenance: MediaProvenance) {
  return {
    uploadedById: provenance.userId,
    uploadedByTokenId: provenance.tokenId ?? null,
    uploadSubject: provenance.subject ?? null,
  }
}

// ─── Représentation API ──────────────────────────────────────────────────────

/** Représentation pour l'administration (chemins relatifs, signés si privé ou en corbeille). */
export function toMediaSummary(media: MediaWithUploader) {
  const paths = adminMediaPaths(media, Boolean(handlerFor(media.kind)?.preview))
  return {
    id: media.id,
    projectId: media.projectId,
    folderId: media.folderId,
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
    /** Chemins de diffusion ; signés (droit « admin ») pour un média privé ou dans la corbeille. */
    url: paths.url,
    previewUrl: paths.previewUrl,
    uploadedBy: media.uploadedBy,
    /** Identifiant d'API ayant envoyé le média (null : interface, ou identifiant supprimé depuis). */
    uploadedByToken: media.uploadedByToken,
    uploadSubject: media.uploadSubject,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    deletedAt: media.deletedAt,
  }
}

export function toMediaDetail(media: MediaWithUploader) {
  return { ...toMediaSummary(media), checksum: media.checksum, metadata: media.metadata, duplicatedFromId: media.duplicatedFromId }
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

/** Média par identifiant (corbeille comprise), ou null. */
export async function findMedia(id: string): Promise<MediaWithUploader | null> {
  const prisma = await usePrisma()
  return prisma.media.findUnique({ where: { id }, include: MEDIA_INCLUDE })
}

async function findMediaOrFail(id: string): Promise<MediaWithUploader> {
  const media = await findMedia(id)
  if (!media) throw createError({ statusCode: 404, statusMessage: 'Media not found' })
  return media
}

/** Valeur de Media.projectId pour un espace. */
function projectIdOf(space: Space): string | null {
  return space.type === 'project' ? space.id : null
}

const SORTS: Record<MediaListQuery['sort'], Prisma.MediaOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  name: [{ originalName: 'asc' }, { id: 'asc' }],
  size: [{ size: 'desc' }, { id: 'desc' }],
}

/**
 * Médias d'un espace ; l'espace est toujours imposé par le serveur, les filtres s'y ajoutent.
 * Médias actifs : ceux du dossier demandé (racine par défaut), sous-dossiers compris si
 * `recursive` ; corbeille : tout l'espace.
 */
export async function listMedia(space: Space, query: MediaListQuery) {
  const where: Prisma.MediaWhereInput = {
    projectId: projectIdOf(space),
    deletedAt: query.status === 'trash' ? { not: null } : null,
    ...(query.status === 'trash' ? {} : await folderWhere(space, query.folder ?? null, Boolean(query.recursive))),
  }
  if (query.q) {
    // Colonnes normalisées : insensible à la casse et aux accents sur les trois bases.
    const term = normalizeSearchText(query.q)
    where.OR = [{ searchTitle: { contains: term } }, { searchName: { contains: term } }, { searchAlt: { contains: term } }]
  }
  if (query.kind) where.kind = query.kind as MediaKind
  if (query.visibility) where.visibility = query.visibility

  const prisma = await usePrisma()
  const [total, items] = await Promise.all([
    prisma.media.count({ where }),
    prisma.media.findMany({
      where,
      include: MEDIA_INCLUDE,
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
 * type annoncés par le client, puis le fait analyser par le gestionnaire de son genre (dans la
 * file bornée des traitements : 503 SERVER_BUSY si elle est pleine).
 */
async function analyze(upload: ReceivedUpload, options: UploadOptions = {}): Promise<AnalyzedUpload> {
  const mimeType = await sniffMimeType(upload.path)
  const kind = mimeType ? mediaKindForMime(mimeType) : undefined
  const handler = kind ? handlerFor(kind) : undefined
  const accepted = options.acceptedTypes ?? Object.values(ACCEPTED_MEDIA_TYPES).flatMap(types => Object.keys(types ?? {}))
  if (!mimeType || !kind || !handler || !accepted.includes(mimeType)) {
    throw mediaError(415, 'UNSUPPORTED_TYPE', { accepted })
  }
  return {
    kind,
    mimeType,
    extension: extensionForMime(mimeType)!,
    inspected: await runProcessing(() => handler.inspect(upload.path, mimeType)),
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
    searchName: normalizeSearchText(upload.filename),
    mimeType: analyzed.mimeType,
    size: upload.size,
    checksum: upload.checksum,
    width: analyzed.inspected.width,
    height: analyzed.inspected.height,
    duration: analyzed.inspected.duration,
    metadata: analyzed.inspected.metadata,
  }
}

/** Nouveau média dans un espace : fichier écrit dans le stockage puis enregistré en base (annulé si l'une échoue). */
export async function createMedia(
  space: Space,
  upload: ReceivedUpload,
  input: MediaMetadataInput,
  provenance: MediaProvenance,
  options: UploadOptions = {},
): Promise<MediaWithUploader> {
  const folderId = input.folderId ?? null
  if (folderId) await requireFolderInSpace(space, folderId)
  const analyzed = await analyze(upload, options)
  const storage = await useMediaStorage()
  const key = await storeOriginal(upload, analyzed)
  try {
    const prisma = await usePrisma()
    const title = input.title ?? null
    const altText = input.altText ?? null
    const created = await prisma.media.create({
      data: {
        ...fileData(upload, analyzed, key),
        ...mediaSearchColumns({ originalName: upload.filename, title, altText }),
        projectId: projectIdOf(space),
        folderId,
        visibility: input.visibility ?? 'PUBLIC',
        title,
        altText,
        ...provenanceData(provenance),
      },
      include: MEDIA_INCLUDE,
    })
    await mediaChanged([created.id], space)
    pregenerateVariants(created)
    return created
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
export async function replaceMediaFile(media: Media, upload: ReceivedUpload, options: UploadOptions = {}): Promise<MediaWithUploader> {
  const analyzed = await analyze(upload, options)
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
  await mediaChanged([media.id], spaceOfMedia(media))
  const replaced = await findMediaOrFail(media.id)
  pregenerateVariants(replaced)
  return replaced
}

export async function updateMediaMetadata(media: Media, input: MediaMetadataInput): Promise<MediaWithUploader> {
  if (input.folderId) await requireFolderInSpace(spaceOfMedia(media), input.folderId)
  const data: Prisma.MediaUncheckedUpdateInput = { ...input }
  if (input.title !== undefined) data.searchTitle = input.title ? normalizeSearchText(input.title) : null
  if (input.altText !== undefined) data.searchAlt = input.altText ? normalizeSearchText(input.altText) : null
  const prisma = await usePrisma()
  const updated = await prisma.media.update({ where: { id: media.id }, data, include: MEDIA_INCLUDE })
  await mediaChanged([media.id], spaceOfMedia(media))
  return updated
}

/** Corbeille : le média n'est plus diffusé mais reste restaurable. */
export async function trashMedia(media: Media): Promise<void> {
  const prisma = await usePrisma()
  await prisma.media.update({ where: { id: media.id }, data: { deletedAt: new Date() } })
  await mediaChanged([media.id], spaceOfMedia(media))
}

export async function restoreMedia(media: Media): Promise<MediaWithUploader> {
  const prisma = await usePrisma()
  const restored = await prisma.media.update({ where: { id: media.id }, data: { deletedAt: null }, include: MEDIA_INCLUDE })
  await mediaChanged([media.id], spaceOfMedia(media))
  return restored
}

/**
 * Suppression définitive (depuis la corbeille uniquement) : enregistrement d'abord (plus aucune
 * référence), fichiers ensuite. Un échec de suppression physique ne laisse qu'un fichier orphelin.
 */
export async function purgeMedia(media: Media): Promise<void> {
  if (!media.deletedAt) throw mediaError(409, 'NOT_IN_TRASH')
  const prisma = await usePrisma()
  await prisma.media.delete({ where: { id: media.id } })
  await mediaChanged([media.id], spaceOfMedia(media))
  await deleteStoredFiles([media])
}

/**
 * Supprime du stockage l'original et les dérivés de médias déjà effacés de la base. Ne lève
 * jamais : un échec ne laisse que des fichiers orphelins, signalés dans le journal.
 */
export async function deleteStoredFiles(items: Pick<Media, 'id' | 'storageKey'>[]): Promise<void> {
  const storage = await useMediaStorage()
  for (const item of items) {
    try {
      await storage.delete(item.storageKey)
      await storage.deletePrefix(variantPrefix(item.id))
    }
    catch (error) {
      console.error(`[surge-media] Fichiers du média ${item.id} non supprimés du stockage :`, error)
    }
  }
}

// ─── Duplication, déplacement ────────────────────────────────────────────────

/**
 * Copie indépendante d'un média dans un espace (le même ou un autre) et l'un de ses dossiers
 * (racine par défaut) : nouvel identifiant, version 1, fichier copié dans le stockage, métadonnées
 * reprises, provenance conservée. Les dérivés ne sont pas copiés : l'aperçu est pré-généré.
 */
export async function duplicateMedia(media: Media, target: Space, provenance: MediaProvenance, folderId: string | null = null): Promise<MediaWithUploader> {
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
  if (folderId) await requireFolderInSpace(target, folderId)
  const storage = await useMediaStorage()
  const key = originalKey(extensionForMime(media.mimeType) ?? 'bin')
  await storage.copy(media.storageKey, key)
  try {
    const prisma = await usePrisma()
    const copy = await prisma.media.create({
      data: {
        projectId: projectIdOf(target),
        folderId,
        kind: media.kind,
        visibility: media.visibility,
        storageKey: key,
        originalName: media.originalName,
        mimeType: media.mimeType,
        size: media.size,
        checksum: media.checksum,
        width: media.width,
        height: media.height,
        duration: media.duration,
        title: media.title,
        altText: media.altText,
        ...mediaSearchColumns(media),
        // Json? : null s'omet (Prisma exige sinon une valeur spéciale, importée à l'exécution).
        ...(media.metadata === null ? {} : { metadata: media.metadata as Prisma.InputJsonValue }),
        duplicatedFromId: media.id,
        ...provenanceData(provenance),
      },
      include: MEDIA_INCLUDE,
    })
    await mediaChanged([copy.id], target)
    pregenerateVariants(copy)
    return copy
  }
  catch (error) {
    await storage.delete(key)
    throw error
  }
}

/**
 * Change l'espace d'un média sans changer son identifiant ni ses URL (fichier et dérivés
 * inchangés). Il quitte son dossier, propre à l'ancien espace, pour `folderId` (dossier de
 * l'espace cible, racine par défaut).
 */
export async function moveMedia(media: Media, target: Space, folderId: string | null = null): Promise<MediaWithUploader> {
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
  if (folderId) await requireFolderInSpace(target, folderId)
  const prisma = await usePrisma()
  const moved = await prisma.media.update({
    where: { id: media.id },
    data: { projectId: projectIdOf(target), folderId },
    include: MEDIA_INCLUDE,
  })
  await mediaChanged([media.id], spaceOfMedia(media), target)
  return moved
}
