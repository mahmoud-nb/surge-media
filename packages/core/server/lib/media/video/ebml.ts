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

async function readInfo(context: Context, info: Element): Promise<number | null> {
  let scale = 1_000_000
  let duration: number | null = null
  for await (const element of elements(context, info.body, info.end!)) {
    if (element.id === ID.TimecodeScale) scale = unsigned(await readBody(context, element)) || 1_000_000
    else if (element.id === ID.Duration) duration = float(await readBody(context, element))
  }
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return null
  const value = duration * scale / 1e9
  return value < 1e8 ? value : null
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

  const file: WebmFile = { duration: null, tracks: [] }
  const segmentEnd = segment.end ?? source.size
  const scanLimit = Math.min(segmentEnd, segment.body + MAX_HEADER_SCAN)
  let sawTracks = false
  for await (const element of elements(context, segment.body, segmentEnd)) {
    if (element.id === ID.Cluster || element.body > scanLimit) break
    // Autre élément de taille inconnue avant les données : rien ne permet de le sauter.
    if (element.end === null) break
    if (element.id === ID.Info) file.duration = await readInfo(context, element)
    else if (element.id === ID.Tracks) {
      sawTracks = true
      for await (const entry of elements(context, element.body, element.end)) {
        if (entry.id === ID.TrackEntry) file.tracks.push(await readTrack(context, entry))
      }
    }
  }
  if (!sawTracks) throw unreadable('No WebM tracks before the media data.')
  return file
}
