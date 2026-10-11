import { av1CodecString, avcCodecString } from './codecs'
import { type ByteSource, MAX_READ_LENGTH, unreadable } from './source'

/**
 * Lecture des en-têtes d'un fichier WebM (EBML, RFC 8794 ; Matroska, RFC 9559) : `Info` (durée) et
 * `Tracks` (pistes, codecs, dimensions), lus avant le premier `Cluster`. Les enregistrements d'un
 * navigateur (`MediaRecorder`) ont un `Segment` de taille inconnue et pas de durée : acceptés.
 * Pure, testée.
 */

export interface WebmTrack {
  type: 'video' | 'audio' | 'other'
  enabled: boolean
  /** Codec normalisé (`vp8`, `vp9`, `av01`, `avc1`, `opus`…) et chaîne RFC 6381 s'il y a lieu. */
  codec: string
  codecString: string | null
  width: number
  height: number
}

export interface WebmFile {
  duration: number | null
  /** Durée absente des en-têtes, estimée d'après le dernier `Cluster` (enregistrements des navigateurs). */
  durationEstimated: boolean
  tracks: WebmTrack[]
}

const ID = {
  EBML: 0x1A45DFA3,
  DocType: 0x4282,
  Segment: 0x18538067,
  Info: 0x1549A966,
  TimecodeScale: 0x2AD7B1,
  Duration: 0x4489,
  Tracks: 0x1654AE6B,
  TrackEntry: 0xAE,
  TrackType: 0x83,
  FlagEnabled: 0xB9,
  CodecID: 0x86,
  CodecPrivate: 0x63A2,
  Video: 0xE0,
  PixelWidth: 0xB0,
  PixelHeight: 0xBA,
  DisplayWidth: 0x54B0,
  DisplayHeight: 0x54BA,
  DisplayUnit: 0x54B2,
  Cluster: 0x1F43B675,
} as const

/** En-têtes parcourus au plus avant les données (au-delà : pistes introuvables). */
const MAX_HEADER_SCAN = 16 * 1024 * 1024
const MAX_ELEMENTS = 10_000

const VIDEO_CODECS: Record<string, string> = {
  'V_VP8': 'vp8',
  'V_VP9': 'vp9',
  'V_AV1': 'av01',
  'V_MPEG4/ISO/AVC': 'avc1',
  'V_MPEGH/ISO/HEVC': 'hev1',
}
const AUDIO_CODECS: Record<string, string> = {
  A_OPUS: 'opus',
  A_VORBIS: 'vorbis',
  A_FLAC: 'flac',
  A_AC3: 'ac-3',
  A_EAC3: 'ec-3',
  A_DTS: 'dts',
}

interface Element {
  id: number
  /** Début et fin du contenu ; `end` = null pour une taille inconnue. */
  body: number
  end: number | null
}

interface Context {
  source: ByteSource
  elements: number
}

/** Entier de taille variable : identifiant (marqueur conservé) ou taille (marqueur retiré, tous bits à 1 = inconnue). */
function vint(buffer: Buffer, offset: number, withMarker: boolean): { length: number, value: number, unknown: boolean } {
  const first = buffer[offset]
  if (first === undefined || first === 0) throw unreadable('Invalid EBML variable-size integer.')
  const length = Math.clz32(first) - 23
  if (offset + length > buffer.length || (withMarker && length > 4)) throw unreadable('Invalid EBML variable-size integer.')
  let value = withMarker ? first : first & (0xFF >> length)
  let allOnes = value === 0xFF >> length
  for (let i = 1; i < length; i++) {
    const byte = buffer[offset + i]!
    value = value * 256 + byte
    allOnes &&= byte === 0xFF
  }
  return { length, value, unknown: !withMarker && allOnes }
}

async function readElement(context: Context, offset: number, limit: number): Promise<Element | null> {
  if (limit - offset < 2) return null
  if (++context.elements > MAX_ELEMENTS) throw unreadable('Too many EBML elements.')
  const head = await context.source.read(offset, 12)
  const id = vint(head, 0, true)
  const size = vint(head, id.length, false)
  const body = offset + id.length + size.length
  if (size.unknown) return { id: id.value, body, end: null }
  const end = body + size.value
  if (end > limit) throw unreadable('EBML element exceeds its container.')
  return { id: id.value, body, end }
}

async function* elements(context: Context, from: number, limit: number): AsyncGenerator<Element> {
  for (let offset = from; ;) {
    const element = await readElement(context, offset, limit)
    if (!element) return
    yield element
    if (element.end === null) return // taille inconnue : le contenu va jusqu'à la fin du parent
    offset = element.end
  }
}

async function readBody(context: Context, element: Element): Promise<Buffer> {
  if (element.end === null) throw unreadable('Unexpected EBML element of unknown size.')
  const length = element.end - element.body
  if (length > MAX_READ_LENGTH) throw unreadable('EBML element too large to read.')
  const body = await context.source.read(element.body, length)
  if (body.length < length) throw unreadable('Truncated EBML element.')
  return body
}

function unsigned(body: Buffer): number {
  if (body.length > 7) throw unreadable('EBML integer too large.')
  let value = 0
  for (const byte of body) value = value * 256 + byte
  return value
}

function float(body: Buffer): number {
  if (body.length === 0) return 0
  if (body.length === 4) return body.readFloatBE(0)
  if (body.length === 8) return body.readDoubleBE(0)
  throw unreadable('Invalid EBML float.')
}

function text(body: Buffer): string {
  return body.toString('latin1').replace(/\0+$/, '')
}

/** Durée (secondes) en unités de `scale` nanosecondes ; null si nulle ou absurde. */
function scaled(value: number, scale: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const seconds = value * scale / 1e9
  return seconds < 1e8 ? seconds : null
}

async function readInfo(context: Context, info: Element): Promise<{ duration: number | null, scale: number }> {
  let scale = 1_000_000
  let duration: number | null = null
  for await (const element of elements(context, info.body, info.end!)) {
    if (element.id === ID.TimecodeScale) scale = unsigned(await readBody(context, element)) || 1_000_000
    else if (element.id === ID.Duration) duration = float(await readBody(context, element))
  }
  return { duration: duration === null ? null : scaled(duration, scale), scale }
}

// ─── Durée estimée (fichiers sans durée) ─────────────────────────────────────

/** Fin du fichier lue pour trouver le dernier `Cluster` : 1 Mio, puis 4, puis 16 au plus (grappes de 4K). */
const DURATION_TAILS = [1, 4, 16].map(mebibytes => mebibytes * 1024 * 1024)
const CLUSTER_ID = Buffer.from([0x1F, 0x43, 0xB6, 0x75])
const CLUSTER = {
  Timecode: 0xE7,
  SimpleBlock: 0xA3,
  BlockGroup: 0xA0,
  Block: 0xA1,
  BlockDuration: 0x9B,
  Position: 0xA7,
  PrevSize: 0xAB,
  Void: 0xEC,
  CRC32: 0xBF,
} as const
const CLUSTER_CHILDREN = new Set<number>(Object.values(CLUSTER))
/** Éléments de premier niveau qui peuvent suivre un `Cluster` de taille inconnue. */
const SEGMENT_CHILDREN = new Set([ID.Cluster, 0x1C53BB6B /* Cues */, 0x1254C367 /* Tags */, 0x1043A770 /* Chapters */, 0x1941A469])

/** Décalage (signé, unités du `Cluster`) d'un bloc `SimpleBlock` ou `Block`. */
function blockOffset(buffer: Buffer, body: number, end: number): number {
  const track = vint(buffer, body, false)
  if (body + track.length + 3 > end) throw unreadable('Truncated block.')
  return buffer.readInt16BE(body + track.length)
}

/**
 * Fin (unités de `TimecodeScale`) des blocs du `Cluster` qui commence à `at`, null si ce n'est pas un
 * `Cluster` cohérent (identifiant trouvé par hasard dans des données). Un bloc coupé par la fin du
 * tampon arrête le parcours.
 */
function clusterEnd(buffer: Buffer, at: number): number | null {
  let end: number | null = null
  try {
    let offset = at + CLUSTER_ID.length
    const size = vint(buffer, offset, false)
    offset += size.length
    const limit = size.unknown ? buffer.length : Math.min(buffer.length, offset + size.value)
    let timecode: number | null = null
    while (limit - offset >= 2) {
      const id = vint(buffer, offset, true)
      if (SEGMENT_CHILDREN.has(id.value as never)) break
      // `Timecode` d'abord (seuls CRC-32 et Void peuvent le précéder), puis des éléments connus.
      if (!CLUSTER_CHILDREN.has(id.value)) return end
      if (timecode === null && id.value !== CLUSTER.Timecode && id.value !== CLUSTER.CRC32 && id.value !== CLUSTER.Void) return null
      const length = vint(buffer, offset + id.length, false)
      if (length.unknown) return end
      const body = offset + id.length + length.length
      const childEnd = body + length.value
      if (childEnd > limit) break
      if (id.value === CLUSTER.Timecode) timecode = unsigned(buffer.subarray(body, childEnd))
      else if (id.value === CLUSTER.SimpleBlock && timecode !== null) {
        end = Math.max(end ?? 0, timecode + blockOffset(buffer, body, childEnd))
      }
      else if (id.value === CLUSTER.BlockGroup && timecode !== null) {
        let start: number | null = null
        let duration = 0
        for (let child = body; childEnd - child >= 2;) {
          const childId = vint(buffer, child, true)
          const childLength = vint(buffer, child + childId.length, false)
          const childBody = child + childId.length + childLength.length
          const next = childBody + childLength.value
          if (childLength.unknown || next > childEnd) break
          if (childId.value === CLUSTER.Block) start = timecode + blockOffset(buffer, childBody, next)
          else if (childId.value === CLUSTER.BlockDuration) duration = unsigned(buffer.subarray(childBody, next))
          child = next
        }
        if (start !== null) end = Math.max(end ?? 0, start + duration)
      }
      offset = childEnd
    }
    return end
  }
  catch {
    // Élément coupé par la fin du tampon (ou données incohérentes) : blocs déjà lus seulement.
    return end
  }
}

/** Fin des données d'après le dernier `Cluster` cohérent d'un tampon (fin du fichier). Pure, testée. */
export function lastClusterEnd(tail: Buffer): number | null {
  for (let at = tail.lastIndexOf(CLUSTER_ID); at >= 0; at = at > 0 ? tail.lastIndexOf(CLUSTER_ID, at - 1) : -1) {
    const end = clusterEnd(tail, at)
    if (end !== null) return end
  }
  return null
}

/** Durée (secondes) estimée par la fin du fichier ; null si introuvable (jamais d'erreur). */
async function estimatedDuration(source: ByteSource, dataStart: number, scale: number): Promise<number | null> {
  try {
    for (const length of DURATION_TAILS) {
      const start = Math.max(dataStart, source.size - length)
      const parts: Buffer[] = []
      for (let offset = start; offset < source.size; offset += MAX_READ_LENGTH) {
        parts.push(await source.read(offset, Math.min(MAX_READ_LENGTH, source.size - offset)))
      }
      const end = lastClusterEnd(Buffer.concat(parts))
      if (end !== null) return scaled(end, scale)
      if (start === dataStart) return null
    }
    return null
  }
  catch {
    return null
  }
}

async function readTrack(context: Context, entry: Element): Promise<WebmTrack> {
  let trackType = 0
  let enabled = true
  let codecId = ''
  let codecPrivate: Buffer | null = null
  const video = { pixelWidth: 0, pixelHeight: 0, displayWidth: 0, displayHeight: 0, displayUnit: 0 }
  for await (const element of elements(context, entry.body, entry.end!)) {
    switch (element.id) {
      case ID.TrackType: trackType = unsigned(await readBody(context, element)); break
      case ID.FlagEnabled: enabled = unsigned(await readBody(context, element)) !== 0; break
      case ID.CodecID: codecId = text(await readBody(context, element)); break
      case ID.CodecPrivate: codecPrivate = await readBody(context, element); break
      case ID.Video:
        for await (const field of elements(context, element.body, element.end!)) {
          const value = () => readBody(context, field).then(unsigned)
          if (field.id === ID.PixelWidth) video.pixelWidth = await value()
          else if (field.id === ID.PixelHeight) video.pixelHeight = await value()
          else if (field.id === ID.DisplayWidth) video.displayWidth = await value()
          else if (field.id === ID.DisplayHeight) video.displayHeight = await value()
          else if (field.id === ID.DisplayUnit) video.displayUnit = await value()
        }
        break
    }
  }

  if (trackType === 1) {
    const codec = VIDEO_CODECS[codecId] ?? codecId.toLowerCase().slice(0, 32)
    let codecString: string | null = null
    if (codec === 'vp8' || codec === 'vp9') codecString = codec
    else if (codec === 'av01' && codecPrivate) codecString = av1CodecString(codecPrivate)
    else if (codec === 'avc1' && codecPrivate) codecString = avcCodecString('avc1', codecPrivate)
    // Taille d'affichage en pixels si elle est donnée (rapport d'aspect), sinon taille codée.
    const display = video.displayUnit === 0 && video.displayWidth > 0 && video.displayHeight > 0
    return {
      type: 'video',
      enabled,
      codec,
      codecString,
      width: display ? video.displayWidth : video.pixelWidth,
      height: display ? video.displayHeight : video.pixelHeight,
    }
  }
  if (trackType === 2) {
    const codec = AUDIO_CODECS[codecId] ?? (codecId.startsWith('A_AAC') ? 'mp4a' : codecId === 'A_MPEG/L3' ? 'mp3' : codecId.startsWith('A_PCM') ? 'lpcm' : codecId.toLowerCase().slice(0, 32))
    const codecString = codec === 'opus' || codec === 'vorbis' || codec === 'flac' ? codec : codec === 'mp3' ? 'mp3' : null
    return { type: 'audio', enabled, codec, codecString, width: 0, height: 0 }
  }
  return { type: 'other', enabled, codec: codecId.toLowerCase().slice(0, 32), codecString: null, width: 0, height: 0 }
}

export async function probeWebm(source: ByteSource): Promise<WebmFile> {
  const context: Context = { source, elements: 0 }
  const header = await readElement(context, 0, source.size)
  if (!header || header.id !== ID.EBML || header.end === null) throw unreadable('Missing EBML header.')
  let docType = ''
  for await (const element of elements(context, header.body, header.end)) {
    if (element.id === ID.DocType) docType = text(await readBody(context, element))
  }
  if (docType !== 'webm') throw unreadable('Not a WebM file.')

  let segment: Element | null = null
  for await (const element of elements(context, header.end, source.size)) {
    if (element.id === ID.Segment) {
      segment = element
      break
    }
  }
  if (!segment) throw unreadable('Missing WebM segment.')

  const file: WebmFile = { duration: null, durationEstimated: false, tracks: [] }
  const segmentEnd = segment.end ?? source.size
  const scanLimit = Math.min(segmentEnd, segment.body + MAX_HEADER_SCAN)
  let sawTracks = false
  let scale = 1_000_000
  let dataStart = segment.body
  for await (const element of elements(context, segment.body, segmentEnd)) {
    // `dataStart` : début du premier `Cluster` (fin de l'élément précédent).
    if (element.id === ID.Cluster || element.body > scanLimit) break
    // Autre élément de taille inconnue avant les données : rien ne permet de le sauter.
    if (element.end === null) break
    if (element.id === ID.Info) ({ duration: file.duration, scale } = await readInfo(context, element))
    else if (element.id === ID.Tracks) {
      sawTracks = true
      for await (const entry of elements(context, element.body, element.end)) {
        if (entry.id === ID.TrackEntry) file.tracks.push(await readTrack(context, entry))
      }
    }
    dataStart = element.end
  }
  if (!sawTracks) throw unreadable('No WebM tracks before the media data.')
  if (file.duration === null) {
    // Enregistrement d'un navigateur : pas de durée dans les en-têtes, estimée par la fin des données.
    file.duration = await estimatedDuration(source, dataStart, scale)
    file.durationEstimated = file.duration !== null
  }
  return file
}
