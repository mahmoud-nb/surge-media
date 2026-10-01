import { Readable } from 'node:stream'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { imageHandler } from '../server/lib/media/handlers/image'
import { planTransform, type TransformSource } from '../server/lib/media/transform-plan'
import { parseTransformation, type TransformFormat } from '../shared/utils/transforms'

/**
 * Pipeline sharp réel (handlers/image.ts) : ordre orientation EXIF → rotation → miroir → zone →
 * taille, vérifié sur une image repère (quadrant haut-gauche rouge) pour chaque combinaison.
 */

type Corner = 'TL' | 'TR' | 'BR' | 'BL'
const CLOCKWISE: Record<Corner, Corner> = { TL: 'TR', TR: 'BR', BR: 'BL', BL: 'TL' }
const MIRROR_H: Record<Corner, Corner> = { TL: 'TR', TR: 'TL', BL: 'BR', BR: 'BL' }
const MIRROR_V: Record<Corner, Corner> = { TL: 'BL', BL: 'TL', TR: 'BR', BR: 'TR' }

async function marker(orientation?: number): Promise<Buffer> {
  const width = 40
  const height = 20
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < 10; y++) for (let x = 0; x < 20; x++) raw[(y * width + x) * 3] = 255
  const image = sharp(raw, { raw: { width, height, channels: 3 } })
  return orientation ? image.withMetadata({ orientation }).jpeg({ quality: 100 }).toBuffer() : image.png().toBuffer()
}

async function redCorner(data: Buffer): Promise<{ corner: Corner | null, width: number, height: number }> {
  const { data: pixels, info } = await sharp(data).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const red = (x: number, y: number) => pixels[(y * info.width + x) * info.channels]! > 128
  const w = info.width - 1
  const h = info.height - 1
  const corner = red(0, 0) ? 'TL' : red(w, 0) ? 'TR' : red(w, h) ? 'BR' : red(0, h) ? 'BL' : null
  return { corner, width: info.width, height: info.height }
}

async function render(input: Buffer, segment: string, source: TransformSource, format: TransformFormat = 'png') {
  const parsed = parseTransformation(segment)
  if (!parsed.ok) throw new Error(parsed.message)
  const planned = planTransform(parsed.transformation, source, format, 4096)
  if (!planned.ok) throw new Error(planned.message)
  const rendered = await imageHandler.transform!(Readable.from(input), planned.plan)
  return { rendered, plan: planned.plan }
}

describe('pipeline d\'images', () => {
  const landscape: TransformSource = { width: 40, height: 20, hasAlpha: false, focal: null }

  for (const rotate of [0, 90, 180, 270] as const) {
    for (const flip of [null, 'h', 'v', 'hv'] as const) {
      it(`r_${rotate} puis flip_${flip ?? '—'}`, async () => {
        const segment = [rotate ? `r_${rotate}` : '', flip ? `flip_${flip}` : ''].filter(Boolean).join(',')
        let expected: Corner = 'TL'
        for (let turn = 0; turn < rotate / 90; turn++) expected = CLOCKWISE[expected]
        if (flip?.includes('h')) expected = MIRROR_H[expected]
        if (flip?.includes('v')) expected = MIRROR_V[expected]

        const { rendered } = await render(await marker(), segment, landscape)
        const result = await redCorner(rendered.data)
        expect(result.corner).toBe(expected)
        expect([result.width, result.height]).toEqual(rotate % 180 ? [20, 40] : [40, 20])
      })
    }
  }

  it('applique l\'orientation EXIF avant la rotation et le miroir', async () => {
    // Orientation 6 : l'image s'affiche après un quart de tour horaire (dimensions orientées 20 × 40).
    const portrait: TransformSource = { width: 20, height: 40, hasAlpha: false, focal: null }
    const input = await marker(6)
    expect((await redCorner((await render(input, '', portrait)).rendered.data)).corner).toBe('TR')
    expect((await redCorner((await render(input, 'r_90', portrait)).rendered.data)).corner).toBe('BR')
    expect((await redCorner((await render(input, 'r_90,flip_h', portrait)).rendered.data)).corner).toBe('BL')
    // Zone exprimée dans l'image orientée : le quadrant rouge est en haut à droite (x 10–20, y 0–20).
    const crop = await render(input, 'crop_10-0-10-20', portrait)
    expect(await redCorner(crop.rendered.data)).toEqual({ corner: 'TL', width: 10, height: 20 })
  })

  it('produit les dimensions prévues dans chaque format, sans métadonnées', async () => {
    const photo = await sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } })
      .withMetadata({ orientation: 1 })
      .png()
      .toBuffer()
    const source: TransformSource = { width: 1200, height: 800, hasAlpha: true, focal: null }
    for (const format of ['jpg', 'png', 'webp', 'avif'] as const) {
      const { rendered, plan } = await render(photo, 'w_2000,h_1000', source, format)
      const meta = await sharp(rendered.data).metadata()
      expect([rendered.width, rendered.height]).toEqual([plan.width, plan.height])
      expect([meta.width, meta.height]).toEqual([1200, 600])
      expect(meta.format).toBe(format === 'jpg' ? 'jpeg' : format === 'avif' ? 'heif' : format)
      expect(meta.exif).toBeUndefined()
      if (format === 'jpg') expect(meta.hasAlpha).toBe(false)
    }
  })
})
