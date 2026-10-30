import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { licensePayloadSchema, type LicensePayload } from '#shared/schemas/license'
import { licenseGraceEndsAt, normalizeLicenseToken, type LicenseDetails, type LicenseInvalidReason, type LicensePeriod } from '#shared/utils/license'

/**
 * Jeton de licence : JWS compact signé Ed25519 (RFC 7515, `alg: EdDSA` de la RFC 8037), vérifié hors ligne
 * contre les clés publiques intégrées (keys.ts) — jamais d'appel vers l'éditeur. Format :
 * `<en-tête>.<charge>.<signature>` en base64url ; en-tête `{ alg, typ, kid }`, charge décrite par
 * `licensePayloadSchema`. Fonctions pures (les clés sont passées en paramètre), testées (tests/license.test.ts) ;
 * l'outil d'émission (dépôt privé) en reprend `signLicense` et `verifyLicense`.
 */

export const LICENSE_ALGORITHM = 'EdDSA'
export const LICENSE_TYPE = 'surge-media-license'
export const LICENSE_ISSUER = 'surge-up'
export const LICENSE_AUDIENCE = 'surge-media'
export const LICENSE_FORMAT_VERSION = 1

/** Clé publique de confiance : identifiant (`kid` de l'en-tête) et coordonnée `x` du JWK Ed25519 (base64url). */
export interface LicensePublicKey {
  kid: string
  x: string
}

export type LicenseVerification
  = | { ok: true, kid: string, payload: LicensePayload }
    | { ok: false, reason: LicenseInvalidReason }

const BASE64URL = /^[A-Za-z0-9_-]+$/
const SIGNATURE_BYTES = 64

const publicKeys = new Map<string, KeyObject>()

function publicKeyObject(key: LicensePublicKey): KeyObject {
  let object = publicKeys.get(key.x)
  if (!object) {
    object = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.x }, format: 'jwk' })
    publicKeys.set(key.x, object)
  }
  return object
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  }
  catch {
    return null
  }
}

/** Signe une licence (outil d'émission, tests). */
export function signLicense(payload: LicensePayload, privateKey: KeyObject, kid: string): string {
  const signingInput = `${encodeJson({ alg: LICENSE_ALGORITHM, typ: LICENSE_TYPE, kid })}.${encodeJson(payload)}`
  return `${signingInput}.${sign(null, Buffer.from(signingInput), privateKey).toString('base64url')}`
}

/**
 * Vérifie une licence collée : forme, en-tête, clé connue, signature, puis seulement le contenu (jamais lu
 * avant d'avoir vérifié la signature). Ne juge pas les dates : voir `licenseTermState`.
 */
export function verifyLicense(input: string, keys: readonly LicensePublicKey[]): LicenseVerification {
  const parts = normalizeLicenseToken(input).split('.')
  if (parts.length !== 3 || !parts.every(part => BASE64URL.test(part))) return { ok: false, reason: 'malformed' }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]

  const header = decodeJson(encodedHeader)
  if (!header) return { ok: false, reason: 'malformed' }
  if (header.alg !== LICENSE_ALGORITHM || header.typ !== LICENSE_TYPE) return { ok: false, reason: 'algorithm' }
  const key = keys.find(candidate => candidate.kid === header.kid)
  if (!key) return { ok: false, reason: 'unknown-key' }

  const signature = Buffer.from(encodedSignature, 'base64url')
  const signed = signature.length === SIGNATURE_BYTES
    && verify(null, Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKeyObject(key), signature)
  if (!signed) return { ok: false, reason: 'signature' }

  const payload = decodeJson(encodedPayload)
  if (!payload) return { ok: false, reason: 'malformed' }
  if (payload.iss !== LICENSE_ISSUER || payload.aud !== LICENSE_AUDIENCE) return { ok: false, reason: 'product' }
  if (typeof payload.v === 'number' && payload.v > LICENSE_FORMAT_VERSION) return { ok: false, reason: 'version' }
  const parsed = licensePayloadSchema.safeParse(payload)
  if (!parsed.success) return { ok: false, reason: 'payload' }
  return { ok: true, kid: key.kid, payload: parsed.data }
}

/** Période de validité d'une licence (millisecondes). */
export function licensePeriod(payload: LicensePayload): LicensePeriod {
  return { startsAt: payload.nbf * 1000, expiresAt: payload.exp * 1000 }
}

/** Licence telle que l'API la décrit. */
export function licenseDetails(payload: LicensePayload): LicenseDetails {
  const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
  return {
    id: payload.jti,
    licensee: payload.licensee,
    plan: payload.plan,
    features: payload.features,
    instances: payload.instances,
    issuedAt: iso(payload.iat),
    startsAt: iso(payload.nbf),
    expiresAt: iso(payload.exp),
    graceEndsAt: new Date(licenseGraceEndsAt(payload.exp * 1000)).toISOString(),
    supportEndsAt: iso(payload.support),
  }
}
