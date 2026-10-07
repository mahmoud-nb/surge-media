import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReservedPresetName, TRANSFORM_FORMATS } from '../shared/utils/transforms'
import { findDeliveryMedia, invalidateMedia, reloadDeliveryMedia } from '../server/lib/media/cache'
import {
  contentDisposition,
  currentTargetPath,
  deliveryReloadNeeded,
  holdApplies,
  originalDisposition,
  type DeliveryAccess,
} from '../server/lib/media/delivery'
import { deliveryVariant, parseDeliveryPath, type DeliveryTarget } from '../server/lib/media/delivery-path'
import { renditionKey, variantPrefix } from '../server/lib/media/keys'
import { findRendition, renditionFilename, resolveRenditionDeliverable } from '../server/lib/media/renditions'
import { buildSignatureQuery, checkSignature } from '../server/lib/media/signing'
import { adminMediaPaths, renditionPath } from '../server/lib/media/urls'

const options = { maxDimension: 4096, formats: TRANSFORM_FORMATS }
const id = 'cmmedia0001'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function target(path: string): DeliveryTarget {
  const parsed = parseDeliveryPath(path, options)
  if (parsed?.type !== 'target') throw new Error(`cible attendue : ${path}`)
  return parsed.target
}

/** Ligne `MediaRendition` (champs lus par la diffusion). */
function rendition(name: string, container: string) {
  return {
    name,
    container,
    mimeType: container === 'mp4' ? 'video/mp4' : 'video/webm',
    size: 12_844_349,
    checksum: 'c'.repeat(64),
    storageKey: `variants/${id}/rendition-${name}-Qx7Kp.${container}`,
  }
}

const video = {
  id,
  version: 4,
  kind: 'VIDEO',
  mimeType: 'video/quicktime',
  originalName: 'Vacances été.MOV',
  title: null,
  renditions: [rendition('h264', 'mp4')],
}

describe('rendus : chemins de diffusion et signatures', () => {
  it('reconnaît /m/<id>/v<n>/renditions/h264.mp4 et av1.webm, rien d\'autre (404)', () => {
    expect(parseDeliveryPath(`${id}/v3/renditions/h264.mp4`, options)).toEqual({
      type: 'target',
      target: { id, version: 3, filename: 'h264.mp4', kind: 'rendition', name: 'h264', container: 'mp4' },
    })
    expect(target(`${id}/v3/renditions/av1.webm`)).toMatchObject({ kind: 'rendition', name: 'av1', container: 'webm' })
    // Nom inconnu, conteneur d'un autre rendu, casse, extension en trop : jamais jusqu'à la base.
    for (const file of ['h264.webm', 'av1.mp4', 'vp9.webm', 'H264.MP4', 'h264', 'h264.mp4.mp4', 'h264.MP4', 'h264%2Emp4', 'original.mp4']) {
      expect(parseDeliveryPath(`${id}/v3/renditions/${file}`, options), file).toBeNull()
    }
    // « renditions » n'est jamais analysé comme un préréglage (pas de 400 pour un format d'image).
    expect(parseDeliveryPath(`${id}/v3/renditions/affiche.jpg`, options)).toBeNull()
    expect(parseDeliveryPath(`${id}/v3/renditions/x/h264.mp4`, options)).toBeNull()
    expect(isReservedPresetName('renditions')).toBe(true)
  })

  it('chemin d\'un rendu : relu par l\'analyse, sous la version courante', () => {
    expect(renditionPath({ id, version: 7 }, 'h264')).toBe(`/m/${id}/v7/renditions/h264.mp4`)
    expect(renditionPath({ id, version: 7 }, 'av1')).toBe(`/m/${id}/v7/renditions/av1.webm`)
    for (const name of ['h264', 'av1'] as const) {
      expect(target(renditionPath({ id, version: 7 }, name).slice('/m/'.length))).toMatchObject({ kind: 'rendition', name, version: 7 })
    }
  })

  it('un rendu prend le droit de l\'original (`file`) : jamais « derived » ni permanent, couvert par « admin »', () => {
    const h264 = target(`${id}/v3/renditions/h264.mp4`)
    expect(deliveryVariant(h264)).toBe('original')
    expect(deliveryVariant(target(`${id}/v3/renditions/av1.webm`))).toBe('original')
    const media = { id, version: 3 }
    const check = { mediaId: id, version: 3, variant: deliveryVariant(h264) }
    // Le lien signé pour le fichier (chemin de l'original) ouvre aussi ses rendus, à la même échéance.
    const file = Object.fromEntries(new URLSearchParams(buildSignatureQuery('secret', media, { variant: 'original' }, 2_000_000_000)))
    expect(checkSignature(['secret'], check, file, 1_900_000_000)).toEqual({ status: 'valid', expires: 2_000_000_000, scope: null })
    // … mais pas ceux d'une autre version.
    expect(checkSignature(['secret'], { ...check, version: 4 }, file, 1_900_000_000).status).toBe('invalid')
    // Jamais de signature permanente, ni présentée sans échéance.
    expect(() => buildSignatureQuery('secret', media, { variant: 'original' }, null)).toThrow()
    expect(checkSignature(['secret'], check, { ...file, exp: undefined }, 1_900_000_000).status).toBe('invalid')
    const derived = Object.fromEntries(new URLSearchParams(buildSignatureQuery('secret', media, { scope: 'derived' }, 2_000_000_000)))
    expect(checkSignature(['secret'], check, derived, 1_900_000_000).status).toBe('invalid')
    const admin = Object.fromEntries(new URLSearchParams(buildSignatureQuery('secret', media, { scope: 'admin' }, 2_000_000_000)))
    expect(checkSignature(['secret'], check, admin, 1_900_000_000).status).toBe('valid')
    // La signature d'un dérivé n'ouvre pas un rendu.
    const preset = Object.fromEntries(new URLSearchParams(buildSignatureQuery('secret', media, { variant: 'full' }, 2_000_000_000)))
    expect(checkSignature(['secret'], check, preset, 1_900_000_000).status).toBe('invalid')
  })

  it('administration : chemins des rendus, permanents si public, sinon signés « admin » comme l\'original', () => {
    const base = { ...video, visibility: 'PUBLIC', deletedAt: null, posterKey: null }
    expect(adminMediaPaths(base, false).renditions).toEqual({})
    expect(adminMediaPaths(base, false, [], ['av1', 'h264']).renditions).toEqual({
      av1: `/m/${id}/v4/renditions/av1.webm`,
      h264: `/m/${id}/v4/renditions/h264.mp4`,
    })

    vi.stubGlobal('useRuntimeConfig', () => ({ media: { signingSecret: 'secret-de-test', previousSigningSecret: '' }, session: {} }))
    for (const variant of [{ ...base, visibility: 'PRIVATE' }, { ...base, deletedAt: new Date() }]) {
      const paths = adminMediaPaths(variant, false, [], ['h264'])
      const [path, query] = paths.renditions.h264!.split('?') as [string, string]
      expect(path).toBe(`/m/${id}/v4/renditions/h264.mp4`)
      expect(query).toBe(paths.url.split('?')[1])
      const signed = Object.fromEntries(new URLSearchParams(query))
      expect(signed.scope).toBe('admin')
      const check = { mediaId: id, version: 4, variant: deliveryVariant(target(path.slice('/m/'.length))) }
      expect(checkSignature(['secret-de-test'], check, signed, Math.floor(Date.now() / 1000)).status).toBe('valid')
    }
  })
})

describe('rendus : fichier servi', () => {
  it('fichier d\'un rendu présent : clé et type de la base, ETag de l\'empreinte ; absent : null', () => {
    expect(resolveRenditionDeliverable(video, 'h264')).toEqual({
      key: `variants/${id}/rendition-h264-Qx7Kp.mp4`,
      mimeType: 'video/mp4',
      size: 12_844_349,
      etag: 'c'.repeat(32),
    })
    expect(resolveRenditionDeliverable(video, 'av1')).toBeNull()
    expect(resolveRenditionDeliverable({ renditions: [] }, 'h264')).toBeNull()
    // Ligne incohérente (conteneur d'un autre rendu) : ignorée.
    expect(findRendition({ renditions: [rendition('h264', 'webm')] }, 'h264')).toBeNull()
  })

  it('nom de téléchargement : celui du média, avec l\'extension du rendu', () => {
    expect(renditionFilename(video, 'h264')).toBe('vacances-ete.mp4')
    expect(renditionFilename({ ...video, title: 'Défilé 2026' }, 'av1')).toBe('defile-2026.webm')
  })

  it('clé de stockage : aléatoire, rangée avec les dérivés, hors des préfixes de version', () => {
    const key = renditionKey(id, 'h264', 'mp4')
    expect(key).toMatch(new RegExp(`^${variantPrefix(id)}rendition-h264-[\\w-]{16}\\.mp4$`))
    expect(key.startsWith(`${variantPrefix(id)}v`)).toBe(false)
    expect(renditionKey(id, 'h264', 'mp4')).not.toBe(key)
  })
})

describe('diffusion : décisions de la route', () => {
  it('relit le cache pour une version plus récente ou un rendu inconnu, jamais pour une ancienne version', () => {
    expect(deliveryReloadNeeded(target(`${id}/v5/video.mov`), video)).toBe(true)
    expect(deliveryReloadNeeded(target(`${id}/v5/renditions/h264.mp4`), video)).toBe(true)
    expect(deliveryReloadNeeded(target(`${id}/v4/renditions/av1.webm`), video)).toBe(true)
    expect(deliveryReloadNeeded(target(`${id}/v4/renditions/h264.mp4`), video)).toBe(false)
    expect(deliveryReloadNeeded(target(`${id}/v4/video.mov`), video)).toBe(false)
    expect(deliveryReloadNeeded(target(`${id}/v3/renditions/av1.webm`), video)).toBe(false)
    expect(deliveryReloadNeeded(target(`${id}/v3/full/video.jpg`), video)).toBe(false)
  })

  it('ancienne version : même fichier à la version courante ; rendu disparu → original', () => {
    expect(currentTargetPath(video, target(`${id}/v2/renditions/h264.mp4`))).toBe(`/m/${id}/v4/renditions/h264.mp4`)
    expect(currentTargetPath(video, target(`${id}/v2/renditions/av1.webm`))).toBe(`/m/${id}/v4/vacances-ete.mov`)
    expect(currentTargetPath({ ...video, renditions: [] }, target(`${id}/v2/renditions/h264.mp4`))).toBe(`/m/${id}/v4/vacances-ete.mov`)
    expect(currentTargetPath(video, target(`${id}/v2/ancien-nom.mov`))).toBe(`/m/${id}/v4/vacances-ete.mov`)
    expect(currentTargetPath(video, target(`${id}/v2/tracks/cmtrack0001.vtt`))).toBe(`/m/${id}/v4/tracks/cmtrack0001.vtt`)
    expect(currentTargetPath(video, target(`${id}/v2/full/affiche.jpg`))).toBe(`/m/${id}/v4/full/vacances-ete.jpg`)
    expect(currentTargetPath(video, target(`${id}/v2/w_800/affiche.webp`))).toBe(`/m/${id}/v4/w_800/vacances-ete.webp`)
  })

  it('retenue (503) : original et rendus d\'une vidéo en cours de nettoyage, sauf lien « admin »', () => {
    const held = { kind: 'VIDEO', processingState: 'PENDING' as const, metadata: { container: 'mp4', dataTracks: ['gpmd'] } }
    const original = target(`${id}/v4/video.mp4`)
    const h264 = target(`${id}/v4/renditions/h264.mp4`)
    const accesses: DeliveryAccess[] = [
      { mode: 'public', signed: false },
      { mode: 'signed', expires: 2_000_000_000, scope: null },
      { mode: 'credential' },
    ]
    for (const access of accesses) {
      expect(holdApplies(original, held, access, 'embedded')).toBe(true)
      expect(holdApplies(h264, held, access, 'external')).toBe(true)
      expect(holdApplies(original, { ...held, processingState: 'PROCESSING' }, access, 'embedded')).toBe(true)
    }
    const admin: DeliveryAccess = { mode: 'signed', expires: 2_000_000_000, scope: 'admin' }
    expect(holdApplies(original, held, admin, 'embedded')).toBe(false)
    expect(holdApplies(h264, held, admin, 'embedded')).toBe(false)
    // L'affiche, ses dérivés et les pistes de texte ne contiennent pas la piste : toujours servis.
    for (const path of [`${id}/v4/full/affiche.jpg`, `${id}/v4/w_800/affiche.webp`, `${id}/v4/tracks/cmtrack0001.vtt`]) {
      expect(holdApplies(target(path), held, accesses[0]!, 'embedded'), path).toBe(false)
    }
    // Levée : traitement désactivé, nettoyage fini (prêt ou en échec), piste retirée, autre genre.
    const open: DeliveryAccess = { mode: 'public', signed: false }
    expect(holdApplies(original, held, open, 'off')).toBe(false)
    expect(holdApplies(original, { ...held, processingState: 'READY' }, open, 'embedded')).toBe(false)
    expect(holdApplies(original, { ...held, processingState: 'FAILED' }, open, 'embedded')).toBe(false)
    expect(holdApplies(original, { ...held, processingState: null }, open, 'embedded')).toBe(false)
    expect(holdApplies(original, { ...held, metadata: { container: 'mp4', dataTracks: [] } }, open, 'embedded')).toBe(false)
    expect(holdApplies(original, { ...held, kind: 'IMAGE' }, open, 'embedded')).toBe(false)
  })

  it('original d\'un format converti, ou illisible d\'après ses métadonnées : en téléchargement', () => {
    expect(originalDisposition({ kind: 'VIDEO', mimeType: 'video/x-matroska', metadata: null })).toBe('attachment')
    expect(originalDisposition({ kind: 'VIDEO', mimeType: 'video/x-msvideo', metadata: { container: 'avi', videoCodec: null } })).toBe('attachment')
    expect(originalDisposition({ kind: 'VIDEO', mimeType: 'video/3gpp', metadata: { container: '3gp', videoCodec: 'avc1', playback: 'broad' } })).toBe('attachment')
    expect(originalDisposition({ kind: 'VIDEO', mimeType: 'video/mp4', metadata: { container: 'mp4', videoCodec: 'avc1', playback: 'broad' } })).toBe('inline')
    // `variable` (HEVC…) reste lu par une partie des navigateurs : affiché.
    expect(originalDisposition({ kind: 'VIDEO', mimeType: 'video/quicktime', metadata: { container: 'mov', videoCodec: 'hvc1', playback: 'variable' } })).toBe('inline')
    expect(originalDisposition({ kind: 'VIDEO', mimeType: 'video/webm', metadata: null })).toBe('inline')
    expect(originalDisposition({ kind: 'IMAGE', mimeType: 'image/jpeg', metadata: null })).toBe('inline')
  })

  it('Content-Disposition : affichage par défaut, téléchargement sur demande, nom ASCII et UTF-8', () => {
    expect(contentDisposition('été "2026".mp4')).toBe('inline; filename="ete _2026_.mp4"; filename*=UTF-8\'\'%C3%A9t%C3%A9%20%222026%22.mp4')
    expect(contentDisposition('clip.mkv', 'attachment')).toBe('attachment; filename="clip.mkv"; filename*=UTF-8\'\'clip.mkv')
    expect(contentDisposition('日本.avi', 'attachment')).toBe('attachment; filename=".avi"; filename*=UTF-8\'\'%E6%97%A5%E6%9C%AC.avi')
    expect(contentDisposition('', 'attachment')).toBe('attachment; filename="media"; filename*=UTF-8\'\'')
  })
})

describe('cache de diffusion : rendus et relecture', () => {
  function fakePrisma(rows: Record<string, unknown>) {
    const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null)
    vi.stubGlobal('usePrisma', async () => ({ media: { findUnique } }))
    return findUnique
  }

  it('lit le média avec ses rendus, une fois, puis le relit au plus une fois par seconde', async () => {
    const row = { ...video, id: 'cmcache0001' }
    const findUnique = fakePrisma({ cmcache0001: row })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    expect(await findDeliveryMedia('cmcache0001')).toBe(row)
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'cmcache0001' }, include: { renditions: true } })
    expect(await findDeliveryMedia('cmcache0001')).toBe(row)
    expect(findUnique).toHaveBeenCalledTimes(1)

    // Relecture demandée juste après une lecture : l'entrée est reprise (une URL inventée ne force pas
    // une requête à chaque fois).
    now.mockReturnValue(1_000_500)
    expect(await reloadDeliveryMedia('cmcache0001')).toBe(row)
    expect(findUnique).toHaveBeenCalledTimes(1)

    // Une seconde plus tard : relue en base (rendu produit ailleurs entre-temps).
    const updated = { ...row, renditions: [...row.renditions, rendition('av1', 'webm')] }
    fakePrisma({ cmcache0001: updated })
    now.mockReturnValue(1_001_000)
    expect(await reloadDeliveryMedia('cmcache0001')).toBe(updated)
    expect(await findDeliveryMedia('cmcache0001')).toBe(updated)
  })

  it('relit sans attendre après une invalidation locale ; un média absent n\'est pas mis en cache longtemps', async () => {
    const findUnique = fakePrisma({})
    expect(await findDeliveryMedia('cmcache0002')).toBeNull()
    expect(await findDeliveryMedia('cmcache0002')).toBeNull()
    expect(findUnique).toHaveBeenCalledTimes(1)
    invalidateMedia('cmcache0002')
    const row = { ...video, id: 'cmcache0002' }
    fakePrisma({ cmcache0002: row })
    expect(await findDeliveryMedia('cmcache0002')).toBe(row)
  })
})
