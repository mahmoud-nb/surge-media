import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCEPTED_MIME_TYPES, acceptedMimeTypes, CONVERTED_MIME_TYPES } from '../shared/utils/media'
import { codecLabel, videoMetadata, videoPlayback, videoSourceType } from '../shared/utils/video'
import { videoHandler } from '../server/lib/media/handlers/video'
import { largestSize, resolveUploadSizes, rulesFor, uploadRules } from '../server/lib/media/limits'
import { receiveUpload } from '../server/lib/media/upload'
import { detectMimeType, SNIFF_HEADER_BYTES } from '../server/lib/media/sniff'
import { av1CodecString, avcCodecString, hevcCodecString, mpeg4AudioCodec, vp9CodecString } from '../server/lib/media/video/codecs'
import { lastClusterEnd } from '../server/lib/media/video/ebml'
import { XMP_UUID } from '../server/lib/media/video/isobmff'
import { parseVideoPreparation, plannedSource, type PreparationOptions, type PreparationPlan, preparedStream, prepareVideo } from '../server/lib/media/video/prepare'
import { convertedContainerFor, convertedVideoMetadata, probeVideo, probeVideoFile, VideoProbeError } from '../server/lib/media/video/probe'
import { bufferSource } from '../server/lib/media/video/source'

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Fabrication de fichiers ISO BMFF (MP4, MOV) ─────────────────────────────

const u8 = (...values: number[]) => Buffer.from(values)
const u16 = (value: number) => {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16BE(value)
  return buffer
}
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0)
  return buffer
}
const i32 = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32BE(value)
  return buffer
}
const text = (value: string) => Buffer.from(value, 'latin1')

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  return Buffer.concat([u32(8 + body.length), text(type), body])
}
function fullBox(type: string, version: number, flags: number, ...parts: Buffer[]): Buffer {
  return box(type, u8(version, (flags >> 16) & 0xFF, (flags >> 8) & 0xFF, flags & 0xFF), ...parts)
}
const ftyp = (major: string, ...compatible: string[]) => box('ftyp', text(major), u32(0), ...compatible.map(text))
const mvhd = (timescale: number, duration: number) => fullBox('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(80))

const u64 = (value: number) => {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(value))
  return buffer
}

const MATRICES: Record<number, number[]> = { 0: [1, 0, 0, 1], 90: [0, 1, -1, 0], 180: [-1, 0, 0, -1], 270: [0, -1, 1, 0] }
function tkhd(width: number, height: number, { rotation = 0, enabled = true, id = 1 } = {}): Buffer {
  const [a, b, c, d] = MATRICES[rotation]!
  const matrix = Buffer.concat([i32(a! * 65536), i32(b! * 65536), u32(0), i32(c! * 65536), i32(d! * 65536), u32(0), u32(0), u32(0), u32(0x40000000)])
  return fullBox('tkhd', 0, enabled ? 3 : 0, u32(0), u32(0), u32(id), u32(0), u32(0), Buffer.alloc(8), u16(0), u16(0), u16(0), u16(0), matrix, u32(width * 65536), u32(height * 65536))
}
const mdhd = (timescale: number, duration: number) => fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55C4), u16(0))
const hdlr = (handler: string, componentType = '\0\0\0\0') => fullBox('hdlr', 0, 0, text(componentType), text(handler), Buffer.alloc(12), text('handler\0'))
function videoEntry(fourcc: string, width: number, height: number, ...children: Buffer[]): Buffer {
  return box(fourcc, Buffer.alloc(6), u16(1), Buffer.alloc(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), Buffer.alloc(32), u16(0x18), u16(0xFFFF), ...children)
}
function audioEntry(fourcc: string, version: number, ...children: Buffer[]): Buffer {
  const extension = version === 1 ? Buffer.alloc(16) : version === 2 ? Buffer.alloc(36) : Buffer.alloc(0)
  return box(fourcc, Buffer.alloc(6), u16(1), u16(version), u16(0), u32(0), u16(2), u16(16), u16(0), u16(0), u32(48000 * 65536), extension, ...children)
}
const avcC = (profile = 0x64, compatibility = 0x00, level = 0x1F) => box('avcC', u8(1, profile, compatibility, level, 0xFF, 0xE1))
/** AAC LC (type d'objet audio 2), 48 kHz, stéréo. */
const esds = (objectType = 0x40, audioObjectType = 2) => fullBox('esds', 0, 0, u8(
  0x03, 25, 0x00, 0x01, 0x00,
  0x04, 17, objectType, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0x05, 2, (audioObjectType << 3) | 0x01, 0x90,
  0x06, 1, 0x02,
))
const stsd = (entry: Buffer) => fullBox('stsd', 0, 0, u32(1), entry)

function track(handler: string, entry: Buffer, { width = 0, height = 0, rotation = 0, enabled = true, componentType = '\0\0\0\0', id = 1 } = {}): Buffer {
  return box('trak',
    tkhd(width, height, { rotation, enabled, id }),
    box('mdia', mdhd(30000, 300000), hdlr(handler, componentType), box('minf', box('stbl', stsd(entry), fullBox('stts', 0, 0, u32(0))))))
}
const h264Track = (width = 1920, height = 1080, options: { rotation?: number, enabled?: boolean } = {}) =>
  track('vide', videoEntry('avc1', width, height, avcC()), { width, height, ...options })
const aacTrack = () => track('soun', audioEntry('mp4a', 0, esds()))

interface Mp4Options {
  brand?: string[]
  tracks?: Buffer[]
  duration?: number
  extra?: Buffer[]
  moovFirst?: boolean
  mdat?: Buffer
}
function mp4({ brand = ['isom', 'isom', 'mp42'], tracks = [h264Track(), aacTrack()], duration = 12_345, extra = [], moovFirst = true, mdat = box('mdat', Buffer.alloc(4096, 7)) }: Mp4Options = {}): Buffer {
  const moov = box('moov', mvhd(1000, duration), ...tracks, ...extra)
  const [major, ...compatible] = brand
  return Buffer.concat(moovFirst ? [ftyp(major!, ...compatible), moov, mdat] : [ftyp(major!, ...compatible), mdat, moov])
}

const probe = (file: Buffer, mimeType = 'video/mp4') => probeVideo(bufferSource(file), mimeType)

// ─── Fabrication de fichiers WebM (EBML) ─────────────────────────────────────

function idBytes(id: number): Buffer {
  const bytes: number[] = []
  for (let value = id; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 0xFF)
  return Buffer.from(bytes)
}
function sizeBytes(size: number): Buffer {
  if (size < 0x7F) return u8(0x80 | size)
  if (size < 0x3FFF) return u8(0x40 | (size >> 8), size & 0xFF)
  return Buffer.concat([u8(0x10), Buffer.from([(size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF])])
}
const UNKNOWN_SIZE = u8(0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)
const el = (id: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts)
  return Buffer.concat([idBytes(id), sizeBytes(body.length), body])
}
const uintEl = (id: number, value: number) => el(id, value < 256 ? u8(value) : value < 65536 ? u16(value) : u32(value))
const strEl = (id: number, value: string) => el(id, text(value))
const floatEl = (id: number, value: number) => {
  const buffer = Buffer.alloc(8)
  buffer.writeDoubleBE(value)
  return el(id, buffer)
}

const ebmlHeader = (docType = 'webm') => el(0x1A45DFA3, uintEl(0x4286, 1), strEl(0x4282, docType), uintEl(0x4287, 4), uintEl(0x4285, 2))
const webmVideoTrack = (codec = 'V_VP9', width = 1280, height = 720, extra: Buffer[] = []) =>
  el(0xAE, uintEl(0xD7, 1), uintEl(0x83, 1), strEl(0x86, codec), ...extra, el(0xE0, uintEl(0xB0, width), uintEl(0xBA, height)))
const webmAudioTrack = (codec = 'A_OPUS') => el(0xAE, uintEl(0xD7, 2), uintEl(0x83, 2), strEl(0x86, codec))

/** WebM d'un enregistrement de navigateur : segment de taille inconnue, durée facultative, grappe de taille inconnue. */
function webm({ docType = 'webm', duration = 8_500 as number | null, tracks = [webmVideoTrack(), webmAudioTrack()] } = {}): Buffer {
  const info = el(0x1549A966, uintEl(0x2AD7B1, 1_000_000), ...(duration === null ? [] : [floatEl(0x4489, duration)]))
  const cluster = Buffer.concat([idBytes(0x1F43B675), UNKNOWN_SIZE, uintEl(0xE7, 0), Buffer.alloc(256, 1)])
  return Buffer.concat([ebmlHeader(docType), idBytes(0x18538067), UNKNOWN_SIZE, info, el(0x1654AE6B, ...tracks), cluster])
}

// ─── Détection du type ───────────────────────────────────────────────────────

describe('detectMimeType', () => {
  it('reconnaît MP4, MOV et WebM', () => {
    expect(detectMimeType(ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41'))).toBe('video/mp4')
    expect(detectMimeType(ftyp('mp42', 'isom', 'mp41', 'mp42'))).toBe('video/mp4')
    expect(detectMimeType(ftyp('M4V ', 'M4V ', 'M4A ', 'mp42', 'isom'))).toBe('video/mp4')
    expect(detectMimeType(ftyp('qt  ', 'qt  '))).toBe('video/quicktime')
    expect(detectMimeType(ebmlHeader('webm'))).toBe('video/webm')
  })

  it('garde l\'AVIF et refuse HEIF, audio seul, marques inconnues', () => {
    expect(detectMimeType(ftyp('avif', 'mif1', 'miaf'))).toBe('image/avif')
    expect(detectMimeType(ftyp('mif1', 'avif', 'miaf'))).toBe('image/avif')
    expect(detectMimeType(ftyp('heic', 'mif1', 'heic'))).toBeUndefined()
    expect(detectMimeType(ftyp('M4A ', 'M4A ', 'mp42', 'isom'))).toBeUndefined()
    expect(detectMimeType(ftyp('abcd', 'efgh'))).toBeUndefined()
    expect(detectMimeType(ebmlHeader('webvtt'))).toBeUndefined()
  })

  it('reste sûr sur des en-têtes tronqués ou vides', () => {
    expect(detectMimeType(Buffer.alloc(0))).toBeUndefined()
    expect(detectMimeType(ebmlHeader().subarray(0, 6))).toBeUndefined()
    expect(detectMimeType(ftyp('isom').subarray(0, 10))).toBeUndefined()
    expect(detectMimeType(u8(0x1A, 0x45, 0xDF, 0xA3, 0x00))).toBeUndefined()
    expect(detectMimeType(u8(0xFF, 0xD8, 0xFF, 0xE0))).toBe('image/jpeg')
    expect(detectMimeType(text('OggS'))).toBeUndefined()
    expect(detectMimeType(u8(0x47))).toBeUndefined()
  })
})

// ─── Formats convertis (phase D3) ────────────────────────────────────────────

const u16le = (value: number) => {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}
const u32le = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}

/** AVI : liste RIFF de forme `AVI ` ouverte par la liste d'en-têtes `hdrl` (`avih`). */
const aviHeader = (form = 'AVI ') => Buffer.concat([text('RIFF'), u32le(100_000), text(form), text('LIST'), u32le(68), text('hdrl'), text('avih'), u32le(56), Buffer.alloc(56)])
/** ASF (WMV) : objet d'en-tête (GUID, taille sur 64 bits, nombre d'objets, réservés). */
const ASF_GUID = Buffer.from('3026B2758E66CF11A6D900AA0062CE6C', 'hex')
const asfHeader = () => Buffer.concat([ASF_GUID, u32le(5000), u32le(0), u32le(6), u8(1, 2), Buffer.alloc(64)])

/** Page Ogg (RFC 3533) portant un seul paquet ; `bos` = page de début de flux. */
function oggPage(packet: Buffer, { bos = true, serial = 1 } = {}): Buffer {
  const lacing: number[] = []
  for (let rest = packet.length; ; rest -= 255) {
    lacing.push(Math.min(rest, 255))
    if (rest < 255) break
  }
  return Buffer.concat([text('OggS'), u8(0, bos ? 0x02 : 0x00), Buffer.alloc(8), u32le(serial), u32le(0), u32le(0), u8(lacing.length), Buffer.from(lacing), packet])
}
/** Paquets d'identification : Theora (42 octets), Vorbis, Opus ; squelette (Ogg Skeleton). */
const THEORA_HEADER = Buffer.concat([u8(0x80), text('theora'), u8(3, 2, 1), u16(40), u16(30), Buffer.alloc(29)])
const VORBIS_HEADER = Buffer.concat([u8(0x01), text('vorbis'), Buffer.alloc(23)])
const OPUS_HEADER = Buffer.concat([text('OpusHead'), u8(1, 2), Buffer.alloc(9)])
const SKELETON_HEADER = Buffer.concat([text('fishead\0'), u16le(3), u16le(0), Buffer.alloc(60)])

/** Paquet MPEG-TS (188 octets) : synchronisation 0x47, PID, compteur ; M2TS : horodatage de 4 octets en tête. */
const tsPacket = (pid: number, counter = 0) => Buffer.concat([u8(0x47, 0x40 | (pid >> 8), pid & 0xFF, 0x10 | (counter & 0x0F)), Buffer.alloc(184, 0xFF)])
const transportStream = (packets = 8) => Buffer.concat(Array.from({ length: packets }, (_, i) => tsPacket(i === 0 ? 0 : 0x100, i)))
const m2ts = (packets = 8) => Buffer.concat(Array.from({ length: packets }, (_, i) => Buffer.concat([u32(0x40000000 + i * 3003), tsPacket(i === 0 ? 0 : 0x1011, i)])))

describe('detectMimeType — formats convertis (D3)', () => {
  it('3GP / 3G2 d\'après la marque principale seulement', () => {
    expect(detectMimeType(ftyp('3gp4', 'isom', '3gp4'))).toBe('video/3gpp')
    expect(detectMimeType(ftyp('3gp5', '3gp5', 'isom'))).toBe('video/3gpp')
    expect(detectMimeType(ftyp('3ge6', '3ge6', '3gp6'))).toBe('video/3gpp')
    expect(detectMimeType(ftyp('3g2a', '3g2a', '3gp4'))).toBe('video/3gpp2')
    // MP4 courant citant 3GP parmi ses marques compatibles : reste un MP4.
    expect(detectMimeType(ftyp('isom', 'isom', '3gp4', 'mp41'))).toBe('video/mp4')
    expect(detectMimeType(ftyp('mp42', 'mp42', '3g2a'))).toBe('video/mp4')
  })

  it('Matroska, AVI, WMV', () => {
    expect(detectMimeType(ebmlHeader('matroska'))).toBe('video/x-matroska')
    expect(detectMimeType(webm({ docType: 'matroska' }))).toBe('video/x-matroska')
    expect(detectMimeType(aviHeader())).toBe('video/x-msvideo')
    expect(detectMimeType(aviHeader('WAVE'))).toBeUndefined()
    expect(detectMimeType(aviHeader('AVIX'))).toBeUndefined()
    expect(detectMimeType(asfHeader())).toBe('video/x-ms-wmv')
    const almost = asfHeader()
    almost[15] = 0x6D
    expect(detectMimeType(almost)).toBeUndefined()
  })

  it('Ogg : seulement avec un flux Theora parmi les pages de début', () => {
    expect(detectMimeType(Buffer.concat([oggPage(THEORA_HEADER), oggPage(VORBIS_HEADER, { serial: 2 })]))).toBe('video/ogg')
    // Squelette en tête (ffmpeg2theora), puis Theora et Vorbis.
    const skeleton = Buffer.concat([oggPage(SKELETON_HEADER), oggPage(THEORA_HEADER, { serial: 2 }), oggPage(VORBIS_HEADER, { serial: 3 })])
    expect(detectMimeType(skeleton)).toBe('video/ogg')
    // Paquet de plus de 255 octets : table de segments de plusieurs entrées.
    expect(detectMimeType(Buffer.concat([oggPage(Buffer.concat([SKELETON_HEADER, Buffer.alloc(300)])), oggPage(THEORA_HEADER, { serial: 2 })]))).toBe('video/ogg')
    // Audio seul (Vorbis, Opus) : non reconnu, même si une page suivante (hors début de flux) contient « \x80theora ».
    expect(detectMimeType(oggPage(VORBIS_HEADER))).toBeUndefined()
    expect(detectMimeType(oggPage(OPUS_HEADER))).toBeUndefined()
    expect(detectMimeType(Buffer.concat([oggPage(VORBIS_HEADER), oggPage(THEORA_HEADER, { bos: false })]))).toBeUndefined()
    // Page tronquée, ou dont la table de segments dépasse l'en-tête examiné.
    expect(detectMimeType(oggPage(THEORA_HEADER).subarray(0, 30))).toBeUndefined()
    expect(detectMimeType(Buffer.concat([text('OggS'), u8(0, 2), Buffer.alloc(20), u8(255), Buffer.alloc(10)]))).toBeUndefined()
  })

  it('MPEG-TS (188 octets) et M2TS / AVCHD (192 octets)', () => {
    expect(SNIFF_HEADER_BYTES).toBeGreaterThanOrEqual(4 * 192)
    expect(detectMimeType(transportStream().subarray(0, SNIFF_HEADER_BYTES))).toBe('video/mp2t')
    expect(detectMimeType(m2ts().subarray(0, SNIFF_HEADER_BYTES))).toBe('video/mp2t')
    // Fichier court : quatre paquets complets suffisent.
    expect(detectMimeType(transportStream(4))).toBe('video/mp2t')
    expect(detectMimeType(m2ts(4))).toBe('video/mp2t')
  })

  it('MPEG-TS : chaque paquet présent vérifié, un GIF jamais pris pour un flux de transport', () => {
    expect(detectMimeType(transportStream(3))).toBeUndefined()
    const broken = transportStream().subarray(0, SNIFF_HEADER_BYTES)
    broken[5 * 188] = 0x00
    expect(detectMimeType(broken)).toBeUndefined()
    // « G » (0x47) au début, sans répétition : un texte quelconque.
    expect(detectMimeType(Buffer.concat([text('GRIB'), Buffer.alloc(SNIFF_HEADER_BYTES - 4, 0x20)]))).toBeUndefined()
    // GIF dont les octets retombent sur 0x47 tous les 188 octets : reconnu comme GIF (examiné avant).
    const gif = Buffer.alloc(SNIFF_HEADER_BYTES)
    for (let offset = 0; offset < gif.length; offset += 188) gif[offset] = 0x47
    text('GIF89a').copy(gif)
    expect(detectMimeType(gif)).toBe('image/gif')
  })
})

// ─── Chaînes de codecs ───────────────────────────────────────────────────────

describe('chaînes de codecs RFC 6381', () => {
  it('H.264, H.265, AV1, VP9', () => {
    expect(avcCodecString('avc1', u8(1, 0x64, 0x00, 0x1F))).toBe('avc1.64001F')
    expect(avcCodecString('avc1', u8(1, 0x42))).toBeNull()
    const hvcC = Buffer.concat([u8(1, 0x01), u32(0x60000000), u8(0xB0, 0, 0, 0, 0, 0), u8(93), Buffer.alloc(10)])
    expect(hevcCodecString('hvc1', hvcC)).toBe('hvc1.1.6.L93.B0')
    const main10High = Buffer.concat([u8(1, 0x22), u32(0x20000000), Buffer.alloc(6), u8(120), Buffer.alloc(10)])
    expect(hevcCodecString('hev1', main10High)).toBe('hev1.2.4.H120')
    expect(av1CodecString(u8(0x81, 0x08, 0x00, 0x00))).toBe('av01.0.08M.08')
    expect(av1CodecString(u8(0x81, 0x2D, 0xC0, 0x00))).toBe('av01.1.13H.10')
    expect(av1CodecString(u8(0x01, 0x08, 0x00))).toBeNull()
    expect(vp9CodecString(u8(1, 0, 0, 0, 0, 31, 0x82))).toBe('vp09.00.31.08')
  })

  it('audio MPEG-4 : AAC, HE-AAC, MP3', () => {
    expect(mpeg4AudioCodec(esds().subarray(8))).toEqual({ codec: 'mp4a', string: 'mp4a.40.2' })
    expect(mpeg4AudioCodec(esds(0x40, 5).subarray(8))).toEqual({ codec: 'mp4a', string: 'mp4a.40.5' })
    expect(mpeg4AudioCodec(esds(0x6B).subarray(8))).toEqual({ codec: 'mp3', string: 'mp4a.6B' })
    expect(mpeg4AudioCodec(u8(0, 0, 0, 0, 0x09))).toEqual({ codec: 'mp4a', string: null })
  })
})

// ─── Analyse ISO BMFF ────────────────────────────────────────────────────────

describe('probeVideo — MP4 et MOV', () => {
  it('extrait dimensions, durée, codecs, débit et faststart', async () => {
    const file = mp4()
    const result = await probe(file)
    expect(result).toMatchObject({ width: 1920, height: 1080, duration: 12.345 })
    expect(result.metadata).toEqual({
      container: 'mp4',
      videoCodec: 'avc1',
      audioCodec: 'mp4a',
      codecs: 'avc1.64001F,mp4a.40.2',
      hasAudio: true,
      rotation: 0,
      bitrate: Math.round(file.length * 8 / 12.345),
      faststart: true,
      hasLocation: false,
      playback: 'broad',
      prepared: null,
      durationEstimated: false,
      dataTracks: [],
      hdr: null,
      rewrites: [],
    })
  })

  it('applique la rotation d\'une vidéo de téléphone (dimensions permutées)', async () => {
    for (const rotation of [90, 270]) {
      const result = await probe(mp4({ tracks: [h264Track(1920, 1080, { rotation })] }))
      expect(result).toMatchObject({ width: 1080, height: 1920, metadata: { rotation, hasAudio: false, codecs: 'avc1.64001F' } })
    }
    expect((await probe(mp4({ tracks: [h264Track(1920, 1080, { rotation: 180 })] }))).width).toBe(1920)
  })

  it('MOV : HEVC, son QuickTime (version 1, configuration dans « wave »), lieu de tournage', async () => {
    const hvcC = box('hvcC', Buffer.concat([u8(1, 0x01), u32(0x60000000), u8(0xB0, 0, 0, 0, 0, 0), u8(93), Buffer.alloc(10)]))
    const wave = box('wave', box('frma', text('mp4a')), esds())
    const location = box('udta', box('©xyz', u16(17), u16(0x15C7), text('+48.8584+002.2945/')))
    const file = mp4({
      brand: ['qt  ', 'qt  '],
      tracks: [
        track('vide', videoEntry('hvc1', 3840, 2160, hvcC), { width: 3840, height: 2160, rotation: 90, componentType: 'mhlr' }),
        track('soun', audioEntry('mp4a', 1, wave), { componentType: 'mhlr' }),
      ],
      extra: [location],
    })
    const result = await probe(file, 'video/quicktime')
    expect(result).toMatchObject({ width: 2160, height: 3840 })
    expect(result.metadata).toMatchObject({
      container: 'mov',
      videoCodec: 'hvc1',
      codecs: 'hvc1.1.6.L93.B0,mp4a.40.2',
      hasLocation: true,
      playback: 'variable',
    })
  })

  it('lieu de tournage dans les métadonnées QuickTime (clés) ou un élément « ©xyz »', async () => {
    const keys = box('keys', u32(0), u32(1), u32(8 + 36), text('mdta'), text('com.apple.quicktime.location.ISO6709'))
    expect((await probe(mp4({ extra: [box('meta', hdlr('mdta'), keys)] }))).metadata.hasLocation).toBe(true)
    const ilst = box('ilst', box('©xyz', box('data', u32(1), u32(0), text('+48.85+002.29/'))))
    expect((await probe(mp4({ extra: [box('udta', fullBox('meta', 0, 0, hdlr('mdir'), ilst))] }))).metadata.hasLocation).toBe(true)
    expect((await probe(mp4({ extra: [box('udta', box('©too', text('encoder')))] }))).metadata.hasLocation).toBe(false)
  })

  it('lieu de tournage dans un paquet XMP (boîte « uuid » de premier niveau, « udta/XMP_ »)', async () => {
    const packet = text('<x:xmpmeta><rdf:Description exif:GPSLatitude="48,51.4N" exif:GPSLongitude="2,21.1E"/></x:xmpmeta>')
    const top = Buffer.concat([mp4({ moovFirst: false }), box('uuid', XMP_UUID, packet)])
    expect((await probe(top)).metadata.hasLocation).toBe(true)
    expect((await probe(mp4({ extra: [box('udta', box('XMP_', packet))] }))).metadata.hasLocation).toBe(true)
    const noGps = Buffer.concat([mp4(), box('uuid', XMP_UUID, text('<x:xmpmeta xmp:CreatorTool="Editor"/>'))])
    expect((await probe(noGps)).metadata.hasLocation).toBe(false)
  })

  it('index en fin de fichier : faststart faux', async () => {
    const result = await probe(mp4({ moovFirst: false }))
    expect(result.metadata.faststart).toBe(false)
    expect(result.duration).toBe(12.345)
  })

  it('MP4 fragmenté : durée de « mehd », parcours arrêté au premier fragment', async () => {
    const mvex = box('mvex', fullBox('mehd', 0, 0, u32(60_000)), fullBox('trex', 0, 0, Buffer.alloc(20)))
    const moov = box('moov', mvhd(1000, 0), h264Track(), mvex)
    const fragments = Array.from({ length: 12_000 }, () => box('moof', box('mfhd', u32(0), u32(1))))
    const result = await probe(Buffer.concat([ftyp('iso5', 'iso5', 'dash'), moov, ...fragments]))
    expect(result.duration).toBe(60)
    expect(result.metadata.faststart).toBe(true)
  })

  it('MP4 fragmenté sans « mehd » (enregistrement de navigateur) : fin du dernier fragment', async () => {
    const trex = (id: number, duration: number) => fullBox('trex', 0, 0, u32(id), u32(1), u32(duration), u32(0), u32(0))
    const moov = box('moov', mvhd(1000, 0), h264Track(), track('soun', audioEntry('mp4a', 0, esds()), { id: 2 }), box('mvex', trex(1, 10_000), trex(2, 1024)))
    // Piste 1 : durées par échantillon (drapeau 0x100) ; piste 2 : durée par défaut de trex.
    const traf = (id: number, start: number, perSample: number[] | null, count = 0) => box('traf',
      fullBox('tfhd', 0, 0x020000, u32(id)),
      fullBox('tfdt', 1, 0, u64(start)),
      perSample
        ? fullBox('trun', 0, 0x000101, u32(perSample.length), u32(0), ...perSample.map(u32))
        : fullBox('trun', 0, 0x000001, u32(count), u32(0)))
    const fragment = (index: number) => Buffer.concat([
      box('moof', fullBox('mfhd', 0, 0, u32(index + 1)), traf(1, index * 30_000, [10_000, 10_000, 10_000]), traf(2, index * 30_000, null, 29)),
      box('mdat', Buffer.alloc(64)),
    ])
    const file = Buffer.concat([ftyp('iso5', 'iso5', 'mp41'), moov, fragment(0), fragment(1), fragment(2)])
    // Vidéo : 60000 + 30000 = 90000 / 30000 = 3 s ; audio : 60000 + 29 × 1024 = 89696, moins long.
    const result = await probe(file)
    expect(result.duration).toBe(3)
    expect(result.metadata.bitrate).toBe(Math.round(file.length * 8 / 3))
    // Fragment illisible : durée inconnue, jamais de refus du fichier.
    const broken = Buffer.concat([ftyp('iso5', 'iso5'), moov, box('moof', box('traf', fullBox('tfhd', 0, 0, u32(1)), fullBox('trun', 0, 0x000100, u32(500), u32(1))))])
    expect((await probe(broken)).duration).toBeNull()
  })

  it('durée inconnue : null, débit inconnu', async () => {
    const result = await probe(mp4({ duration: 0, tracks: [track('vide', videoEntry('avc1', 640, 360, avcC()), { width: 640, height: 360 })].map(t => t) }))
    // Durée de la piste (mdhd : 300000 / 30000 = 10 s) en repli.
    expect(result.duration).toBe(10)
    const unknown = await probe(Buffer.concat([ftyp('isom', 'isom'), box('moov', mvhd(1000, 0), box('trak', tkhd(640, 360), box('mdia', mdhd(0, 0), hdlr('vide'), box('minf', box('stbl', stsd(videoEntry('avc1', 640, 360, avcC())))))))]))
    expect(unknown.duration).toBeNull()
    expect(unknown.metadata.bitrate).toBeNull()
  })

  it('dimensions codées en repli, piste désactivée ignorée, boîte 64 bits, mdat jusqu\'à la fin', async () => {
    const coded = await probe(mp4({ tracks: [track('vide', videoEntry('avc1', 1280, 720, avcC()), { width: 0, height: 0 })] }))
    expect(coded).toMatchObject({ width: 1280, height: 720 })
    const disabled = await probe(mp4({ tracks: [h264Track(320, 240, { enabled: false }), h264Track(1280, 720)] }))
    expect(disabled.width).toBe(1280)
    const large = Buffer.concat([u32(1), text('free'), Buffer.from([0, 0, 0, 0, 0, 0, 0, 24]), Buffer.alloc(8)])
    const toEnd = Buffer.concat([u32(0), text('mdat'), Buffer.alloc(100)])
    const result = await probe(Buffer.concat([ftyp('isom', 'isom'), large, box('moov', mvhd(1000, 5000), h264Track()), toEnd]))
    expect(result).toMatchObject({ width: 1920, duration: 5, metadata: { faststart: true } })
  })

  it('MP4 tronqué : données (mdat) tolérées, structures refusées', async () => {
    const file = mp4()
    expect((await probe(file.subarray(0, file.length - 100))).width).toBe(1920)
    const cut = mp4({ moovFirst: false })
    await expect(probe(cut.subarray(0, cut.length - 40))).rejects.toMatchObject({ reason: 'unreadable' })
  })

  it('refuse les fichiers sans piste vidéo ou incohérents', async () => {
    await expect(probe(mp4({ tracks: [aacTrack()] }))).rejects.toMatchObject({ reason: 'no-video' })
    await expect(probe(Buffer.concat([ftyp('isom', 'isom'), box('mdat', Buffer.alloc(10))]))).rejects.toMatchObject({ reason: 'unreadable' })
    // Taille d'une boîte plus petite que son en-tête, ou débordant de son parent.
    await expect(probe(Buffer.concat([ftyp('isom', 'isom'), u32(4), text('moov')]))).rejects.toBeInstanceOf(VideoProbeError)
    const overflow = Buffer.concat([ftyp('isom', 'isom'), u32(16), text('moov'), u32(64), text('trak'), Buffer.alloc(4)])
    await expect(probe(overflow)).rejects.toMatchObject({ reason: 'unreadable' })
    // Dimensions absurdes (rien n'est décodé : contrôle de cohérence).
    await expect(probe(mp4({ tracks: [h264Track(40_000, 20_000)] }))).rejects.toMatchObject({ reason: 'unreadable' })
    await expect(probe(mp4({ tracks: [track('vide', videoEntry('avc1', 0, 0, avcC()), { width: 0, height: 0 })] }))).rejects.toMatchObject({ reason: 'unreadable' })
  })

  it('borne le nombre de boîtes lues (fichier hostile)', async () => {
    const free = Array.from({ length: 10_001 }, () => box('free'))
    await expect(probe(Buffer.concat([ftyp('isom', 'isom'), box('moov', mvhd(1000, 1000), ...free)]))).rejects.toMatchObject({ reason: 'unreadable' })
  })

  it('compatibilité : H.264 + MP3 large, AC-3 variable, ProRes variable', async () => {
    const mp3 = track('soun', audioEntry('mp4a', 0, esds(0x6B)))
    expect((await probe(mp4({ tracks: [h264Track(), mp3] }))).metadata).toMatchObject({ audioCodec: 'mp3', codecs: 'avc1.64001F,mp4a.6B', playback: 'broad' })
    const ac3 = track('soun', audioEntry('ac-3', 0, box('dac3', u8(0x10, 0x3D, 0xE0))))
    expect((await probe(mp4({ tracks: [h264Track(), ac3] }))).metadata).toMatchObject({ audioCodec: 'ac-3', codecs: 'avc1.64001F,ac-3', playback: 'variable' })
    const prores = track('vide', videoEntry('apcn', 1920, 1080), { width: 1920, height: 1080 })
    expect((await probe(mp4({ brand: ['qt  ', 'qt  '], tracks: [prores] }), 'video/quicktime')).metadata).toMatchObject({ videoCodec: 'apcn', codecs: null, playback: 'variable' })
  })
})

// ─── Pistes de données de l'appareil (phase D3) ──────────────────────────────

/** Entrée d'échantillon générique (piste de métadonnées) : réservé (6), index de référence (2). */
const dataEntry = (fourcc: string) => box(fourcc, Buffer.alloc(6), u16(1))
const dataTrack = (handler: string, fourcc: string, id: number, options: { enabled?: boolean } = {}) => track(handler, dataEntry(fourcc), { id, ...options })

describe('probeVideo — pistes de données de l\'appareil (D3)', () => {
  const dataTracksOf = async (tracks: Buffer[], mimeType = 'video/mp4') =>
    (await probe(mp4({ tracks: [h264Track(), aacTrack(), ...tracks] }), mimeType)).metadata.dataTracks

  it('GoPro, caméras 360°, iPhone, DJI, Sony : code du format d\'échantillon', async () => {
    // GoPro : GPMF (`gpmd`), code temporel ignoré, piste de secours `fdsc` (gestionnaire `meta` seul).
    expect(await dataTracksOf([dataTrack('tmcd', 'tmcd', 3), dataTrack('meta', 'gpmd', 4), dataTrack('meta', 'fdsc', 5)])).toEqual(['gpmd', 'meta'])
    expect(await dataTracksOf([dataTrack('camm', 'camm', 3)])).toEqual(['camm'])
    // iPhone : plusieurs pistes `mebx`, désactivées, listées une fois.
    expect(await dataTracksOf([dataTrack('meta', 'mebx', 3, { enabled: false }), dataTrack('meta', 'mebx', 4, { enabled: false })], 'video/quicktime')).toEqual(['mebx'])
    expect(await dataTracksOf([dataTrack('meta', 'djmd', 3), dataTrack('meta', 'dbgi', 4)])).toEqual(['djmd', 'dbgi'])
    expect(await dataTracksOf([dataTrack('meta', 'rtmd', 3), dataTrack('meta', 'mett', 4)])).toEqual(['rtmd', 'mett'])
    // Format connu sous un gestionnaire inhabituel ; gestionnaire de données sans format connu.
    expect(await dataTracksOf([dataTrack('gpmf', 'gpmd', 3), dataTrack('data', 'xyz1', 4)])).toEqual(['gpmd', 'data'])
  })

  it('pistes lues ou gérées ailleurs ignorées : diffusion, code temporel, texte, sous-titres', async () => {
    expect(await dataTracksOf([
      dataTrack('hint', 'rtp ', 3),
      dataTrack('tmcd', 'tmcd', 4),
      dataTrack('text', 'text', 5),
      dataTrack('sbtl', 'tx3g', 6),
      dataTrack('subt', 'stpp', 7),
      dataTrack('clcp', 'c608', 8),
      dataTrack('odsm', 'mp4s', 9),
    ])).toEqual([])
    // La présence d'une piste de données ne change ni la piste lue ni la compatibilité.
    const result = await probe(mp4({ tracks: [dataTrack('meta', 'gpmd', 2), h264Track(), aacTrack()] }))
    expect(result.metadata).toMatchObject({ videoCodec: 'avc1', audioCodec: 'mp4a', playback: 'broad', dataTracks: ['gpmd'] })
  })

  it('WebM : aucune piste de données', async () => {
    expect((await probe(webm(), 'video/webm')).metadata).toMatchObject({ dataTracks: [], hdr: null, rewrites: [] })
  })
})

// ─── Vidéos converties (phase D3) ────────────────────────────────────────────

describe('vidéos converties (D3)', () => {
  it('conteneur d\'un type détecté', () => {
    expect(convertedContainerFor('video/x-matroska')).toBe('mkv')
    expect(convertedContainerFor('video/3gpp2')).toBe('3gp')
    for (const mimeType of CONVERTED_MIME_TYPES) expect(convertedContainerFor(mimeType)).not.toBeNull()
    for (const mimeType of ['video/mp4', 'video/quicktime', 'video/webm', 'image/png', 'constructor', '__proto__']) {
      expect(convertedContainerFor(mimeType)).toBeNull()
    }
  })

  it('jamais lues par le lecteur d\'en-têtes', async () => {
    for (const mimeType of CONVERTED_MIME_TYPES) {
      await expect(probe(mp4(), mimeType)).rejects.toMatchObject({ reason: 'unreadable' })
    }
    await expect(probe(webm({ docType: 'matroska' }), 'video/x-matroska')).rejects.toMatchObject({ reason: 'unreadable' })
    await expect(probe(mp4(), 'constructor')).rejects.toMatchObject({ reason: 'unreadable' })
  })

  it('à l\'envoi : rien de lu, tout inconnu jusqu\'à l\'analyse par ffprobe, aucune préparation', async () => {
    // Chemin inexistant : la preuve qu'aucun octet n'est lu.
    const inspected = await videoHandler.inspect('/nonexistent/surge-media/clip.mkv', 'video/x-matroska')
    expect(inspected).toEqual({
      width: null,
      height: null,
      duration: null,
      metadata: {
        container: 'mkv',
        videoCodec: null,
        audioCodec: null,
        codecs: null,
        hasAudio: false,
        rotation: 0,
        bitrate: null,
        faststart: null,
        hasLocation: false,
        playback: 'none',
        prepared: [],
        durationEstimated: false,
        dataTracks: [],
        hdr: null,
        rewrites: [],
      },
    })
    expect(await videoHandler.prepare!('/nonexistent/surge-media/clip.mkv', 'video/x-matroska', inspected)).toEqual({ inspected, file: null })
    // Relue depuis la colonne JSON : identique, jamais lue par `<video>`.
    expect(videoMetadata(JSON.parse(JSON.stringify(inspected.metadata)))).toEqual(convertedVideoMetadata('mkv'))
    for (const mimeType of CONVERTED_MIME_TYPES) {
      const { metadata } = await videoHandler.inspect('/nonexistent', mimeType)
      expect(videoMetadata(metadata)).toMatchObject({ container: convertedContainerFor(mimeType), playback: 'none', videoCodec: null })
    }
  })
})

// ─── Analyse WebM ────────────────────────────────────────────────────────────

describe('probeVideo — WebM', () => {
  it('enregistrement de navigateur : segment et grappe de taille inconnue', async () => {
    const result = await probe(webm(), 'video/webm')
    expect(result).toMatchObject({ width: 1280, height: 720, duration: 8.5 })
    expect(result.metadata).toMatchObject({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', codecs: 'vp9,opus', faststart: null, rotation: 0, playback: 'broad' })
  })

  it('durée absente (MediaRecorder) : null', async () => {
    const result = await probe(webm({ duration: null, tracks: [webmVideoTrack('V_VP8', 640, 480)] }), 'video/webm')
    expect(result).toMatchObject({ width: 640, duration: null, metadata: { videoCodec: 'vp8', hasAudio: false, codecs: 'vp8', bitrate: null, durationEstimated: false } })
  })

  it('taille d\'affichage, AV1 et H.264 (CodecPrivate)', async () => {
    const display = el(0xE0, uintEl(0xB0, 1440), uintEl(0xBA, 1080), uintEl(0x54B0, 1920), uintEl(0x54BA, 1080))
    const anamorphic = el(0xAE, uintEl(0x83, 1), strEl(0x86, 'V_VP9'), display)
    expect((await probe(webm({ tracks: [anamorphic] }), 'video/webm')).width).toBe(1920)
    const av1 = webmVideoTrack('V_AV1', 1920, 1080, [el(0x63A2, u8(0x81, 0x08, 0x00, 0x00))])
    expect((await probe(webm({ tracks: [av1] }), 'video/webm')).metadata).toMatchObject({ videoCodec: 'av01', codecs: 'av01.0.08M.08', playback: 'variable' })
    const h264 = webmVideoTrack('V_MPEG4/ISO/AVC', 1920, 1080, [el(0x63A2, u8(1, 0x42, 0xC0, 0x1E))])
    expect((await probe(webm({ tracks: [h264, webmAudioTrack()] }), 'video/webm')).metadata).toMatchObject({ videoCodec: 'avc1', codecs: 'avc1.42C01E,opus', playback: 'variable' })
  })

  it('refuse un Matroska présenté comme WebM, l\'audio seul et un en-tête incohérent', async () => {
    await expect(probe(webm({ docType: 'matroska' }), 'video/webm')).rejects.toMatchObject({ reason: 'unreadable' })
    await expect(probe(webm({ tracks: [webmAudioTrack()] }), 'video/webm')).rejects.toMatchObject({ reason: 'no-video' })
    await expect(probe(Buffer.concat([ebmlHeader(), u8(0x00, 0x00, 0x00)]), 'video/webm')).rejects.toMatchObject({ reason: 'unreadable' })
    const tracksAfterData = Buffer.concat([ebmlHeader(), idBytes(0x18538067), UNKNOWN_SIZE, el(0x1F43B675, Buffer.alloc(8)), el(0x1654AE6B, webmVideoTrack())])
    await expect(probe(tracksAfterData, 'video/webm')).rejects.toMatchObject({ reason: 'unreadable' })
  })
})

describe('probeVideoFile', () => {
  it('lit un fichier par positions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'surge-media-video-test-'))
    try {
      const path = join(directory, 'clip.mp4')
      await writeFile(path, mp4({ moovFirst: false, mdat: box('mdat', Buffer.alloc(3 * 1024 * 1024, 1)) }))
      const result = await probeVideoFile(path, 'video/mp4')
      expect(result).toMatchObject({ width: 1920, height: 1080, metadata: { faststart: false } })
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

// ─── Limites par genre ───────────────────────────────────────────────────────

describe('limites d\'envoi par genre', () => {
  it('défauts, valeurs invalides, plafond', () => {
    const warnings: string[] = []
    expect(resolveUploadSizes({})).toEqual({ IMAGE: 25 * 1024 * 1024, VIDEO: 512 * 1024 * 1024 })
    expect(resolveUploadSizes({ IMAGE: 1000, VIDEO: '2000' })).toEqual({ IMAGE: 1000, VIDEO: 2000 })
    expect(resolveUploadSizes({ IMAGE: -5, VIDEO: 4 * 1024 ** 3 }, message => warnings.push(message))).toEqual({ IMAGE: 25 * 1024 * 1024, VIDEO: 2_147_483_647 })
    expect(warnings).toHaveLength(2)
  })

  it('taille selon le type, plafond d\'un jeton délégué, plus grande limite', () => {
    const sizes = { IMAGE: 100, VIDEO: 1000 }
    const rules = rulesFor(sizes)
    expect(rules.acceptedTypes).toEqual(ACCEPTED_MIME_TYPES)
    expect(rules.maxSizeFor('image/png')).toBe(100)
    expect(rules.maxSizeFor('video/webm')).toBe(1000)
    expect(rules.maxSizeFor('application/pdf')).toBe(0)
    expect(largestSize(rules)).toBe(1000)
    const capped = rulesFor(sizes, ['image/png', 'video/mp4'], 500)
    expect(capped.acceptedTypes).toEqual(['image/png', 'video/mp4'])
    expect(capped.maxSizeFor('video/mp4')).toBe(500)
    expect(capped.maxSizeFor('image/png')).toBe(100)
    expect(largestSize(rulesFor(sizes, ['image/jpeg']))).toBe(100)
  })

  it('types restreints, jamais élargis : intersection avec les types de l\'installation (D3)', () => {
    const sizes = { IMAGE: 100, VIDEO: 1000 }
    const active = acceptedMimeTypes(true)
    // Jeton qui cite le MKV, traitement inactif : le MKV reste refusé.
    expect(rulesFor(sizes, ['video/x-matroska', 'video/mp4']).acceptedTypes).toEqual(['video/mp4'])
    // Aucun type restant : plus grande limite nulle (la réception refuse alors d'emblée en 415, voir plus bas).
    expect(largestSize(rulesFor(sizes, ['video/x-matroska']))).toBe(0)
    // Traitement actif : ordre des types de l'installation, quel que soit celui du jeton.
    expect(rulesFor(sizes, ['video/x-matroska', 'video/mp4'], undefined, active).acceptedTypes).toEqual(['video/mp4', 'video/x-matroska'])
    // Affiche : seules des images, même quand l'installation accepte les vidéos converties.
    expect(rulesFor(sizes, ['image/jpeg', 'image/png'], undefined, active).acceptedTypes).toEqual(['image/jpeg', 'image/png'])
    // Sans restriction : tous les types de l'installation ; limite des vidéos pour les formats convertis.
    const all = rulesFor(sizes, undefined, undefined, active)
    expect(all.acceptedTypes).toEqual(active)
    for (const type of CONVERTED_MIME_TYPES) expect(all.maxSizeFor(type)).toBe(1000)
    expect(largestSize(all)).toBe(1000)
    expect(rulesFor(sizes, ['video/ogg'], 500, active).maxSizeFor('video/ogg')).toBe(500)
  })

  it('règles de l\'installation : limites configurées, types de base transmis', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ media: { maxUploadSize: 100, maxVideoUploadSize: 1000 } }))
    const active = uploadRules(['image/png', 'video/x-ms-wmv', 'application/pdf'], 800, acceptedMimeTypes(true))
    expect(active.acceptedTypes).toEqual(['image/png', 'video/x-ms-wmv'])
    expect(active.maxSizeFor('video/x-ms-wmv')).toBe(800)
    expect(active.maxSizeFor('image/png')).toBe(100)
    expect(uploadRules(['image/png', 'video/x-ms-wmv']).acceptedTypes).toEqual(['image/png'])
    expect(uploadRules().acceptedTypes).toEqual(ACCEPTED_MIME_TYPES)
    expect(largestSize(uploadRules(undefined, undefined, acceptedMimeTypes(true)))).toBe(1000)
  })

  it('réception sans type admis : 415 d\'emblée, jamais un 413 « 0 octet » (D3)', async () => {
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string, data: unknown }) => Object.assign(new Error(input.statusMessage), input))
    const sizes = { IMAGE: 100, VIDEO: 1000 }
    // Jeton limité au MKV, traitement des vidéos inactif. La requête factice n'a pas de flux : tout
    // essai de lecture du corps échouerait autrement (TypeError) — le refus précède toute lecture.
    const request = (headers: Record<string, string>) => ({ node: { req: { headers } } }) as unknown as Parameters<typeof receiveUpload>[0]
    const multipart = { 'content-type': 'multipart/form-data; boundary=x' }
    const none = rulesFor(sizes, ['video/x-matroska'])
    const unsupported = { statusCode: 415, data: { code: 'UNSUPPORTED_TYPE', accepted: [] } }
    // Corps annoncé au-delà de la marge multipart (64 Kio), ou sans taille annoncée : même refus.
    await expect(receiveUpload(request({ ...multipart, 'content-length': String(10 * 1024 * 1024) }), none)).rejects.toMatchObject(unsupported)
    await expect(receiveUpload(request(multipart), none)).rejects.toMatchObject(unsupported)
    // Un corps qui n'est pas multipart reste une requête invalide (400), avant les types.
    await expect(receiveUpload(request({ 'content-type': 'application/json' }), none)).rejects.toMatchObject({ statusCode: 400, data: { code: 'MULTIPART_REQUIRED' } })
    // Avec un type admis, la même taille annoncée reste refusée par le pré-contrôle (413, limite des vidéos).
    const mp4 = rulesFor(sizes, ['video/x-matroska', 'video/mp4'])
    await expect(receiveUpload(request({ ...multipart, 'content-length': String(10 * 1024 * 1024) }), mp4)).rejects.toMatchObject({ statusCode: 413, data: { code: 'FILE_TOO_LARGE', maxSize: 1000 } })
  })
})

// ─── Métadonnées partagées ───────────────────────────────────────────────────

describe('métadonnées vidéo (partagées)', () => {
  it('compatibilité de lecture', () => {
    expect(videoPlayback('mp4', 'avc1', 'mp4a')).toBe('broad')
    expect(videoPlayback('mov', 'avc1', null)).toBe('broad')
    expect(videoPlayback('mp4', 'hvc1', 'mp4a')).toBe('variable')
    expect(videoPlayback('webm', 'vp9', 'opus')).toBe('broad')
    expect(videoPlayback('webm', 'vp8', 'mp4a')).toBe('variable')
    expect(videoPlayback('webm', 'av01', null)).toBe('variable')
    // Conteneurs convertis (D3) : jamais lus tels quels, quels que soient les codecs.
    expect(videoPlayback('mkv', 'avc1', 'mp4a')).toBe('none')
    expect(videoPlayback('3gp', 'avc1', null)).toBe('none')
    expect(videoPlayback('ts', null, null)).toBe('none')
  })

  it('champs de la phase D3 : pistes de données, HDR, réécritures, conteneurs convertis', () => {
    expect(videoMetadata({ container: 'mp4', videoCodec: 'avc1' })).toMatchObject({ dataTracks: [], hdr: null, rewrites: [] })
    expect(videoMetadata({ container: 'mov', videoCodec: 'hvc1', dataTracks: ['mebx', 3, null, 'gpmd'], hdr: 'hlg', rewrites: ['webmIndex', 'oops', 'dataTracks'] }))
      .toMatchObject({ dataTracks: ['mebx', 'gpmd'], hdr: 'hlg', rewrites: ['dataTracks', 'webmIndex'] })
    expect(videoMetadata({ container: 'mp4', videoCodec: 'avc1', dataTracks: 'gpmd', hdr: 'dolby', rewrites: 'webmIndex' })).toMatchObject({ dataTracks: [], hdr: null, rewrites: [] })
    // Converti : codec vidéo inconnu tant que ffprobe ne l'a pas lu ; jamais lu par `<video>`.
    expect(videoMetadata({ container: 'avi', videoCodec: null, playback: 'broad' })).toMatchObject({ container: 'avi', videoCodec: null, playback: 'none' })
    expect(videoMetadata({ container: 'wmv', videoCodec: 'wmv3', playback: 'variable' })?.playback).toBe('none')
    expect(videoMetadata({ container: 'mp4', videoCodec: null })).toBeNull()
    expect(videoMetadata({ container: 'flv', videoCodec: 'flv1' })).toBeNull()
  })

  it('libellés, lecture de la colonne JSON, type d\'une source', () => {
    expect(codecLabel('avc1')).toBe('H.264')
    expect(codecLabel('hev1')).toBe('H.265 (HEVC)')
    expect(codecLabel('xyz1')).toBe('XYZ1')
    expect(videoMetadata(null)).toBeNull()
    expect(videoMetadata({ format: 'jpeg' })).toBeNull()
    expect(videoMetadata({ container: 'webm', videoCodec: 'vp8', playback: 'oops' })).toMatchObject({ audioCodec: null, rotation: 0, faststart: null, playback: 'variable', prepared: null, durationEstimated: false })
    expect(videoMetadata({ container: 'mp4', videoCodec: 'avc1', prepared: ['metadata', 'oops', 'faststart'] })?.prepared).toEqual(['faststart', 'metadata'])
    expect(videoMetadata({ container: 'mp4', videoCodec: 'avc1', prepared: [] })?.prepared).toEqual([])
    expect(videoSourceType('video/mp4', 'avc1.64001F,mp4a.40.2')).toBe('video/mp4; codecs="avc1.64001F, mp4a.40.2"')
    expect(videoSourceType('video/webm', null)).toBe('video/webm')
  })
})

// ─── Enregistrements réels ───────────────────────────────────────────────────

/**
 * Fichiers produits par `MediaRecorder` (Chromium 152, animation sur canvas, 160 × 90, 2 s) : formats
 * réels des applications qui enregistrent dans le navigateur avant d'envoyer (segment WebM de taille
 * inconnue sans durée, MP4 fragmenté sans `mehd`).
 */
describe('enregistrements réels de navigateur', () => {
  const fixture = (name: string) => readFile(new URL(`./fixtures/video/${name}`, import.meta.url))

  it('WebM VP9 + Opus', async () => {
    const file = await fixture('recorder-vp9-opus.webm')
    expect(detectMimeType(file.subarray(0, SNIFF_HEADER_BYTES))).toBe('video/webm')
    const result = await probe(file, 'video/webm')
    expect(result).toMatchObject({ width: 160, height: 90 })
    // Pas de durée dans le fichier : estimée par le dernier « Cluster » (2 s enregistrées).
    expect(result.duration).toBeCloseTo(1.985, 3)
    expect(result.metadata).toMatchObject({ videoCodec: 'vp9', audioCodec: 'opus', codecs: 'vp9,opus', playback: 'broad', durationEstimated: true })
  })

  it('WebM VP8 sans son', async () => {
    const result = await probe(await fixture('recorder-vp8.webm'), 'video/webm')
    expect(result).toMatchObject({ width: 160, height: 90, metadata: { videoCodec: 'vp8', hasAudio: false, codecs: 'vp8', durationEstimated: true } })
    // Une seule grappe, de taille inconnue, faite de « BlockGroup ».
    expect(result.duration).toBeCloseTo(1.96, 3)
  })

  it('MP4 fragmenté H.264 + AAC : durée tirée des fragments', async () => {
    const file = await fixture('recorder-h264-aac.mp4')
    expect(detectMimeType(file.subarray(0, SNIFF_HEADER_BYTES))).toBe('video/mp4')
    const result = await probe(file)
    expect(result).toMatchObject({ width: 160, height: 90 })
    expect(result.duration).toBeCloseTo(2, 0)
    expect(result.metadata).toMatchObject({ videoCodec: 'avc1', audioCodec: 'mp4a', codecs: 'avc1.42C00C,mp4a.40.2', faststart: true, playback: 'broad' })
    // Fragmenté : index déjà en tête, gardé tel quel par la préparation.
    expect(await prepareVideo(bufferSource(file), 'video/mp4', { faststart: true, metadata: true })).toEqual({ status: 'skipped', reason: 'fragmented file' })
  })
})

// ─── Préparation à l'envoi (phase D2) ────────────────────────────────────────

const stco = (offsets: number[]) => fullBox('stco', 0, 0, u32(offsets.length), ...offsets.map(u32))
const co64 = (offsets: number[]) => fullBox('co64', 0, 0, u32(offsets.length), ...offsets.map(u64))
const dref = (flags = 1) => fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, flags))

interface ChunkTrackOptions {
  id?: number
  width?: number
  height?: number
  rotation?: number
  wide?: boolean
  stbl?: Buffer[]
  drefFlags?: number
  udta?: Buffer[]
}
function chunkTrack(handler: string, entry: Buffer, offsets: number[], { id = 1, width = 0, height = 0, rotation = 0, wide = false, stbl = [], drefFlags = 1, udta = [] }: ChunkTrackOptions = {}): Buffer {
  return box('trak',
    tkhd(width, height, { rotation, id }),
    box('mdia', mdhd(30000, 300000), hdlr(handler), box('minf',
      box('dinf', dref(drefFlags)),
      box('stbl', stsd(entry), fullBox('stts', 0, 0, u32(0)), wide ? co64(offsets) : stco(offsets), ...stbl))),
    ...udta)
}

/** Élément d'une liste QuickTime (`ilst` d'un `meta` de clés) : numéro de clé, valeur texte. */
function keyItem(index: number, value: string): Buffer {
  const data = box('data', u32(1), u32(0), text(value))
  return Buffer.concat([u32(8 + data.length), u32(index), data])
}
/** `meta` QuickTime à clés (`mdta`), sans version : chaque clé a sa valeur. */
function keysMeta(entries: [string, string][]): Buffer {
  const keys = fullBox('keys', 0, 0, u32(entries.length), ...entries.map(([name]) => box('mdta', text(name))))
  return box('meta', hdlr('mdta'), keys, box('ilst', ...entries.map(([, value], i) => keyItem(i + 1, value))))
}
const itunesItem = (type: string, value: string) => box(type, box('data', u32(1), u32(0), text(value)))
const GPS_XMP = text('<x:xmpmeta><rdf:Description exif:GPSLatitude="48,51.4N"/></x:xmpmeta>')

interface PhoneOptions {
  moovFirst?: boolean
  wide?: boolean
  largeMdat?: boolean
  metadata?: boolean
  brand?: string[]
  padding?: boolean
  track?: ChunkTrackOptions
  movie?: Buffer[]
}
/**
 * Vidéo « de téléphone » : index en fin de fichier, données distinctes par bloc (3 blocs vidéo, 3 audio),
 * lieu, appareil et logiciel dans `udta`, `meta` (clés) et un paquet XMP de premier niveau.
 */
function phoneFile({ moovFirst = false, wide = false, largeMdat = false, metadata = true, brand = ['isom', 'isom', 'mp42'], padding = false, track = {}, movie = [] }: PhoneOptions = {}): Buffer {
  const samples = Buffer.alloc(6 * 512)
  for (let i = 0; i < samples.length; i++) samples[i] = (i * 31 + 7) & 0xFF
  const mdat = largeMdat
    ? Buffer.concat([u32(1), text('mdat'), u64(16 + samples.length), samples])
    : box('mdat', samples)
  const mdatHeader = largeMdat ? 16 : 8
  const [major, ...compatible] = brand
  const head = ftyp(major!, ...compatible)
  const before = [
    ...(metadata ? [box('uuid', XMP_UUID, GPS_XMP)] : []),
    ...(padding ? [box('free', Buffer.alloc(32))] : []),
  ]
  const udta = box('udta',
    box('©xyz', text('+48.8566+002.3522/')),
    box('auth', text('Galaxy S25 Ultra')),
    box('smta', text('mdlnSM-S938B')),
    box('©nam', text('Vacances')),
    fullBox('meta', 0, 0, hdlr('mdir'), box('ilst', itunesItem('©nam', 'Titre iTunes'), itunesItem('©too', 'Lavf61'), itunesItem('©xyz', '+48.8566+002.3522/'))))
  const meta = keysMeta([
    ['com.apple.quicktime.location.ISO6709', '+48.8566+002.3522+035.000/'],
    ['com.apple.quicktime.title', 'Mon titre'],
    ['com.apple.quicktime.make', 'Apple'],
    ['com.android.version', '16'],
  ])
  const moov = (dataStart: number) => box('moov',
    mvhd(1000, 12_345),
    chunkTrack('vide', videoEntry('avc1', 1920, 1080, avcC()), [0, 1, 2].map(k => dataStart + k * 1024), { width: 1920, height: 1080, rotation: 90, wide, ...track }),
    chunkTrack('soun', audioEntry('mp4a', 0, esds()), [0, 1, 2].map(k => dataStart + k * 1024 + 512), { id: 2, wide }),
    ...(metadata ? [udta, meta, box('uuid', Buffer.alloc(16, 0x42), text('vendor'))] : []),
    ...movie)
  const prefix = head.length + before.reduce((total, part) => total + part.length, 0)
  if (!moovFirst) return Buffer.concat([head, ...before, mdat, moov(prefix + mdatHeader)])
  const size = moov(0).length
  return Buffer.concat([head, ...before, moov(prefix + size + mdatHeader), mdat])
}

/** Types des boîtes de premier niveau. */
function topLevelTypes(file: Buffer): string[] {
  const types: string[] = []
  for (let offset = 0; offset + 8 <= file.length;) {
    let size = file.readUInt32BE(offset)
    if (size === 1) size = Number(file.readBigUInt64BE(offset + 8))
    types.push(file.toString('latin1', offset + 4, offset + 8))
    offset += size
  }
  return types
}

const BOTH: PreparationOptions = { faststart: true, metadata: true }
const prepare = (file: Buffer, options = BOTH, mimeType = 'video/mp4') => prepareVideo(bufferSource(file), mimeType, options)
async function prepared(file: Buffer, options = BOTH, mimeType = 'video/mp4'): Promise<{ plan: PreparationPlan, bytes: Buffer, result: Awaited<ReturnType<typeof probeVideo>> }> {
  const outcome = await prepare(file, options, mimeType)
  if (outcome.status !== 'prepared') throw new Error(`préparation attendue : ${JSON.stringify(outcome)}`)
  const bytes = await plannedSource(bufferSource(file), outcome.plan).read(0, outcome.plan.size)
  return { plan: outcome.plan, bytes, result: outcome.probe }
}
/** Chaque bloc d'échantillons : mêmes octets à la nouvelle position. */
function expectChunksMoved(file: Buffer, bytes: Buffer, plan: PreparationPlan): void {
  expect(plan.chunks).toHaveLength(6)
  for (const { from, to } of plan.chunks) expect(bytes.subarray(to, to + 512).equals(file.subarray(from, from + 512))).toBe(true)
}

describe('préparation des MP4/MOV (D2)', () => {
  it('index en tête, lieu et appareil retirés, données déplacées sans erreur, idempotente', async () => {
    const file = phoneFile()
    expect((await probe(file)).metadata).toMatchObject({ faststart: false, hasLocation: true })
    const { plan, bytes, result } = await prepared(file)
    expect(plan.operations).toEqual(['faststart', 'metadata'])
    expect(plan.removed).toEqual(expect.arrayContaining([
      'uuid(XMP)',
      'moov/udta/©xyz',
      'moov/udta/auth',
      'moov/udta/smta',
      'moov/udta/meta/ilst/©too',
      'moov/udta/meta/ilst/©xyz',
      'moov/meta/keys:com.apple.quicktime.location.ISO6709',
      'moov/meta/keys:com.apple.quicktime.make',
      'moov/meta/keys:com.android.version',
      'moov/uuid',
    ]))
    expect(topLevelTypes(bytes)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(bytes.length).toBe(plan.size)
    expect(plan.size).toBeLessThan(file.length)
    expectChunksMoved(file, bytes, plan)
    expect(result).toMatchObject({ width: 1080, height: 1920, duration: 12.345 })
    expect(result.metadata).toMatchObject({ faststart: true, hasLocation: false, rotation: 90, codecs: 'avc1.64001F,mp4a.40.2', prepared: ['faststart', 'metadata'] })

    // Conservés : titres (udta, iTunes, clé QuickTime renumérotée) ; plus rien de l'appareil ni du lieu.
    for (const kept of ['Vacances', 'Titre iTunes', 'com.apple.quicktime.title', 'Mon titre']) expect(bytes.includes(text(kept))).toBe(true)
    for (const gone of ['Galaxy', 'SM-S938B', 'Lavf61', '+48.8566', 'GPSLatitude', 'com.apple.quicktime.make', 'com.android.version', 'vendor']) expect(bytes.includes(text(gone))).toBe(false)
    const ilst = bytes.lastIndexOf(text('ilst')) - 4
    expect(bytes.readUInt32BE(ilst + 12)).toBe(1) // clé « title » : 2 → 1
    expect(bytes.readUInt32BE(ilst)).toBe(8 + bytes.readUInt32BE(ilst + 8))

    expect(await prepare(bytes)).toEqual({ status: 'unchanged' })
  })

  it('faststart seul : métadonnées gardées, taille identique', async () => {
    const file = phoneFile()
    const { plan, bytes, result } = await prepared(file, { faststart: true, metadata: false })
    expect(plan).toMatchObject({ operations: ['faststart'], removed: [], size: file.length })
    expect(topLevelTypes(bytes)).toEqual(['ftyp', 'uuid', 'moov', 'mdat'])
    expectChunksMoved(file, bytes, plan)
    expect(result.metadata).toMatchObject({ faststart: true, hasLocation: true, prepared: ['faststart'] })
  })

  it('métadonnées seules : index laissé en fin de fichier', async () => {
    const file = phoneFile()
    const { plan, bytes, result } = await prepared(file, { faststart: false, metadata: true })
    expect(plan.operations).toEqual(['metadata'])
    expect(topLevelTypes(bytes)).toEqual(['ftyp', 'mdat', 'moov'])
    expectChunksMoved(file, bytes, plan)
    expect(result.metadata).toMatchObject({ faststart: false, hasLocation: false, prepared: ['metadata'] })
  })

  it('rien à faire : index en tête, sans métadonnées (bourrage gardé), ou préparation désactivée', async () => {
    expect(await prepare(phoneFile({ moovFirst: true, metadata: false, padding: true }))).toEqual({ status: 'unchanged' })
    expect(await prepare(phoneFile(), { faststart: false, metadata: false })).toEqual({ status: 'unchanged' })
    // Réécrit pour une autre raison : le bourrage part aussi, sans compter comme une métadonnée.
    const { plan, bytes } = await prepared(phoneFile({ metadata: false, padding: true }))
    expect(plan).toMatchObject({ operations: ['faststart'], removed: ['free'] })
    expect(topLevelTypes(bytes)).toEqual(['ftyp', 'moov', 'mdat'])
  })

  it('décalages 64 bits (co64), données de taille 64 bits (largesize)', async () => {
    const file = phoneFile({ wide: true, largeMdat: true })
    const { plan, bytes, result } = await prepared(file)
    expectChunksMoved(file, bytes, plan)
    expect(result.metadata).toMatchObject({ faststart: true, hasLocation: false })
    expect(bytes.readUInt32BE(bytes.indexOf(text('mdat')) - 4)).toBe(1)
  })

  it('MOV : marque de fin de « udta », noms de pistes et chapitres conservés', async () => {
    const trackUdta = Buffer.concat([u32(8 + 12 + 4), text('udta'), box('name', text('Main')), u32(0)])
    const file = phoneFile({ brand: ['qt  ', 'qt  '], track: { udta: [trackUdta] }, movie: [box('udta', box('chpl', u32(0)), box('©mak', text('Apple')))] })
    const { bytes, result, plan } = await prepared(file, BOTH, 'video/quicktime')
    expect(result.metadata).toMatchObject({ container: 'mov', faststart: true, hasLocation: false })
    expect(plan.removed).toContain('moov/udta/©mak')
    const kept = bytes.indexOf(text('name')) - 4
    expect(bytes.subarray(kept - 8, kept + 16).equals(trackUdta)).toBe(true)
    expect(bytes.includes(text('chpl'))).toBe(true)
  })

  it('fichiers gardés tels quels : fragmenté, données externes, chiffré, décalage hors données, deux index', async () => {
    const skipped = async (file: Buffer, mimeType = 'video/mp4') => {
      const outcome = await prepare(file, BOTH, mimeType)
      return outcome.status === 'skipped' ? outcome.reason : outcome.status
    }
    expect(await skipped(phoneFile({ movie: [box('mvex', fullBox('trex', 0, 0, Buffer.alloc(20)))] }))).toBe('fragmented file')
    expect(await skipped(phoneFile({ track: { drefFlags: 0 } }))).toBe('external data reference')
    expect(await skipped(phoneFile({ track: { stbl: [fullBox('saio', 0, 0, u32(1), u32(0))] } }))).toBe('auxiliary information offsets (encrypted file)')
    expect(await skipped(Buffer.concat([phoneFile(), box('moov', mvhd(1000, 1))]))).toBe('several moov boxes')
    expect(await skipped(webm(), 'video/webm')).toBe('not an ISO BMFF file')
    // Bloc pointant hors des données (dans `ftyp`) : rien n'est déplacé.
    const file = phoneFile()
    const table = file.lastIndexOf(text('stco')) + 12
    file.writeUInt32BE(4, table)
    expect(await skipped(file)).toBe('chunk offset outside media data')
  })

  it('pistes de données de l\'appareil gardées et toujours signalées (retirées par le traitement, D3)', async () => {
    const file = phoneFile({ movie: [dataTrack('meta', 'gpmd', 3), dataTrack('camm', 'camm', 4)] })
    expect((await probe(file)).metadata.dataTracks).toEqual(['gpmd', 'camm'])
    const { bytes, result } = await prepared(file)
    expect(result.metadata).toMatchObject({ dataTracks: ['gpmd', 'camm'], hasLocation: false, prepared: ['faststart', 'metadata'], hdr: null, rewrites: [] })
    expect(bytes.includes(text('gpmd'))).toBe(true)
  })

  it('le flux écrit exactement la sortie vérifiée', async () => {
    const file = phoneFile({ padding: true })
    const directory = await mkdtemp(join(tmpdir(), 'surge-media-prepare-'))
    try {
      const path = join(directory, 'phone.mp4')
      await writeFile(path, file)
      const { plan, bytes } = await prepared(file)
      const chunks: Buffer[] = []
      for await (const chunk of preparedStream(path, plan)) chunks.push(chunk as Buffer)
      expect(Buffer.concat(chunks).equals(bytes)).toBe(true)
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('réglage NUXT_MEDIA_VIDEO_PREPARE', () => {
    const warnings: string[] = []
    const warn = (message: string) => warnings.push(message)
    expect(parseVideoPreparation(undefined, warn)).toEqual(BOTH)
    expect(parseVideoPreparation('faststart, metadata', warn)).toEqual(BOTH)
    expect(parseVideoPreparation('FASTSTART', warn)).toEqual({ faststart: true, metadata: false })
    expect(parseVideoPreparation('none', warn)).toEqual({ faststart: false, metadata: false })
    expect(parseVideoPreparation('', warn)).toEqual({ faststart: false, metadata: false })
    expect(parseVideoPreparation(['metadata'], warn)).toEqual({ faststart: false, metadata: true })
    expect(warnings).toEqual([])
    expect(parseVideoPreparation('faststart,location', warn)).toEqual({ faststart: true, metadata: false })
    expect(warnings).toHaveLength(1)
  })
})

// ─── Durée estimée des WebM (phase D2) ───────────────────────────────────────

/** Bloc WebM : piste 1, décalage signé (unités de la grappe), image clé. */
const simpleBlock = (offset: number) => el(0xA3, u8(0x81), u16(offset & 0xFFFF), u8(0x80), Buffer.alloc(24, 9))
const blockGroup = (offset: number, duration: number) => el(0xA0, el(0xA1, u8(0x81), u16(offset & 0xFFFF), u8(0x00), Buffer.alloc(16, 9)), uintEl(0x9B, duration))
const cluster = (timecode: number, ...children: Buffer[]) => Buffer.concat([idBytes(0x1F43B675), UNKNOWN_SIZE, uintEl(0xE7, timecode), ...children])

describe('durée estimée des WebM sans durée (D2)', () => {
  it('fin du dernier « Cluster » : blocs simples, groupes avec durée, grappe de taille connue', () => {
    expect(lastClusterEnd(cluster(1000, simpleBlock(0), simpleBlock(480)))).toBe(1480)
    expect(lastClusterEnd(Buffer.concat([cluster(0, simpleBlock(20)), cluster(2000, blockGroup(500, 40), simpleBlock(520))]))).toBe(2540)
    const known = el(0x1F43B675, uintEl(0xE7, 3000), simpleBlock(-20), simpleBlock(10))
    expect(lastClusterEnd(Buffer.concat([known, el(0x1C53BB6B, Buffer.alloc(8))]))).toBe(3010)
  })

  it('identifiant trouvé dans des données, grappe coupée par la fin du tampon, rien de lisible', () => {
    const decoy = el(0xA3, u8(0x81), u16(900), u8(0x80), Buffer.from([0x1F, 0x43, 0xB6, 0x75, 0x85, 0x55, 0x55]))
    expect(lastClusterEnd(cluster(1000, simpleBlock(100), decoy))).toBe(1900)
    const whole = cluster(1000, simpleBlock(100), simpleBlock(200))
    expect(lastClusterEnd(whole.subarray(0, whole.length - 10))).toBe(1100)
    expect(lastClusterEnd(Buffer.alloc(64, 1))).toBeNull()
  })

  it('WebM sans durée : estimée et signalée', async () => {
    const info = el(0x1549A966, uintEl(0x2AD7B1, 1_000_000))
    const file = Buffer.concat([ebmlHeader(), idBytes(0x18538067), UNKNOWN_SIZE, info, el(0x1654AE6B, webmVideoTrack()), cluster(0, simpleBlock(0)), cluster(4000, simpleBlock(0), simpleBlock(1250))])
    const result = await probe(file, 'video/webm')
    expect(result.duration).toBe(5.25)
    expect(result.metadata).toMatchObject({ durationEstimated: true, bitrate: Math.round(file.length * 8 / 5.25) })
  })
})
