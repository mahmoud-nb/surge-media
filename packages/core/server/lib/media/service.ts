import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { MediaListQuery, MediaMetadataInput } from '#shared/schemas/media'
import { MEDIA_PAGE_SIZE } from '#shared/schemas/media'
import { ACCEPTED_MEDIA_TYPES, acceptedMimeTypes, CONVERTED_MIME_TYPES, extensionForMime, mediaKindForMime, type MediaKind } from '#shared/utils/media'
import { mediaSearchColumns, normalizeSearchText } from '#shared/utils/search'
import { sameFocalPoint } from '#shared/utils/transforms'
import { isConvertedContainer, type VideoHdrTransfer, type VideoMetadata, videoMetadata, type VideoRewrite, VIDEO_REWRITES } from '#shared/utils/video'
import { BACKFILL_PRIORITY, type ProcessingStateValue, RENDITION_FORMATS, RENDITION_NAMES, type RenditionName } from '#shared/utils/video-processing'
import type { AccessToken, Media, MediaJob, MediaRendition, MediaTextTrack, Prisma } from '../../generated/prisma/client'
import type { Space } from '../../utils/access'
import { folderWhere, requireFolderInSpace } from '../folders/service'
import { useMediaStorage } from '../storage'
import type { ProbeResult } from '../video-processing/ffprobe'
import {
  cancelActiveJobs,
  catchUpJobs,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  type FailOutcome,
  JOB_TRANSACTION,
  type JobFailure,
  type JobLease,
  JobLost,
  jobPriority,
  type JobResult,
  type MediaStateWrite,
  processingDetail,
  reapExpiredLeases,
  type ReapedJob,
  releaseJob,
  renewLease,
  resultData,
} from '../video-processing/jobs'
import { notifyJobQueued } from '../video-processing/runner'
import { videoProcessingActive } from '../video-processing/status'
import { mediaChanged } from './cache'
import { mediaError } from './errors'
import { handlerFor, type InspectedMedia } from './handlers'
import { imageHandler, normalizePoster } from './handlers/image'
import type { PreparedMedia } from './handlers/types'
import { originalKey, posterKey, renditionKey, variantPrefix } from './keys'
import { sniffMimeType } from './sniff'
import { runProcessing } from './processing'
import { PROCESSING_INCLUDE, type ProcessingRelations, videoSources } from './sources'
import { type ReceivedUpload, temporaryCopy } from './upload'
import { copyTextTracks, TEXT_TRACK_ORDER } from './tracks'
import { adminMediaPaths, type AdminMediaPaths } from './urls'
import type { VideoProbe } from './video/probe'
import { hasDerivedFiles, mediaFocalPoint, pregenerateVariants } from './variants'

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
 * analyses de fichiers passent par la file bornée des traitements ; un fichier peut être **préparé**
 * avant d'être stocké (vidéos : index en tête, métadonnées d'origine retirées) ; l'aperçu d'un nouveau
 * fichier est pré-généré en tâche de fond. La version (dans toutes les URL) change avec le fichier et avec
 * le point d'intérêt : un cache ne sert jamais un fichier ou un recadrage périmé.
 *
 * Traitement des vidéos par ffmpeg (phase D3, architecture § 31 à § 34) : quand il est actif, chaque
 * nouveau fichier vidéo reçoit sa tâche **dans la même écriture** que lui (envoi, remplacement,
 * « Optimiser ») et `processingState` résume la dernière tâche. Une tâche vise un **fichier**
 * (`MediaJob.sourceKey`), pas une version : un changement de version sans nouveau fichier (affiche, point
 * d'intérêt) ne la touche pas ; un nouveau fichier l'annule et supprime les rendus de l'ancien. Les
 * écritures du processus de travail (analyse d'un format converti, réécriture sans perte, rendu, affiche,
 * état) passent aussi par ici, dans des transactions qui commencent par renouveler le bail de la tâche
 * (video-processing/jobs.ts) puis vérifient que le fichier est toujours le sien : sinon le résultat est
 * jeté.
 */

/** Relations lues pour les listes de l'administration : auteur de l'envoi seulement (requête légère). */
const MEDIA_LIST_INCLUDE = {
  uploadedBy: { select: { id: true, name: true, email: true } },
  uploadedByToken: { select: { id: true, name: true, type: true, prefix: true } },
} as const
/**
 * Relations d'un média complet (fiche, réponse de chaque écriture) : en plus, ses pistes de texte, ses
 * rendus et sa dernière tâche (phase D3) — jamais dans les listes, une jointure par média affiché.
 */
const MEDIA_INCLUDE = {
  ...MEDIA_LIST_INCLUDE,
  textTracks: TEXT_TRACK_ORDER,
  ...PROCESSING_INCLUDE,
} as const
/** Média d'une liste de l'administration (`listMedia`). */
export type MediaListRecord = Media & {
  uploadedBy: { id: string, name: string | null, email: string } | null
  uploadedByToken: { id: string, name: string, type: AccessToken['type'], prefix: string } | null
}
/** Média complet (`MEDIA_INCLUDE`). */
export type MediaWithUploader = MediaListRecord & ProcessingRelations & {
  /** Pistes de texte d'une vidéo (phase D2), dans leur ordre d'ajout. */
  textTracks: MediaTextTrack[]
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
export function toMediaSummary(media: MediaListRecord) {
  return summaryFields(media, adminMediaPaths(media, hasDerivedFiles(media)))
}

/** Champs de la représentation résumée, chemins déjà calculés (une seule signature par réponse). */
function summaryFields(media: MediaListRecord, paths: AdminMediaPaths) {
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
    /** État du traitement d'une vidéo (phase D3) : PENDING, PROCESSING, READY, FAILED ; null = non concerné. */
    processingState: media.processingState,
    /** Point d'intérêt (fractions 0 à 1 de l'image orientée), null = centre. */
    focalPoint: mediaFocalPoint(media),
    /** Chemins de diffusion ; signés (droit « admin ») pour un média privé, dans la corbeille ou retenu (urls.ts). */
    url: paths.url,
    previewUrl: paths.previewUrl,
    /** Image d'affiche d'une vidéo (source de l'aperçu et des dérivés) ; `url` : image entière en JPEG. */
    poster: media.posterKey && media.posterWidth && media.posterHeight
      ? { url: paths.posterUrl, width: media.posterWidth, height: media.posterHeight, time: media.posterTime }
      : null,
    uploadedBy: media.uploadedBy,
    /** Identifiant d'API ayant envoyé le média (null : interface, ou identifiant supprimé depuis). */
    uploadedByToken: media.uploadedByToken,
    uploadSubject: media.uploadSubject,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    deletedAt: media.deletedAt,
  }
}

/**
 * Traitement d'une vidéo pour l'administration (fiche, GET …/processing) : sa dernière tâche (sources.ts,
 * `PROCESSING_INCLUDE`), selon l'état et non la seule présence d'une tâche — un fichier remplacé pendant
 * que le traitement est inactif remet l'état à null mais garde la tâche terminée de l'ancien fichier.
 * null : jamais traitée (ou image), comme `processing` de l'API v1.
 */
export function mediaProcessingDetail(media: Pick<Media, 'processingState'> & { jobs: readonly MediaJob[] }) {
  return media.processingState ? processingDetail(media.jobs[0] ?? null) : null
}

/**
 * Représentation complète (fiche). Vidéo (phase D3) : `processing` = dernière tâche (détail de l'erreur
 * déjà assaini, jamais de chemin) ; `renditions` dans l'ordre de `sources` (noms inconnus ignorés) ;
 * `sources` = liste prête pour `<video><source>` (server/lib/media/sources.ts). Leurs liens sont signés
 * comme l'original (« admin » si privé, en corbeille ou retenu).
 */
export function toMediaDetail(media: MediaWithUploader) {
  const renditions = RENDITION_NAMES.flatMap(name => media.renditions.filter(rendition => rendition.name === name).map(rendition => ({ ...rendition, name })))
  const paths = adminMediaPaths(media, hasDerivedFiles(media), media.textTracks.map(track => track.id), renditions.map(rendition => rendition.name))
  const renditionUrl = (name: RenditionName) => paths.renditions[name]!
  return {
    ...summaryFields(media, paths),
    checksum: media.checksum,
    metadata: media.metadata,
    duplicatedFromId: media.duplicatedFromId,
    /** Pistes de texte d'une vidéo ; `url` signée (droit « admin ») si le média est privé ou dans la corbeille. */
    textTracks: media.textTracks.map((track, index) => ({
      id: track.id,
      kind: track.kind,
      language: track.language,
      label: track.label,
      isDefault: track.isDefault,
      size: track.size,
      cueCount: track.cueCount,
      sourceFormat: track.sourceFormat,
      url: paths.trackUrls[index]!,
      createdAt: track.createdAt,
    })),
    /** Dernière tâche de traitement d'une vidéo (phase D3), null : jamais traitée (ou image). */
    processing: mediaProcessingDetail(media),
    /** Rendus produits par ffmpeg (AV1 puis H.264). */
    renditions: renditions.map(rendition => ({
      name: rendition.name,
      container: rendition.container,
      mimeType: rendition.mimeType,
      codecs: rendition.codecs,
      width: rendition.width,
      height: rendition.height,
      duration: rendition.duration,
      bitrate: rendition.bitrate,
      size: rendition.size,
      url: renditionUrl(rendition.name),
    })),
    /** Sources du lecteur, par ordre de préférence ; [] : image, ou format converti sans rendu (pas encore lisible). */
    sources: videoSources(media, renditions, name => name ? renditionUrl(name) : paths.url),
  }
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
      include: MEDIA_LIST_INCLUDE,
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
 * type annoncés par le client, puis le fait analyser par le gestionnaire de son genre (images : dans
 * la file bornée des traitements, 503 SERVER_BUSY si elle est pleine ; vidéos : lecture d'en-têtes,
 * hors file). Types acceptés par défaut : ceux de l'installation en ce moment (formats convertis — MKV,
 * AVI… — seulement quand le traitement des vidéos est actif, DD32), la même liste que la réception.
 */
async function analyze(upload: ReceivedUpload, options: UploadOptions = {}): Promise<AnalyzedUpload> {
  const mimeType = await sniffMimeType(upload.path)
  const kind = mimeType ? mediaKindForMime(mimeType) : undefined
  const handler = kind ? handlerFor(kind) : undefined
  const accepted = options.acceptedTypes ?? acceptedMimeTypes(await videoProcessingActive())
  if (!mimeType || !kind || !handler || !accepted.includes(mimeType)) {
    throw mediaError(415, 'UNSUPPORTED_TYPE', { accepted })
  }
  const inspect = () => handler.inspect(upload.path, mimeType)
  let inspected: InspectedMedia
  try {
    inspected = await (handler.queued === false ? inspect() : runProcessing(inspect))
  }
  catch (error) {
    // Contenu refusé par le gestionnaire (vidéo sans piste vidéo) : même réponse qu'un type inconnu.
    const data = (error as { data?: { code?: string, detail?: string } } | null)?.data
    if (data?.code === 'UNSUPPORTED_TYPE') throw mediaError(415, 'UNSUPPORTED_TYPE', { accepted, detail: data.detail })
    throw error
  }
  return { kind, mimeType, extension: extensionForMime(mimeType)!, inspected }
}

/** Préparation du gestionnaire (vidéos), ou fichier reçu stocké tel quel. */
async function prepareOriginal(upload: ReceivedUpload, analyzed: AnalyzedUpload): Promise<PreparedMedia> {
  const handler = handlerFor(analyzed.kind)
  if (!handler?.prepare) return { inspected: analyzed.inspected, file: null }
  return handler.prepare(upload.path, analyzed.mimeType, analyzed.inspected)
}

/** Fichier écrit dans le stockage : clé, taille et empreinte du fichier **stocké** (préparé ou non). */
interface StoredOriginal {
  key: string
  size: number
  checksum: string
  inspected: InspectedMedia
}

async function storeOriginal(upload: ReceivedUpload, analyzed: AnalyzedUpload, prepared?: PreparedMedia): Promise<StoredOriginal> {
  const { inspected, file } = prepared ?? await prepareOriginal(upload, analyzed)
  const storage = await useMediaStorage()
  const key = originalKey(analyzed.extension)
  if (!file) {
    await storage.put(key, createReadStream(upload.path), { contentType: analyzed.mimeType, size: upload.size })
    return { key, size: upload.size, checksum: upload.checksum, inspected }
  }

  // Fichier préparé : empreinte calculée pendant l'écriture (même passage que la copie).
  const hash = createHash('sha256')
  let written = 0
  const content = file.open()
  async function* hashed() {
    for await (const chunk of content) {
      written += (chunk as Buffer).length
      hash.update(chunk as Buffer)
      yield chunk
    }
  }
  await storage.put(key, Readable.from(hashed()), { contentType: analyzed.mimeType, size: file.size })
  if (written !== file.size) {
    await storage.delete(key)
    throw new Error(`[surge-media] Fichier préparé incomplet (${written} octets écrits sur ${file.size}).`)
  }
  return { key, size: file.size, checksum: hash.digest('hex'), inspected }
}

function fileData(upload: ReceivedUpload, analyzed: AnalyzedUpload, stored: StoredOriginal): FileData {
  return {
    kind: analyzed.kind,
    storageKey: stored.key,
    originalName: upload.filename,
    searchName: normalizeSearchText(upload.filename),
    mimeType: analyzed.mimeType,
    size: stored.size,
    checksum: stored.checksum,
    width: stored.inspected.width,
    height: stored.inspected.height,
    duration: stored.inspected.duration,
    metadata: stored.inspected.metadata as Prisma.InputJsonValue,
  }
}

/** Champs d'un nouveau fichier (`fileData`). */
interface FileData {
  kind: MediaKind
  storageKey: string
  originalName: string
  searchName: string
  mimeType: string
  size: number
  checksum: string
  width: number | null
  height: number | null
  duration: number | null
  metadata: Prisma.InputJsonValue
}

/**
 * Le nouveau fichier d'une vidéo doit-il être traité ? Oui quand le traitement est actif ; toujours pour
 * un format converti (MKV, AVI…), accepté seulement parce qu'il l'était à la réception : sans tâche, il
 * ne serait jamais lisible.
 */
async function processesFile(kind: MediaKind, mimeType: string): Promise<boolean> {
  if (kind !== 'VIDEO') return false
  return CONVERTED_MIME_TYPES.includes(mimeType) || await videoProcessingActive()
}

/**
 * Nouveau média dans un espace : fichier écrit dans le stockage puis enregistré en base (annulé si l'une échoue).
 * Vidéo, traitement actif : tâche créée dans la même écriture (création imbriquée, atomique), état « en attente ».
 */
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
  const stored = await storeOriginal(upload, analyzed)
  try {
    const prisma = await usePrisma()
    const title = input.title ?? null
    const altText = input.altText ?? null
    const data = fileData(upload, analyzed, stored)
    const processing = await processesFile(analyzed.kind, analyzed.mimeType)
    const created = await prisma.media.create({
      data: {
        ...data,
        ...mediaSearchColumns({ originalName: upload.filename, title, altText }),
        projectId: projectIdOf(space),
        folderId,
        visibility: input.visibility ?? 'PUBLIC',
        title,
        altText,
        ...provenanceData(provenance),
        ...(processing
          ? { processingState: 'PENDING', jobs: { create: { sourceKey: stored.key, priority: jobPriority(data.metadata), runAfter: new Date() } } }
          : {}),
      },
      include: MEDIA_INCLUDE,
    })
    await mediaChanged([created.id], space)
    if (processing) notifyJobQueued()
    pregenerateVariants(created)
    return created
  }
  catch (error) {
    await storage.delete(stored.key)
    throw error
  }
}

/**
 * Remplace le fichier en conservant l'identifiant et les métadonnées éditoriales (titre, texte
 * alternatif, visibilité). Nouvelle clé + version incrémentée : les URL changent, les caches ne
 * servent jamais l'ancien fichier. Mise à jour conditionnée à la version lue (409 si concurrente).
 */
export async function replaceMediaFile(media: Media, upload: ReceivedUpload, options: UploadOptions = {}): Promise<MediaWithUploader> {
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
  const analyzed = await analyze(upload, options)
  if (analyzed.kind !== media.kind) throw mediaError(422, 'KIND_MISMATCH')
  const stored = await storeOriginal(upload, analyzed)
  return commitNewFile(media, fileData(upload, analyzed, stored))
}

interface CommitOptions {
  /**
   * Réécriture sans perte faite par cette tâche (retrait des pistes de métadonnées, réparation d'un WebM) :
   * la tâche continue sur le nouveau fichier (`sourceKey` mis à jour) au lieu d'être annulée et recréée.
   * Écriture conditionnée à son bail et à son fichier.
   */
  carry?: JobLease
}

type CommitOutcome =
  | { status: 'ok', renditions: MediaRendition[], queued: boolean }
  | { status: 'conflict' | 'lost' }

/**
 * Nouveau fichier d'un média (déjà écrit dans le stockage), en une transaction qui commence par une
 * écriture conditionnelle (video-processing/jobs.ts, « écriture d'abord ») : version incrémentée si
 * personne ne l'a changée entre-temps et hors corbeille ; tâches actives annulées et rendus de l'ancien
 * fichier retirés (ils ne le décrivent plus) ; nouvelle tâche si le traitement est actif (`carry` : la
 * tâche en cours continue). Ne supprime aucun fichier : voir `commitNewFile`.
 */
async function commitFile(media: Media, data: FileData, options: CommitOptions = {}): Promise<CommitOutcome> {
  const prisma = await usePrisma()
  const now = new Date()
  const { carry } = options
  const processing = !carry && await processesFile(data.kind, data.mimeType)
  // Vidéo sans traitement : l'état de l'ancien fichier ne décrit pas le nouveau (« non concerné »).
  const state: Prisma.MediaUncheckedUpdateManyInput = carry || data.kind !== 'VIDEO' ? {} : { processingState: processing ? 'PENDING' : null }
  return prisma.$transaction(async (tx): Promise<CommitOutcome> => {
    if (carry && !await renewLease(tx, carry, now)) return { status: 'lost' }
    const { count } = await tx.media.updateMany({
      where: { id: media.id, version: media.version, deletedAt: null, ...(carry ? { storageKey: carry.sourceKey } : {}) },
      data: { ...data, ...state, version: { increment: 1 } },
    })
    if (count !== 1) {
      if (!carry) return { status: 'conflict' }
      // Bail renouvelé, verrou d'écriture pris : la lecture est sûre. Même fichier, hors corbeille : seule la
      // version a changé (affiche, point d'intérêt) — conflit, relu et refait par commitRewrittenFile ; un
      // autre fichier ou la corbeille rendent la tâche caduque.
      const same = await tx.media.count({ where: { id: media.id, storageKey: carry.sourceKey, deletedAt: null } })
      return { status: same === 1 ? 'conflict' : 'lost' }
    }
    const renditions = data.kind === 'VIDEO' ? await tx.mediaRendition.findMany({ where: { mediaId: media.id } }) : []
    if (renditions.length > 0) await tx.mediaRendition.deleteMany({ where: { mediaId: media.id } })
    if (carry) {
      await tx.mediaJob.updateMany({ where: { id: carry.id, lockedBy: carry.lockedBy, status: 'RUNNING' }, data: { sourceKey: data.storageKey } })
      return { status: 'ok', renditions, queued: false }
    }
    if (data.kind === 'VIDEO') await cancelActiveJobs(tx, media.id, now)
    if (processing) await enqueueJob(tx, { mediaId: media.id, sourceKey: data.storageKey, priority: jobPriority(data.metadata) }, now)
    return { status: 'ok', renditions, queued: processing }
  }, JOB_TRANSACTION)
}

/** Suppression après validation : un échec ne laisse qu'un fichier orphelin (journalisé), jamais une erreur à l'utilisateur. */
async function deleteQuietly(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task()
  }
  catch (error) {
    console.error(`[surge-media] ${label} non supprimé(s) du stockage :`, error)
  }
}

/** Après un nouveau fichier : ancien original, rendus et dérivés de l'ancienne version supprimés, caches invalidés. */
async function afterNewFile(media: Media, outcome: Extract<CommitOutcome, { status: 'ok' }>): Promise<MediaWithUploader> {
  const storage = await useMediaStorage()
  await deleteQuietly(`Dérivés de la version ${media.version} du média ${media.id}`, () => deleteVersionVariants(media))
  await deleteQuietly(`Ancien fichier du média ${media.id}`, () => storage.delete(media.storageKey))
  for (const rendition of outcome.renditions) {
    await deleteQuietly(`Rendu ${rendition.name} du média ${media.id}`, () => storage.delete(rendition.storageKey))
  }
  await mediaChanged([media.id], spaceOfMedia(media))
  if (outcome.queued) notifyJobQueued()
  const replaced = await findMediaOrFail(media.id)
  pregenerateVariants(replaced)
  return replaced
}

/**
 * Enregistre le nouveau fichier d'un média (déjà écrit dans le stockage) : version incrémentée si
 * personne ne l'a changée entre-temps (sinon 409 et nouveau fichier supprimé), puis suppression de
 * l'ancien fichier, des rendus de l'ancien fichier et des dérivés de l'ancienne version.
 */
async function commitNewFile(media: Media, data: FileData): Promise<MediaWithUploader> {
  const storage = await useMediaStorage()
  let outcome: CommitOutcome
  try {
    outcome = await commitFile(media, data)
  }
  catch (error) {
    await storage.delete(data.storageKey)
    throw error
  }
  if (outcome.status !== 'ok') {
    await storage.delete(data.storageKey)
    throw mediaError(409, 'VERSION_CONFLICT')
  }
  return afterNewFile(media, outcome)
}

/**
 * Métadonnées d'une vidéo relue par le lecteur de D1 (`hdr` toujours null, `rewrites` toujours []),
 * complétées de ce que le traitement savait déjà du même contenu : courbe HDR (ffprobe) et réécritures
 * sans perte déjà faites (plus `rewrite`, celle qui vient d'être faite).
 */
function withProcessingMetadata(
  metadata: InspectedMedia['metadata'],
  previous: VideoMetadata | null,
  extra: { hdr?: VideoHdrTransfer | null, rewrite?: VideoRewrite } = {},
): InspectedMedia['metadata'] {
  const rewrites = new Set<VideoRewrite>(previous?.rewrites ?? [])
  if (extra.rewrite) rewrites.add(extra.rewrite)
  return {
    ...metadata,
    hdr: extra.hdr !== undefined ? extra.hdr : previous?.hdr ?? null,
    rewrites: VIDEO_REWRITES.filter(rewrite => rewrites.has(rewrite)),
  }
}

/**
 * Prépare le fichier déjà stocké d'une vidéo (envoyée avant la phase D2, ou réglage changé depuis) :
 * même chemin qu'un remplacement par le même fichier — nouvelle version, anciennes URL redirigées. Rien
 * à faire : le média est seulement marqué comme examiné (`metadata.prepared = []`), même version.
 */
export async function prepareStoredMedia(media: Media): Promise<MediaWithUploader> {
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
  const storage = await useMediaStorage()
  const upload = await temporaryCopy(await storage.getStream(media.storageKey), media.originalName)
  const previous = videoMetadata(media.metadata)
  try {
    const analyzed = await analyze(upload)
    if (analyzed.kind !== media.kind) throw mediaError(422, 'KIND_MISMATCH')
    const prepared = await prepareOriginal(upload, analyzed)
    if (prepared.file) {
      const stored = await storeOriginal(upload, analyzed, prepared)
      const data = fileData(upload, analyzed, stored)
      return await commitNewFile(media, { ...data, metadata: withProcessingMetadata(stored.inspected.metadata, previous) as Prisma.InputJsonValue })
    }
    const prisma = await usePrisma()
    const { count } = await prisma.media.updateMany({
      where: { id: media.id, version: media.version },
      data: { metadata: withProcessingMetadata(prepared.inspected.metadata, previous) as Prisma.InputJsonValue },
    })
    if (count !== 1) throw mediaError(409, 'VERSION_CONFLICT')
    await mediaChanged([media.id], spaceOfMedia(media))
    return await findMediaOrFail(media.id)
  }
  finally {
    await upload.cleanup()
  }
}

/** Dérivés d'une version qui n'est plus servie (lignes puis fichiers) : ses URL redirigent vers la nouvelle. */
async function deleteVersionVariants(media: Pick<Media, 'id' | 'version'>): Promise<void> {
  const prisma = await usePrisma()
  await prisma.mediaVariant.deleteMany({ where: { mediaId: media.id, transformation: { startsWith: `v${media.version}/` } } })
  const storage = await useMediaStorage()
  await storage.deletePrefix(`${variantPrefix(media.id)}v${media.version}-`)
}

/**
 * Métadonnées éditoriales (titre, texte alternatif, visibilité, dossier) et point d'intérêt. Un
 * point d'intérêt modifié crée une **nouvelle version** (architecture phase C, CD8) : toutes les
 * URL changent (les anciennes redirigent), les dérivés de l'ancienne version sont supprimés et
 * régénérés à la demande. Mise à jour conditionnée à la version lue (409 si concurrente).
 */
export async function updateMediaMetadata(media: Media, input: MediaMetadataInput): Promise<MediaWithUploader> {
  const { focalPoint, ...fields } = input
  if (fields.folderId) await requireFolderInSpace(spaceOfMedia(media), fields.folderId)
  const data: Prisma.MediaUncheckedUpdateManyInput = { ...fields }
  if (fields.title !== undefined) data.searchTitle = fields.title ? normalizeSearchText(fields.title) : null
  if (fields.altText !== undefined) data.searchAlt = fields.altText ? normalizeSearchText(fields.altText) : null
  const prisma = await usePrisma()

  if (focalPoint !== undefined && !sameFocalPoint(focalPoint, mediaFocalPoint(media))) {
    if (!hasDerivedFiles(media)) throw createError({ statusCode: 400, statusMessage: 'Only images and videos with a poster image have a focal point.' })
    if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
    const { count } = await prisma.media.updateMany({
      where: { id: media.id, version: media.version },
      data: { ...data, focalX: focalPoint?.x ?? null, focalY: focalPoint?.y ?? null, version: { increment: 1 } },
    })
    if (count !== 1) throw mediaError(409, 'VERSION_CONFLICT')
    await deleteVersionVariants(media)
    await mediaChanged([media.id], spaceOfMedia(media))
    const updated = await findMediaOrFail(media.id)
    pregenerateVariants(updated)
    return updated
  }

  const updated = await prisma.media.update({ where: { id: media.id }, data, include: MEDIA_INCLUDE })
  await mediaChanged([media.id], spaceOfMedia(media))
  return updated
}

/**
 * Corbeille : le média n'est plus diffusé mais reste restaurable. Ses tâches vidéo sont annulées (aucun
 * calcul pour un média en corbeille, ffmpeg arrêté au prochain contrôle) ; son état est gardé.
 */
export async function trashMedia(media: Media): Promise<void> {
  const prisma = await usePrisma()
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.media.update({ where: { id: media.id }, data: { deletedAt: now } })
    if (media.kind === 'VIDEO') await cancelActiveJobs(tx, media.id, now)
  }, JOB_TRANSACTION)
  await mediaChanged([media.id], spaceOfMedia(media))
}

/**
 * Restauration. Vidéo dont le traitement n'était pas terminé (en attente, en cours ou en échec), traitement
 * actif : nouvelle tâche (celle d'avant a été annulée par la corbeille). Traitement inactif : « en attente »
 * sans tâche, repris par le rattrapage quand le traitement redevient actif. Média hors de la corbeille
 * (double clic, deux onglets) : rien ne change — surtout pas l'annulation d'un traitement en cours.
 */
export async function restoreMedia(media: Media): Promise<MediaWithUploader> {
  const prisma = await usePrisma()
  const now = new Date()
  const active = media.kind === 'VIDEO' && await videoProcessingActive()
  const outcome = await prisma.$transaction(async (tx) => {
    // Écriture conditionnelle d'abord (jobs.ts, « écriture d'abord ») : seulement depuis la corbeille.
    const { count } = await tx.media.updateMany({ where: { id: media.id, deletedAt: { not: null } }, data: { deletedAt: null } })
    if (count !== 1) return 'unchanged' as const
    const restored = await tx.media.findUniqueOrThrow({ where: { id: media.id } })
    const state = restored.processingState
    if (restored.kind !== 'VIDEO' || state === null || state === 'READY') return 'restored' as const
    if (!active) {
      if (state === 'PROCESSING') await tx.media.updateMany({ where: { id: media.id }, data: { processingState: 'PENDING' } })
      return 'restored' as const
    }
    await tx.media.updateMany({ where: { id: media.id }, data: { processingState: 'PENDING' } })
    await cancelActiveJobs(tx, media.id, now)
    await enqueueJob(tx, { mediaId: media.id, sourceKey: restored.storageKey, priority: jobPriority(restored.metadata) }, now)
    return 'queued' as const
  }, JOB_TRANSACTION)
  if (outcome !== 'unchanged') await mediaChanged([media.id], spaceOfMedia(media))
  if (outcome === 'queued') notifyJobQueued()
  return findMediaOrFail(media.id)
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
 * reprises (point d'intérêt compris), provenance conservée. Les dérivés ne sont pas copiés :
 * l'aperçu est pré-généré. Vidéo (phase D3) : rendus copiés (copie côté stockage, aucun calcul) et état
 * du traitement repris ; une vidéo dont le traitement n'était pas terminé reçoit sa propre tâche quand le
 * traitement est actif (sans refaire les rendus copiés).
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
        focalX: media.focalX,
        focalY: media.focalY,
        ...mediaSearchColumns(media),
        // Json? : null s'omet (Prisma exige sinon une valeur spéciale, importée à l'exécution).
        ...(media.metadata === null ? {} : { metadata: media.metadata as Prisma.InputJsonValue }),
        duplicatedFromId: media.id,
        ...provenanceData(provenance),
      },
      include: MEDIA_INCLUDE,
    })
    if (media.kind === 'VIDEO') await copyTextTracks(media, copy.id)
    const withPoster = media.posterKey ? await copyPoster(media, copy) : copy
    // Copie déjà enregistrée : un échec ici ne doit pas supprimer son original (bloc catch ci-dessous).
    const queued = media.kind === 'VIDEO' && await copyProcessing(media, copy).catch((error: unknown) => {
      console.error(`[surge-media] Traitement du média ${media.id} non repris par sa copie ${copy.id} :`, error)
      return false
    })
    const duplicate = media.kind === 'VIDEO' ? await findMediaOrFail(copy.id) : withPoster
    await mediaChanged([copy.id], target)
    if (queued) notifyJobQueued()
    pregenerateVariants(duplicate)
    return duplicate
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

// ─── Image d'affiche (vidéos, phase D2) ──────────────────────────────────────

/** Types d'image acceptés pour une affiche (normalisée ensuite en JPEG). */
export const POSTER_TYPES: readonly string[] = Object.keys(ACCEPTED_MEDIA_TYPES.IMAGE ?? {})

function requirePosterTarget(media: Media): void {
  if (media.kind !== 'VIDEO') throw mediaError(422, 'KIND_MISMATCH', { detail: 'Only videos have a poster image.' })
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
}

/**
 * Image d'affiche d'une vidéo (fichier reçu : une image) : normalisée en JPEG dans la file des traitements
 * (orientation, 3840 px au plus, métadonnées retirées), puis source de l'aperçu et des dérivés de la vidéo.
 * Première affiche : même version (aucun dérivé n'existait). Nouvelle affiche : nouvelle version, comme le
 * point d'intérêt (anciennes URL redirigées, dérivés de l'ancienne version supprimés) — sinon un cache
 * servirait l'ancienne image à la même URL. `time` : instant capturé (secondes), null pour une image envoyée.
 */
export async function setMediaPoster(media: Media, upload: ReceivedUpload, time: number | null): Promise<MediaWithUploader> {
  requirePosterTarget(media)
  const mimeType = await sniffMimeType(upload.path)
  if (!mimeType || !POSTER_TYPES.includes(mimeType)) throw mediaError(415, 'UNSUPPORTED_TYPE', { accepted: POSTER_TYPES })
  const poster = await runProcessing(async () => {
    await imageHandler.inspect(upload.path, mimeType)
    return normalizePoster(upload.path)
  })

  const storage = await useMediaStorage()
  const key = posterKey(media.id)
  await storage.put(key, Readable.from(poster.data), { contentType: 'image/jpeg', size: poster.data.length })
  const replacing = media.posterKey !== null
  const prisma = await usePrisma()
  const { count } = await prisma.media.updateMany({
    where: { id: media.id, version: media.version, posterKey: media.posterKey },
    data: {
      posterKey: key,
      posterWidth: poster.width,
      posterHeight: poster.height,
      posterSize: poster.data.length,
      posterTime: time,
      ...(replacing ? { version: { increment: 1 } } : {}),
    },
  })
  if (count !== 1) {
    await storage.delete(key)
    throw mediaError(409, 'VERSION_CONFLICT')
  }
  if (replacing) {
    await deleteVersionVariants(media)
    await storage.delete(media.posterKey!)
  }
  await mediaChanged([media.id], spaceOfMedia(media))
  const updated = await findMediaOrFail(media.id)
  pregenerateVariants(updated)
  return updated
}

/** Retire l'affiche d'une vidéo : nouvelle version, dérivés et point d'intérêt supprimés. Sans affiche : rien. */
export async function removeMediaPoster(media: Media): Promise<MediaWithUploader> {
  requirePosterTarget(media)
  if (!media.posterKey) return findMediaOrFail(media.id)
  const prisma = await usePrisma()
  const { count } = await prisma.media.updateMany({
    where: { id: media.id, version: media.version, posterKey: media.posterKey },
    data: { posterKey: null, posterWidth: null, posterHeight: null, posterSize: null, posterTime: null, focalX: null, focalY: null, version: { increment: 1 } },
  })
  if (count !== 1) throw mediaError(409, 'VERSION_CONFLICT')
  await deleteVersionVariants(media)
  const storage = await useMediaStorage()
  await storage.delete(media.posterKey)
  await mediaChanged([media.id], spaceOfMedia(media))
  return findMediaOrFail(media.id)
}

/**
 * Rendus et état du traitement d'une vidéo vers sa copie (duplication, § 31.3) : fichiers copiés côté
 * stockage (CopyObject sous S3), lignes recréées ; un rendu non copié est journalisé. Copie complète d'une
 * vidéo prête : « prête », sans calcul. Sinon, traitement actif : tâche propre à la copie, qui ne refait
 * pas les rendus copiés. Renvoie true si une tâche a été créée.
 */
async function copyProcessing(source: Media, copy: Pick<Media, 'id' | 'storageKey'>): Promise<boolean> {
  if (source.processingState === null) return false
  const prisma = await usePrisma()
  const storage = await useMediaStorage()
  const renditions = await prisma.mediaRendition.findMany({ where: { mediaId: source.id } })
  const copied: RenditionName[] = []
  for (const rendition of renditions) {
    const name = rendition.name as RenditionName
    if (!(name in RENDITION_FORMATS)) continue
    const key = renditionKey(copy.id, name, RENDITION_FORMATS[name].container)
    try {
      await storage.copy(rendition.storageKey, key)
      const { id: _id, mediaId: _mediaId, createdAt: _createdAt, storageKey: _storageKey, ...fields } = rendition
      await prisma.mediaRendition.create({ data: { ...fields, mediaId: copy.id, storageKey: key } })
      copied.push(name)
    }
    catch (error) {
      console.error(`[surge-media] Rendu ${name} du média ${source.id} non copié vers ${copy.id} :`, error)
      await storage.delete(key).catch(() => {})
    }
  }

  const complete = source.processingState === 'READY' && copied.length === renditions.length
  const queue = !complete && await videoProcessingActive()
  const state: ProcessingStateValue = complete
    ? 'READY'
    : queue || source.processingState === 'PROCESSING' ? 'PENDING' : source.processingState
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.media.updateMany({ where: { id: copy.id }, data: { processingState: state } })
    if (queue) await enqueueJob(tx, { mediaId: copy.id, sourceKey: copy.storageKey, priority: jobPriority(source.metadata), renditions: copied }, now)
  }, JOB_TRANSACTION)
  return queue
}

/** Copie l'affiche d'une vidéo vers sa copie (duplication) ; un échec laisse la copie sans affiche (journalisé). */
async function copyPoster(source: Media, copy: MediaWithUploader): Promise<MediaWithUploader> {
  const storage = await useMediaStorage()
  const key = posterKey(copy.id)
  try {
    await storage.copy(source.posterKey!, key)
    const prisma = await usePrisma()
    return await prisma.media.update({
      where: { id: copy.id },
      data: { posterKey: key, posterWidth: source.posterWidth, posterHeight: source.posterHeight, posterSize: source.posterSize, posterTime: source.posterTime },
      include: MEDIA_INCLUDE,
    })
  }
  catch (error) {
    console.error(`[surge-media] Affiche du média ${source.id} non copiée vers ${copy.id} :`, error)
    await storage.delete(key).catch(() => {})
    return copy
  }
}

/** Champ `time` d'un envoi d'affiche : secondes de la vidéo (image capturée), absent = image envoyée. 400 si invalide. */
export function posterTimeField(raw: string | undefined, duration: number | null): number | null {
  if (raw === undefined || raw.trim() === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || (duration !== null && value > duration + 1)) {
    throw createError({ statusCode: 400, statusMessage: 'The "time" field must be a number of seconds within the video.' })
  }
  return Math.round(value * 1000) / 1000
}

// ─── Traitement des vidéos (phase D3) : état, tâches ─────────────────────────

/**
 * État de traitement écrit dans la transaction d'une transition de tâche (video-processing/jobs.ts) :
 * seulement si le fichier du média est toujours celui de la tâche et hors corbeille.
 */
const writeProcessingState: MediaStateWrite = async (tx, target, state) => {
  const { count } = await tx.media.updateMany({
    where: { id: target.mediaId, storageKey: target.sourceKey, deletedAt: null },
    data: { processingState: state },
  })
  return count === 1
}

/** Après des transitions : caches et révisions des espaces des médias (relus : un média peut avoir changé d'espace entre-temps). */
async function processingChanged(ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return
  const prisma = await usePrisma()
  const rows = await prisma.media.findMany({ where: { id: { in: unique } }, select: { projectId: true } })
  await mediaChanged(unique, ...rows.map(spaceOfMedia))
}

/** État de traitement d'un média, si son fichier est toujours `sourceKey` (et hors corbeille). false sinon. */
export async function setProcessingState(mediaId: string, state: ProcessingStateValue, sourceKey: string): Promise<boolean> {
  const prisma = await usePrisma()
  const written = await writeProcessingState(prisma, { mediaId, sourceKey }, state)
  if (written) await processingChanged([mediaId])
  return written
}

/** Prend la prochaine tâche prête pour ce processus ; le média passe « en cours ». */
export async function claimProcessingJob(workerId: string): Promise<JobLease | null> {
  const lease = await claimNextJob(await usePrisma(), workerId, new Date(), writeProcessingState)
  if (lease) await processingChanged([lease.mediaId])
  return lease
}

/** Tâche réussie : média « prêt » (avertissements dans `result`). */
export async function completeProcessingJob(lease: JobLease, result: JobResult): Promise<boolean> {
  const done = await completeJob(await usePrisma(), lease, new Date(), result, writeProcessingState)
  if (done) await processingChanged([lease.mediaId])
  return done
}

/** Essai en échec : nouvel essai différé (« en attente ») ou échec définitif (« en échec »). */
export async function failProcessingJob(lease: JobLease, failure: JobFailure, result: JobResult): Promise<FailOutcome> {
  const outcome = await failJob(await usePrisma(), lease, new Date(), failure, result, writeProcessingState)
  if (outcome !== 'lost') await processingChanged([lease.mediaId])
  return outcome
}

/** Tâche rendue à la file sans compter d'essai (arrêt du processus) : média « en attente ». */
export async function releaseProcessingJob(lease: JobLease, result: JobResult): Promise<boolean> {
  const released = await releaseJob(await usePrisma(), lease, new Date(), result, writeProcessingState)
  if (released) await processingChanged([lease.mediaId])
  return released
}

/** Baux échus (processus arrêté net) : tâches reprises ou en échec définitif. */
export async function reapProcessingJobs(): Promise<ReapedJob[]> {
  const reaped = await reapExpiredLeases(await usePrisma(), new Date(), writeProcessingState)
  await processingChanged(reaped.map(job => job.mediaId))
  return reaped
}

/** Rattrapage au démarrage : médias « en attente » sans tâche active (base restaurée). Renvoie leur nombre. */
export async function catchUpProcessing(): Promise<number> {
  const caught = await catchUpJobs(await usePrisma(), new Date(), writeProcessingState)
  await processingChanged(caught)
  if (caught.length > 0) notifyJobQueued()
  return caught.length
}

/**
 * Relance du traitement d'une vidéo (« Relancer » : échec, ou rendus à refaire avec d'autres réglages ;
 * première fois pour une vidéo envoyée avant D3) : tâche active annulée, nouvelle tâche pour le fichier
 * actuel, qui refait les rendus existants (un rendu remplacé change la version). 422 KIND_MISMATCH pour
 * une image, 409 IN_TRASH, 409 PROCESSING_DISABLED si le traitement est inactif.
 */
export async function requestProcessing(media: Media, options: { priority?: number } = {}): Promise<MediaWithUploader> {
  if (media.kind !== 'VIDEO') throw mediaError(422, 'KIND_MISMATCH', { detail: 'Only videos are processed.' })
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
  if (!await videoProcessingActive()) throw mediaError(409, 'PROCESSING_DISABLED')
  const prisma = await usePrisma()
  const now = new Date()
  const queued = await prisma.$transaction(async (tx) => {
    const { count } = await tx.media.updateMany({
      where: { id: media.id, storageKey: media.storageKey, deletedAt: null },
      data: { processingState: 'PENDING' },
    })
    if (count !== 1) return false
    await cancelActiveJobs(tx, media.id, now)
    await enqueueJob(tx, { mediaId: media.id, sourceKey: media.storageKey, priority: jobPriority(media.metadata, options.priority ?? 0) }, now)
    return true
  }, JOB_TRANSACTION)
  if (!queued) throw mediaError(409, 'VERSION_CONFLICT')
  await mediaChanged([media.id], spaceOfMedia(media))
  notifyJobQueued()
  return findMediaOrFail(media.id)
}

/** Vidéos existantes traitées par lot de… */
const BACKFILL_BATCH = 200

/**
 * « Traiter les vidéos existantes » : une tâche de priorité basse (BACKFILL_PRIORITY, après les envois
 * récents) pour chaque vidéo jamais traitée (`processingState` null), hors corbeille. Chaque vidéo est
 * prise par une écriture conditionnelle (toujours non traitée, même fichier) : deux demandes simultanées
 * ne créent pas deux tâches. 409 PROCESSING_DISABLED si le traitement est inactif. Renvoie le nombre de
 * tâches créées ; `progress.count` le suit pendant la boucle : une écriture qui échoue en route (base
 * indisponible) laisse les tâches déjà créées, que l'appelant peut encore journaliser. Elles sont
 * annoncées dans tous les cas (caches, révisions, boucle de traitement).
 */
export async function backfillProcessing(progress: { count: number } = { count: 0 }): Promise<{ count: number }> {
  if (!await videoProcessingActive()) throw mediaError(409, 'PROCESSING_DISABLED')
  const prisma = await usePrisma()
  const changed: string[] = []
  const skipped: string[] = []
  try {
    for (let round = 0; round < 10_000; round++) {
      const batch = await prisma.media.findMany({
        where: { kind: 'VIDEO', processingState: null, deletedAt: null, ...(skipped.length > 0 ? { id: { notIn: skipped } } : {}) },
        select: { id: true, storageKey: true, metadata: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BACKFILL_BATCH,
      })
      for (const media of batch) {
        const now = new Date()
        const queued = await prisma.$transaction(async (tx) => {
          const { count } = await tx.media.updateMany({
            where: { id: media.id, storageKey: media.storageKey, processingState: null, deletedAt: null },
            data: { processingState: 'PENDING' },
          })
          if (count !== 1) return false
          await enqueueJob(tx, { mediaId: media.id, sourceKey: media.storageKey, priority: jobPriority(media.metadata, BACKFILL_PRIORITY) }, now)
          return true
        }, JOB_TRANSACTION)
        ;(queued ? changed : skipped).push(media.id)
        progress.count = changed.length
      }
      if (batch.length < BACKFILL_BATCH) break
    }
  }
  finally {
    if (changed.length > 0) {
      notifyJobQueued()
      await processingChanged(changed)
    }
  }
  return { count: changed.length }
}

// ─── Traitement des vidéos (phase D3) : écritures du processus de travail ────

/** Taille et empreinte SHA-256 d'un fichier local (sortie de ffmpeg), en une lecture. */
async function fileDigest(path: string): Promise<{ size: number, checksum: string }> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    size += (chunk as Buffer).length
    hash.update(chunk as Buffer)
  }
  return { size, checksum: hash.digest('hex') }
}

/** Sortie de ffmpeg présentée comme un fichier reçu (même chemin d'analyse et de préparation qu'un envoi). */
async function localUpload(path: string, filename: string): Promise<ReceivedUpload> {
  const { size, checksum } = await fileDigest(path)
  return { path, size, checksum, filename, fields: {}, cleanup: async () => {} }
}

/**
 * Écriture d'un résultat de tâche : bail renouvelé en premier (« écriture d'abord », jobs.ts), puis
 * écriture du média conditionnée à son fichier (`storageKey` = celui de la tâche) et hors corbeille.
 * Lève JobLost si l'une ou l'autre n'a rien écrit.
 */
async function writeJobResult(lease: JobLease, data: Prisma.MediaUncheckedUpdateManyInput, extraWhere: Prisma.MediaWhereInput = {}): Promise<boolean> {
  const prisma = await usePrisma()
  const now = new Date()
  const outcome = await prisma.$transaction(async (tx) => {
    if (!await renewLease(tx, lease, now)) return 'lost' as const
    const { count } = await tx.media.updateMany({ where: { id: lease.mediaId, storageKey: lease.sourceKey, deletedAt: null, ...extraWhere }, data })
    return count === 1 ? 'ok' as const : 'unchanged' as const
  }, JOB_TRANSACTION)
  if (outcome === 'lost') throw new JobLost()
  return outcome === 'ok'
}

/**
 * Résultat de l'analyse ffprobe (étape `probe`), sans nouvelle version (rien de servi ne change) :
 *   - format converti (MKV, AVI…, inconnu jusque-là) : dimensions affichées, durée, codecs, son, rotation,
 *     débit, courbe HDR ; `playback` reste `none` (l'original n'est jamais proposé à `<video>`) ;
 *   - MP4, MOV, WebM : courbe HDR seulement (le lecteur de D1 ne lit pas les couleurs).
 * Lève JobLost si la tâche ou son fichier ont changé. Renvoie le média relu (ou tel quel si rien ne change).
 */
export async function applyProbeResult(media: Media, lease: JobLease, probe: ProbeResult): Promise<Media> {
  const metadata = videoMetadata(media.metadata)
  const video = probe.video
  if (!metadata || !video) return media
  let data: Prisma.MediaUncheckedUpdateManyInput
  if (isConvertedContainer(metadata.container)) {
    const duration = probe.duration
    const next: VideoMetadata = {
      ...metadata,
      videoCodec: video.codec,
      audioCodec: probe.audio?.codec ?? null,
      codecs: null,
      hasAudio: probe.audio !== null,
      rotation: video.rotation,
      bitrate: probe.bitrate ?? (duration ? Math.round(media.size * 8 / duration) : null),
      playback: 'none',
      hdr: video.hdr,
    }
    data = { width: video.width, height: video.height, duration, metadata: next as unknown as Prisma.InputJsonValue }
  }
  else {
    if (metadata.hdr === video.hdr) return media
    data = { metadata: { ...metadata, hdr: video.hdr } as unknown as Prisma.InputJsonValue }
  }
  if (!await writeJobResult(lease, data)) throw new JobLost('Fichier du média remplacé pendant l\'analyse.')
  await mediaChanged([media.id], spaceOfMedia(media))
  return findMediaOrFail(media.id)
}

/**
 * Réécriture sans perte d'une vidéo par sa tâche (§ 32.1, DD28 : retrait des pistes de métadonnées,
 * réparation d'un WebM) : la sortie de ffmpeg remplace l'original par le même chemin qu'« Optimiser » —
 * réanalyse par le lecteur de D1, préparation de D2 (liste de ce qui est conservé, « faststart »),
 * nouvelle version, anciennes URL redirigées, ancien original supprimé. Les métadonnées gardent la courbe
 * HDR et la liste des réécritures. La tâche continue sur le nouveau fichier : `lease.sourceKey` est mis à
 * jour. Une version changée entre-temps sans nouveau fichier (affiche, point d'intérêt) est relue et
 * l'écriture refaite ; un autre fichier, la corbeille ou le bail perdu lèvent JobLost.
 */
export async function commitRewrittenFile(
  media: Media,
  outputPath: string,
  options: { lease: JobLease, rewrite: VideoRewrite, hdr: VideoHdrTransfer | null },
): Promise<MediaWithUploader> {
  const { lease } = options
  const upload = await localUpload(outputPath, media.originalName)
  // Même type que l'original (ffmpeg écrit le même conteneur) : tout autre résultat est une sortie fautive.
  const analyzed = await analyze(upload, { acceptedTypes: [media.mimeType] })
  if (analyzed.kind !== media.kind) throw mediaError(422, 'KIND_MISMATCH')
  const prepared = await prepareOriginal(upload, analyzed)
  const stored = await storeOriginal(upload, analyzed, prepared)
  const storage = await useMediaStorage()
  try {
    const data = fileData(upload, analyzed, stored)
    data.metadata = withProcessingMetadata(stored.inspected.metadata, videoMetadata(media.metadata), { hdr: options.hdr, rewrite: options.rewrite }) as Prisma.InputJsonValue
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await findMedia(media.id)
      if (!current || current.deletedAt || current.storageKey !== lease.sourceKey) throw new JobLost('Fichier du média remplacé pendant la réécriture.')
      const outcome = await commitFile(current, data, { carry: lease })
      if (outcome.status === 'lost') throw new JobLost()
      if (outcome.status === 'ok') {
        lease.sourceKey = data.storageKey
        return await afterNewFile(current, outcome)
      }
    }
    throw mediaError(409, 'VERSION_CONFLICT')
  }
  catch (error) {
    // Fichier jamais enregistré (la clé n'est référencée qu'après validation) : supprimé.
    if (lease.sourceKey !== stored.key) await storage.delete(stored.key).catch(() => {})
    throw error
  }
}

/**
 * Rendu produit par une tâche (§ 34, DD33), déjà vérifié par le lecteur de D1 (`probe`) : fichier écrit
 * dans le stockage, puis, en une transaction (bail d'abord), ligne `MediaRendition` créée ou remplacée si
 * le fichier du média est toujours celui de la tâche. Remplacer un rendu existant (relance avec d'autres
 * réglages) change la version : jamais de nouveaux octets à une URL déjà mise en cache ; les dérivés de
 * l'ancienne version et l'ancien fichier du rendu sont supprimés. Un rendu qui n'existait pas ne change
 * pas la version. Échec ou JobLost : le nouveau fichier est supprimé.
 */
export async function saveRendition(media: Media, lease: JobLease, name: RenditionName, outputPath: string, probe: VideoProbe): Promise<MediaWithUploader> {
  const format = RENDITION_FORMATS[name]
  const { size, checksum } = await fileDigest(outputPath)
  const duration = probe.duration ?? 0
  const fields = {
    container: format.container,
    mimeType: format.mimeType,
    codecs: probe.metadata.codecs ?? [probe.metadata.videoCodec, probe.metadata.audioCodec].filter(Boolean).join(','),
    width: probe.width,
    height: probe.height,
    duration,
    bitrate: probe.metadata.bitrate ?? (duration > 0 ? Math.round(size * 8 / duration) : 0),
    size,
    checksum,
  }
  const storage = await useMediaStorage()
  const key = renditionKey(media.id, name, format.container)
  await storage.put(key, createReadStream(outputPath), { contentType: format.mimeType, size })
  const result: JobResult = { ...lease.result, renditions: [...new Set([...lease.result.renditions, name])] }
  const prisma = await usePrisma()
  const now = new Date()
  type Saved = { status: 'ok', previous: MediaRendition | null, oldVersion: number } | { status: 'lost' }
  let outcome: Saved
  try {
    outcome = await prisma.$transaction(async (tx): Promise<Saved> => {
      if (!await renewLease(tx, lease, now, resultData(result))) return { status: 'lost' }
      const previous = await tx.mediaRendition.findUnique({ where: { mediaId_name: { mediaId: media.id, name } } })
      const { count } = await tx.media.updateMany({
        where: { id: media.id, storageKey: lease.sourceKey, deletedAt: null },
        data: previous ? { version: { increment: 1 } } : { updatedAt: now },
      })
      if (count !== 1) return { status: 'lost' }
      if (previous) await tx.mediaRendition.update({ where: { id: previous.id }, data: { ...fields, storageKey: key, createdAt: now } })
      else await tx.mediaRendition.create({ data: { ...fields, mediaId: media.id, name, storageKey: key } })
      const current = await tx.media.findUnique({ where: { id: media.id }, select: { version: true } })
      return { status: 'ok', previous, oldVersion: (current?.version ?? 1) - (previous ? 1 : 0) }
    }, JOB_TRANSACTION)
  }
  catch (error) {
    await storage.delete(key).catch(() => {})
    throw error
  }
  if (outcome.status !== 'ok') {
    await storage.delete(key)
    throw new JobLost()
  }
  lease.result = result
  if (outcome.previous) {
    const previous = outcome.previous
    await deleteQuietly(`Ancien rendu ${name} du média ${media.id}`, () => storage.delete(previous.storageKey))
    await deleteQuietly(`Dérivés de la version ${outcome.oldVersion} du média ${media.id}`, () => deleteVersionVariants({ id: media.id, version: outcome.oldVersion }))
  }
  await mediaChanged([media.id], spaceOfMedia(media))
  const updated = await findMediaOrFail(media.id)
  if (outcome.previous) pregenerateVariants(updated)
  return updated
}

/** Normalisation d'une affiche dans la file des traitements d'images ; file pleine : nouvel essai (5 au plus). */
async function normalizeServerPoster(path: string): Promise<Awaited<ReturnType<typeof normalizePoster>>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runProcessing(() => normalizePoster(path))
    }
    catch (error) {
      if ((error as { data?: { code?: string } } | null)?.data?.code !== 'SERVER_BUSY' || attempt >= 5) throw error
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}

/**
 * Affiche extraite par le serveur (§ 32.3, DD30), seulement si la vidéo n'en a **aucune** : normalisée
 * comme une affiche envoyée (JPEG ≤ 3840 px, file des traitements d'images), puis enregistrée par une
 * écriture conditionnelle (toujours sans affiche, même fichier, hors corbeille), **sans nouvelle
 * version** (première affiche, DD18). Une affiche choisie entre-temps par l'utilisateur l'emporte : la
 * nôtre est supprimée, null est renvoyé. JobLost si la tâche a été perdue.
 */
export async function setServerPoster(media: Media, lease: JobLease, jpegPath: string, time: number | null): Promise<MediaWithUploader | null> {
  if (media.posterKey) return null
  const poster = await normalizeServerPoster(jpegPath)
  const storage = await useMediaStorage()
  const key = posterKey(media.id)
  await storage.put(key, Readable.from(poster.data), { contentType: 'image/jpeg', size: poster.data.length })
  let written: boolean
  try {
    written = await writeJobResult(
      lease,
      { posterKey: key, posterWidth: poster.width, posterHeight: poster.height, posterSize: poster.data.length, posterTime: time },
      { posterKey: null },
    )
  }
  catch (error) {
    await storage.delete(key).catch(() => {})
    throw error
  }
  if (!written) {
    await storage.delete(key)
    return null
  }
  await mediaChanged([media.id], spaceOfMedia(media))
  const updated = await findMediaOrFail(media.id)
  pregenerateVariants(updated)
  return updated
}
