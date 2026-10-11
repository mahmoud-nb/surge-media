import { describe, expect, it } from 'vitest'
import { parseDeliveryPath, deliveryVariant } from '../server/lib/media/delivery-path'
import { planTransform, type TransformSource } from '../server/lib/media/transform-plan'
import { signaturePlan, type SignatureContext, type SignedFile } from '../server/lib/api/signature-plan'
import {
  presetFieldsToDefinition,
  presetFormSchema,
  presetFormValues,
  transformFieldsSchema,
  transformLinksSchema,
  transformPreviewQuerySchema,
  cropFieldValues,
  cropParameter,
  EMPTY_CROP,
  parseCropFields,
  rotatedSize,
  TRANSFORM_DENSITIES,
  type PresetFormValues,
} from '../shared/schemas/transforms'
import { htmlAttribute, imageSnippets, videoSnippet, withTransformFormat } from '../shared/utils/snippets'
import {
  BUILTIN_PRESETS,
  focalObjectPosition,
  formatTransformation,
  freeTransformAllowed,
  IDENTITY_TRANSFORMATION,
  isReservedPresetName,
  parsePresetDefinition,
  parseTransformation,
  parseTransformFormat,
  roundFocalCoordinate,
  sameFocalPoint,
  TRANSFORM_FORMATS,
  TRANSFORM_POLICIES,
  type TransformFormat,
  type Transformation,
  type TransformPolicy,
} from '../shared/utils/transforms'

function canonical(segment: string): string {
  const result = parseTransformation(segment)
  if (!result.ok) throw new Error(result.message)
  return result.canonical
}

function failure(segment: string): string | null {
  const result = parseTransformation(segment)
  if (result.ok) throw new Error(`« ${segment} » aurait dû être refusé`)
  return result.param
}

function transformation(segment: string): Transformation {
  const result = parseTransformation(segment)
  if (!result.ok) throw new Error(result.message)
  return result.transformation
}

describe('analyse et forme canonique', () => {
  it('range les paramètres dans l\'ordre fixe', () => {
    expect(canonical('q_70,h_450,w_800')).toBe('w_800,h_450,q_70')
    expect(canonical('bg_ffffff,fit_contain,h_10,w_10,flip_h,r_90,crop_0-0-5-5,q_1'))
      .toBe('r_90,flip_h,crop_0-0-5-5,w_10,h_10,fit_contain,q_1,bg_ffffff')
  })

  it('retire les valeurs par défaut et les paramètres sans effet', () => {
    expect(canonical('w_800,h_600,fit_cover')).toBe('w_800,h_600')
    expect(canonical('w_800,h_600,g_focal')).toBe('w_800,h_600')
    expect(canonical('w_800,fit_contain')).toBe('w_800')
    expect(canonical('w_800,g_north')).toBe('w_800')
    expect(canonical('w_800,h_600,fit_inside,g_north')).toBe('w_800,h_600,fit_inside')
    expect(canonical('r_0')).toBe('')
    expect(canonical('dpr_2')).toBe('')
    expect(canonical('')).toBe('')
  })

  it('normalise les nombres, la couleur et le miroir', () => {
    expect(canonical('w_0800')).toBe('w_800')
    expect(canonical('bg_FFAA00,w_10,h_10,fit_contain')).toBe('w_10,h_10,fit_contain,bg_ffaa00')
    expect(canonical('flip_vh')).toBe('flip_hv')
  })

  it('garde la qualité et le fond explicites (forme indépendante du format)', () => {
    expect(canonical('w_800,q_80')).toBe('w_800,q_80')
    expect(canonical('w_800,bg_000000')).toBe('w_800,bg_000000')
  })

  it('applique la densité aux dimensions, dans la borne', () => {
    expect(canonical('w_400,dpr_2')).toBe('w_800')
    expect(canonical('w_400,h_300,dpr_1.5')).toBe('w_600,h_450')
    expect(canonical('w_3000,dpr_2')).toBe('w_4096')
    expect(canonical('w_3000,h_1500,dpr_2')).toBe('w_4096,h_2048')
    expect(failure('w_400,dpr_1.25')).toBe('dpr')
    expect(failure('w_400,dpr_4')).toBe('dpr')
  })

  it('refuse les paramètres inconnus, répétés ou invalides', () => {
    expect(failure('x_1')).toBe('x')
    expect(failure('w_800,w_600')).toBe('w')
    expect(failure('w_0')).toBe('w')
    expect(failure('w_4097')).toBe('w')
    expect(failure('w_abc')).toBe('w')
    expect(failure('r_45')).toBe('r')
    expect(failure('flip_x')).toBe('flip')
    expect(failure('fit_stretch')).toBe('fit')
    expect(failure('g_middle')).toBe('g')
    expect(failure('q_0')).toBe('q')
    expect(failure('q_101')).toBe('q')
    expect(failure('bg_fff')).toBe('bg')
    expect(failure('crop_0-0-0-10')).toBe('crop')
    expect(failure('crop_1-2-3')).toBe('crop')
    expect(failure('w800')).toBe('w800')
    expect(failure('w_1,,h_1')).toBeNull()
    expect(failure(`w_1${',q_1'.repeat(10)}`)).toBeNull()
  })

  it('respecte une borne réglée', () => {
    expect(parseTransformation('w_2000', { maxDimension: 1600 })).toMatchObject({ ok: false, param: 'w' })
    expect(parseTransformation('w_1000,dpr_2', { maxDimension: 1600 })).toMatchObject({ ok: true, canonical: 'w_1600' })
  })

  it('reproduit sa propre forme canonique', () => {
    for (const segment of ['w_800,h_600,fit_contain,g_north,q_70,bg_123abc', 'crop_1-2-3-4,r_270,flip_v,h_100']) {
      const first = canonical(segment)
      expect(canonical(first)).toBe(first)
      expect(formatTransformation(transformation(first))).toBe(first)
    }
  })

  it('reconnaît les formats de sortie', () => {
    expect(parseTransformFormat('webp')).toEqual({ format: 'webp', canonical: true })
    expect(parseTransformFormat('jpeg')).toEqual({ format: 'jpg', canonical: false })
    expect(parseTransformFormat('JPG')).toEqual({ format: 'jpg', canonical: false })
    expect(parseTransformFormat('gif')).toBeNull()
  })

  it('analyse les préréglages intégrés', () => {
    for (const definition of Object.values(BUILTIN_PRESETS)) expect(canonical(definition)).toBe(definition)
  })
})

describe('chemins de diffusion', () => {
  const options = { maxDimension: 4096, formats: TRANSFORM_FORMATS }
  const id = 'cmediaid0000000000000001'

  it('reconnaît l\'original, un préréglage et une transformation', () => {
    expect(parseDeliveryPath(`${id}/v3/affiche.jpg`, options)).toEqual({
      type: 'target',
      target: { id, version: 3, filename: 'affiche.jpg', kind: 'original' },
    })
    expect(parseDeliveryPath(`${id}/v3/preview/affiche.webp`, options)).toMatchObject({
      type: 'target',
      target: { kind: 'preset', preset: 'preview', format: 'webp' },
    })
    expect(parseDeliveryPath(`${id}/v3/w_800,h_450/affiche.avif`, options)).toMatchObject({
      type: 'target',
      target: { kind: 'transform', canonical: 'w_800,h_450', format: 'avif' },
    })
  })

  it('redirige vers la forme canonique en gardant le nom', () => {
    expect(parseDeliveryPath(`${id}/v3/h_450,w_800/affiche.webp`, options)).toEqual({ type: 'redirect', path: `${id}/v3/w_800,h_450/affiche.webp` })
    expect(parseDeliveryPath(`${id}/v3/w_800/affiche.jpeg`, options)).toEqual({ type: 'redirect', path: `${id}/v3/w_800/affiche.jpg` })
    expect(parseDeliveryPath(`${id}/v3/preview/affiche.JPEG`, options)).toEqual({ type: 'redirect', path: `${id}/v3/preview/affiche.jpg` })
    expect(parseDeliveryPath(`${id}/v3/r_0/affiche.png`, options)).toEqual({ type: 'redirect', path: `${id}/v3/full/affiche.png` })
  })

  it('refuse une transformation ou un format invalides (400)', () => {
    expect(parseDeliveryPath(`${id}/v3/w_0/affiche.webp`, options)).toMatchObject({ type: 'invalid' })
    expect(parseDeliveryPath(`${id}/v3/w_800/affiche.gif`, options)).toMatchObject({ type: 'invalid' })
    expect(parseDeliveryPath(`${id}/v3/w_800/affiche`, options)).toMatchObject({ type: 'invalid' })
    expect(parseDeliveryPath(`${id}/v3/w_800/affiche.avif`, { ...options, formats: ['jpg', 'webp'] as TransformFormat[] })).toMatchObject({ type: 'invalid' })
  })

  it('ignore les chemins hors grammaire (404)', () => {
    expect(parseDeliveryPath(`${id}/3/affiche.jpg`, options)).toBeNull()
    expect(parseDeliveryPath(`${id}/v3`, options)).toBeNull()
    expect(parseDeliveryPath(`${id}/v3/a/b/affiche.jpg`, options)).toBeNull()
    expect(parseDeliveryPath(`${id}/v3/Preview/affiche.webp`, options)).toBeNull()
    expect(parseDeliveryPath(`bad!/v3/affiche.jpg`, options)).toBeNull()
  })

  it('désigne le droit signé sans le format', () => {
    const webp = parseDeliveryPath(`${id}/v3/w_800/a.webp`, options)
    const jpg = parseDeliveryPath(`${id}/v3/w_800/a.jpg`, options)
    if (webp?.type !== 'target' || jpg?.type !== 'target') throw new Error('cible attendue')
    expect(deliveryVariant(webp.target)).toBe('t:w_800')
    expect(deliveryVariant(jpg.target)).toBe('t:w_800')
  })
})

describe('opération effective', () => {
  const photo: TransformSource = { width: 1200, height: 800, hasAlpha: false, focal: null }

  function plan(segment: string, format: TransformFormat = 'webp', source: TransformSource = photo, maxDimension = 4096) {
    const result = planTransform(transformation(segment), source, format, maxDimension)
    if (!result.ok) throw new Error(result.message)
    return result.plan
  }

  it('n\'agrandit jamais et garde le rapport demandé', () => {
    const cover = plan('w_2000,h_1000')
    expect([cover.width, cover.height]).toEqual([1200, 600])
    expect(cover.resize).toMatchObject({ fit: 'cover', position: 'centre' })
    const fill = plan('w_2400,h_400,fit_fill')
    expect([fill.width, fill.height]).toEqual([1200, 200])
    const contain = plan('w_3000,h_3000,fit_contain')
    expect([contain.width, contain.height]).toEqual([1200, 1200])
    expect(contain.resize).toMatchObject({ fit: 'contain', background: null })
  })

  it('partage le fichier des demandes équivalentes', () => {
    expect(plan('w_1600').key).toBe(plan('w_4096').key)
    expect(plan('w_1600').key).toBe(plan('').key)
    expect(plan('w_1200,h_800').key).toBe(plan('').key)
    expect(plan('w_600,h_400').key).toBe(plan('w_600').key)
    expect(plan('w_800,h_600').key).not.toBe(plan('w_800').key)
  })

  it('réduit proportionnellement', () => {
    expect(plan('w_600')).toMatchObject({ width: 600, height: 400, resize: { fit: 'fill' } })
    expect(plan('h_200')).toMatchObject({ width: 300, height: 200 })
    expect(plan('w_480,h_480,fit_inside')).toMatchObject({ width: 480, height: 320, key: 'size_480x320,q_80.webp' })
    expect(plan('w_480,h_480,fit_outside')).toMatchObject({ width: 720, height: 480 })
    expect(plan('w_480,h_480,fit_inside,q_72').key).toBe('size_480x320,q_72.webp')
  })

  it('borne la sortie, même sans redimensionnement demandé', () => {
    const large: TransformSource = { width: 6000, height: 4000, hasAlpha: false, focal: null }
    expect(plan('', 'jpg', large)).toMatchObject({ width: 4096, height: 2731 })
    expect(plan('', 'jpg', large, 2000)).toMatchObject({ width: 2000, height: 1333 })
    expect(plan('w_1000,h_1000', 'jpg', large)).toMatchObject({ width: 1000, height: 1000 })
  })

  it('travaille sur l\'image tournée et vérifie la zone', () => {
    expect(plan('r_90')).toMatchObject({ width: 800, height: 1200, rotate: 90 })
    expect(plan('r_90,crop_0-1000-800-200')).toMatchObject({ width: 800, height: 200, extract: { x: 0, y: 1000, width: 800, height: 200 } })
    expect(planTransform(transformation('crop_0-1000-800-200'), photo, 'webp', 4096)).toMatchObject({ ok: false })
    expect(planTransform(transformation('crop_1100-0-200-100'), photo, 'webp', 4096)).toMatchObject({ ok: false })
    expect(plan('crop_0-0-1200-800').extract).toBeNull()
  })

  it('aplatit la transparence en JPEG et choisit la qualité du format', () => {
    const alpha: TransformSource = { ...photo, hasAlpha: true }
    expect(plan('', 'jpg', alpha)).toMatchObject({ flatten: 'ffffff', quality: 80 })
    expect(plan('bg_102030', 'jpg', alpha).flatten).toBe('102030')
    expect(plan('', 'webp', alpha).flatten).toBeNull()
    expect(plan('', 'avif').quality).toBe(50)
    expect(plan('', 'png').quality).toBeNull()
    expect(plan('q_60', 'png').quality).toBe(60)
    expect(plan('w_100,h_100,fit_contain', 'jpg').resize).toMatchObject({ background: 'ffffff' })
  })

  it('recadre autour du point d\'intérêt, dans les limites de l\'image', () => {
    const left: TransformSource = { ...photo, focal: { x: 0.1, y: 0.5 } }
    expect(plan('w_400,h_400', 'webp', left)).toMatchObject({
      extract: { x: 0, y: 0, width: 800, height: 800 },
      resize: { width: 400, height: 400, fit: 'fill' },
    })
    const right: TransformSource = { ...photo, focal: { x: 0.9, y: 0.5 } }
    expect(plan('w_400,h_400', 'webp', right).extract).toEqual({ x: 400, y: 0, width: 800, height: 800 })
    // Ancrage explicite : le point d'intérêt est ignoré.
    expect(plan('w_400,h_400,g_north', 'webp', right)).toMatchObject({ extract: null, resize: { fit: 'cover', position: 'north' } })
    // Après un quart de tour horaire, un point à gauche se retrouve en haut.
    expect(plan('r_90,w_400,h_400', 'webp', left).extract).toEqual({ x: 0, y: 0, width: 800, height: 800 })
  })

  it('identifie l\'opération indépendamment de la demande', () => {
    expect(plan('').key).toBe('q_80.webp')
    expect(plan('', 'png').key).toBe('full.png')
    expect(planTransform(IDENTITY_TRANSFORMATION, photo, 'avif', 4096)).toMatchObject({ ok: true, plan: { key: 'q_50.avif' } })
  })
})

describe('politique et préréglages (C2)', () => {
  it('décide des transformations libres selon la politique et le droit présenté', () => {
    const grants = ['none', 'exact', 'derived', 'admin', 'credential'] as const
    const allowed = (policy: TransformPolicy) => grants.filter(grant => freeTransformAllowed(policy, grant))
    expect(allowed('OPEN')).toEqual([...grants])
    expect(allowed('SIGNED')).toEqual(['exact', 'derived', 'admin', 'credential'])
    expect(allowed('PRESETS')).toEqual(['admin'])
  })

  it('vérifie la définition d\'un préréglage', () => {
    expect(parsePresetDefinition(' q_70,w_800 ')).toMatchObject({ ok: true, canonical: 'w_800,q_70' })
    expect(parsePresetDefinition('crop_0-0-10-10,w_100')).toMatchObject({ ok: false, param: 'crop' })
    expect(parsePresetDefinition('r_0')).toMatchObject({ ok: false, param: null })
    expect(parsePresetDefinition('w_5000')).toMatchObject({ ok: false, param: 'w' })
    expect(parsePresetDefinition('w_2000', { maxDimension: 1000 })).toMatchObject({ ok: false, param: 'w' })
  })

  it('réserve les noms intégrés', () => {
    for (const name of ['preview', 'full', 'original']) expect(isReservedPresetName(name)).toBe(true)
    expect(isReservedPresetName('thumb')).toBe(false)
  })
})

describe('formulaire d\'un préréglage', () => {
  const base: PresetFormValues = { name: 'carte', description: '', width: '', height: '', fit: 'cover', gravity: 'focal', quality: '', background: '', rotate: '0', flip: '' }
  const definition = (values: Partial<PresetFormValues>) => {
    const result = presetFormSchema.safeParse({ ...base, ...values })
    if (!result.success) throw new Error(result.error.issues.map(issue => issue.message).join())
    return presetFieldsToDefinition(result.data)
  }
  const issues = (values: Partial<PresetFormValues>) => {
    const result = presetFormSchema.safeParse({ ...base, ...values })
    return result.success ? [] : result.error.issues.map(issue => `${issue.path.join('.')}:${issue.message}`)
  }

  it('produit la forme canonique', () => {
    expect(definition({ width: '800', height: '450', gravity: 'north', quality: '70' })).toBe('w_800,h_450,g_north,q_70')
    expect(definition({ width: '800', fit: 'contain', gravity: 'north' })).toBe('w_800')
    expect(definition({ width: '300', height: '300', fit: 'contain', background: '#FFAA00' })).toBe('w_300,h_300,fit_contain,bg_ffaa00')
    expect(definition({ rotate: '90', flip: 'h' })).toBe('r_90,flip_h')
  })

  it('refuse un préréglage vide, des bornes ou un nom invalides', () => {
    expect(issues({})).toEqual(['width:validation.presetEmpty'])
    expect(issues({ width: '0' })).toEqual(['width:validation.integerRange'])
    expect(issues({ width: '4097' })).toEqual(['width:validation.integerRange'])
    expect(issues({ width: '10', quality: '101' })).toEqual(['quality:validation.integerRange'])
    expect(issues({ width: '10', background: 'fff' })).toEqual(['background:validation.color'])
    expect(issues({ width: '10', name: 'Carte' })).toEqual(['name:validation.presetName'])
    expect(issues({ width: '10', name: 'preview' })).toEqual(['name:validation.presetNameReserved'])
  })

  it('reprend une transformation enregistrée', () => {
    const parsed = parseTransformation('r_180,w_640,h_360,fit_fill,q_60')
    if (!parsed.ok) throw new Error(parsed.message)
    const values = presetFormValues(parsed.transformation, 'bandeau', 'Bandeau')
    expect(values).toMatchObject({ name: 'bandeau', width: '640', height: '360', fit: 'fill', quality: '60', rotate: '180' })
    expect(definition(values)).toBe('r_180,w_640,h_360,fit_fill,q_60')
  })
})

describe('point d\'intérêt', () => {
  it('arrondit à 4 décimales dans [0, 1] et compare à cette précision', () => {
    expect(roundFocalCoordinate(0.123456)).toBe(0.1235)
    expect([roundFocalCoordinate(-0.2), roundFocalCoordinate(1.4)]).toEqual([0, 1])
    expect(sameFocalPoint({ x: 0.5, y: 0.25 }, { x: 0.50001, y: 0.25 })).toBe(true)
    expect(sameFocalPoint({ x: 0.5, y: 0.25 }, { x: 0.5002, y: 0.25 })).toBe(false)
    expect([sameFocalPoint(null, null), sameFocalPoint(null, { x: 0.5, y: 0.5 })]).toEqual([true, false])
  })

  it('l\'aperçu de l\'interface reproduit le recadrage du serveur', () => {
    const cases: [number, number, number, { x: number, y: number }][] = [
      [1200, 800, 1, { x: 0.1, y: 0.5 }],
      [1200, 800, 1, { x: 0.7, y: 0.5 }],
      [1200, 800, 16 / 9, { x: 0.5, y: 0.05 }],
      [1200, 800, 16 / 9, { x: 0.3, y: 0.62 }],
      [800, 1200, 16 / 9, { x: 0.5, y: 0.8 }],
      [800, 1200, 1, { x: 0.9, y: 0.35 }],
    ]
    for (const [width, height, ratio, focal] of cases) {
      const outWidth = 400
      const outHeight = Math.round(outWidth / ratio)
      const result = planTransform(transformation(`w_${outWidth},h_${outHeight}`), { width, height, hasAlpha: false, focal }, 'webp', 4096)
      if (!result.ok) throw new Error(result.message)
      const extract = result.plan.extract!
      const position = focalObjectPosition(width, height, outWidth / outHeight, focal)
      // object-position p : la zone visible commence à (taille − zone) × p.
      const left = (width - extract.width) * position.x
      const top = (height - extract.height) * position.y
      expect(Math.abs(left - extract.x), JSON.stringify({ width, height, ratio, focal })).toBeLessThanOrEqual(1)
      expect(Math.abs(top - extract.y), JSON.stringify({ width, height, ratio, focal })).toBeLessThanOrEqual(1)
    }
    expect(focalObjectPosition(1200, 800, 1, null)).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('signature d\'un lien délivré par l\'API', () => {
  const transform: SignedFile = { kind: 'transform', canonical: 'w_800,h_450', format: 'webp' }
  const preset: SignedFile = { kind: 'preset', name: 'carte', format: 'avif' }
  const file: SignedFile = { kind: 'file' }
  const context = (visibility: SignatureContext['visibility'], policy: TransformPolicy, delegated = false): SignatureContext => ({ visibility, policy, delegated })

  it('média privé : toujours à échéance (cible exacte, ou droit « derived »)', () => {
    expect(signaturePlan(file, false, context('PRIVATE', 'OPEN'))).toEqual({ type: 'expiring', access: { variant: 'original' } })
    expect(signaturePlan(preset, false, context('PRIVATE', 'PRESETS'))).toEqual({ type: 'expiring', access: { variant: 'carte' } })
    expect(signaturePlan(transform, false, context('PRIVATE', 'SIGNED'))).toEqual({ type: 'expiring', access: { variant: 't:w_800,h_450' } })
    expect(signaturePlan(preset, true, context('PRIVATE', 'OPEN'))).toEqual({ type: 'expiring', access: { scope: 'derived' } })
  })

  it('média public : signature seulement pour un paramètre libre en politique « signed »', () => {
    for (const policy of TRANSFORM_POLICIES) {
      expect(signaturePlan(file, false, context('PUBLIC', policy))).toEqual({ type: 'none' })
      expect(signaturePlan(preset, false, context('PUBLIC', policy))).toEqual({ type: 'none' })
    }
    expect(signaturePlan(transform, false, context('PUBLIC', 'OPEN'))).toEqual({ type: 'none' })
    expect(signaturePlan(transform, false, context('PUBLIC', 'SIGNED'))).toEqual({ type: 'permanent', access: { variant: 't:w_800,h_450' } })
    // Jeton délégué : jamais de lien permanent.
    expect(signaturePlan(transform, false, context('PUBLIC', 'SIGNED', true))).toEqual({ type: 'expiring', access: { variant: 't:w_800,h_450' } })
    // Droit « derived » : à échéance en politique « signed », inutile sinon.
    expect(signaturePlan(preset, true, context('PUBLIC', 'SIGNED'))).toEqual({ type: 'expiring', access: { scope: 'derived' } })
    expect(signaturePlan(preset, true, context('PUBLIC', 'OPEN'))).toEqual({ type: 'none' })
    expect(signaturePlan(preset, true, context('PUBLIC', 'PRESETS'))).toEqual({ type: 'none' })
  })

  it('politique « presets » : paramètres libres refusés, quelle que soit la signature', () => {
    for (const visibility of ['PUBLIC', 'PRIVATE'] as const) {
      expect(signaturePlan(transform, false, context(visibility, 'PRESETS')).type).toBe('refused')
      expect(signaturePlan(transform, true, context(visibility, 'PRESETS')).type).toBe('refused')
    }
  })
})

describe('générateur d\'adresses', () => {
  const fields = { width: '', height: '', fit: 'cover', gravity: 'focal', quality: '', background: '', rotate: '0', flip: '' } as const

  it('champs : tout vide = image entière (full), mêmes bornes que les préréglages', () => {
    const empty = transformFieldsSchema.safeParse(fields)
    expect(empty.success && presetFieldsToDefinition(empty.data)).toBe('')
    const sized = transformFieldsSchema.safeParse({ ...fields, width: '800', height: '450', gravity: 'north' })
    expect(sized.success && presetFieldsToDefinition(sized.data)).toBe('w_800,h_450,g_north')
    expect(transformFieldsSchema.safeParse({ ...fields, width: '0' }).success).toBe(false)
    // Le préréglage, lui, doit changer quelque chose.
    expect(presetFormSchema.safeParse({ ...fields, name: 'vide', description: '' }).success).toBe(false)
  })

  it('aperçu et liens : un préréglage ou des paramètres, format webp par défaut', () => {
    expect(transformPreviewQuerySchema.parse({ transform: 'w_800' })).toEqual({ transform: 'w_800', format: 'webp' })
    expect(transformPreviewQuerySchema.parse({ transform: '', format: 'avif' })).toEqual({ transform: '', format: 'avif' })
    expect(transformPreviewQuerySchema.parse({ preset: 'carte' })).toEqual({ preset: 'carte', format: 'webp' })
    for (const query of [{}, { preset: 'carte', transform: 'w_10' }, { preset: 'Carte' }, { transform: 'w_10', format: 'gif' }]) {
      expect(transformPreviewQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false)
    }
    expect(transformLinksSchema.parse({ items: [{ transform: 'w_10' }] })).toEqual({ items: [{ transform: 'w_10', format: 'webp' }], expiresIn: 3600 })
    expect(transformLinksSchema.safeParse({ items: [] }).success).toBe(false)
    expect(transformLinksSchema.safeParse({ items: Array.from({ length: 5 }, () => ({ preset: 'preview' })) }).success).toBe(false)
    expect(transformLinksSchema.safeParse({ items: [{ preset: 'preview' }], expiresIn: 30 }).success).toBe(false)
  })

  it('extraits HTML : img, picture (AVIF, WebP, repli JPEG), srcset par densité, attributs échappés', () => {
    const url = 'https://media.example.com/m/abc12345/v2/w_800/affiche.webp?exp=1&kid=k&sig=s'
    expect(withTransformFormat(url, 'avif')).toBe('https://media.example.com/m/abc12345/v2/w_800/affiche.avif?exp=1&kid=k&sig=s')
    expect(withTransformFormat('/m/x/v1/full/a.png', 'jpg')).toBe('/m/x/v1/full/a.jpg')
    expect(htmlAttribute('a "b" & <c>')).toBe('a &quot;b&quot; &amp; &lt;c&gt;')

    const snippets = imageSnippets({
      url,
      densities: [{ density: 1, url }, { density: 2, url: url.replace('w_800', 'w_1600') }, { density: 3, url: url.replace('w_800', 'w_2400') }],
      width: 800,
      height: 450,
      alt: 'Plage "été"',
      formats: ['jpg', 'png', 'webp', 'avif'],
      format: 'webp',
    })
    expect(snippets.map(snippet => snippet.kind)).toEqual(['img', 'picture', 'srcset'])
    expect(snippets[0]!.code).toBe('<img src="https://media.example.com/m/abc12345/v2/w_800/affiche.webp?exp=1&amp;kid=k&amp;sig=s" width="800" height="450" alt="Plage &quot;été&quot;" loading="lazy">')
    const picture = snippets[1]!.code.split('\n')
    expect(picture[1]).toContain('type="image/avif" srcset="https://media.example.com/m/abc12345/v2/w_800/affiche.avif?exp=1&amp;')
    expect(picture[2]).toContain('type="image/webp"')
    expect(picture[3]).toContain('affiche.jpg?exp=1')
    expect(snippets[2]!.code).toContain('/w_800/affiche.webp?exp=1&amp;kid=k&amp;sig=s 1x, https://media.example.com/m/abc12345/v2/w_1600/affiche.webp')
    expect(snippets[2]!.code).toContain('/w_2400/affiche.webp?exp=1&amp;kid=k&amp;sig=s 3x"')
    // Densité fractionnaire écrite avec un point (syntaxe HTML) ; une seule densité : pas de srcset.
    expect(imageSnippets({ url: '/a.webp', alt: '', formats: ['webp'], format: 'webp', densities: [{ density: 1, url: '/a.webp' }, { density: 1.5, url: '/b.webp' }] })[1]!.code)
      .toContain('srcset="/a.webp 1x, /b.webp 1.5x"')
    expect(imageSnippets({ url: '/a.webp', alt: '', formats: ['webp'], format: 'webp', densities: [{ density: 1, url: '/a.webp' }] })).toHaveLength(1)

    // Formats restreints : pas de <picture> sans autre source que le repli ; pas de 2x sans variante.
    const only = imageSnippets({ url: '/m/x/v1/w_10/a.jpg', alt: '', formats: ['jpg'], format: 'jpg' })
    expect(only.map(snippet => snippet.kind)).toEqual(['img'])
    expect(only[0]!.code).toBe('<img src="/m/x/v1/w_10/a.jpg" alt="" loading="lazy">')
    const webpOnly = imageSnippets({ url: '/m/x/v1/w_10/a.webp', alt: '', formats: ['webp', 'avif'], format: 'webp' })
    expect(webpOnly[1]!.code).toBe('<picture>\n  <source type="image/avif" srcset="/m/x/v1/w_10/a.avif">\n  <img src="/m/x/v1/w_10/a.webp" alt="" loading="lazy">\n</picture>')
  })
})

describe('extrait <video>', () => {
  const base = { url: 'https://media.example.com/m/v1d/v2/clip.mov?exp=1&kid=k&sig=s', mimeType: 'video/quicktime', codecs: 'avc1.640028,mp4a.40.2', label: '' }

  it('sans sources : l\'original seul, MOV annoncé video/mp4 avec ses codecs, attributs échappés', () => {
    expect(videoSnippet({ ...base, width: 1920, height: 1080, label: 'Plage "été"' })).toBe([
      '<video controls preload="metadata" playsinline width="1920" height="1080" style="max-width: 100%; height: auto" aria-label="Plage &quot;été&quot;">',
      '  <source src="https://media.example.com/m/v1d/v2/clip.mov?exp=1&amp;kid=k&amp;sig=s" type="video/mp4; codecs=&quot;avc1.640028, mp4a.40.2&quot;">',
      '</video>',
    ].join('\n'))
    expect(videoSnippet({ ...base, mimeType: 'video/webm', codecs: null, sources: [] })).toContain('<source src="https://media.example.com/m/v1d/v2/clip.mov?exp=1&amp;kid=k&amp;sig=s" type="video/webm">')
  })

  it('sources (phase D3) : un <source> par source dans l\'ordre donné, avant les pistes ; `url` ignorée', () => {
    const code = videoSnippet({
      ...base,
      poster: '/m/v1d/v2/full/clip.jpg',
      sources: [
        { url: '/m/v1d/v2/renditions/av1.webm?exp=1&kid=k&sig=s', type: 'video/webm; codecs="av01.0.08M.08, opus"' },
        { url: '/m/v1d/v2/renditions/h264.mp4?exp=1&kid=k&sig=s', type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
      ],
      tracks: [{ src: '/m/v1d/v2/tracks/t1.vtt', kind: 'subtitles', srclang: 'fr', label: 'Français', default: true }],
    }).split('\n')
    expect(code).toEqual([
      '<video controls preload="metadata" playsinline poster="/m/v1d/v2/full/clip.jpg" crossorigin="anonymous">',
      '  <source src="/m/v1d/v2/renditions/av1.webm?exp=1&amp;kid=k&amp;sig=s" type="video/webm; codecs=&quot;av01.0.08M.08, opus&quot;">',
      '  <source src="/m/v1d/v2/renditions/h264.mp4?exp=1&amp;kid=k&amp;sig=s" type="video/mp4; codecs=&quot;avc1.640028, mp4a.40.2&quot;">',
      '  <track kind="subtitles" srclang="fr" label="Français" src="/m/v1d/v2/tracks/t1.vtt" default>',
      '</video>',
    ])
  })
})

describe('zone de recadrage et densité du générateur', () => {
  const image = { width: 1200, height: 800 }
  const fields = (x: string, y: string, width: string, height: string) => ({ x, y, width, height })

  it('dimensions de travail : un quart de tour les échange', () => {
    expect(rotatedSize(1200, 800, '0')).toEqual({ width: 1200, height: 800 })
    expect(rotatedSize(1200, 800, '90')).toEqual({ width: 800, height: 1200 })
    expect(rotatedSize(1200, 800, 270)).toEqual({ width: 800, height: 1200 })
    expect(rotatedSize(1200, 800, '180')).toEqual({ width: 1200, height: 800 })
  })

  it('zone : tout vide = aucune zone ; valeurs complètes dans l\'image', () => {
    expect(parseCropFields({ ...EMPTY_CROP }, image)).toEqual({ region: null, errors: {} })
    expect(parseCropFields(fields(' 100', '50 ', '400', '300'), image)).toEqual({ region: { x: 100, y: 50, width: 400, height: 300 }, errors: {} })
    expect(parseCropFields(fields('0', '0', '1200', '800'), image).region).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
  })

  it('zone : saisie incomplète, hors bornes, ou qui dépasse de l\'image', () => {
    const keys = (check: ReturnType<typeof parseCropFields>) => Object.fromEntries(Object.entries(check.errors).map(([field, error]) => [field, error!.key]))
    expect(keys(parseCropFields(fields('10', '', '100', ''), image))).toEqual({ y: 'validation.cropIncomplete', height: 'validation.cropIncomplete' })
    expect(keys(parseCropFields(fields('1200', '0', '0', 'x'), image))).toEqual({ x: 'validation.integerRange', width: 'validation.integerRange', height: 'validation.integerRange' })
    const outside = parseCropFields(fields('1000', '700', '300', '200'), image)
    expect(outside.region).toBeNull()
    expect(outside.errors).toEqual({
      width: { key: 'validation.cropOutside', params: { max: 200 } },
      height: { key: 'validation.cropOutside', params: { max: 100 } },
    })
    // Après un quart de tour, la même zone ne tient plus.
    expect(parseCropFields(fields('900', '0', '200', '100'), rotatedSize(1200, 800, '90')).errors.x?.key).toBe('validation.integerRange')
  })

  it('paramètres : zone et densité repliées dans la forme canonique du serveur', () => {
    const region = { x: 100, y: 50, width: 400, height: 300 }
    expect(cropParameter(region)).toBe('crop_100-50-400-300')
    expect(cropFieldValues(region)).toEqual({ x: '100', y: '50', width: '400', height: '300' })
    expect(cropFieldValues(null)).toEqual(EMPTY_CROP)
    expect(canonical(`w_200,${cropParameter(region)},dpr_2`)).toBe('crop_100-50-400-300,w_400')
    expect(canonical('w_300,h_200,dpr_1.5')).toBe('w_450,h_300')
    for (const density of TRANSFORM_DENSITIES) expect(parseTransformation(`w_100,dpr_${density}`).ok).toBe(true)
  })
})
