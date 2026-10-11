import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { TextTrackInput, TextTrackUpdate } from '#shared/schemas/media'
import { TEXT_TRACK_KINDS, TEXT_TRACKS_MAX, textTrackGroup, type TextTrackKind } from '#shared/utils/text-tracks'
import type { Media, MediaTextTrack, Prisma } from '../../generated/prisma/client'
import { useMediaStorage } from '../storage'
import { mediaChanged } from './cache'
import { mediaError } from './errors'
import { trackKey } from './keys'
import { parseTextTrack, type ParsedTextTrack, TextTrackError } from './text-track'
import type { DeliverableObject } from './variants'

/**
 * Pistes de texte des vidéos (phase D2, architecture § 20) : fichier WebVTT normalisé
 * (`variants/<média>/track-<aléa>.vtt`, supprimé avec le média à la purge) et ligne `MediaTextTrack`.
 * Le fichier d'une piste est immuable : le remplacer crée une nouvelle piste (nouvelle URL) ; type,
 * langue, libellé et « par défaut » se modifient sans toucher au fichier. Toute modification met à jour
 * `Media.updatedAt` (ETag de l'API) et invalide les caches (`mediaChanged`). Pas d'entrée de journal,
 * comme pour le titre ou le texte alternatif.
 */

/** Ordre d'affichage et de diffusion des pistes d'une vidéo. */
export const TEXT_TRACK_ORDER = { orderBy: { createdAt: 'asc' } } as const

/** Nouveau fichier de piste : contenu reçu en mémoire et nom indicatif. */
export interface TextTrackFile {
  data: Buffer
  filename: string
}

function requireVideo(media: Media): void {
  if (media.kind !== 'VIDEO') throw mediaError(422, 'KIND_MISMATCH', { detail: 'Only videos have text tracks.' })
  if (media.deletedAt) throw mediaError(409, 'IN_TRASH')
}

/** Fichier analysé et réécrit ; 422 INVALID_TEXT_TRACK (avec la ligne en cause) s'il est refusé. */
function parseFile(file: TextTrackFile): ParsedTextTrack {
  try {
    return parseTextTrack(file.data)
  }
  catch (error) {
    if (!(error instanceof TextTrackError)) throw error
    const detail = error.line === null ? error.message : `Line ${error.line}: ${error.message}`
    throw mediaError(422, 'INVALID_TEXT_TRACK', { line: error.line, detail })
  }
}

async function storeTrack(mediaId: string, track: ParsedTextTrack): Promise<{ storageKey: string, size: number, checksum: string }> {
  const data = Buffer.from(track.vtt, 'utf8')
  const storageKey = trackKey(mediaId)
  const storage = await useMediaStorage()
  await storage.put(storageKey, Readable.from(data), { contentType: 'text/vtt; charset=utf-8', size: data.length })
  return { storageKey, size: data.length, checksum: createHash('sha256').update(data).digest('hex') }
}

/** Types du même groupe « par défaut » (sous-titres et sous-titres SME ensemble). */
function groupKinds(kind: TextTrackKind): TextTrackKind[] {
  return TEXT_TRACK_KINDS.filter(other => textTrackGroup(other) === textTrackGroup(kind))
}

type Transaction = Prisma.TransactionClient

/** Une piste « par défaut » au plus par groupe : retire l'indication des autres pistes du groupe. */
async function clearGroupDefault(tx: Transaction, mediaId: string, kind: TextTrackKind, exceptId: string | null): Promise<void> {
  await tx.mediaTextTrack.updateMany({
    where: { mediaId, kind: { in: groupKinds(kind) }, isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    data: { isDefault: false },
  })
}

async function touchMedia(tx: Transaction, mediaId: string): Promise<void> {
  await tx.media.update({ where: { id: mediaId }, data: { updatedAt: new Date() } })
}

async function findTrack(media: Media, trackId: string): Promise<MediaTextTrack> {
  const prisma = await usePrisma()
  const track = await prisma.mediaTextTrack.findFirst({ where: { id: trackId, mediaId: media.id } })
  if (!track) throw mediaError(404, 'TRACK_NOT_FOUND')
  return track
}

/** Fichier d'une piste pour la diffusion (/m/…/tracks/<piste>.vtt) ; 404 si la vidéo ne l'a pas. */
export async function resolveTrackDeliverable(media: Media, trackId: string): Promise<DeliverableObject> {
  const prisma = await usePrisma()
  const track = await prisma.mediaTextTrack.findFirst({ where: { id: trackId, mediaId: media.id } })
  if (!track) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  return { key: track.storageKey, mimeType: 'text/vtt; charset=utf-8', size: track.size, etag: track.checksum.slice(0, 32) }
}

export async function listTextTracks(mediaId: string): Promise<MediaTextTrack[]> {
  const prisma = await usePrisma()
  return prisma.mediaTextTrack.findMany({ where: { mediaId }, ...TEXT_TRACK_ORDER })
}

/** Ajoute une piste à une vidéo (20 au plus : 409 TRACK_LIMIT_REACHED). */
export async function addTextTrack(media: Media, file: TextTrackFile, input: TextTrackInput): Promise<MediaTextTrack> {
  requireVideo(media)
  const prisma = await usePrisma()
  if (await prisma.mediaTextTrack.count({ where: { mediaId: media.id } }) >= TEXT_TRACKS_MAX) throw mediaError(409, 'TRACK_LIMIT_REACHED')
  const parsed = parseFile(file)
  const stored = await storeTrack(media.id, parsed)
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (input.isDefault) await clearGroupDefault(tx, media.id, input.kind, null)
      const track = await tx.mediaTextTrack.create({
        data: {
          mediaId: media.id,
          kind: input.kind,
          language: input.language,
          label: input.label,
          isDefault: input.isDefault,
          ...stored,
          cueCount: parsed.cueCount,
          sourceFormat: parsed.sourceFormat,
        },
      })
      await touchMedia(tx, media.id)
      return track
    })
    await mediaChanged([media.id], spaceOfMedia(media))
    return created
  }
  catch (error) {
    const storage = await useMediaStorage()
    await storage.delete(stored.storageKey)
    throw error
  }
}

/** Type, langue, libellé, « par défaut » : le fichier et son URL ne changent pas. */
export async function updateTextTrack(media: Media, trackId: string, update: TextTrackUpdate): Promise<MediaTextTrack> {
  requireVideo(media)
  const track = await findTrack(media, trackId)
  const kind = update.kind ?? track.kind
  const isDefault = update.isDefault ?? track.isDefault
  const prisma = await usePrisma()
  const updated = await prisma.$transaction(async (tx) => {
    if (isDefault) await clearGroupDefault(tx, media.id, kind, track.id)
    const row = await tx.mediaTextTrack.update({ where: { id: track.id }, data: { ...update, kind, isDefault } })
    await touchMedia(tx, media.id)
    return row
  })
  await mediaChanged([media.id], spaceOfMedia(media))
  return updated
}

/**
 * Remplace le fichier d'une piste : nouvelle piste (nouvel identifiant, nouvelle URL) aux mêmes type,
 * langue, libellé et « par défaut », l'ancienne est supprimée.
 */
export async function replaceTextTrackFile(media: Media, trackId: string, file: TextTrackFile): Promise<MediaTextTrack> {
  requireVideo(media)
  const track = await findTrack(media, trackId)
  const parsed = parseFile(file)
  const stored = await storeTrack(media.id, parsed)
  const prisma = await usePrisma()
  let created: MediaTextTrack
  try {
    created = await prisma.$transaction(async (tx) => {
      await tx.mediaTextTrack.delete({ where: { id: track.id } })
      const row = await tx.mediaTextTrack.create({
        data: {
          mediaId: media.id,
          kind: track.kind,
          language: track.language,
          label: track.label,
          isDefault: track.isDefault,
          ...stored,
          cueCount: parsed.cueCount,
          sourceFormat: parsed.sourceFormat,
        },
      })
      await touchMedia(tx, media.id)
      return row
    })
  }
  catch (error) {
    const storage = await useMediaStorage()
    await storage.delete(stored.storageKey)
    throw error
  }
  const storage = await useMediaStorage()
  await storage.delete(track.storageKey)
  await mediaChanged([media.id], spaceOfMedia(media))
  return created
}

export async function deleteTextTrack(media: Media, trackId: string): Promise<void> {
  requireVideo(media)
  const track = await findTrack(media, trackId)
  const prisma = await usePrisma()
  await prisma.$transaction(async (tx) => {
    await tx.mediaTextTrack.delete({ where: { id: track.id } })
    await touchMedia(tx, media.id)
  })
  const storage = await useMediaStorage()
  await storage.delete(track.storageKey)
  await mediaChanged([media.id], spaceOfMedia(media))
}

/** Copie les pistes d'une vidéo vers sa copie (duplication) ; un échec est seulement journalisé. */
export async function copyTextTracks(source: Pick<Media, 'id'>, copyId: string): Promise<void> {
  const storage = await useMediaStorage()
  const prisma = await usePrisma()
  for (const track of await listTextTracks(source.id)) {
    const storageKey = trackKey(copyId)
    try {
      await storage.copy(track.storageKey, storageKey)
      await prisma.mediaTextTrack.create({
        data: {
          mediaId: copyId,
          kind: track.kind,
          language: track.language,
          label: track.label,
          isDefault: track.isDefault,
          storageKey,
          size: track.size,
          checksum: track.checksum,
          cueCount: track.cueCount,
          sourceFormat: track.sourceFormat,
        },
      })
    }
    catch (error) {
      console.error(`[surge-media] Piste ${track.id} non copiée vers le média ${copyId} :`, error)
      await storage.delete(storageKey).catch(() => {})
    }
  }
}
