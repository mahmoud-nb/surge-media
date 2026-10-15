// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { type Component, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createSurgeMedia, SmImage, SmMedia, SmPicture, SmProcessingStatus, SmThumbnail, SmVideo } from '../src'
import { imageMedia, privateImage, project, videoMedia } from '../../client/tests/fixtures'

/**
 * Rendu serveur dans Node (aucun `window`) : les paquets s'importent sans navigateur et produisent un
 * balisage complet et déterministe (srcset, dimensions, texte alternatif, sources vidéo).
 */
async function render(component: Component, props: Record<string, unknown>, options: Parameters<typeof createSurgeMedia>[0] = {}) {
  const app = createSSRApp({ render: () => h(component, props) })
  app.use(createSurgeMedia(options))
  return renderToString(app)
}

describe('rendu serveur', () => {
  it('SmImage : srcset, sizes, dimensions et texte alternatif, sans plugin configuré', async () => {
    const html = await render(SmImage, { media: imageMedia, widths: [640, 1280], sizes: '(min-width: 800px) 50vw, 100vw' })
    expect(html).toContain('srcset="https://media.example.com/m/cmimage0001/v3/w_640/plage-au-crepuscule.webp 640w, https://media.example.com/m/cmimage0001/v3/w_1280/plage-au-crepuscule.webp 1280w"')
    expect(html).toContain('sizes="(min-width: 800px) 50vw, 100vw"')
    expect(html).toContain('width="1280" height="853"')
    expect(html).toContain('alt="Une plage au coucher du soleil"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('style="max-width:100%;height:auto;"')
    // Rendu identique à chaque fois (hydratation sans écart).
    expect(await render(SmImage, { media: imageMedia, widths: [640, 1280] })).toBe(await render(SmImage, { media: imageMedia, widths: [640, 1280] }))
  })

  it('SmImage : politique et formats du projet connus dès le rendu serveur', async () => {
    const presetsOnly = await render(SmImage, { media: imageMedia, priority: true }, { project: { ...project, transformPolicy: 'presets', transformFormats: ['jpg'] } })
    expect(presetsOnly).toContain('/preview/plage-au-crepuscule.jpg 480w')
    expect(presetsOnly).not.toContain('/w_')
    expect(presetsOnly).toContain('loading="eager" fetchpriority="high"')
    // Média privé en politique « signed » : le gabarit signé permet les paramètres libres.
    const signed = await render(SmImage, { media: privateImage, width: 320, decorative: true }, { project: { ...project, transformPolicy: 'signed' } })
    expect(signed).toContain('/w_320/plage-au-crepuscule.webp?exp=1900000000&amp;kid=abcd1234&amp;scope=derived&amp;sig=')
    expect(signed).toMatch(/ alt[ >]/) // alt vide (équivalent à alt="")
  })

  it('SmPicture : sources par format activé, repli JPEG, direction artistique', async () => {
    const html = await render(SmPicture, {
      media: imageMedia,
      widths: [800],
      sources: [{ media: '(max-width: 600px)', aspect: 1, widths: [600] }],
    }, { defaults: { formats: ['jpg', 'webp', 'avif'] } })
    expect(html).toMatch(/<source media="\(max-width: 600px\)" type="image\/avif" srcset="[^"]*\/w_600,h_600\/plage-au-crepuscule\.avif 600w"/)
    expect(html).toContain('type="image/webp" srcset="https://media.example.com/m/cmimage0001/v3/w_800/plage-au-crepuscule.webp 800w"')
    expect(html).toContain('src="https://media.example.com/m/cmimage0001/v3/w_800/plage-au-crepuscule.jpg"')
    expect(html.indexOf('image/avif"')).toBeLessThan(html.indexOf('image/webp"'))
  })

  it('SmVideo : sources dans l\'ordre, sous-titres, affiche, aucune lecture automatique', async () => {
    const html = await render(SmVideo, { media: videoMedia })
    expect(html).toMatch(/<source src="[^"]*av1\.webm" type="video\/webm; codecs=&quot;av01\.0\.08M\.08, opus&quot;">\s*<source src="[^"]*h264\.mp4"/)
    expect(html).toContain('<track kind="captions" srclang="fr" label="Français" src="https://media.example.com/m/cmvideo0001/v2/tracks/cmtrack0001.vtt" default>')
    expect(html).toContain('crossorigin="anonymous"')
    expect(html).toContain('poster="https://media.example.com/m/cmvideo0001/v2/w_1280/visite.webp"')
    expect(html).toContain('aria-label="Visite"')
    expect(html).toContain('preload="metadata"')
    expect(html).not.toContain('autoplay')
    expect(html).toContain('Votre navigateur ne peut pas lire cette vidéo.')
  })

  it('SmVideo : sans source lisible, état du traitement et lien vers l\'original ; en anglais', async () => {
    const pending = { ...videoMedia, sources: [], processing: { status: 'processing' as const, progress: 0.25, error: null, updatedAt: '2026-10-15T10:00:00.000Z' } }
    const html = await render(SmVideo, { media: pending, lazy: true }, { locale: 'en' })
    expect(html).toContain('This video will play here as soon as its compatible version is ready.')
    expect(html).toContain('Processing')
    expect(html).toContain('<progress max="1" value="0.25" aria-label="Processing progress">')
    expect(html).toContain('25%')
    expect(html).toContain(`href="${videoMedia.url}"`)
    expect(html).toContain('Download the original video')
  })

  it('SmMedia, SmThumbnail, SmProcessingStatus', async () => {
    expect(await render(SmMedia, { media: imageMedia, width: 200 })).toContain('<img class="sm-image"')
    expect(await render(SmMedia, { media: videoMedia })).toContain('<video')
    const thumbnail = await render(SmThumbnail, { media: videoMedia, size: 120 })
    expect(thumbnail).toContain('/w_120,h_120/visite.webp')
    expect(thumbnail).toContain('1:23')
    // Intl sépare nombre et unité par une espace insécable.
    expect(thumbnail).toMatch(/Durée : 1\sminute et 23\ssecondes/)
    const failed = await render(SmProcessingStatus, { processing: { status: 'failed', progress: null, error: 'TOO_LONG', updatedAt: '2026-10-15T10:00:00.000Z' } })
    expect(failed).toContain('Traitement interrompu')
    expect(failed).toContain('La vidéo dépasse la durée maximale de traitement.')
    expect(failed).toContain('role="status"')
  })
})
