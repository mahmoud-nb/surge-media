/**
 * Chaînes de codecs RFC 6381 (`avc1.64001F`, `mp4a.40.2`…) calculées depuis les enregistrements de
 * configuration des pistes (ISO/IEC 14496-15, AV1-ISOBMFF, VP-Codec-ISOBMFF, ISO/IEC 14496-1) : elles
 * permettent d'écrire `<source type='video/mp4; codecs="…"'>`. Null quand l'enregistrement manque ou
 * est trop court. Fonctions pures, testées.
 */

const hex2 = (value: number) => value.toString(16).toUpperCase().padStart(2, '0')
const dec2 = (value: number) => String(value).padStart(2, '0')

/** H.264 : `avc1.PPCCLL` (profil, contraintes, niveau) depuis `avcC`. */
export function avcCodecString(fourcc: string, avcC: Buffer): string | null {
  if (avcC.length < 4) return null
  return `${fourcc}.${hex2(avcC[1]!)}${hex2(avcC[2]!)}${hex2(avcC[3]!)}`
}

/** H.265 : `hvc1.<espace><profil>.<compatibilités>.<rang><niveau>[.<contraintes>]` depuis `hvcC`. */
export function hevcCodecString(fourcc: string, hvcC: Buffer): string | null {
  if (hvcC.length < 13) return null
  const byte = hvcC[1]!
  const space = ['', 'A', 'B', 'C'][byte >> 6]!
  const tier = byte & 0x20 ? 'H' : 'L'
  const profile = byte & 0x1F
  // Drapeaux de compatibilité dans l'ordre inverse des bits, en hexadécimal sans zéros de tête.
  let flags = hvcC.readUInt32BE(2)
  let reversed = 0
  for (let i = 0; i < 32; i++) {
    reversed = (reversed << 1) | (flags & 1)
    flags >>>= 1
  }
  const constraints = [...hvcC.subarray(6, 12)]
  while (constraints.length > 0 && constraints.at(-1) === 0) constraints.pop()
  const parts = [fourcc, `${space}${profile}`, (reversed >>> 0).toString(16).toUpperCase(), `${tier}${hvcC[12]!}`]
  if (constraints.length > 0) parts.push(constraints.map(hex2).join('.'))
  return parts.join('.')
}

/** AV1 : `av01.<profil>.<niveau><rang>.<profondeur>` depuis `av1C` (aussi le `CodecPrivate` d'un WebM). */
export function av1CodecString(av1C: Buffer): string | null {
  if (av1C.length < 3 || !(av1C[0]! & 0x80)) return null
  const profile = av1C[1]! >> 5
  const level = av1C[1]! & 0x1F
  const tier = av1C[2]! & 0x80 ? 'H' : 'M'
  const bitDepth = av1C[2]! & 0x20 ? 12 : av1C[2]! & 0x40 ? 10 : 8
  return `av01.${profile}.${dec2(level)}${tier}.${dec2(bitDepth)}`
}

/** VP9 (dans MP4) : `vp09.<profil>.<niveau>.<profondeur>` depuis `vpcC` (FullBox). */
export function vp9CodecString(vpcC: Buffer): string | null {
  if (vpcC.length < 7) return null
  return `vp09.${dec2(vpcC[4]!)}.${dec2(vpcC[5]!)}.${dec2(vpcC[6]! >> 4)}`
}

/** Taille d'un descripteur MPEG-4 (1 à 4 octets de 7 bits). */
function descriptorLength(buffer: Buffer, offset: number): { length: number, size: number } | null {
  let length = 0
  for (let i = 0; i < 4; i++) {
    const byte = buffer[offset + i]
    if (byte === undefined) return null
    length = (length << 7) | (byte & 0x7F)
    if (!(byte & 0x80)) return { length, size: i + 1 }
  }
  return null
}

/**
 * Audio MPEG-4 depuis `esds` (FullBox) : `{ codec: 'mp4a' | 'mp3', string: 'mp4a.40.2' | 'mp4a.6B' }`.
 * Indication de type d'objet 0x40 = audio MPEG-4 (type AAC dans la configuration), 0x69/0x6B = MP3.
 */
export function mpeg4AudioCodec(esds: Buffer): { codec: string, string: string | null } {
  let offset = 4 // version et drapeaux
  const take = (tag: number): number | null => {
    if (esds[offset] !== tag) return null
    const size = descriptorLength(esds, offset + 1)
    if (!size) return null
    offset += 1 + size.size
    return size.length
  }
  if (take(0x03) === null) return { codec: 'mp4a', string: null }
  const flags = esds[offset + 2] ?? 0
  offset += 3
  if (flags & 0x80) offset += 2
  if (flags & 0x40) offset += 1 + (esds[offset] ?? 0)
  if (flags & 0x20) offset += 2
  if (take(0x04) === null) return { codec: 'mp4a', string: null }
  const objectType = esds[offset]
  if (objectType === undefined) return { codec: 'mp4a', string: null }
  if (objectType === 0x69 || objectType === 0x6B) return { codec: 'mp3', string: `mp4a.${hex2(objectType)}` }
  if (objectType !== 0x40) return { codec: 'mp4a', string: `mp4a.${hex2(objectType)}` }
  offset += 13
  if (take(0x05) === null) return { codec: 'mp4a', string: null }
  const first = esds[offset]
  if (first === undefined) return { codec: 'mp4a', string: null }
  let audioObjectType = first >> 3
  if (audioObjectType === 31) {
    const second = esds[offset + 1]
    if (second === undefined) return { codec: 'mp4a', string: null }
    audioObjectType = 32 + (((first & 0x07) << 3) | (second >> 5))
  }
  return { codec: 'mp4a', string: `mp4a.40.${audioObjectType}` }
}
