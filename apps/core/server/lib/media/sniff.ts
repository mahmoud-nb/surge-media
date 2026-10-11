import { open } from 'node:fs/promises'

/**
 * Détection du type réel d'un fichier d'après ses premiers octets (« signature »), jamais
 * d'après le nom ou le type annoncés par le client. Liste d'autorisation : seuls les formats
 * reconnus ici peuvent être acceptés ; le gestionnaire du genre vérifie ensuite que le
 * contenu est réellement lisible (sharp pour les images, lecteur d'en-têtes pour les vidéos ;
 * ffprobe, dans la tâche de traitement, pour les vidéos converties).
 *
 * `detectMimeType` est pure (testée) : elle sert aussi pendant la réception d'un envoi, dès que
 * les premiers octets sont arrivés (refus immédiat d'un type non accepté, limite de taille du genre).
 *
 * Reconnaître un format ne suffit pas à l'accepter : les formats convertis par le traitement des vidéos
 * (MKV, AVI, 3GP, MPEG-TS, OGV, WMV : phase D3, DD32) sont toujours reconnus ici, mais acceptés
 * seulement quand le traitement est actif (`acceptedMimeTypes`, règles d'envoi de limits.ts). Leur
 * type détecté fixe aussi le format d'entrée imposé à ffmpeg, qui ne devine jamais seul.
 *
 * Ajouter un format = ajouter sa signature ci-dessous et le déclarer dans ACCEPTED_MEDIA_TYPES, ou dans
 * CONVERTED_VIDEO_TYPES pour une vidéo lue seulement par ffmpeg (shared/utils/media.ts).
 */

/**
 * Octets examinés (le type est connu dès qu'ils sont arrivés, ou à la fin d'un fichier plus court) :
 * assez pour vérifier plusieurs paquets MPEG-TS (188 octets, 192 en M2TS), dont la signature se répète.
 */
export const SNIFF_HEADER_BYTES = 1024

function ascii(header: Buffer, offset: number, length: number): string {
  return header.subarray(offset, offset + length).toString('latin1')
}

/** Marques d'un conteneur ISO BMFF (boîte « ftyp » : AVIF, HEIC, MP4, MOV…) : principale puis compatibles. */
function isoBrands(header: Buffer): string[] {
  if (header.length < 16 || ascii(header, 4, 4) !== 'ftyp') return []
  const boxSize = Math.min(header.readUInt32BE(0), header.length)
  const brands = [ascii(header, 8, 4)]
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(ascii(header, offset, 4))
  return brands
}

/** Images HEIF (dont celles des téléphones) : jamais prises pour des vidéos. */
const HEIF_IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avci', 'avcs'])
/** Audio seul (iTunes, Flash) : genre AUDIO, pas encore accepté. */
const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B '])
/** Marques des fichiers MP4 vidéo courants (appareils, logiciels de montage, navigateurs, DASH/CMAF). */
const MP4_VIDEO_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'mp71', 'avc1',
  'M4V ', 'M4VH', 'M4VP', 'dash', 'msnv', 'MSNV', 'XAVC', 'NDAS', 'mmp4', 'cmfc', 'cmf2', 'f4v ', 'av01',
])

function isoBmffType(header: Buffer): string | undefined {
  const brands = isoBrands(header)
  if (brands.length === 0) return undefined
  // AVIF (image ou séquence d'images) reconnu avant tout conteneur vidéo.
  if (brands.some(brand => brand === 'avif' || brand === 'avis')) return 'image/avif'
  const major = brands[0]!
  if (HEIF_IMAGE_BRANDS.has(major) || AUDIO_BRANDS.has(major)) return undefined
  // 3GPP (`3gp4`, `3gp5`, `3ge6`…) et 3GPP2 (`3g2a`…) des anciens téléphones : convertis (phase D3), d'après
  // la marque principale seulement (un MP4 courant cite souvent `3gp4` parmi ses marques compatibles).
  if (major.startsWith('3g2')) return 'video/3gpp2'
  if (major.startsWith('3g')) return 'video/3gpp'
  if (major === 'qt  ') return 'video/quicktime'
  // Le gestionnaire vidéo vérifie ensuite la présence d'une piste vidéo (sinon 415).
  return brands.some(brand => MP4_VIDEO_BRANDS.has(brand)) ? 'video/mp4' : undefined
}

/** Entier EBML de taille variable (`withMarker` : identifiant, bits de longueur conservés). */
function ebmlVint(buffer: Buffer, offset: number, withMarker: boolean): { length: number, value: number } | null {
  const first = buffer[offset]
  if (first === undefined || first === 0) return null
  const length = Math.clz32(first) - 23
  if (offset + length > buffer.length) return null
  let value = withMarker ? first : first & (0xFF >> length)
  for (let i = 1; i < length; i++) value = value * 256 + buffer[offset + i]!
  return { length, value }
}

/**
 * En-tête EBML : `DocType` « webm » (lu tel quel par `<video>`) ou « matroska » (MKV, converti : phase D3).
 * Un autre `DocType` n'est pas une vidéo reconnue.
 */
function ebmlType(header: Buffer): string | undefined {
  if (header.length < 4 || header.readUInt32BE(0) !== 0x1A45DFA3) return undefined
  const size = ebmlVint(header, 4, false)
  if (!size) return undefined
  const end = Math.min(header.length, 4 + size.length + size.value)
  for (let offset = 4 + size.length; offset < end;) {
    const id = ebmlVint(header, offset, true)
    if (!id) return undefined
    const length = ebmlVint(header, offset + id.length, false)
    if (!length) return undefined
    const start = offset + id.length + length.length
    if (id.value === 0x4282) {
      const docType = ascii(header, start, length.value).replace(/\0+$/, '')
      return docType === 'webm' ? 'video/webm' : docType === 'matroska' ? 'video/x-matroska' : undefined
    }
    offset = start + length.value
  }
  return undefined
}

/** Objet d'en-tête ASF (WMV, WMA) : GUID 75B22630-668E-11CF-A6D9-00AA0062CE6C, octets dans l'ordre du fichier. */
const ASF_HEADER_GUID = Buffer.from('3026B2758E66CF11A6D900AA0062CE6C', 'hex')

/**
 * Ogg Theora : les pages de début de flux (drapeau BOS) ouvrent le fichier, une par flux multiplexé ; l'une
 * d'elles doit commencer par le paquet d'identification Theora (`\x80theora`). Un squelette (Ogg Skeleton)
 * peut la précéder. Ogg sans vidéo (Vorbis, Opus, FLAC) : non reconnu.
 */
function oggType(header: Buffer): string | undefined {
  for (let offset = 0; offset + 27 <= header.length && ascii(header, offset, 4) === 'OggS';) {
    // En-tête de page (RFC 3533) : drapeaux à l'octet 5, nombre de segments à l'octet 26, puis la table des segments.
    if (!(header[offset + 5]! & 0x02)) return undefined
    const segments = header[offset + 26]!
    const body = offset + 27 + segments
    if (body > header.length) return undefined
    if (ascii(header, body, 7) === '\x80theora') return 'video/ogg'
    let length = 0
    for (let i = 0; i < segments; i++) length += header[offset + 27 + i]!
    offset = body + length
  }
  return undefined
}

/**
 * Paquets d'un flux de transport : MPEG-TS (188 octets), M2TS / AVCHD (192 : horodatage de 4 octets avant
 * chaque paquet de 188 octets).
 */
const TS_PACKETS = [{ size: 188, prefix: 0 }, { size: 192, prefix: 4 }] as const
/** Paquets complets exigés dans l'en-tête : un seul octet 0x47 (« G ») ne prouve rien. */
const TS_MIN_PACKETS = 4

/**
 * MPEG-TS / M2TS : octet de synchronisation 0x47 au début de **chaque** paquet présent dans l'en-tête (quatre
 * complets au moins). Examiné en dernier : un GIF (`GIF8…`) commence aussi par 0x47.
 */
function isTransportStream(header: Buffer): boolean {
  return TS_PACKETS.some(({ size, prefix }) => {
    if (header.length < TS_MIN_PACKETS * size) return false
    for (let offset = prefix; offset < header.length; offset += size) {
      if (header[offset] !== 0x47) return false
    }
    return true
  })
}

const SIGNATURES: { mimeType: string | ((header: Buffer) => string | undefined), matches: (header: Buffer) => boolean }[] = [
  { mimeType: 'image/jpeg', matches: h => h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF },
  { mimeType: 'image/png', matches: h => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) },
  { mimeType: 'image/gif', matches: h => ['GIF87a', 'GIF89a'].includes(ascii(h, 0, 6)) },
  { mimeType: 'image/webp', matches: h => ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 4) === 'WEBP' },
  { mimeType: isoBmffType, matches: h => h.length >= 8 && ascii(h, 4, 4) === 'ftyp' },
  { mimeType: ebmlType, matches: h => h.length >= 4 && h.readUInt32BE(0) === 0x1A45DFA3 },
  // Vidéos converties par le traitement (phase D3) : acceptées seulement quand il est actif.
  { mimeType: 'video/x-msvideo', matches: h => ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 4) === 'AVI ' },
  { mimeType: 'video/x-ms-wmv', matches: h => h.subarray(0, 16).equals(ASF_HEADER_GUID) },
  { mimeType: oggType, matches: h => ascii(h, 0, 4) === 'OggS' },
  { mimeType: 'video/mp2t', matches: isTransportStream },
]

/** Type MIME reconnu d'après les premiers octets (`SNIFF_HEADER_BYTES` au plus), ou undefined. */
export function detectMimeType(header: Buffer): string | undefined {
  const signature = SIGNATURES.find(candidate => candidate.matches(header))
  if (!signature) return undefined
  return typeof signature.mimeType === 'string' ? signature.mimeType : signature.mimeType(header)
}

/** Type MIME reconnu d'après le contenu d'un fichier, ou undefined. */
export async function sniffMimeType(path: string): Promise<string | undefined> {
  const file = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(SNIFF_HEADER_BYTES), 0, SNIFF_HEADER_BYTES, 0)
    return detectMimeType(buffer.subarray(0, bytesRead))
  }
  finally {
    await file.close()
  }
}
