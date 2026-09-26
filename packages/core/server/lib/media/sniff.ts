import { open } from 'node:fs/promises'

/**
 * Détection du type réel d'un fichier d'après ses premiers octets (« signature »), jamais
 * d'après le nom ou le type annoncés par le client. Liste d'autorisation : seuls les formats
 * reconnus ici peuvent être acceptés ; le gestionnaire du genre vérifie ensuite que le
 * contenu est réellement lisible (sharp pour les images).
 *
 * Ajouter un format (vidéo MP4/WebM, PDF…) = ajouter sa signature ci-dessous et le déclarer
 * dans ACCEPTED_MEDIA_TYPES (shared/utils/media.ts).
 */

const HEADER_BYTES = 256

function ascii(header: Buffer, offset: number, length: number): string {
  return header.subarray(offset, offset + length).toString('latin1')
}

/** Marques d'un conteneur ISO BMFF (boîte « ftyp » : AVIF, HEIC, MP4…) : principale et compatibles. */
function isoBrands(header: Buffer): string[] {
  if (header.length < 16 || ascii(header, 4, 4) !== 'ftyp') return []
  const boxSize = Math.min(header.readUInt32BE(0), header.length)
  const brands = [ascii(header, 8, 4)]
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(ascii(header, offset, 4))
  return brands
}

const SIGNATURES: { mimeType: string, matches: (header: Buffer) => boolean }[] = [
  { mimeType: 'image/jpeg', matches: h => h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF },
  { mimeType: 'image/png', matches: h => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) },
  { mimeType: 'image/gif', matches: h => ['GIF87a', 'GIF89a'].includes(ascii(h, 0, 6)) },
  { mimeType: 'image/webp', matches: h => ascii(h, 0, 4) === 'RIFF' && ascii(h, 8, 4) === 'WEBP' },
  { mimeType: 'image/avif', matches: h => isoBrands(h).some(brand => brand === 'avif' || brand === 'avis') },
]

/** Type MIME reconnu d'après le contenu, ou undefined. */
export async function sniffMimeType(path: string): Promise<string | undefined> {
  const file = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(HEADER_BYTES), 0, HEADER_BYTES, 0)
    const header = buffer.subarray(0, bytesRead)
    return SIGNATURES.find(signature => signature.matches(header))?.mimeType
  }
  finally {
    await file.close()
  }
}
