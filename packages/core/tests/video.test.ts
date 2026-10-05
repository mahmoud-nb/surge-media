import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codecLabel, videoMetadata, videoPlayback, videoSourceType } from '../shared/utils/video'
import { largestSize, resolveUploadSizes, rulesFor } from '../server/lib/media/limits'
import { detectMimeType } from '../server/lib/media/sniff'
import { av1CodecString, avcCodecString, hevcCodecString, mpeg4AudioCodec, vp9CodecString } from '../server/lib/media/video/codecs'
import { probeVideo, probeVideoFile, VideoProbeError } from '../server/lib/media/video/probe'
import { bufferSource } from '../server/lib/media/video/source'

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

  it('garde l\'AVIF et refuse HEIF, 3GP, audio seul, Matroska', () => {
    expect(detectMimeType(ftyp('avif', 'mif1', 'miaf'))).toBe('image/avif')
    expect(detectMimeType(ftyp('mif1', 'avif', 'miaf'))).toBe('image/avif')
    expect(detectMimeType(ftyp('heic', 'mif1', 'heic'))).toBeUndefined()
    expect(detectMimeType(ftyp('3gp4', 'isom', '3gp4'))).toBeUndefined()
    expect(detectMimeType(ftyp('M4A ', 'M4A ', 'mp42', 'isom'))).toBeUndefined()
    expect(detectMimeType(ftyp('abcd', 'efgh'))).toBeUndefined()
    expect(detectMimeType(ebmlHeader('matroska'))).toBeUndefined()
  })

  it('reste sûr sur des en-têtes tronqués ou vides', () => {
    expect(detectMimeType(Buffer.alloc(0))).toBeUndefined()
    expect(detectMimeType(ebmlHeader().subarray(0, 6))).toBeUndefined()
    expect(detectMimeType(ftyp('isom').subarray(0, 10))).toBeUndefined()
    expect(detectMimeType(u8(0x1A, 0x45, 0xDF, 0xA3, 0x00))).toBeUndefined()
    expect(detectMimeType(u8(0xFF, 0xD8, 0xFF, 0xE0))).toBe('image/jpeg')
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

// ─── Analyse WebM ────────────────────────────────────────────────────────────

describe('probeVideo — WebM', () => {
  it('enregistrement de navigateur : segment et grappe de taille inconnue', async () => {
    const result = await probe(webm(), 'video/webm')
    expect(result).toMatchObject({ width: 1280, height: 720, duration: 8.5 })
    expect(result.metadata).toMatchObject({ container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', codecs: 'vp9,opus', faststart: null, rotation: 0, playback: 'broad' })
  })

  it('durée absente (MediaRecorder) : null', async () => {
    const result = await probe(webm({ duration: null, tracks: [webmVideoTrack('V_VP8', 640, 480)] }), 'video/webm')
    expect(result).toMatchObject({ width: 640, duration: null, metadata: { videoCodec: 'vp8', hasAudio: false, codecs: 'vp8', bitrate: null } })
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

  it('refuse Matroska, l\'audio seul et un en-tête incohérent', async () => {
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
    expect(rules.maxSizeFor('image/png')).toBe(100)
    expect(rules.maxSizeFor('video/webm')).toBe(1000)
    expect(rules.maxSizeFor('application/pdf')).toBe(0)
    expect(largestSize(rules)).toBe(1000)
    const capped = rulesFor(sizes, ['image/png', 'video/mp4'], 500)
    expect(capped.maxSizeFor('video/mp4')).toBe(500)
    expect(capped.maxSizeFor('image/png')).toBe(100)
    expect(largestSize(rulesFor(sizes, ['image/jpeg']))).toBe(100)
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
  })

  it('libellés, lecture de la colonne JSON, type d\'une source', () => {
    expect(codecLabel('avc1')).toBe('H.264')
    expect(codecLabel('hev1')).toBe('H.265 (HEVC)')
    expect(codecLabel('xyz1')).toBe('XYZ1')
    expect(videoMetadata(null)).toBeNull()
    expect(videoMetadata({ format: 'jpeg' })).toBeNull()
    expect(videoMetadata({ container: 'webm', videoCodec: 'vp8', playback: 'oops' })).toMatchObject({ audioCodec: null, rotation: 0, faststart: null, playback: 'variable' })
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
    expect(detectMimeType(file.subarray(0, 256))).toBe('video/webm')
    const result = await probe(file, 'video/webm')
    expect(result).toMatchObject({ width: 160, height: 90, duration: null })
    expect(result.metadata).toMatchObject({ videoCodec: 'vp9', audioCodec: 'opus', codecs: 'vp9,opus', playback: 'broad' })
  })

  it('WebM VP8 sans son', async () => {
    const result = await probe(await fixture('recorder-vp8.webm'), 'video/webm')
    expect(result).toMatchObject({ width: 160, height: 90, metadata: { videoCodec: 'vp8', hasAudio: false, codecs: 'vp8' } })
  })

  it('MP4 fragmenté H.264 + AAC : durée tirée des fragments', async () => {
    const file = await fixture('recorder-h264-aac.mp4')
    expect(detectMimeType(file.subarray(0, 256))).toBe('video/mp4')
    const result = await probe(file)
    expect(result).toMatchObject({ width: 160, height: 90 })
    expect(result.duration).toBeCloseTo(2, 0)
    expect(result.metadata).toMatchObject({ videoCodec: 'avc1', audioCodec: 'mp4a', codecs: 'avc1.42C00C,mp4a.40.2', faststart: true, playback: 'broad' })
  })
})
