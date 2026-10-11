import { describe, expect, it } from 'vitest'
import { type SourceMedia, type SourceRendition, videoSources } from '../server/lib/media/sources'
import type { RenditionName } from '../shared/utils/video-processing'

/**
 * Sources d'une vidéo (contrat `sources[]`, phase D3, architecture § 35) : ordre, original lisible ou non,
 * types annoncés à `<video>`.
 */

const H264_CODECS = 'avc1.640028,mp4a.40.2'

function video(container: string, overrides: Partial<SourceMedia> & { codecs?: string | null } = {}): SourceMedia {
  const { codecs = H264_CODECS, ...fields } = overrides
  const converted = ['mkv', 'avi', '3gp', 'ts', 'ogv', 'wmv'].includes(container)
  return {
    kind: 'VIDEO',
    mimeType: { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' }[container] ?? 'video/x-msvideo',
    metadata: {
      container,
      videoCodec: converted ? null : 'avc1',
      audioCodec: converted ? null : 'mp4a',
      codecs: converted ? null : codecs,
      bitrate: 8_000_000,
      playback: converted ? 'none' : 'broad',
    },
    width: 3840,
    height: 2160,
    size: 40_000_000,
    ...fields,
  }
}

function rendition(name: string, overrides: Partial<SourceRendition> = {}): SourceRendition {
  const av1 = name === 'av1'
  return {
    name,
    mimeType: av1 ? 'video/webm' : 'video/mp4',
    codecs: av1 ? 'av01.0.08M.08,opus' : H264_CODECS,
    width: 1920,
    height: 1080,
    bitrate: av1 ? 2_400_000 : 5_100_000,
    size: av1 ? 6_000_000 : 12_844_349,
    ...overrides,
  }
}

const link = (name: RenditionName | null) => name ? `/m/x/v2/renditions/${name}.${name === 'av1' ? 'webm' : 'mp4'}?sig` : '/m/x/v2/clip.mp4?sig'

describe('videoSources', () => {
  it('image : aucune source', () => {
    expect(videoSources({ ...video('mp4'), kind: 'IMAGE', mimeType: 'image/jpeg', metadata: null }, [], link)).toEqual([])
  })

  it('sans rendu : l\'original seul, type avec ses codecs, dimensions et débit du média', () => {
    expect(videoSources(video('mp4'), [], link)).toEqual([{
      url: '/m/x/v2/clip.mp4?sig',
      type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
      width: 3840,
      height: 2160,
      bitrate: 8_000_000,
      size: 40_000_000,
      rendition: null,
    }])
  })

  it('MOV : annoncé video/mp4 (canPlayType("video/quicktime") vaut "" dans Chrome et Firefox)', () => {
    const [source] = videoSources(video('mov'), [], link)
    expect(source?.type).toBe('video/mp4; codecs="avc1.640028, mp4a.40.2"')
    expect(videoSources(video('mov', { codecs: null }), [], link)[0]?.type).toBe('video/mp4')
  })

  it('WebM sans codecs connus : type seul', () => {
    expect(videoSources(video('webm', { codecs: null }), [], link)[0]?.type).toBe('video/webm')
  })

  it('format converti (MKV) sans rendu : aucune source (original seulement en téléchargement)', () => {
    expect(videoSources(video('mkv'), [], link)).toEqual([])
  })

  it('rendus : AV1 puis H.264 quel que soit leur ordre en base, original exclu (il reste dans `url`)', () => {
    const sources = videoSources(video('mp4'), [rendition('h264'), rendition('av1')], link)
    expect(sources.map(source => source.rendition)).toEqual(['av1', 'h264'])
    expect(sources[0]).toEqual({
      url: '/m/x/v2/renditions/av1.webm?sig',
      type: 'video/webm; codecs="av01.0.08M.08, opus"',
      width: 1920,
      height: 1080,
      bitrate: 2_400_000,
      size: 6_000_000,
      rendition: 'av1',
    })
    expect(sources[1]).toMatchObject({ url: '/m/x/v2/renditions/h264.mp4?sig', type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"', rendition: 'h264' })
  })

  it('format converti avec rendu H.264 : le rendu seul', () => {
    expect(videoSources(video('mkv'), [rendition('h264')], link).map(source => source.rendition)).toEqual(['h264'])
  })

  it('AV1 sans H.264 : l\'original lisible reste en dernier recours, jamais un original converti', () => {
    expect(videoSources(video('mp4'), [rendition('av1')], link).map(source => source.rendition)).toEqual(['av1', null])
    expect(videoSources(video('mkv'), [rendition('av1')], link).map(source => source.rendition)).toEqual(['av1'])
  })

  it('noms de rendu inconnus ignorés (jamais de lien demandé pour eux)', () => {
    const asked: (RenditionName | null)[] = []
    const sources = videoSources(video('mp4'), [rendition('hevc'), rendition('h264-720')], (name) => {
      asked.push(name)
      return link(name)
    })
    expect(sources.map(source => source.rendition)).toEqual([null])
    expect(asked).toEqual([null])
  })

  it('rendu sans chaîne de codecs : type seul', () => {
    expect(videoSources(video('mp4'), [rendition('h264', { codecs: '' })], link)[0]?.type).toBe('video/mp4')
  })

  it('métadonnées absentes ou illisibles : aucun original proposé', () => {
    expect(videoSources(video('mp4', { metadata: null }), [], link)).toEqual([])
    expect(videoSources(video('mp4', { metadata: null }), [rendition('h264')], link).map(source => source.rendition)).toEqual(['h264'])
  })
})
