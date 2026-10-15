import { BUILTIN_PRESETS } from '@surge-media/client'
import { describe, expect, it } from 'vitest'
import { imageSourceSet, type ImageSourceRequest, parseAspect } from '../src/image-sources'
import { imageMedia, presets, videoMedia } from '../../client/tests/fixtures'

const base: ImageSourceRequest = { media: imageMedia, format: 'webp', mode: 'free', maxDimension: 4096, presets: [...BUILTIN_PRESETS, ...presets] }
const path = (url: string) => url.split('/v3/')[1]

describe('rapport', () => {
  it('lit 16/9, 4:3, 1.5 ; refuse le reste', () => {
    expect(parseAspect('16/9')).toBeCloseTo(16 / 9)
    expect(parseAspect('4:3')).toBeCloseTo(4 / 3)
    expect(parseAspect(1.5)).toBe(1.5)
    expect(parseAspect('abc')).toBeNull()
    expect(parseAspect(0)).toBeNull()
  })
})

describe('attributs d\'une image', () => {
  it('fluide : srcset en largeurs, sizes, dimensions de la plus grande variante', () => {
    const set = imageSourceSet({ ...base, widths: [480, 1024, 4000] })
    expect(set.srcset?.split(', ').map(entry => entry.split(' ')[1])).toEqual(['480w', '1024w', '3000w'])
    expect(set).toMatchObject({ sizes: '100vw', width: 3000, height: 2000, responsive: true })
    expect(path(set.src)).toBe('w_1024/plage-au-crepuscule.webp')
  })

  it('rapport imposé : recadrage cover et hauteur cohérente', () => {
    const set = imageSourceSet({ ...base, aspect: 1, widths: [400, 800], sizes: '50vw' })
    expect(path(set.src)).toBe('w_800,h_800/plage-au-crepuscule.webp')
    expect(set).toMatchObject({ sizes: '50vw', width: 800, height: 800 })
  })

  it('taille fixe : densités 1x, 2x, 3x et dimensions d\'affichage', () => {
    const set = imageSourceSet({ ...base, width: 400, aspect: 16 / 9 })
    expect(path(set.src)).toBe('w_400,h_225/plage-au-crepuscule.webp')
    expect(set.srcset).toContain('/w_800,h_450/plage-au-crepuscule.webp 2x')
    expect(set).toMatchObject({ width: 400, height: 225, responsive: false })
    // Largeur seule : hauteur déduite de l'image.
    expect(imageSourceSet({ ...base, width: 300 })).toMatchObject({ width: 300, height: 200 })
  })

  it('préréglage nommé : dimensions calculées d\'après sa transformation', () => {
    const set = imageSourceSet({ ...base, preset: 'card-sm' })
    expect(path(set.src)).toBe('card-sm/plage-au-crepuscule.webp')
    expect(set).toMatchObject({ width: 400, height: 300 })
  })

  it('politique « préréglages » : srcset de l\'aperçu et de l\'image entière, ou des préréglages donnés', () => {
    const fallback = imageSourceSet({ ...base, mode: 'presets' })
    expect(fallback.srcset?.split(', ').map(entry => path(entry))).toEqual(['preview/plage-au-crepuscule.webp 480w', 'full/plage-au-crepuscule.webp 3000w'])
    const chosen = imageSourceSet({ ...base, mode: 'presets', presetNames: ['card-lg', 'card-sm'], sizes: '33vw' })
    expect(chosen.srcset).toContain('card-sm/plage-au-crepuscule.webp 400w')
    expect(chosen.sizes).toBe('33vw')
  })

  it('vidéo : srcset de son affiche ; sans gabarit, le fichier tel quel', () => {
    expect(imageSourceSet({ ...base, media: videoMedia, widths: [640] }).src).toBe('https://media.example.com/m/cmvideo0001/v2/w_640/visite.webp')
    expect(imageSourceSet({ ...base, media: { ...videoMedia, urlTemplate: null, poster: null } })).toMatchObject({ src: videoMedia.url })
  })
})
