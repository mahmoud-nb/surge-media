import type { Media, Preset, Project } from '../src/types'

/** Exemples conformes au contrat v1 (vérifiés par tests/contract.test.ts contre les schémas du core). */

const BASE = 'https://media.example.com/m/cmimage0001/v3'

export const imageMedia: Media = {
  id: 'cmimage0001',
  projectId: 'cmproject01',
  kind: 'image',
  visibility: 'public',
  title: 'Plage au crépuscule',
  altText: 'Une plage au coucher du soleil',
  filename: 'plage.jpg',
  mimeType: 'image/jpeg',
  extension: 'jpg',
  size: 2_400_000,
  width: 3000,
  height: 2000,
  duration: null,
  version: 3,
  folderId: null,
  url: `${BASE}/plage-au-crepuscule.jpg`,
  sources: [],
  previewUrl: `${BASE}/preview/plage-au-crepuscule.webp`,
  urlTemplate: `${BASE}/{transform}/plage-au-crepuscule.{format}`,
  poster: null,
  textTracks: [],
  processing: null,
  focalPoint: { x: 0.3, y: 0.6 },
  urlExpiresAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
}

const SIGNATURE = 'exp=1900000000&kid=abcd1234&scope=derived&sig=c2lnbmF0dXJl'

export const privateImage: Media = {
  ...imageMedia,
  visibility: 'private',
  url: `${BASE}/plage-au-crepuscule.jpg?exp=1900000000&kid=abcd1234&sig=b3JpZ2luYWw`,
  previewUrl: `${BASE}/preview/plage-au-crepuscule.webp?exp=1900000000&kid=abcd1234&sig=cHJldmlldw`,
  urlTemplate: `${BASE}/{transform}/plage-au-crepuscule.{format}?${SIGNATURE}`,
  urlExpiresAt: '2030-03-17T17:46:40.000Z',
}

const VIDEO = 'https://media.example.com/m/cmvideo0001/v2'

export const videoMedia: Media = {
  ...imageMedia,
  id: 'cmvideo0001',
  kind: 'video',
  title: 'Visite',
  altText: null,
  filename: 'visite.mov',
  mimeType: 'video/quicktime',
  extension: 'mov',
  size: 48_000_000,
  width: 1920,
  height: 1080,
  duration: 83.4,
  version: 2,
  url: `${VIDEO}/visite.mov`,
  sources: [
    { url: `${VIDEO}/renditions/av1.webm`, type: 'video/webm; codecs="av01.0.08M.08, opus"', width: 1920, height: 1080, bitrate: 1_800_000, size: 18_000_000, rendition: 'av1' },
    { url: `${VIDEO}/renditions/h264.mp4`, type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"', width: 1920, height: 1080, bitrate: 4_000_000, size: 41_000_000, rendition: 'h264' },
  ],
  previewUrl: `${VIDEO}/preview/visite.webp`,
  urlTemplate: `${VIDEO}/{transform}/visite.{format}`,
  poster: { url: `${VIDEO}/full/visite.jpg`, width: 1920, height: 1080, time: 8.3 },
  textTracks: [
    { id: 'cmtrack0001', kind: 'captions', language: 'fr', label: 'Français', default: true, url: `${VIDEO}/tracks/cmtrack0001.vtt`, size: 2048, cueCount: 24, createdAt: '2026-10-02T10:00:00.000Z' },
  ],
  processing: { status: 'ready', progress: null, error: null, updatedAt: '2026-10-02T11:00:00.000Z' },
  focalPoint: null,
}

export const project: Project = {
  id: 'cmproject01',
  name: 'Site vitrine',
  slug: 'site-vitrine',
  description: null,
  publicListing: true,
  transformPolicy: 'open',
  transformFormats: ['jpg', 'png', 'webp', 'avif'],
  transformMaxDimension: 4096,
  scopes: ['project:read', 'media:read'],
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-10-15T08:00:00.000Z',
}

export const presets: Preset[] = [
  { name: 'preview', transformation: 'w_480,h_480,fit_inside,q_72', description: null, level: 'builtin' },
  { name: 'full', transformation: '', description: null, level: 'builtin' },
  { name: 'card-sm', transformation: 'w_400,h_300', description: 'Carte', level: 'project' },
  { name: 'card-lg', transformation: 'w_800,h_600', description: 'Carte (grande)', level: 'project' },
]

/** Jeton délégué factice (charge lisible, signature fictive) : la signature n'est vérifiée que par le serveur. */
export function delegatedToken(claims: { exp: number, sub?: string, scopes?: string[] }): string {
  const payload = {
    v: 1,
    jti: 'jti-0123456789',
    iss: 'cmissuer001',
    project: 'cmproject01',
    scopes: claims.scopes ?? ['project:read', 'media:read'],
    sub: claims.sub,
    iat: claims.exp - 900,
    exp: claims.exp,
    kid: 'abcd1234',
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return `sm_dt_${encoded}.c2lnbmF0dXJl`
}
