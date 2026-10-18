import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REFRESH_BEFORE_MS, refreshDelay } from '../src/refresh'
import type { Media } from '../src/types'
import { COMPONENT_MESSAGES, createTranslate } from '../src/ui/i18n'
import { ICON_SIZE, type IconName, ICONS, iconSvgAttributes } from '../src/ui/icons'
import { imageErrorFrameStyle, imageFailedEarly, imageSource, imageStyle, nextImageStage, resolveAltText } from '../src/ui/image'
import { pictureSources } from '../src/ui/picture'
import { displaySettings, type DisplaySettings, knownPresets, projectSettings } from '../src/ui/settings'
import { PROCESSING_ICONS, processingAnnouncementKey, processingProgress, processingReason, processingVisible } from '../src/ui/status'
import { cssText, VISUALLY_HIDDEN } from '../src/ui/styles'
import { kindIcon, kindLabelKey, thumbnailIconSizes, thumbnailImageStyle, thumbnailSource } from '../src/ui/thumbnail'
import { heldVideoDelay, prefersReducedMotion, videoEmptyStyle, videoLabel, videoMessageKey, videoPoster, videoSize, whenNearViewport } from '../src/ui/video'
import { focusPosition } from '../src/urls/focal'
import { ALL_FORMATS } from '../src/urls/picture'
import { BUILTIN_PRESETS } from '../src/urls/srcset'
import { imageMedia, presets, privateImage, project, videoMedia } from './fixtures'

/**
 * Logique des composants commune à toutes les librairies (Vue, puis React et Svelte) : textes et
 * traduction, icônes, réglages du projet, attributs et styles des images, `<picture>`, vignettes, état du
 * traitement, vidéos, relecture des URL signées. Les composants Vue la couvrent aussi (packages/vue/tests).
 */

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const display: DisplaySettings = displaySettings(projectSettings(project), knownPresets(presets.filter(preset => preset.level === 'project')))
const path = (url: string) => url.split('/v3/')[1]

describe('textes des composants', () => {
  it('français par défaut, anglais, langue régionale ramenée à sa base, repli', () => {
    expect(createTranslate('fr')('video.download')).toBe('Télécharger la vidéo originale')
    expect(createTranslate('en-GB')('video.download')).toBe('Download the original video')
    expect(createTranslate('ja')('video.download')).toBe('Télécharger la vidéo originale')
    expect(createTranslate('ja', {}, 'en')('video.download')).toBe('Download the original video')
  })

  it('surcharges et langues ajoutées d\'abord ; texte manquant pris dans la langue de repli', () => {
    const t = createTranslate('de', { de: { video: { download: 'Original herunterladen' } }, fr: { video: { play: 'Lecture' } } })
    expect(t('video.download')).toBe('Original herunterladen')
    expect(t('video.play')).toBe('Lecture')
    expect(t('video.pause')).toBe('Mettre la vidéo en pause')
  })

  it('paramètres remplacés, paramètre inconnu gardé, clé inconnue rendue telle quelle', () => {
    const t = createTranslate('fr')
    expect(t('media.download', { name: 'plage.jpg' })).toBe('Télécharger « plage.jpg »')
    expect(t('upload.announce.error', { name: 'a.png' })).toBe('Échec de l\'envoi de « a.png » : {message}')
    expect(t('video.inconnu')).toBe('video.inconnu')
  })

  it('l\'anglais a exactement les clés du français', () => {
    const keys = (node: unknown, prefix = ''): string[] => Object.entries(node as Record<string, unknown>)
      .flatMap(([key, value]) => (typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]))
    expect(keys(COMPONENT_MESSAGES.en)).toEqual(keys(COMPONENT_MESSAGES.fr))
  })
})

describe('icônes', () => {
  it('tracés de chaque icône et attributs du <svg> (décoratif, classes stables)', () => {
    for (const nodes of Object.values(ICONS)) expect(nodes.length).toBeGreaterThan(0)
    expect(iconSvgAttributes('circle-check')).toMatchObject({
      'width': ICON_SIZE,
      'height': ICON_SIZE,
      'viewBox': '0 0 24 24',
      'stroke-width': 2,
      'aria-hidden': 'true',
      'focusable': 'false',
      'class': 'sm-icon sm-icon--circle-check',
    })
    expect(iconSvgAttributes('x', 24)).toMatchObject({ width: 24, height: 24 })
  })

  it('les icônes nommées par la logique des composants existent', () => {
    const used: IconName[] = [...Object.values(PROCESSING_ICONS), kindIcon('image'), kindIcon('video')]
    for (const name of used) expect(ICONS[name]).toBeDefined()
  })
})

describe('réglages du projet', () => {
  it('projet lu, sinon valeurs de l\'application, sinon celles du serveur', () => {
    expect(projectSettings(null)).toEqual({ policy: null, formats: ALL_FORMATS, maxDimension: 4096 })
    expect(projectSettings(null, { policy: 'presets', formats: ['jpg'], maxDimension: 2000 })).toEqual({ policy: 'presets', formats: ['jpg'], maxDimension: 2000 })
    expect(projectSettings({ ...project, transformPolicy: 'signed', transformFormats: ['webp'], transformMaxDimension: 3000 }, { policy: 'presets' }))
      .toEqual({ policy: 'signed', formats: ['webp'], maxDimension: 3000 })
  })

  it('préréglages : intégrés, sauf ceux que le projet redéfinit, puis ceux du projet', () => {
    expect(knownPresets(null)).toEqual(BUILTIN_PRESETS)
    const custom = { name: 'preview', transformation: 'w_300', description: null, level: 'project' as const }
    const known = knownPresets([custom, presets[2]!])
    expect(known.filter(preset => preset.name === 'preview')).toEqual([custom])
    expect(known.at(-1)?.name).toBe('card-sm')
  })

  it('réglages complets : largeurs et format par défaut de l\'application', () => {
    expect(displaySettings(projectSettings(null), [], { widths: [320], imageFormat: 'jpg' })).toMatchObject({ widths: [320], imageFormat: 'jpg', presets: [] })
  })
})

describe('styles en ligne', () => {
  it('chaîne CSS : propriétés en kebab-case, vides ignorées, propriétés personnalisées gardées', () => {
    expect(cssText({ maxWidth: '100%', height: undefined, objectFit: 'cover', ['--sm-x' as string]: '1' })).toBe('max-width: 100%; object-fit: cover; --sm-x: 1')
    expect(cssText(VISUALLY_HIDDEN)).toContain('white-space: nowrap')
  })
})

describe('images', () => {
  it('format : celui demandé s\'il est activé, sinon celui de l\'application, sinon WebP', () => {
    expect(path(imageSource(imageMedia, { widths: [640] }, display).src)).toBe('w_640/plage-au-crepuscule.webp')
    expect(path(imageSource(imageMedia, { widths: [640], format: 'avif' }, display).src)).toBe('w_640/plage-au-crepuscule.avif')
    const limited = { ...display, formats: ['jpg', 'webp'] as const, imageFormat: 'jpg' as const }
    expect(path(imageSource(imageMedia, { widths: [640] }, limited).src)).toBe('w_640/plage-au-crepuscule.jpg')
    expect(path(imageSource(imageMedia, { widths: [640], format: 'avif' }, limited).src)).toBe('w_640/plage-au-crepuscule.webp')
  })

  it('propriétés du composant : rapport lu (`16/9`), largeurs de l\'application, préréglages imposés par la politique', () => {
    expect(path(imageSource(imageMedia, { aspect: '1', widths: [400] }, display).src)).toBe('w_400,h_400/plage-au-crepuscule.webp')
    expect(path(imageSource(imageMedia, {}, { ...display, widths: [480] }).src)).toBe('w_480/plage-au-crepuscule.webp')
    const set = imageSource(imageMedia, {}, { ...display, policy: 'presets' })
    expect(set.srcset).toContain('/preview/plage-au-crepuscule.webp')
    // Politique `signed` : un média privé (gabarit signé) garde les paramètres libres.
    expect(imageSource(privateImage, { widths: [640] }, { ...display, policy: 'signed' }).src).toContain('/w_640/')
  })

  it('texte alternatif : décoratif, propriété, celui du média ; une image sans texte signalée une fois', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveAltText(imageMedia, { decorative: true })).toBe('')
    expect(resolveAltText(imageMedia, { alt: '' })).toBe('')
    expect(resolveAltText(imageMedia)).toBe(imageMedia.altText)
    const media = { id: 'cmnoalt0002', altText: null }
    expect(resolveAltText(media)).toBe('')
    resolveAltText(media)
    resolveAltText(media, { decorative: true })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('repli : dérivé → original (images seulement) → erreur', () => {
    expect(nextImageStage('source', imageMedia)).toBe('original')
    expect(nextImageStage('original', imageMedia)).toBe('error')
    expect(nextImageStage('source', videoMedia)).toBe('error')
  })

  it('erreur antérieure à l\'hydratation : seulement si decode() échoue pour la même image', async () => {
    const broken = { complete: true, naturalWidth: 0, currentSrc: 'https://media.example.com/a.webp' }
    expect(await imageFailedEarly({ ...broken, complete: false })).toBe(false)
    expect(await imageFailedEarly({ ...broken, naturalWidth: 640 })).toBe(false)
    expect(await imageFailedEarly(broken)).toBe(false)
    expect(await imageFailedEarly({ ...broken, decode: async () => {} })).toBe(false)
    expect(await imageFailedEarly({ ...broken, decode: async () => { throw new Error('EncodingError') } })).toBe(true)
    const changed = { ...broken, decode: async () => {
      changed.currentSrc = 'https://media.example.com/b.webp'
      throw new Error('EncodingError')
    } }
    expect(await imageFailedEarly(changed)).toBe(false)
  })

  it('recadrage CSS sur le point d\'intérêt, largeur fluide, cadre d\'erreur', () => {
    // Point à 30 % de la largeur : le carré gardé touche le bord gauche.
    expect(imageStyle(imageMedia, { responsive: true }, { objectFit: 'cover', aspect: 1 })).toEqual({ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '0% 50%' })
    expect(imageStyle(imageMedia, { responsive: true })).toEqual({ maxWidth: '100%', height: 'auto' })
    expect(imageStyle(imageMedia, { responsive: false })).toEqual({})
    expect(imageErrorFrameStyle({ width: 1600, height: 900, responsive: true })).toMatchObject({ aspectRatio: '1600 / 900', width: '100%', maxWidth: '1600px' })
    expect(imageErrorFrameStyle({ width: 400, height: undefined, responsive: false })).toEqual({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '400px' })
  })

  it('position du point d\'intérêt : centre sans point, le point sans rapport connu', () => {
    expect(focusPosition({ ...imageMedia, focalPoint: null }, 1)).toBe('50% 50%')
    expect(focusPosition(imageMedia, null)).toBe('30% 60%')
  })
})

describe('<picture>', () => {
  it('une <source> par format et par cadrage, puis par format ; image de repli en JPEG', () => {
    const { sources, fallback } = pictureSources(imageMedia, { widths: [640], aspect: 16 / 9, sources: [{ media: '(max-width: 640px)', aspect: 1, widths: [320] }] }, display)
    expect(sources.map(tag => tag.key)).toEqual(['(max-width: 640px)|avif', '(max-width: 640px)|webp', '(max-width: 640px)|jpg', '|avif', '|webp'])
    expect(sources[0]).toMatchObject({ media: '(max-width: 640px)', type: 'image/avif', sizes: '100vw' })
    expect(sources[0]!.srcset).toContain('/w_320,h_320/plage-au-crepuscule.avif 320w')
    expect(sources[3]!.media).toBeUndefined()
    expect(sources[3]!.srcset).toContain('/w_640,h_360/plage-au-crepuscule.avif 640w')
    expect(path(fallback.src)).toBe('w_640,h_360/plage-au-crepuscule.jpg')
  })

  it('un cadrage sans rapport garde le rapport de l\'image ; formats activés sur le serveur et demandés seulement', () => {
    const { sources } = pictureSources(imageMedia, { widths: [640], aspect: 1, sources: [{ media: '(min-width: 1200px)' }] }, { ...display, formats: ['jpg', 'webp'] })
    expect(sources.map(tag => tag.key)).toEqual(['(min-width: 1200px)|webp', '(min-width: 1200px)|jpg', '|webp'])
    expect(sources[0]!.srcset).toContain('/w_640/plage-au-crepuscule.webp')
    expect(pictureSources(imageMedia, { widths: [640], formats: ['jpg', 'webp'] }, display).sources.map(tag => tag.key)).toEqual(['|webp'])
  })
})

describe('vignettes', () => {
  it('carré recadré par le serveur ; préréglages seulement : l\'aperçu', () => {
    expect(path(thumbnailSource(imageMedia, 160, display).src)).toBe('w_160,h_160/plage-au-crepuscule.webp')
    expect(path(thumbnailSource(imageMedia, 160, { ...display, policy: 'presets' }).src)).toBe('preview/plage-au-crepuscule.webp')
  })

  it('icône et nom du genre, tailles des icônes, cadrage de l\'affiche d\'une vidéo', () => {
    expect([kindIcon('image'), kindIcon('video')]).toEqual(['image', 'film'])
    expect(createTranslate('fr')(kindLabelKey('video'))).toBe('Vidéo')
    expect(thumbnailIconSizes(160)).toEqual({ kind: 40, play: 20 })
    expect(thumbnailIconSizes(40)).toEqual({ kind: 16, play: 12 })
    expect(thumbnailImageStyle(videoMedia).objectPosition).toBe('50% 50%')
    expect(thumbnailImageStyle({ ...videoMedia, focalPoint: { x: 0, y: 0.5 } }).objectPosition).toBe('0% 50%')
    expect(thumbnailImageStyle(imageMedia).objectPosition).toBe('0% 50%')
  })
})

describe('état du traitement', () => {
  const processing = (status: 'pending' | 'processing' | 'ready' | 'failed', extra: Partial<NonNullable<Media['processing']>> = {}) =>
    ({ status, progress: null, error: null, updatedAt: '2026-10-15T10:00:00.000Z', ...extra })

  it('montré hors « prête » ; avancement pendant le traitement seulement', () => {
    expect(processingVisible(null)).toBe(false)
    expect(processingVisible(processing('ready'))).toBe(false)
    expect(processingVisible(processing('failed'))).toBe(true)
    expect(processingProgress(processing('processing', { progress: 0.4 }))).toBe(0.4)
    expect(processingProgress(processing('pending', { progress: 0.4 }))).toBeNull()
  })

  it('raison traduite d\'un échec ; code sans texte ignoré', () => {
    const t = createTranslate('en')
    expect(processingReason(processing('failed', { error: 'TIMEOUT' }), t)).toBe('Processing took too long.')
    expect(processingReason(processing('failed', { error: 'NEW_CODE' as 'TIMEOUT' }), t)).toBeNull()
    expect(processingReason(processing('processing', { error: 'TIMEOUT' }), t)).toBeNull()
  })

  it('annonces aux seules transitions', () => {
    expect(processingAnnouncementKey('processing', 'pending')).toBe('processing.announce.started')
    expect(processingAnnouncementKey('processing', 'processing')).toBeNull()
    expect(processingAnnouncementKey('ready', 'processing')).toBe('processing.announce.ready')
    expect(processingAnnouncementKey('ready', undefined)).toBeNull()
    expect(processingAnnouncementKey('failed', null)).toBe('processing.announce.failed')
    expect(processingAnnouncementKey('pending', null)).toBeNull()
  })
})

describe('vidéos', () => {
  it('affiche : dérivé dimensionné, URL donnée, aucune, ou l\'affiche telle quelle (préréglages)', () => {
    expect(videoPoster(videoMedia, {}, display)).toBe('https://media.example.com/m/cmvideo0001/v2/w_1280/visite.webp')
    expect(videoPoster(videoMedia, { posterWidth: 640 }, display)).toBe('https://media.example.com/m/cmvideo0001/v2/w_640/visite.webp')
    expect(videoPoster(videoMedia, { poster: '/affiche.jpg' }, display)).toBe('/affiche.jpg')
    expect(videoPoster(videoMedia, { poster: false }, display)).toBeUndefined()
    expect(videoPoster(videoMedia, {}, { ...display, policy: 'presets' })).toBe(videoMedia.poster!.url)
    expect(videoPoster({ ...videoMedia, poster: null }, {}, display)).toBeUndefined()
  })

  it('dimensions, nom accessible, message sans source lisible', () => {
    expect(videoSize(videoMedia)).toEqual({ width: 1920, height: 1080 })
    expect(videoSize({ ...videoMedia, width: null, height: null }, { width: 640 })).toEqual({ width: 640, height: 1080 })
    expect(videoLabel(videoMedia)).toBe('Visite')
    expect(videoLabel({ title: null, altText: 'Plan large' })).toBe('Plan large')
    expect(videoLabel(videoMedia, 'Bande-annonce')).toBe('Bande-annonce')
    expect(videoMessageKey({ processing: { status: 'processing', progress: 0.5, error: null, updatedAt: '' } })).toBe('video.noSource')
    expect(videoMessageKey({ processing: { status: 'processing', progress: 0.5, error: null, updatedAt: '' } }, true)).toBe('video.unavailable')
    expect(videoMessageKey({ processing: null })).toBe('video.unavailable')
    expect(videoEmptyStyle(undefined, undefined)).toMatchObject({ width: '640px', aspectRatio: '16 / 9' })
    expect(videoEmptyStyle(800, 600)).toMatchObject({ width: '800px', aspectRatio: '800 / 600' })
  })

  it('vidéo retenue (503) : délai de Retry-After borné entre 5 s et 5 min ; sinon null', async () => {
    const answer = (status: number, retryAfter?: string) => vi.fn(async () => new Response(null, { status, headers: retryAfter ? { 'retry-after': retryAfter } : {} }))
    const fetch = answer(503, '6')
    expect(await heldVideoDelay('https://media.example.com/v.mp4', { fetch })).toBe(6000)
    expect(fetch).toHaveBeenCalledWith('https://media.example.com/v.mp4', { method: 'HEAD', cache: 'no-store' })
    expect(await heldVideoDelay('x', { fetch: answer(503) })).toBe(30_000)
    expect(await heldVideoDelay('x', { fetch: answer(503, '1') })).toBe(5000)
    expect(await heldVideoDelay('x', { fetch: answer(503, '3600') })).toBe(300_000)
    expect(await heldVideoDelay('x', { fetch: answer(404) })).toBeNull()
    expect(await heldVideoDelay('x', { fetch: vi.fn(async () => { throw new TypeError('Failed to fetch') }) })).toBeNull()
    // Sans `fetch` fourni : celui de l'environnement, lu à l'appel.
    vi.stubGlobal('fetch', answer(503, '10'))
    expect(await heldVideoDelay('x')).toBe(10_000)
  })

  it('chargement différé : à l\'approche de l\'écran, ou tout de suite sans IntersectionObserver', () => {
    const element = {} as Element
    const immediate = vi.fn()
    whenNearViewport(element, immediate)
    expect(immediate).toHaveBeenCalledTimes(1)

    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof notify) {
        notify = callback
      }

      observe() {}
      disconnect() {
        disconnect()
      }
    })
    const near = vi.fn()
    whenNearViewport(element, near)
    notify([{ isIntersecting: false }])
    expect(near).not.toHaveBeenCalled()
    notify([{ isIntersecting: true }])
    expect(near).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalled()
  })

  it('animations limitées : jamais de lecture automatique', () => {
    expect(prefersReducedMotion()).toBe(false)
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query.includes('reduce') }) })
    expect(prefersReducedMotion()).toBe(true)
  })
})

describe('relecture des URL signées', () => {
  const now = Date.parse('2026-10-17T10:00:00.000Z')

  it('2 min avant l\'échéance, 10 s au moins ; rien sans échéance ou si désactivée', () => {
    expect(refreshDelay({ urlExpiresAt: '2026-10-17T11:00:00.000Z' }, DEFAULT_REFRESH_BEFORE_MS, now)).toBe(58 * 60_000)
    expect(refreshDelay({ urlExpiresAt: '2026-10-17T10:01:00.000Z' }, DEFAULT_REFRESH_BEFORE_MS, now)).toBe(10_000)
    expect(refreshDelay({ urlExpiresAt: '2030-01-01T00:00:00.000Z' }, DEFAULT_REFRESH_BEFORE_MS, now)).toBe(2_147_000_000)
    expect(refreshDelay({ urlExpiresAt: null })).toBeNull()
    expect(refreshDelay({ urlExpiresAt: '2026-10-17T11:00:00.000Z' }, 0, now)).toBeNull()
  })
})
