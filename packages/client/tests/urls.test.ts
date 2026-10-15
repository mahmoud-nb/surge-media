import { describe, expect, it } from 'vitest'
import { transformMode } from '../src/policy'
import { focalObjectPosition, objectPosition } from '../src/urls/focal'
import { mediaUrl, posterUrl } from '../src/urls/media-url'
import { imageFormat, pictureFormats } from '../src/urls/picture'
import { densityCandidates, presetCandidates, srcsetAttribute, widthCandidates } from '../src/urls/srcset'
import { imageMedia, presets, privateImage, videoMedia } from './fixtures'

describe('URL d\'un dérivé', () => {
  it('remplace le segment et le format dans le gabarit', () => {
    expect(mediaUrl(imageMedia, { transform: { height: 450, width: 800, quality: 70 }, format: 'avif' }))
      .toBe('https://media.example.com/m/cmimage0001/v3/w_800,h_450,q_70/plage-au-crepuscule.avif')
    expect(mediaUrl(imageMedia, { preset: 'card-sm' })).toBe('https://media.example.com/m/cmimage0001/v3/card-sm/plage-au-crepuscule.webp')
    expect(mediaUrl(imageMedia)).toBe('https://media.example.com/m/cmimage0001/v3/full/plage-au-crepuscule.webp')
    expect(() => mediaUrl(imageMedia, { preset: 'Bad Name' })).toThrow(RangeError)
  })

  it('garde la signature « derived » d\'un média privé', () => {
    const url = mediaUrl(privateImage, { transform: { width: 640 }, format: 'jpg' })!
    expect(url.startsWith('https://media.example.com/m/cmimage0001/v3/w_640/plage-au-crepuscule.jpg?')).toBe(true)
    expect(new URL(url).searchParams.get('scope')).toBe('derived')
  })

  it('affiche d\'une vidéo : dimensionnée par le gabarit, sinon entière', () => {
    expect(posterUrl(videoMedia, { width: 960 })).toBe('https://media.example.com/m/cmvideo0001/v2/w_960/visite.webp')
    expect(posterUrl(videoMedia)).toBe('https://media.example.com/m/cmvideo0001/v2/full/visite.jpg')
    expect(posterUrl(imageMedia)).toBeNull()
  })
})

describe('srcset', () => {
  it('largeurs bornées à la source, descripteurs réels, sans doublon', () => {
    const candidates = widthCandidates({ ...imageMedia, width: 1000, height: 800 }, { widths: [480, 800, 1200, 1600] })
    expect(candidates.map(candidate => candidate.descriptor)).toEqual(['480w', '800w', '1000w'])
    expect(candidates[2]).toMatchObject({ width: 1000, height: 800 })
    expect(srcsetAttribute(candidates.slice(0, 1))).toBe('https://media.example.com/m/cmimage0001/v3/w_480/plage-au-crepuscule.webp 480w')
  })

  it('rapport imposé : recadrage cover (point d\'intérêt par défaut) et hauteur arrondie', () => {
    const [first] = widthCandidates(imageMedia, { widths: [640], aspect: 16 / 9, format: 'jpg' })
    expect(first).toMatchObject({ descriptor: '640w', width: 640, height: 360 })
    expect(first!.url).toBe('https://media.example.com/m/cmimage0001/v3/w_640,h_360/plage-au-crepuscule.jpg')
  })

  it('densités : seulement celles que la source permet', () => {
    expect(densityCandidates(imageMedia, { width: 800 }).map(candidate => candidate.descriptor)).toEqual(['1x', '2x', '3x'])
    expect(densityCandidates({ ...imageMedia, width: 1000, height: 667 }, { width: 800 }).map(candidate => candidate.descriptor)).toEqual(['1x'])
    expect(densityCandidates({ ...imageMedia, width: 1300, height: 867 }, { width: 800 }).map(candidate => candidate.descriptor)).toEqual(['1x', '2x'])
    expect(densityCandidates(imageMedia, { width: 400, height: 300 })[1]!.url).toContain('/w_800,h_600/')
  })

  it('préréglages : largeur lue dans leur transformation, triés, inconnus ignorés', () => {
    const candidates = presetCandidates(imageMedia, ['card-lg', 'inconnu', 'card-sm'], presets)
    expect(candidates.map(candidate => [candidate.descriptor, candidate.url.split('/v3/')[1]])).toEqual([
      ['400w', 'card-sm/plage-au-crepuscule.webp'],
      ['800w', 'card-lg/plage-au-crepuscule.webp'],
    ])
  })

  it('vidéo : srcset de son affiche ; sans affiche ni gabarit, rien', () => {
    expect(widthCandidates(videoMedia, { widths: [480, 4000] }).map(candidate => candidate.descriptor)).toEqual(['480w', '1920w'])
    expect(widthCandidates({ ...videoMedia, poster: null, urlTemplate: null })).toEqual([])
  })
})

describe('formats', () => {
  it('<picture> : AVIF puis WebP, repli JPEG, formats désactivés exclus', () => {
    expect(pictureFormats(['jpg', 'png', 'webp', 'avif'])).toEqual({ sources: ['avif', 'webp'], fallback: 'jpg' })
    expect(pictureFormats(['webp', 'png'])).toEqual({ sources: ['webp'], fallback: 'png' })
    expect(pictureFormats(['avif'])).toEqual({ sources: [], fallback: 'avif' })
    expect(pictureFormats([])).toEqual({ sources: ['avif', 'webp'], fallback: 'jpg' })
  })

  it('<img> seule : format préféré s\'il est activé, sinon WebP', () => {
    expect(imageFormat(['jpg', 'webp'], 'avif')).toBe('webp')
    expect(imageFormat(['jpg', 'avif'])).toBe('jpg')
    expect(imageFormat(undefined, 'avif')).toBe('avif')
  })
})

describe('politique de transformation', () => {
  it('open → libres ; signed → libres seulement avec un gabarit signé ; presets → préréglages', () => {
    expect(transformMode('open', imageMedia)).toBe('free')
    expect(transformMode('signed', imageMedia)).toBe('presets')
    expect(transformMode('signed', privateImage)).toBe('free')
    expect(transformMode('presets', privateImage)).toBe('presets')
    expect(transformMode(undefined, imageMedia)).toBe('free')
  })
})

describe('point d\'intérêt', () => {
  it('position CSS du recadrage', () => {
    expect(focalObjectPosition(3000, 2000, 1, null)).toEqual({ x: 0.5, y: 0.5 })
    // Carré de 2000 px gardé dans 3000 × 2000, centré sur x = 1800 px : bord gauche à 800 px sur 1000 possibles.
    const position = focalObjectPosition(3000, 2000, 1, { x: 0.6, y: 0.6 })
    expect(position.y).toBe(0.5)
    expect(position.x).toBeCloseTo(0.8)
    expect(focalObjectPosition(3000, 2000, 1, { x: 0.1, y: 0.5 }).x).toBe(0)
    expect(objectPosition({ x: 0.2, y: 0.5 })).toBe('20% 50%')
  })
})
