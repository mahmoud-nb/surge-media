import { BUILTIN_PRESETS as CORE_BUILTIN_PRESETS, parseTransformation } from '#shared/utils/transforms'
import { describe, expect, it } from 'vitest'
import { planTransform } from '../../../apps/core/server/lib/media/transform-plan'
import { BUILTIN_PRESETS } from '../src/urls/srcset'
import { buildTransform, outputSize, parseTransform, type TransformOptions, transformSegment } from '../src/urls/transform'

/**
 * Recoupement avec le core : le client doit écrire exactement la forme canonique du serveur (sinon chaque
 * image coûte une redirection 301) et prévoir exactement la taille du fichier produit (descripteurs du
 * srcset, attributs width/height).
 */

const MAX = 4096

const CASES: TransformOptions[] = [
  {},
  { width: 800 },
  { height: 600 },
  { width: 800, height: 450 },
  { width: 800, height: 450, fit: 'cover', gravity: 'focal' },
  { width: 800, height: 450, gravity: 'north' },
  { width: 800, height: 450, gravity: 'attention' },
  { width: 800, height: 450, fit: 'contain', background: '#FFAA00' },
  { width: 800, height: 450, fit: 'inside' },
  { width: 800, height: 450, fit: 'outside' },
  { width: 800, height: 450, fit: 'fill' },
  { width: 800, gravity: 'north' },
  { width: 800, fit: 'contain' },
  { width: 800, dpr: 2 },
  { width: 800, height: 600, dpr: 1.5 },
  { width: 3000, height: 1000, dpr: 2 },
  { height: 1500, dpr: 3 },
  { dpr: 2 },
  { rotate: 90 },
  { rotate: 270, width: 600 },
  { rotate: 90, flip: 'hv', crop: { x: 10, y: 20, width: 500, height: 400 }, width: 300 },
  { flip: 'v', crop: { x: 0, y: 0, width: 640, height: 480 }, width: 320, height: 320 },
  { quality: 70 },
  { width: 640, quality: 100, background: 'ffffff' },
  { width: 4096, height: 4096, fit: 'contain' },
]

/** Écriture naïve, dans le désordre, sans normalisation : le serveur doit la ramener au même canonique. */
function raw(options: TransformOptions): string {
  const parts: string[] = []
  if (options.dpr !== undefined) parts.push(`dpr_${options.dpr}`)
  if (options.background !== undefined) parts.push(`bg_${options.background.replace('#', '')}`)
  if (options.quality !== undefined) parts.push(`q_${options.quality}`)
  if (options.gravity !== undefined) parts.push(`g_${options.gravity}`)
  if (options.fit !== undefined) parts.push(`fit_${options.fit}`)
  if (options.height !== undefined) parts.push(`h_${options.height}`)
  if (options.width !== undefined) parts.push(`w_${options.width}`)
  if (options.crop) parts.push(`crop_${options.crop.x}-${options.crop.y}-${options.crop.width}-${options.crop.height}`)
  if (options.flip !== undefined) parts.push(`flip_${options.flip}`)
  if (options.rotate !== undefined) parts.push(`r_${options.rotate}`)
  return parts.join(',')
}

describe('forme canonique (recoupée avec parseTransformation du core)', () => {
  it.each(CASES.map(options => [JSON.stringify(options), options] as const))('%s', (_, options) => {
    const canonical = buildTransform(options, MAX)
    const parsed = parseTransformation(canonical, { maxDimension: MAX })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.canonical).toBe(canonical)
    const fromRaw = parseTransformation(raw(options), { maxDimension: MAX })
    expect(fromRaw.ok).toBe(true)
    if (fromRaw.ok) expect(fromRaw.canonical).toBe(canonical)
  })

  it('borne les dimensions à la dimension maximale en gardant le rapport (le serveur les refuserait)', () => {
    expect(buildTransform({ width: 5000 }, MAX)).toBe('w_4096')
    expect(buildTransform({ width: 6000, height: 3000 }, MAX)).toBe('w_4096,h_2048')
    expect(buildTransform({ width: 2000 }, 1024)).toBe('w_1024')
    expect(parseTransformation(buildTransform({ width: 6000, height: 3000 }, MAX), { maxDimension: MAX }).ok).toBe(true)
  })

  it('segment vide = full ; valeurs impossibles refusées', () => {
    expect(transformSegment(buildTransform({}))).toBe('full')
    expect(() => buildTransform({ quality: 101 })).toThrow(RangeError)
    expect(() => buildTransform({ dpr: 1.25 })).toThrow(RangeError)
    expect(() => buildTransform({ background: 'red' })).toThrow(RangeError)
    expect(() => buildTransform({ width: 0 })).toThrow(RangeError)
  })

  it('préréglages intégrés identiques à ceux du serveur', () => {
    expect(Object.fromEntries(BUILTIN_PRESETS.map(preset => [preset.name, preset.transformation]))).toEqual(CORE_BUILTIN_PRESETS)
  })

  it('relit la transformation d\'un préréglage', () => {
    expect(parseTransform('w_480,h_480,fit_inside,q_72')).toEqual({ width: 480, height: 480, fit: 'inside', quality: 72 })
    expect(parseTransform('r_90,flip_h,crop_1-2-30-40,g_north,bg_ffffff,dpr_2')).toEqual({
      rotate: 90, flip: 'h', crop: { x: 1, y: 2, width: 30, height: 40 }, gravity: 'north', background: 'ffffff', dpr: 2,
    })
    expect(parseTransform('full')).toEqual({})
  })
})

describe('taille réelle (recoupée avec planTransform du core)', () => {
  const SOURCES = [
    { width: 3000, height: 2000 },
    { width: 1200, height: 800 },
    { width: 800, height: 1200 },
    { width: 6000, height: 6000 },
    { width: 640, height: 480 },
  ]

  for (const source of SOURCES) {
    it(`source ${source.width}×${source.height}`, () => {
      for (const options of CASES) {
        const canonical = buildTransform(options, MAX)
        const parsed = parseTransformation(canonical, { maxDimension: MAX })
        if (!parsed.ok) throw new Error(canonical)
        for (const format of ['webp', 'jpg'] as const) {
          const plan = planTransform(parsed.transformation, { ...source, hasAlpha: false, focal: { x: 0.3, y: 0.6 } }, format, MAX)
          const predicted = outputSize(options, source, MAX)
          if (!plan.ok) {
            expect(predicted, `${canonical} sur ${source.width}×${source.height}`).toBeNull()
            continue
          }
          expect(predicted, `${canonical} sur ${source.width}×${source.height}`).toEqual({ width: plan.plan.width, height: plan.plan.height })
        }
      }
    })
  }

  it('borne de sortie plus petite que la source', () => {
    const source = { width: 3000, height: 2000 }
    for (const options of CASES) {
      const canonical = buildTransform(options, 1024)
      const parsed = parseTransformation(canonical, { maxDimension: 1024 })
      if (!parsed.ok) throw new Error(canonical)
      const plan = planTransform(parsed.transformation, { ...source, hasAlpha: false, focal: null }, 'webp', 1024)
      if (plan.ok) expect(outputSize(options, source, 1024)).toEqual({ width: plan.plan.width, height: plan.plan.height })
    }
  })
})
