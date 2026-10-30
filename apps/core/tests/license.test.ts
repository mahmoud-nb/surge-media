import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { licenseInstallSchema, type LicensePayload } from '#shared/schemas/license'
import {
  daysUntil,
  LICENSE_STATES,
  licenseClockBehindMs,
  licenseFeaturesActive,
  licenseReferenceTime,
  licenseTermState,
  normalizeLicenseToken,
} from '#shared/utils/license'
import { LICENSE_DEV_PUBLIC_KEY, LICENSE_PUBLIC_KEYS, trustedLicenseKeys } from '../server/lib/license/keys'
import { licenseDetails, licensePeriod, signLicense, verifyLicense, type LicensePublicKey } from '../server/lib/license/token'

const DAY = 24 * 60 * 60
const NOW = Date.UTC(2027, 0, 15) / 1000

function keyPair(kid: string): { privateKey: KeyObject, publicKey: LicensePublicKey } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privateKey, publicKey: { kid, x: publicKey.export({ format: 'jwk' }).x! } }
}

const MAIN = keyPair('test-1')
const OTHER = keyPair('test-2')
const KEYS = [MAIN.publicKey, OTHER.publicKey]

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1,
    iss: 'surge-up',
    aud: 'surge-media',
    jti: 'SU-2027-0001',
    licensee: { name: 'Acme SAS', country: 'FR' },
    plan: 'business',
    features: ['sso'],
    instances: 3,
    iat: NOW,
    nbf: NOW,
    exp: NOW + 365 * DAY,
    support: NOW + 365 * DAY,
    ...overrides,
  }
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** Jeton signé à partir d'un en-tête et d'une charge quelconques (cas que `signLicense` ne produit pas). */
function signRaw(header: unknown, body: unknown, privateKey = MAIN.privateKey): string {
  const input = `${b64(header)}.${b64(body)}`
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`
}

const HEADER = { alg: 'EdDSA', typ: 'surge-media-license', kid: 'test-1' }

describe('vérification de la licence', () => {
  it('accepte une licence signée par une clé de confiance', () => {
    const result = verifyLicense(signLicense(payload(), MAIN.privateKey, 'test-1'), KEYS)
    expect(result).toEqual({ ok: true, kid: 'test-1', payload: payload() })
  })

  it('accepte chacune des clés de confiance (rotation)', () => {
    expect(verifyLicense(signLicense(payload(), OTHER.privateKey, 'test-2'), KEYS).ok).toBe(true)
  })

  it('ignore les espaces et retours à la ligne d\'un collage', () => {
    const token = signLicense(payload(), MAIN.privateKey, 'test-1')
    const wrapped = `  ${token.slice(0, 40)}\n${token.slice(40, 90)}\r\n ${token.slice(90)}\n`
    expect(normalizeLicenseToken(wrapped)).toBe(token)
    expect(verifyLicense(wrapped, KEYS).ok).toBe(true)
  })

  it('ignore les champs inconnus et accepte des offres et fonctions d\'une version plus récente', () => {
    const body = { ...payload({ plan: 'platinum', features: ['sso', 'future-feature'] }), note: 'champ ajouté plus tard' }
    const result = verifyLicense(signRaw(HEADER, body), KEYS)
    expect(result.ok && result.payload).toEqual(payload({ plan: 'platinum', features: ['sso', 'future-feature'] }))
  })

  it.each([
    ['', 'vide'],
    ['abc', 'une seule partie'],
    ['a.b', 'deux parties'],
    ['a.b.c.d', 'quatre parties'],
    ['a+b.c/d.e=f', 'base64 classique'],
  ])('refuse un jeton mal formé (%s : %s)', (token) => {
    expect(verifyLicense(token, KEYS)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('refuse un en-tête illisible', () => {
    const token = signLicense(payload(), MAIN.privateKey, 'test-1').split('.')
    expect(verifyLicense([Buffer.from('pas du json').toString('base64url'), token[1], token[2]].join('.'), KEYS))
      .toEqual({ ok: false, reason: 'malformed' })
  })

  it.each([
    [{ ...HEADER, alg: 'none' }],
    [{ ...HEADER, alg: 'HS256' }],
    [{ ...HEADER, typ: 'JWT' }],
    [{ alg: 'EdDSA', kid: 'test-1' }],
  ])('refuse un autre algorithme ou type (%j)', (header) => {
    expect(verifyLicense(signRaw(header, payload()), KEYS)).toEqual({ ok: false, reason: 'algorithm' })
  })

  it('refuse une clé inconnue', () => {
    const stranger = keyPair('test-9')
    expect(verifyLicense(signLicense(payload(), stranger.privateKey, 'test-9'), KEYS)).toEqual({ ok: false, reason: 'unknown-key' })
  })

  it('refuse une licence signée par une autre clé sous un identifiant de confiance', () => {
    const forger = keyPair('test-1')
    expect(verifyLicense(signLicense(payload(), forger.privateKey, 'test-1'), KEYS)).toEqual({ ok: false, reason: 'signature' })
  })

  it('refuse toute altération de l\'en-tête, de la charge ou de la signature', () => {
    const [header, body, signature] = signLicense(payload(), MAIN.privateKey, 'test-1').split('.') as [string, string, string]
    const forgedBody = b64(payload({ plan: 'enterprise', features: ['sso', 'siem', 'scim'], instances: null }))
    const forgedHeader = b64({ ...HEADER, kid: 'test-2' })
    const bytes = Buffer.from(signature, 'base64url')
    bytes[10] = bytes[10]! ^ 0x01
    expect(verifyLicense(`${header}.${forgedBody}.${signature}`, KEYS)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyLicense(`${forgedHeader}.${body}.${signature}`, KEYS)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyLicense(`${header}.${body}.${bytes.toString('base64url')}`, KEYS)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyLicense(`${header}.${body}.${signature.slice(0, -4)}`, KEYS)).toEqual({ ok: false, reason: 'signature' })
  })

  it('refuse une licence d\'un autre produit ou d\'un autre émetteur', () => {
    expect(verifyLicense(signRaw(HEADER, { ...payload(), aud: 'other-product' }), KEYS)).toEqual({ ok: false, reason: 'product' })
    expect(verifyLicense(signRaw(HEADER, { ...payload(), iss: 'someone-else' }), KEYS)).toEqual({ ok: false, reason: 'product' })
  })

  it('signale un format plus récent', () => {
    expect(verifyLicense(signRaw(HEADER, { ...payload(), v: 2 }), KEYS)).toEqual({ ok: false, reason: 'version' })
  })

  it.each([
    ['sans titulaire', (({ licensee: _, ...rest }) => rest)(payload())],
    ['sans version', (({ v: _, ...rest }) => rest)(payload())],
    ['échéance avant le début', payload({ exp: NOW - DAY })],
    ['fonction mal écrite', payload({ features: ['SSO'] })],
    ['instances nulles', payload({ instances: 0 })],
    ['numéro en minuscules', payload({ jti: 'su-2027-0001' })],
    ['pays sur trois lettres', payload({ licensee: { name: 'Acme', country: 'FRA' } })],
    ['charge en tableau', [payload()]],
  ])('refuse une charge incomplète ou incohérente (%s)', (_, body) => {
    expect(verifyLicense(signRaw(HEADER, body), KEYS)).toEqual({ ok: false, reason: Array.isArray(body) ? 'malformed' : 'payload' })
  })

  it('n\'accepte la clé de développement qu\'en développement', () => {
    expect(trustedLicenseKeys(false)).toEqual(LICENSE_PUBLIC_KEYS)
    expect(trustedLicenseKeys(false)).not.toContainEqual(LICENSE_DEV_PUBLIC_KEY)
    expect(trustedLicenseKeys(true)).toContainEqual(LICENSE_DEV_PUBLIC_KEY)
    const devSigned = signLicense(payload(), MAIN.privateKey, LICENSE_DEV_PUBLIC_KEY.kid)
    expect(verifyLicense(devSigned, trustedLicenseKeys(false))).toEqual({ ok: false, reason: 'unknown-key' })
  })

  it('décrit la licence avec des dates ISO, fin de grâce comprise', () => {
    expect(licenseDetails(payload())).toEqual({
      id: 'SU-2027-0001',
      licensee: { name: 'Acme SAS', country: 'FR' },
      plan: 'business',
      features: ['sso'],
      instances: 3,
      issuedAt: '2027-01-15T00:00:00.000Z',
      startsAt: '2027-01-15T00:00:00.000Z',
      expiresAt: '2028-01-15T00:00:00.000Z',
      graceEndsAt: '2028-02-14T00:00:00.000Z',
      supportEndsAt: '2028-01-15T00:00:00.000Z',
    })
  })

  it('borne la licence collée', () => {
    expect(licenseInstallSchema.safeParse({ token: '  ' }).success).toBe(false)
    expect(licenseInstallSchema.safeParse({ token: 'x'.repeat(8193) }).success).toBe(false)
    expect(licenseInstallSchema.parse({ token: ' abc.def.ghi \n' })).toEqual({ token: 'abc.def.ghi' })
  })
})

describe('états de la licence', () => {
  const period = licensePeriod(payload())
  const start = period.startsAt
  const end = period.expiresAt
  const ms = (days: number) => days * DAY * 1000

  it.each([
    [start - 1, 'pending'],
    [start, 'valid'],
    [end - ms(31), 'valid'],
    [end - ms(30), 'expiring'],
    [end - ms(29), 'expiring'],
    [end - 1, 'expiring'],
    [end, 'grace'],
    [end + ms(29), 'grace'],
    [end + ms(30), 'grace'],
    [end + ms(30) + 1, 'expired'],
    [end + ms(31), 'expired'],
  ])('à %i ms → %s', (reference, state) => {
    expect(licenseTermState(period, reference)).toBe(state)
  })

  it('n\'active les fonctions payantes qu\'en état valable, bientôt échu ou en grâce', () => {
    const active = LICENSE_STATES.filter(licenseFeaturesActive)
    expect(active).toEqual(['valid', 'expiring', 'grace'])
  })

  it('compte les jours restants pour l\'affichage', () => {
    expect(daysUntil(end, end - ms(30))).toBe(30)
    expect(daysUntil(end, end - ms(29) - 1)).toBe(30)
    expect(daysUntil(end, end)).toBe(0)
    expect(daysUntil(end, end + ms(3))).toBe(0)
  })
})

describe('date de référence', () => {
  const system = Date.UTC(2027, 5, 1)
  const hour = 60 * 60 * 1000

  it('suit l\'horloge du système quand elle est la plus récente', () => {
    expect(licenseReferenceTime(system)).toBe(system)
    expect(licenseReferenceTime(system, system - hour, null, undefined)).toBe(system)
  })

  it('ne recule pas avec l\'horloge : le repère ou l\'heure du serveur de base l\'emportent', () => {
    expect(licenseReferenceTime(system - 90 * DAY * 1000, system)).toBe(system)
    expect(licenseReferenceTime(system - hour, null, system)).toBe(system)
    expect(licenseReferenceTime(system - hour, system - 2 * hour, system)).toBe(system)
  })

  it('ignore les témoins absents ou illisibles', () => {
    expect(licenseReferenceTime(system, Number.NaN, Number.POSITIVE_INFINITY, null)).toBe(system)
  })

  it('mesure le retard de l\'horloge du système', () => {
    expect(licenseClockBehindMs(system, system)).toBe(0)
    expect(licenseClockBehindMs(system + hour, system)).toBe(0)
    expect(licenseClockBehindMs(system - 3 * hour, system)).toBe(3 * hour)
  })

  it('une licence échue le reste quand l\'horloge recule', () => {
    const period = licensePeriod(payload())
    const realNow = period.expiresAt + 60 * DAY * 1000
    const rolledBack = period.expiresAt - 100 * DAY * 1000
    expect(licenseTermState(period, rolledBack)).toBe('valid')
    expect(licenseTermState(period, licenseReferenceTime(rolledBack, realNow))).toBe('expired')
  })
})
