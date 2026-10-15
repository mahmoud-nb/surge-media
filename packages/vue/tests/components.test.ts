import type { Media, SurgeClient } from '@surge-media/client'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createSurgeMedia, SmImage, SmProcessingStatus, SmVideo } from '../src'
import { imageMedia, videoMedia } from '../../client/tests/fixtures'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SmImage', () => {
  // happy-dom ne charge pas les images et les dit « complètes » : un navigateur les dit en cours de chargement.
  beforeEach(() => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
  })

  it('repli : dérivé → original → état d\'erreur avec le texte alternatif visible', async () => {
    const wrapper = mount(SmImage, { props: { media: imageMedia } })
    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').attributes('src')).toBe(imageMedia.url)
    expect(wrapper.find('img').attributes('srcset')).toBeUndefined()
    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    const frame = wrapper.find('.sm-image--error')
    expect(frame.attributes('role')).toBe('img')
    expect(frame.attributes('aria-label')).toBe(imageMedia.altText)
    expect(frame.text()).toBe(imageMedia.altText)
    expect(wrapper.emitted('error')).toEqual([['original'], ['error']])
  })

  it('erreur antérieure à l\'hydratation : repli seulement si decode() échoue (image réellement illisible)', async () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
    vi.spyOn(HTMLImageElement.prototype, 'currentSrc', 'get').mockReturnValue('https://media.example.com/m/x/v1/w_640/x.webp')
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined)
    const loaded = mount(SmImage, { props: { media: imageMedia } })
    await flushPromises()
    expect(loaded.find('img').classes()).not.toContain('sm-image--original')
    decode.mockRejectedValue(new Error('EncodingError'))
    const broken = mount(SmImage, { props: { media: imageMedia } })
    await flushPromises()
    expect(broken.find('img').classes()).toContain('sm-image--original')
    expect(broken.emitted('error')).toEqual([['original']])
  })

  it('avertit une fois en développement d\'une image sans texte alternatif', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const media = { ...imageMedia, id: 'cmnoalt0001', altText: null }
    mount(SmImage, { props: { media } })
    mount(SmImage, { props: { media } })
    mount(SmImage, { props: { media, decorative: true } })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('recadrage CSS sur le point d\'intérêt', () => {
    const wrapper = mount(SmImage, { props: { media: imageMedia, objectFit: 'cover', aspect: 1 } })
    const style = wrapper.find('img').attributes('style')
    expect(style).toContain('object-fit: cover')
    // Point à 30 % de la largeur : le carré gardé touche le bord gauche.
    expect(style).toContain('object-position: 0% 50%')
  })
})

describe('SmProcessingStatus', () => {
  it('annonce les seules transitions (début, fin, échec)', async () => {
    const processing = ref<Media['processing']>({ status: 'pending', progress: null, error: null, updatedAt: '2026-10-15T10:00:00.000Z' })
    const wrapper = mount({ components: { SmProcessingStatus }, setup: () => ({ processing }), template: '<SmProcessingStatus :processing="processing" />' })
    const live = () => wrapper.find('[role="status"]').text()
    expect(live()).toBe('')
    processing.value = { status: 'processing', progress: 0.5, error: null, updatedAt: '2026-10-15T10:00:05.000Z' }
    await nextTick()
    expect(live()).toBe('Le traitement de la vidéo a commencé.')
    processing.value = { status: 'processing', progress: 0.7, error: null, updatedAt: '2026-10-15T10:00:10.000Z' }
    await nextTick()
    expect(live()).toBe('Le traitement de la vidéo a commencé.')
    processing.value = { status: 'ready', progress: null, error: null, updatedAt: '2026-10-15T10:00:15.000Z' }
    await nextTick()
    expect(live()).toBe('La vidéo est prête.')
  })

  it('suit la langue du plugin (Ref)', async () => {
    const locale = ref('fr')
    const wrapper = mount(SmProcessingStatus, {
      props: { processing: { status: 'pending', progress: null, error: null, updatedAt: '2026-10-15T10:00:00.000Z' } },
      global: { plugins: [createSurgeMedia({ locale, messages: { de: { processing: { states: { pending: 'Wartet' } } } } })] },
    })
    expect(wrapper.text()).toContain('En attente de traitement')
    locale.value = 'en-US'
    await nextTick()
    expect(wrapper.text()).toContain('Waiting for processing')
    locale.value = 'de'
    await nextTick()
    expect(wrapper.text()).toContain('Wartet')
  })
})

describe('SmVideo', () => {
  it('mode ambiant : muet, en boucle, sans commandes, bouton pause nommé ; rien si les animations sont limitées', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    const reduced = mount(SmVideo, { props: { media: videoMedia, ambient: true }, attachTo: document.body })
    expect(play).not.toHaveBeenCalled()
    reduced.unmount()

    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const wrapper = mount(SmVideo, { props: { media: videoMedia, ambient: true }, attachTo: document.body })
    const video = wrapper.find('video')
    expect(play).toHaveBeenCalledTimes(1)
    expect(video.attributes('controls')).toBeUndefined()
    expect(video.attributes('loop')).toBeDefined()
    expect((video.element as HTMLVideoElement).muted).toBe(true)
    const toggle = wrapper.find('button.sm-video__toggle')
    expect(toggle.attributes('aria-label')).toBe('Lire la vidéo')
    await video.trigger('play')
    expect(toggle.attributes('aria-label')).toBe('Mettre la vidéo en pause')
    wrapper.unmount()
  })

  it('vidéo retenue par le serveur (503) : message, puis nouvel essai après Retry-After', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => new Response(null, { status: 503, headers: { 'retry-after': '6' } }))
    vi.stubGlobal('fetch', fetch)
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    const wrapper = mount(SmVideo, { props: { media: videoMedia } })
    const sources = wrapper.findAll('source')
    await sources[0]!.trigger('error')
    expect(fetch).not.toHaveBeenCalled()
    await sources[1]!.trigger('error')
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith(videoMedia.sources[0]!.url, { method: 'HEAD', cache: 'no-store' })
    expect(wrapper.find('[role="status"]').text()).toBe('Cette vidéo est en cours de préparation : nouvel essai dans quelques instants.')
    await vi.advanceTimersByTimeAsync(6000)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(load).toHaveBeenCalled()
  })

  it('source illisible : état « indisponible » et lien vers l\'original', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    const wrapper = mount(SmVideo, { props: { media: videoMedia } })
    await wrapper.findAll('source')[1]!.trigger('error')
    await flushPromises()
    expect(wrapper.find('video').exists()).toBe(false)
    expect(wrapper.text()).toContain('Cette vidéo ne peut pas être lue ici.')
    expect(wrapper.find('a.sm-video__download').attributes('href')).toBe(videoMedia.url)
    expect(wrapper.emitted('error')).toHaveLength(1)
  })

  it('suit le traitement avec le client et affiche les sources dès qu\'elles existent', async () => {
    vi.useFakeTimers()
    const pending: Media = { ...videoMedia, sources: [], processing: { status: 'processing', progress: 0.5, error: null, updatedAt: '2026-10-15T10:00:00.000Z' } }
    const get = vi.fn(async () => videoMedia)
    const client = { media: { get }, project: vi.fn(), presets: vi.fn() } as unknown as SurgeClient
    const wrapper = mount(SmVideo, { props: { media: pending }, global: { plugins: [createSurgeMedia({ client, loadProject: false })] } })
    expect(wrapper.find('video').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(get).toHaveBeenCalledWith(videoMedia.id, expect.anything())
    expect(wrapper.findAll('source')).toHaveLength(2)
    expect(wrapper.emitted('update')).toEqual([[videoMedia]])
  })
})
