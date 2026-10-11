import { describe, expect, it } from 'vitest'
import {
  alignedExpiry,
  buildSignatureQuery,
  checkSignature,
  keyId,
  targetGrant,
} from '../server/lib/media/signing'

const SECRET = 'secret-courant-de-test-0123456789abcdef'
const PREVIOUS = 'ancien-secret-de-test-fedcba9876543210'
const NOW = 1_800_000_000
const media = { id: 'cmediaid0000000000000001', version: 3 }

/** Paramètres d'un lien (compatibles avec SignatureQuery : chaque valeur est une chaîne). */
function parse(query: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(query))
}

function check(query: string, variant = 'original', overrides: Partial<{ version: number, now: number, secrets: string[] }> = {}) {
  return checkSignature(
    overrides.secrets ?? [SECRET],
    { mediaId: media.id, version: overrides.version ?? media.version, variant },
    parse(query),
    overrides.now ?? NOW,
  )
}

describe('utilitaires', () => {
  it('produit un identifiant de secret court, stable et distinct', () => {
    expect(keyId(SECRET)).toHaveLength(8)
    expect(keyId(SECRET)).toBe(keyId(SECRET))
    expect(keyId(SECRET)).not.toBe(keyId(PREVIOUS))
    expect(keyId(SECRET)).not.toContain(SECRET.slice(0, 4))
  })

  it('associe chaque fichier à son droit', () => {
    expect(targetGrant('original')).toBe('file')
    expect(targetGrant('preview')).toBe('preset:preview')
    expect(targetGrant('t:w_800,h_450')).toBe('t:w_800,h_450')
  })

  it('aligne l\'échéance sur la tranche suivante, sans jamais raccourcir la durée', () => {
    expect(alignedExpiry(1000, 3600, 900)).toBe(5400)
    expect(alignedExpiry(1800, 3600, 900)).toBe(5400)
    expect(alignedExpiry(1801, 3600, 900)).toBe(6300)
    for (let now = 0; now < 2000; now += 37) {
      const expires = alignedExpiry(now, 3600, 900)
      expect(expires - now).toBeGreaterThanOrEqual(3600)
      expect(expires - now).toBeLessThan(3600 + 900)
      expect(expires % 900).toBe(0)
    }
  })
})

describe('lien vers un fichier précis', () => {
  const query = buildSignatureQuery(SECRET, media, { variant: 'original' }, NOW + 60)

  it('contient échéance, identifiant de secret et signature, sans droit élargi', () => {
    const params = parse(query)
    expect(params.exp).toBe(String(NOW + 60))
    expect(params.kid).toBe(keyId(SECRET))
    expect(params.scope).toBeUndefined()
    expect(params.sig).toMatch(/^[\w-]{43}$/)
  })

  it('est valable pour ce fichier jusqu\'à son échéance', () => {
    expect(check(query)).toEqual({ status: 'valid', expires: NOW + 60, scope: null })
    expect(check(query, 'original', { now: NOW + 60 })).toEqual({ status: 'expired' })
  })

  it('ne donne accès ni à un dérivé, ni à une autre version', () => {
    expect(check(query, 'preview')).toEqual({ status: 'invalid' })
    expect(check(query, 'original', { version: 4 })).toEqual({ status: 'invalid' })
  })

  it('refuse une signature, une échéance ou un secret altérés', () => {
    const params = parse(query)
    expect(check(new URLSearchParams({ ...params, sig: `${String(params.sig).slice(0, -1)}A` }).toString())).toEqual({ status: 'invalid' })
    expect(check(new URLSearchParams({ ...params, exp: String(NOW + 3600) }).toString())).toEqual({ status: 'invalid' })
    expect(check(new URLSearchParams({ ...params, kid: keyId(PREVIOUS) }).toString())).toEqual({ status: 'invalid' })
    expect(check(query, 'original', { secrets: [PREVIOUS] })).toEqual({ status: 'invalid' })
  })

  it('refuse des paramètres incomplets ou malformés', () => {
    expect(checkSignature([SECRET], { mediaId: media.id, version: 3, variant: 'original' }, {}, NOW)).toEqual({ status: 'invalid' })
    expect(checkSignature([SECRET], { mediaId: media.id, version: 3, variant: 'original' }, { exp: 'abc', kid: 'x', sig: 'y' }, NOW)).toEqual({ status: 'invalid' })
  })
})

describe('droits élargis', () => {
  it('« derived » couvre les dérivés, jamais l\'original', () => {
    const query = buildSignatureQuery(SECRET, media, { scope: 'derived' }, NOW + 60)
    expect(parse(query).scope).toBe('derived')
    expect(check(query, 'preview')).toEqual({ status: 'valid', expires: NOW + 60, scope: 'derived' })
    expect(check(query, 'original')).toEqual({ status: 'invalid' })
  })

  it('« admin » couvre l\'original et les dérivés de la version', () => {
    const query = buildSignatureQuery(SECRET, media, { scope: 'admin' }, NOW + 60)
    expect(check(query, 'original')).toMatchObject({ status: 'valid', scope: 'admin' })
    expect(check(query, 'preview')).toMatchObject({ status: 'valid', scope: 'admin' })
    expect(check(query, 'original', { version: 2 })).toEqual({ status: 'invalid' })
  })

  it('ne se transforme pas en ajoutant ou en changeant `scope` dans l\'URL', () => {
    const exact = parse(buildSignatureQuery(SECRET, media, { variant: 'original' }, NOW + 60))
    const forged = new URLSearchParams({ ...exact, scope: 'admin' }).toString()
    expect(check(forged, 'preview')).toEqual({ status: 'invalid' })
    const unknown = new URLSearchParams({ ...exact, scope: 'everything' }).toString()
    expect(check(unknown)).toEqual({ status: 'invalid' })
  })
})

describe('transformations', () => {
  it('une signature de transformation ne vaut que pour elle', () => {
    const query = buildSignatureQuery(SECRET, media, { variant: 't:w_800' }, NOW + 60)
    expect(check(query, 't:w_800')).toEqual({ status: 'valid', expires: NOW + 60, scope: null })
    expect(check(query, 't:w_801')).toEqual({ status: 'invalid' })
    expect(check(query, 'preview')).toEqual({ status: 'invalid' })
    expect(check(query, 'original')).toEqual({ status: 'invalid' })
  })

  it('une signature permanente couvre un dérivé précis, sans échéance', () => {
    const query = buildSignatureQuery(SECRET, media, { variant: 't:w_800' }, null)
    expect(parse(query).exp).toBeUndefined()
    expect(check(query, 't:w_800', { now: NOW * 2 })).toEqual({ status: 'valid', expires: null, scope: null })
    expect(check(query, 't:w_800', { version: 4 })).toEqual({ status: 'invalid' })
    const preset = buildSignatureQuery(SECRET, media, { variant: 'thumb' }, null)
    expect(check(preset, 'thumb')).toMatchObject({ status: 'valid', expires: null })
  })

  it('jamais pour l\'original ni un droit élargi', () => {
    expect(() => buildSignatureQuery(SECRET, media, { variant: 'original' }, null)).toThrow()
    expect(() => buildSignatureQuery(SECRET, media, { scope: 'derived' }, null)).toThrow()
    // Retirer l'échéance d'un lien temporaire ne le rend pas permanent.
    const { exp: _exp, ...timed } = parse(buildSignatureQuery(SECRET, media, { variant: 't:w_800' }, NOW + 60))
    expect(check(new URLSearchParams(timed).toString(), 't:w_800')).toEqual({ status: 'invalid' })
    const { exp: _exp2, ...derived } = parse(buildSignatureQuery(SECRET, media, { scope: 'derived' }, NOW + 60))
    expect(check(new URLSearchParams(derived).toString(), 't:w_800')).toEqual({ status: 'invalid' })
    const { exp: _exp3, ...file } = parse(buildSignatureQuery(SECRET, media, { variant: 'original' }, NOW + 60))
    expect(check(new URLSearchParams(file).toString(), 'original')).toEqual({ status: 'invalid' })
  })
})

describe('rotation du secret', () => {
  it('accepte les liens signés avec l\'ancien secret tant qu\'il est déclaré', () => {
    const old = buildSignatureQuery(PREVIOUS, media, { variant: 'original' }, NOW + 60)
    expect(check(old, 'original', { secrets: [SECRET, PREVIOUS] })).toMatchObject({ status: 'valid' })
    expect(check(old, 'original', { secrets: [SECRET] })).toEqual({ status: 'invalid' })
  })
})
