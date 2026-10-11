import { describe, expect, it } from 'vitest'
import { canonicalLanguage, textTrackGroup } from '../shared/utils/text-tracks'
import { isReservedPresetName, TRANSFORM_FORMATS } from '../shared/utils/transforms'
import { deliveryVariant, parseDeliveryPath } from '../server/lib/media/delivery-path'
import { buildSignatureQuery, checkSignature } from '../server/lib/media/signing'

const options = { maxDimension: 4096, formats: TRANSFORM_FORMATS }
const id = 'cmmedia0001'

describe('pistes de texte : chemins de diffusion et signatures', () => {
  it('reconnaît /m/<id>/v<n>/tracks/<piste>.vtt, sinon 404', () => {
    const parsed = parseDeliveryPath(`${id}/v3/tracks/cmtrack0001.vtt`, options)
    expect(parsed).toEqual({ type: 'target', target: { id, version: 3, filename: 'cmtrack0001.vtt', kind: 'track', trackId: 'cmtrack0001' } })
    expect(parsed?.type === 'target' && deliveryVariant(parsed.target)).toBe('track:cmtrack0001')
    for (const path of [`${id}/v3/tracks/cmtrack0001.srt`, `${id}/v3/tracks/court.vtt`, `${id}/v3/tracks/../x.vtt`]) {
      expect(parseDeliveryPath(path, options), path).toBeNull()
    }
    expect(isReservedPresetName('tracks')).toBe(true)
  })

  it('une piste : jamais de signature permanente ni couverte par « derived », couverte par « admin »', () => {
    const media = { id, version: 3 }
    expect(() => buildSignatureQuery('secret', media, { variant: 'track:cmtrack0001' }, null)).toThrow()
    const exact = Object.fromEntries(new URLSearchParams(buildSignatureQuery('secret', media, { variant: 'track:cmtrack0001' }, 2_000_000_000)))
    const target = { mediaId: id, version: 3, variant: 'track:cmtrack0001' }
    expect(checkSignature(['secret'], target, exact, 1_900_000_000).status).toBe('valid')
    // Même signature présentée sans échéance : refusée.
    expect(checkSignature(['secret'], target, { ...exact, exp: undefined }, 1_900_000_000).status).toBe('invalid')
    const derived = Object.fromEntries(new URLSearchParams(buildSignatureQuery('secret', media, { scope: 'derived' }, 2_000_000_000)))
    expect(checkSignature(['secret'], target, derived, 1_900_000_000).status).toBe('invalid')
    const admin = Object.fromEntries(new URLSearchParams(buildSignatureQuery('secret', media, { scope: 'admin' }, 2_000_000_000)))
    expect(checkSignature(['secret'], target, admin, 1_900_000_000).status).toBe('valid')
  })

  it('langues BCP 47 canoniques et groupes « par défaut »', () => {
    expect(canonicalLanguage('FR')).toBe('fr')
    expect(canonicalLanguage(' en-gb ')).toBe('en-GB')
    expect(canonicalLanguage('pt-br')).toBe('pt-BR')
    expect(canonicalLanguage('pas une langue !')).toBeNull()
    expect(canonicalLanguage('')).toBeNull()
    expect([textTrackGroup('SUBTITLES'), textTrackGroup('CAPTIONS'), textTrackGroup('DESCRIPTIONS'), textTrackGroup('CHAPTERS')]).toEqual(['text', 'text', 'descriptions', 'chapters'])
  })
})
