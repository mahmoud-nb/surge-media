import { avcCodecString, av1CodecString, hevcCodecString, mpeg4AudioCodec, vp9CodecString } from './codecs'
import { type ByteSource, MAX_READ_LENGTH, unreadable } from './source'

/**
 * Lecture des en-têtes d'un conteneur ISO BMFF (MP4, QuickTime MOV) : ISO/IEC 14496-12 et
 * QuickTime File Format. Seules les boîtes utiles sont lues (`mvhd`, `tkhd`, `mdhd`, `hdlr`, `stsd`,
 * métadonnées) ; les tables d'échantillons et les données (`mdat`) ne sont jamais lues. Pure, testée.
 */

export interface IsoTrack {
  /** Identifiant de la piste (`tkhd`), échelle de temps (`mdhd`). */
  id: number
  timescale: number
  handler: string
  enabled: boolean
  /** Dimensions de présentation (`tkhd`, avant rotation). */
  width: number
  height: number
  rotation: number
  /** Durée de la piste (secondes), null si inconnue. */
  duration: number | null
  /** Format de l'échantillon (`avc1`, `mp4a`…), en minuscules, et chaîne RFC 6381 s'il y a lieu. */
  codec: string | null
  codecString: string | null
  /** Dimensions codées (`stsd`), en repli de `tkhd`. */
  codedWidth: number
  codedHeight: number
}

export interface IsoMovie {
  majorBrand: string | null
  /**
   * Durée (secondes) du film, null si inconnue. MP4 fragmenté (enregistrement d'un navigateur, CMAF) :
   * `mehd`, sinon fin du dernier fragment ; les durées des pistes ne couvrent alors que l'en-tête.
   */
  duration: number | null
  fragmented: boolean
  tracks: IsoTrack[]
  /** Index (`moov`) placé avant les données (`mdat`) : lecture progressive sans requête de plus. */
  faststart: boolean
  hasLocation: boolean
}

interface Box {
  type: string
  start: number
  /** Début du contenu (après l'en-tête). */
  body: number
  end: number
}

const MAX_BOXES = 10_000
const MAX_DEPTH = 10
/** Boîtes de premier niveau parcourues au plus pour trouver le dernier fragment (au-delà : durée inconnue). */
const FRAGMENT_SCAN_MAX = 8000
const LOCATION_KEY = Buffer.from('location.ISO6709')
/** Élément `©xyz` d'une liste de métadonnées (`ilst`). */
const LOCATION_ITEM = Buffer.from([0xA9, 0x78, 0x79, 0x7A])
/** Boîtes de lieu de tournage : QuickTime `©xyz`, 3GPP `loci`. */
const LOCATION_BOXES = new Set(['©xyz', 'loci'])

interface Context {
  source: ByteSource
  boxes: number
}

/** En-tête de la boîte à `offset`, bornée par `limit` (fin du parent) ; null s'il ne reste qu'un bourrage. */
async function readBox(context: Context, offset: number, limit: number, topLevel = false): Promise<Box | null> {
  if (limit - offset < 8) return null
  if (++context.boxes > MAX_BOXES) throw unreadable('Too many boxes.')
  const head = await context.source.read(offset, 16)
  if (head.length < 8) throw unreadable('Truncated box header.')
  const type = head.toString('latin1', 4, 8)
  let size = head.readUInt32BE(0)
  let header = 8
  if (size === 1) {
    if (head.length < 16) throw unreadable('Truncated box header.')
    const large = head.readBigUInt64BE(8)
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw unreadable('Box too large.')
    size = Number(large)
    header = 16
  }
  else if (size === 0) {
    // Jusqu'à la fin du parent (en pratique : dernier `mdat` du fichier).
    size = limit - offset
  }
  if (size < header) throw unreadable(`Invalid size for box ${JSON.stringify(type)}.`)
  let end = offset + size
  if (end > limit) {
    // Données tronquées en fin de fichier : tolérées pour `mdat` seulement (aucune autre structure ne déborde).
    if (!(topLevel && type === 'mdat')) throw unreadable(`Box ${JSON.stringify(type)} exceeds its container.`)
    end = limit
  }
  return { type, start: offset, body: offset + header, end }
}

async function* children(context: Context, from: number, limit: number, topLevel = false): AsyncGenerator<Box> {
  for (let offset = from; ;) {
    const box = await readBox(context, offset, limit, topLevel)
    if (!box) return
    yield box
    offset = box.end
  }
}

async function readBody(context: Context, box: Box): Promise<Buffer> {
  const length = box.end - box.body
  if (length > MAX_READ_LENGTH) throw unreadable(`Box ${JSON.stringify(box.type)} too large to read.`)
  const body = await context.source.read(box.body, length)
  if (body.length < length) throw unreadable(`Truncated box ${JSON.stringify(box.type)}.`)
  return body
}

/** Durée en secondes depuis une échelle et une valeur ; null si nulle, « inconnue » (tous bits à 1) ou absurde. */
function seconds(duration: number, timescale: number): number | null {
  if (!timescale || !duration || duration === 0xFFFFFFFF || !Number.isFinite(duration)) return null
  const value = duration / timescale
  return value > 0 && value < 1e8 ? value : null
}

/** `mvhd` / `mdhd` : échelle de temps et durée (versions 0 et 1). */
function timing(body: Buffer): { timescale: number, duration: number } {
  const version = body[0]
  if (version === 1) {
    if (body.length < 32) throw unreadable('Truncated time header.')
    const duration = body.readBigUInt64BE(24)
    return { timescale: body.readUInt32BE(20), duration: duration === 0xFFFFFFFFFFFFFFFFn ? 0 : Number(duration) }
  }
  if (body.length < 20) throw unreadable('Truncated time header.')
  return { timescale: body.readUInt32BE(12), duration: body.readUInt32BE(16) }
}

/** `tkhd` : identifiant, activation, rotation (matrice) et dimensions de présentation (16.16). */
function trackHeader(body: Buffer): { id: number, enabled: boolean, rotation: number, width: number, height: number } {
  const version = body[0]
  const offset = version === 1 ? 4 + 32 : 4 + 20 // après version/drapeaux et les dates, identifiant, durée
  if (body.length < offset + 8 + 8 + 36 + 8) throw unreadable('Truncated track header.')
  const id = body.readUInt32BE(version === 1 ? 20 : 12)
  const enabled = (body.readUInt32BE(0) & 0x000001) !== 0
  const matrix = offset + 16 // réservé (8), couche (2), groupe (2), volume (2), réservé (2)
  const a = body.readInt32BE(matrix) / 65536
  const b = body.readInt32BE(matrix + 4) / 65536
  const degrees = Math.round(Math.atan2(b, a) * 180 / Math.PI)
  const rotation = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360
  return {
    id,
    enabled,
    rotation,
    width: Math.round(body.readUInt32BE(matrix + 36) / 65536),
    height: Math.round(body.readUInt32BE(matrix + 40) / 65536),
  }
}

interface SampleEntry {
  codec: string
  codecString: string | null
  width: number
  height: number
}

/** Boîte enfant `type` dans [from, to) d'un tampon déjà lu (sous-boîtes d'une entrée `stsd`). */
function findInBuffer(buffer: Buffer, from: number, to: number, type: string, depth = 0): Buffer | null {
  for (let offset = from; offset + 8 <= to;) {
    const size = buffer.readUInt32BE(offset)
    if (size < 8 || offset + size > to) return null
    const boxType = buffer.toString('latin1', offset + 4, offset + 8)
    if (boxType === type) return buffer.subarray(offset + 8, offset + size)
    // QuickTime : configuration audio MPEG-4 dans une boîte `wave`.
    if (boxType === 'wave' && depth < 2) {
      const nested = findInBuffer(buffer, offset + 8, offset + size, type, depth + 1)
      if (nested) return nested
    }
    offset += size
  }
  return null
}

/** Première entrée de `stsd` : format, chaîne de codecs, dimensions codées (vidéo). */
function sampleEntry(stsd: Buffer, handler: string): SampleEntry | null {
  if (stsd.length < 16 || stsd.readUInt32BE(4) === 0) return null
  const size = stsd.readUInt32BE(8)
  const end = 8 + size
  if (size < 16 || end > stsd.length) throw unreadable('Invalid sample description.')
  const fourcc = stsd.toString('latin1', 12, 16)
  const codec = fourcc.trim().toLowerCase()
  const entry = 8 // début de l'entrée dans `stsd`

  if (handler === 'vide') {
    const fields = entry + 16 // taille, format, réservé (6), index de référence (2)
    if (end < fields + 70) return { codec, codecString: null, width: 0, height: 0 }
    const width = stsd.readUInt16BE(fields + 16)
    const height = stsd.readUInt16BE(fields + 18)
    const boxes = fields + 70
    let codecString: string | null = null
    if (codec === 'avc1' || codec === 'avc3') codecString = avcString(codec, findInBuffer(stsd, boxes, end, 'avcC'))
    else if (codec === 'hvc1' || codec === 'hev1') codecString = nullable(findInBuffer(stsd, boxes, end, 'hvcC'), box => hevcCodecString(codec, box))
    else if (codec === 'av01') codecString = nullable(findInBuffer(stsd, boxes, end, 'av1C'), av1CodecString)
    else if (codec === 'vp09') codecString = nullable(findInBuffer(stsd, boxes, end, 'vpcC'), vp9CodecString)
    return { codec, codecString, width, height }
  }

  if (handler === 'soun') {
    const fields = entry + 16
    // QuickTime : version de la description du son (0, 1 : +16 octets, 2 : +36 octets).
    const version = end >= fields + 2 ? stsd.readUInt16BE(fields) : 0
    const boxes = fields + 20 + (version === 1 ? 16 : version === 2 ? 36 : 0)
    if (codec === 'mp4a') {
      const esds = findInBuffer(stsd, boxes, end, 'esds')
      const audio = esds ? mpeg4AudioCodec(esds) : { codec: 'mp4a', string: null }
      return { codec: audio.codec, codecString: audio.string, width: 0, height: 0 }
    }
    if (codec === '.mp3') return { codec: 'mp3', codecString: 'mp3', width: 0, height: 0 }
    if (codec === 'opus') return { codec, codecString: 'opus', width: 0, height: 0 }
    if (codec === 'flac') return { codec, codecString: 'flac', width: 0, height: 0 }
    if (codec === 'ac-3' || codec === 'ec-3') return { codec, codecString: codec, width: 0, height: 0 }
    return { codec, codecString: null, width: 0, height: 0 }
  }
  return { codec, codecString: null, width: 0, height: 0 }
}

function avcString(codec: string, avcC: Buffer | null): string | null {
  return avcC ? avcCodecString(codec, avcC) : null
}

function nullable(value: Buffer | null, build: (box: Buffer) => string | null): string | null {
  return value ? build(value) : null
}

async function readTrack(context: Context, trak: Box, depth: number): Promise<IsoTrack> {
  const track: IsoTrack = { id: 0, timescale: 0, handler: '', enabled: true, width: 0, height: 0, rotation: 0, duration: null, codec: null, codecString: null, codedWidth: 0, codedHeight: 0 }
  let stsd: Buffer | null = null
  for await (const box of children(context, trak.body, trak.end)) {
    if (box.type === 'tkhd') Object.assign(track, trackHeader(await readBody(context, box)))
    else if (box.type === 'mdia') {
      for await (const child of children(context, box.body, box.end)) {
        if (child.type === 'mdhd') {
          const { timescale, duration } = timing(await readBody(context, child))
          track.timescale = timescale
          track.duration = seconds(duration, timescale)
        }
        else if (child.type === 'hdlr') {
          const body = await readBody(context, child)
          if (body.length >= 12) track.handler = body.toString('latin1', 8, 12)
        }
        else if (child.type === 'minf') {
          stsd = await findStsd(context, child, depth + 2)
        }
      }
    }
  }
  if (stsd) {
    const entry = sampleEntry(stsd, track.handler)
    if (entry) Object.assign(track, { codec: entry.codec, codecString: entry.codecString, codedWidth: entry.width, codedHeight: entry.height })
  }
  return track
}

/** `minf` › `stbl` › `stsd`. */
async function findStsd(context: Context, minf: Box, depth: number): Promise<Buffer | null> {
  if (depth > MAX_DEPTH) throw unreadable('Boxes nested too deeply.')
  for await (const box of children(context, minf.body, minf.end)) {
    if (box.type !== 'stbl') continue
    for await (const child of children(context, box.body, box.end)) {
      if (child.type === 'stsd') return readBody(context, child)
    }
  }
  return null
}

/** `meta` QuickTime (sans version) ou ISO (FullBox) : début des sous-boîtes. */
function metaChildrenOffset(body: Buffer): number {
  return body.length >= 12 && body.readUInt32BE(0) === 0 && body.toString('latin1', 8, 12) === 'hdlr' ? 4 : 0
}

/** Lieu de tournage dans `udta` (`©xyz`, `loci`) ou une boîte `meta` (clé `com.apple.quicktime.location.ISO6709`). */
async function hasLocationIn(context: Context, box: Box): Promise<boolean> {
  if (box.end - box.body > MAX_READ_LENGTH) return false
  const body = await readBody(context, box)
  if (box.type === 'meta') return body.includes(LOCATION_KEY) || body.includes(LOCATION_ITEM)
  for (let offset = 0; offset + 8 <= body.length;) {
    const size = body.readUInt32BE(offset)
    if (size < 8 || offset + size > body.length) return false
    const type = body.toString('latin1', offset + 4, offset + 8)
    if (LOCATION_BOXES.has(type)) return true
    if (type === 'meta') {
      const meta = body.subarray(offset + 8, offset + size)
      const items = meta.subarray(metaChildrenOffset(meta))
      if (items.includes(LOCATION_KEY) || items.includes(LOCATION_ITEM)) return true
    }
    offset += size
  }
  return false
}

/** Sous-boîtes d'un tampon déjà lu (structure vérifiée : une incohérence arrête le parcours). */
function* boxesIn(buffer: Buffer, from = 0, to = buffer.length): Generator<{ type: string, body: Buffer }> {
  for (let offset = from; offset + 8 <= to;) {
    const size = buffer.readUInt32BE(offset)
    if (size < 8 || offset + size > to) return
    yield { type: buffer.toString('latin1', offset + 4, offset + 8), body: buffer.subarray(offset + 8, offset + size) }
    offset += size
  }
}

/** Nombre de bits à 1 (champs facultatifs de `trun`). */
function bitCount(value: number): number {
  let count = 0
  for (let bits = value; bits; bits &= bits - 1) count++
  return count
}

/**
 * Fin (dans l'échelle de chaque piste) du fragment `moof` : `tfdt` + somme des durées d'échantillons de
 * ses `trun` (durée par échantillon, sinon par défaut de `tfhd`, sinon de `trex`). ISO/IEC 14496-12 § 8.8.
 */
export function fragmentEnds(moof: Buffer, trexDefaults: ReadonlyMap<number, number>): Map<number, number> {
  const ends = new Map<number, number>()
  for (const traf of boxesIn(moof)) {
    if (traf.type !== 'traf') continue
    let trackId = 0
    let defaultDuration = 0
    let start = 0
    let total = 0
    for (const box of boxesIn(traf.body)) {
      const body = box.body
      if (box.type === 'tfhd' && body.length >= 8) {
        const flags = body.readUInt32BE(0) & 0xFFFFFF
        trackId = body.readUInt32BE(4)
        const offset = 8 + (flags & 0x01 ? 8 : 0) + (flags & 0x02 ? 4 : 0)
        defaultDuration = trexDefaults.get(trackId) ?? 0
        if (flags & 0x08 && body.length >= offset + 4) defaultDuration = body.readUInt32BE(offset)
      }
      else if (box.type === 'tfdt' && body.length >= 8) {
        start = body[0] === 1 && body.length >= 12 ? Number(body.readBigUInt64BE(4)) : body.readUInt32BE(4)
      }
      else if (box.type === 'trun' && body.length >= 8) {
        const flags = body.readUInt32BE(0) & 0xFFFFFF
        const count = body.readUInt32BE(4)
        const first = 8 + (flags & 0x01 ? 4 : 0) + (flags & 0x04 ? 4 : 0)
        const stride = 4 * bitCount(flags & 0xF00)
        if (!(flags & 0x100)) {
          total += count * defaultDuration
          continue
        }
        if (first + count * stride > body.length) throw unreadable('Truncated track run.')
        for (let i = 0; i < count; i++) total += body.readUInt32BE(first + i * stride)
      }
    }
    if (trackId) ends.set(trackId, Math.max(ends.get(trackId) ?? 0, start + total))
  }
  return ends
}

/** Durée d'un MP4 fragmenté sans `mehd` : fin du dernier fragment ; null si introuvable (jamais d'erreur). */
async function fragmentedDuration(source: ByteSource, from: number, tracks: IsoTrack[], trexDefaults: ReadonlyMap<number, number>): Promise<number | null> {
  try {
    const context: Context = { source, boxes: 0 }
    let last: Box | null = null
    for await (const box of children(context, from, source.size, true)) {
      if (context.boxes > FRAGMENT_SCAN_MAX) return null
      if (box.type === 'moof') last = box
    }
    if (!last) return null
    const ends = fragmentEnds(await readBody(context, last), trexDefaults)
    let duration: number | null = null
    for (const track of tracks) {
      const end = ends.get(track.id)
      const value = end && track.timescale ? seconds(end, track.timescale) : null
      if (value !== null && (duration === null || value > duration)) duration = value
    }
    return duration
  }
  catch {
    return null
  }
}

export async function probeIsoBmff(source: ByteSource): Promise<IsoMovie> {
  const context: Context = { source, boxes: 0 }
  let moov: Box | null = null
  let ftypBrand: string | null = null
  let firstMdat: number | null = null
  let firstFragment: number | null = null

  for await (const box of children(context, 0, source.size, true)) {
    if (box.type === 'ftyp' && ftypBrand === null) {
      const body = await readBody(context, box)
      if (body.length >= 4) ftypBrand = body.toString('latin1', 0, 4)
    }
    else if (box.type === 'moov' && !moov) moov = box
    else if (box.type === 'mdat' && firstMdat === null) firstMdat = box.start
    if (box.type === 'moof' && firstFragment === null) firstFragment = box.start
    // Index trouvé et position des données connue : inutile de parcourir le reste (fragments d'un MP4
    // fragmenté, par milliers).
    if (moov && (firstMdat !== null || box.type === 'moof')) break
  }
  if (!moov) throw unreadable('No movie header (moov).')

  const movie: IsoMovie = {
    majorBrand: ftypBrand,
    duration: null,
    fragmented: false,
    tracks: [],
    faststart: firstMdat === null || moov.start < firstMdat,
    hasLocation: false,
  }
  let fragmentDuration: number | null = null
  let timescale = 0
  const trexDefaults = new Map<number, number>()

  for await (const box of children(context, moov.body, moov.end)) {
    switch (box.type) {
      case 'mvhd': {
        const header = timing(await readBody(context, box))
        timescale = header.timescale
        movie.duration = seconds(header.duration, header.timescale)
        break
      }
      case 'mvex':
        movie.fragmented = true
        for await (const child of children(context, box.body, box.end)) {
          const body = await readBody(context, child)
          if (child.type === 'mehd') {
            fragmentDuration = body[0] === 1 && body.length >= 12 ? Number(body.readBigUInt64BE(4)) : body.length >= 8 ? body.readUInt32BE(4) : null
          }
          // Durée par défaut des échantillons de chaque piste (repli de `tfhd`).
          else if (child.type === 'trex' && body.length >= 16) trexDefaults.set(body.readUInt32BE(4), body.readUInt32BE(12))
        }
        break
      case 'trak':
        movie.tracks.push(await readTrack(context, box, 1))
        break
      case 'udta':
      case 'meta':
        if (!movie.hasLocation) movie.hasLocation = await hasLocationIn(context, box)
        break
    }
  }
  if (movie.fragmented) {
    // Les durées de `mvhd` et des pistes ne couvrent que les échantillons de l'en-tête (souvent aucun).
    movie.duration = fragmentDuration !== null
      ? seconds(fragmentDuration, timescale)
      : await fragmentedDuration(source, firstFragment ?? moov.end, movie.tracks, trexDefaults)
  }
  return movie
}
