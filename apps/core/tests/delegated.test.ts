import { describe, expect, it } from 'vitest'
import { decodeDelegatedToken, encodeDelegatedToken, isDelegatedToken, toDelegatedGrant } from '../server/lib/access/delegated'
import { keyId } from '../server/lib/media/signing'
import { apiDelegatedTokenBodySchema, type DelegatedTokenClaims } from '../shared/schemas/api'
import { DELEGATED_TOKEN_MAX_LENGTH } from '../shared/utils/api'
import { credentialScopes, DELEGATED_TOKEN_SCOPES } from '../shared/utils/permissions'

const SECRET = 'secret-de-signature-de-test-assez-long'
const PREVIOUS = 'ancien-secret-de-signature-de-test'
const NOW = 1_790_000_000

function claims(overrides: Partial<DelegatedTokenClaims> = {}, secret = SECRET): DelegatedTokenClaims {
  return {
    v: 1,
    jti: 'jti-0123456789',
    iss: 'cmissuer00000000000000000',
    project: 'cmproject0000000000000000',
    scopes: ['media:upload'],
    sub: 'user-42',
    origin: 'https://app.example.com',
    upload: { maxFiles: 3, maxSize: 1_000_000, types: ['image/png'], visibility: 'private' },
    iat: NOW,
    exp: NOW + 900,
    kid: keyId(secret),
    ...overrides,
  }
}

describe('jetons délégués : format et signature', () => {
  it('aller-retour : charge lisible, vérifiée avec le secret désigné par kid', () => {
    const token = encodeDelegatedToken(claims(), SECRET)
    expect(token.startsWith('sm_dt_')).toBe(true)
    expect(isDelegatedToken(token)).toBe(true)
    // La charge est lisible sans secret (le composant anticipe l'échéance).
    const payload = JSON.parse(Buffer.from(token.slice(6).split('.')[0]!, 'base64url').toString('utf8'))
    expect(payload.exp).toBe(NOW + 900)
    expect(decodeDelegatedToken(token, [SECRET], NOW)).toEqual({ ok: true, claims: claims() })
  })

  it('rotation du secret : l\'ancien secret reste accepté, un secret retiré invalide le jeton', () => {
    const token = encodeDelegatedToken(claims({}, PREVIOUS), PREVIOUS)
    expect(decodeDelegatedToken(token, [SECRET, PREVIOUS], NOW).ok).toBe(true)
    expect(decodeDelegatedToken(token, [SECRET], NOW)).toEqual({ ok: false, code: 'TOKEN_INVALID' })
  })

  it('refuse une charge ou une signature altérée', () => {
    const token = encodeDelegatedToken(claims(), SECRET)
    const [payload, signature] = token.slice(6).split('.') as [string, string]
    // Portées élargies par le navigateur : la signature ne correspond plus.
    const forged = Buffer.from(JSON.stringify(claims({ scopes: [...DELEGATED_TOKEN_SCOPES] }))).toString('base64url')
    expect(decodeDelegatedToken(`sm_dt_${forged}.${signature}`, [SECRET], NOW).ok).toBe(false)
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
    expect(decodeDelegatedToken(`sm_dt_${payload}.${flipped}`, [SECRET], NOW).ok).toBe(false)
    // Signé avec un autre secret mais annonçant le kid du secret courant.
    expect(decodeDelegatedToken(encodeDelegatedToken(claims(), 'un-autre-secret'), [SECRET], NOW).ok).toBe(false)
  })

  it('refuse les formes invalides sans erreur', () => {
    for (const value of ['', 'sm_dt_', 'sm_dt_abc', 'sm_dt_a.b.c', 'sm_pat_abc.def', 'sm_dt_!!!.xyz', `sm_dt_${'a'.repeat(DELEGATED_TOKEN_MAX_LENGTH)}.b`]) {
      expect(decodeDelegatedToken(value, [SECRET], NOW)).toEqual({ ok: false, code: 'TOKEN_INVALID' })
    }
    // JSON valide et signé, mais contenu hors contrat (version inconnue).
    const unknown = encodeDelegatedToken({ ...claims(), v: 2 } as unknown as DelegatedTokenClaims, SECRET)
    expect(decodeDelegatedToken(unknown, [SECRET], NOW).ok).toBe(false)
  })

  it('échéance : TOKEN_EXPIRED seulement pour un jeton authentique', () => {
    const token = encodeDelegatedToken(claims(), SECRET)
    expect(decodeDelegatedToken(token, [SECRET], NOW + 899).ok).toBe(true)
    expect(decodeDelegatedToken(token, [SECRET], NOW + 900)).toEqual({ ok: false, code: 'TOKEN_EXPIRED' })
    expect(decodeDelegatedToken(token, ['autre'], NOW + 900)).toEqual({ ok: false, code: 'TOKEN_INVALID' })
  })

  it('charge → droits utilisés par le contrôle d\'accès', () => {
    const grant = toDelegatedGrant(claims({ sub: undefined, origin: undefined }))
    expect(grant).toMatchObject({ issuerId: 'cmissuer00000000000000000', projectId: 'cmproject0000000000000000', subject: null, origin: null })
    expect(grant.expiresAt.getTime()).toBe((NOW + 900) * 1000)
  })
})

describe('jetons délégués : portées effectives', () => {
  it('portées du jeton ∩ portées actuelles de l\'émetteur, dans son seul projet', () => {
    const issuer = ['project:read', 'media:read', 'media:upload'] as const
    expect(credentialScopes({ type: 'DELEGATED', scopes: ['media:read', 'media:upload'], ownProject: true, issuerScopes: [...issuer] }))
      .toEqual(['media:read', 'media:upload'])
    // L'émetteur a perdu media:upload : le jeton aussi.
    expect(credentialScopes({ type: 'DELEGATED', scopes: ['media:upload'], ownProject: true, issuerScopes: ['project:read', 'media:read'] })).toEqual([])
    expect(credentialScopes({ type: 'DELEGATED', scopes: ['media:read'], ownProject: false, issuerScopes: [...issuer] })).toEqual([])
    // Aucune lecture d'office : un jeton d'envoi seul ne lit pas les médias.
    expect(credentialScopes({ type: 'DELEGATED', scopes: ['media:upload'], ownProject: true, issuerScopes: [...issuer] })).toEqual(['media:upload'])
  })
})

describe('jetons délégués : demande d\'émission', () => {
  it('valeurs par défaut et normalisation de l\'origine', () => {
    const body = apiDelegatedTokenBodySchema.parse({ scopes: ['media:read'], origin: 'HTTPS://App.Example.com/' })
    expect(body).toEqual({ scopes: ['media:read'], expiresIn: 900, origin: 'https://app.example.com' })
  })

  it('refuse durée hors bornes, portée inconnue, origine générique, sujet avec caractère de contrôle, champ inconnu', () => {
    const invalid = [
      { scopes: [] },
      { scopes: ['project:members'] },
      { scopes: ['media:read', 'tags:manage'] },
      { scopes: ['media:read'], expiresIn: 30 },
      { scopes: ['media:read'], expiresIn: 3601 },
      { scopes: ['media:read'], origin: 'https://*.example.com' },
      { scopes: ['media:read'], origin: 'https://app.example.com/chemin' },
      { scopes: ['media:read'], subject: 'a\nb' },
      { scopes: ['media:read'], subject: 'x'.repeat(129) },
      { scopes: ['media:read'], issuer: 'moi' },
    ]
    for (const input of invalid) expect(apiDelegatedTokenBodySchema.safeParse(input).success, JSON.stringify(input)).toBe(false)
  })

  it('contraintes d\'envoi : seulement avec media:upload ou media:write, types acceptés par l\'installation', () => {
    expect(apiDelegatedTokenBodySchema.safeParse({ scopes: ['media:read'], upload: { maxFiles: 1 } }).success).toBe(false)
    expect(apiDelegatedTokenBodySchema.safeParse({ scopes: ['media:write'], upload: { maxSize: 1000 } }).success).toBe(true)
    expect(apiDelegatedTokenBodySchema.safeParse({ scopes: ['media:upload'], upload: { types: ['image/svg+xml'] } }).success).toBe(false)
    expect(apiDelegatedTokenBodySchema.safeParse({ scopes: ['media:upload'], upload: { maxFiles: 0 } }).success).toBe(false)
    expect(apiDelegatedTokenBodySchema.safeParse({ scopes: ['media:upload'], upload: { visibility: 'PRIVATE' } }).success).toBe(false)
    const parsed = apiDelegatedTokenBodySchema.parse({ scopes: ['media:upload'], upload: { maxFiles: 5, types: ['image/png', 'image/jpeg'], visibility: 'private' } })
    expect(parsed.upload).toEqual({ maxFiles: 5, types: ['image/png', 'image/jpeg'], visibility: 'private' })
  })
})
