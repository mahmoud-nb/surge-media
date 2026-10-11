import { describe, expect, it } from 'vitest'
import {
  displayPrefix,
  generateAccessToken,
  hashAccessToken,
  parseAccessToken,
  TOKEN_BODY_LENGTH,
  TOKEN_CHECKSUM_LENGTH,
} from '../server/lib/access/tokens'
import { addOriginSchema, confirmPasswordSchema, createPersonalTokenSchema, createProjectKeySchema, forgetTrustedDevicesSchema } from '../shared/schemas/credentials'
import { isRecentlyVerified, REAUTH_WINDOW_SECONDS, TRUSTED_DEVICE_DEFAULT_DAYS, TRUSTED_DEVICE_MAX_DAYS, trustedDeviceDays } from '../shared/utils/auth'
import { TOKEN_PREFIXES, TOKEN_TYPES, tokenStatus } from '../shared/utils/credentials'
import { isOriginAllowed, isWildcardOrigin, normalizeOrigin } from '../shared/utils/origins'
import { hasPermission, ROLES, tokenScopes } from '../shared/utils/permissions'

describe('format des identifiants opaques', () => {
  it('produit sm_<type>_ + 43 caractères base62 + CRC32 sur 6 caractères', () => {
    for (const type of TOKEN_TYPES) {
      const { value, prefix, hash } = generateAccessToken(type)
      expect(value.startsWith(TOKEN_PREFIXES[type])).toBe(true)
      expect(value).toHaveLength(TOKEN_PREFIXES[type].length + TOKEN_BODY_LENGTH + TOKEN_CHECKSUM_LENGTH)
      expect(value.slice(TOKEN_PREFIXES[type].length)).toMatch(/^[0-9A-Za-z]+$/)
      expect(prefix).toBe(displayPrefix(value, type))
      expect(prefix).toHaveLength(TOKEN_PREFIXES[type].length + 6)
      expect(hash).toBe(hashAccessToken(value))
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      expect(parseAccessToken(value)).toBe(type)
    }
  })

  it('garde une longueur fixe, même avec des octets nuls ou maximaux', () => {
    for (const byte of [0x00, 0xFF]) {
      const { value } = generateAccessToken('SECRET', Buffer.alloc(32, byte))
      expect(value).toHaveLength(TOKEN_PREFIXES.SECRET.length + TOKEN_BODY_LENGTH + TOKEN_CHECKSUM_LENGTH)
      expect(parseAccessToken(value)).toBe('SECRET')
    }
  })

  it('est déterministe pour un même tirage et unique d\'un tirage à l\'autre', () => {
    const random = Buffer.alloc(32, 7)
    expect(generateAccessToken('PERSONAL', random).value).toBe(generateAccessToken('PERSONAL', random).value)
    const values = new Set(Array.from({ length: 200 }, () => generateAccessToken('PUBLISHABLE').value))
    expect(values.size).toBe(200)
  })

  it('rejette sans base de données un jeton altéré, tronqué ou d\'un autre format', () => {
    const { value } = generateAccessToken('SECRET')
    const body = value.slice(TOKEN_PREFIXES.SECRET.length)
    const flipped = value.slice(0, -10) + (value.at(-10) === 'a' ? 'b' : 'a') + value.slice(-9)
    expect(parseAccessToken(flipped)).toBeNull()
    expect(parseAccessToken(value.slice(0, -1))).toBeNull()
    expect(parseAccessToken(`${value}x`)).toBeNull()
    // Même corps, autre type : le CRC couvre le préfixe.
    expect(parseAccessToken(`sm_pk_${body}`)).toBeNull()
    expect(parseAccessToken('')).toBeNull()
    expect(parseAccessToken('Bearer abc')).toBeNull()
    expect(parseAccessToken(`sm_xx_${body}`)).toBeNull()
  })

  it('refuse un tirage aléatoire de mauvaise taille', () => {
    expect(() => generateAccessToken('SECRET', Buffer.alloc(16))).toThrow()
  })
})

describe('portées des identifiants', () => {
  it('incluent toujours la lecture, dans l\'ordre canonique, sans portée de gestion', () => {
    expect(tokenScopes([])).toEqual(['project:read', 'media:read'])
    expect(tokenScopes(['media:delete', 'media:upload'])).toEqual(['project:read', 'media:read', 'media:upload', 'media:delete'])
    expect(tokenScopes(['project:members', 'project:settings', 'users:manage'])).toEqual(['project:read', 'media:read'])
  })

  it('le journal d\'audit est réservé à l\'ADMIN', () => {
    expect(ROLES.filter(role => hasPermission(role, 'audit:read'))).toEqual(['ADMIN'])
  })

  it('statut calculé : révoqué prime, puis expiré, sinon actif', () => {
    const now = Date.parse('2026-09-29T12:00:00Z')
    expect(tokenStatus({ revokedAt: null, expiresAt: null }, now)).toBe('active')
    expect(tokenStatus({ revokedAt: null, expiresAt: '2026-09-29T12:00:01Z' }, now)).toBe('active')
    expect(tokenStatus({ revokedAt: null, expiresAt: '2026-09-29T12:00:00Z' }, now)).toBe('expired')
    expect(tokenStatus({ revokedAt: '2026-09-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z' }, now)).toBe('revoked')
  })
})

describe('schémas de création', () => {
  it('jeton personnel : au moins un espace', () => {
    const base = { name: 'CI', lifetime: '90' }
    expect(createPersonalTokenSchema.safeParse(base).success).toBe(false)
    expect(createPersonalTokenSchema.safeParse({ ...base, allProjects: true }).success).toBe(true)
    expect(createPersonalTokenSchema.safeParse({ ...base, projectIds: ['p1'] }).success).toBe(true)
    expect(createPersonalTokenSchema.safeParse({ ...base, includeLibrary: true }).success).toBe(true)
  })

  it('jeton personnel : durée obligatoire et bornée, portées de gestion refusées', () => {
    expect(createPersonalTokenSchema.safeParse({ name: 'CI', allProjects: true }).success).toBe(false)
    expect(createPersonalTokenSchema.safeParse({ name: 'CI', lifetime: 'never', allProjects: true }).success).toBe(false)
    expect(createPersonalTokenSchema.safeParse({ name: 'CI', lifetime: '30', allProjects: true, scopes: ['project:members'] }).success).toBe(false)
    const parsed = createPersonalTokenSchema.parse({ name: ' CI ', lifetime: '30', allProjects: true, scopes: ['media:write', 'media:write'] })
    expect(parsed.name).toBe('CI')
    expect(parsed.scopes).toEqual(['media:write'])
  })

  it('clé : environnement normalisé et au bon format', () => {
    expect(createProjectKeySchema.parse({ type: 'SECRET', name: 'API', environment: ' Production ' }).environment).toBe('production')
    expect(createProjectKeySchema.parse({ type: 'PUBLISHABLE', name: 'Site', environment: 'preview-eu' }).lifetime).toBe('365')
    for (const environment of ['', 'pré-prod', 'a b', '-x', 'x--y', 'x'.repeat(33)]) {
      expect(createProjectKeySchema.safeParse({ type: 'SECRET', name: 'API', environment }).success).toBe(false)
    }
    expect(createProjectKeySchema.safeParse({ type: 'PERSONAL', name: 'API', environment: 'test' }).success).toBe(false)
  })
})

describe('origines autorisées', () => {
  it('normalise la saisie', () => {
    expect(normalizeOrigin('https://App.Example.com/')).toBe('https://app.example.com')
    expect(normalizeOrigin('  http://localhost:3000 ')).toBe('http://localhost:3000')
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com')
    expect(normalizeOrigin('http://[::1]:8080')).toBe('http://[::1]:8080')
    expect(normalizeOrigin('https://*.Example.com')).toBe('https://*.example.com')
    expect(normalizeOrigin('https://*.example.com:8443')).toBe('https://*.example.com:8443')
    expect(normalizeOrigin('https://exämple.com')).toBe('https://xn--exmple-cua.com')
  })

  it('refuse ce qui n\'est pas une origine', () => {
    for (const input of [
      '', 'example.com', 'ftp://example.com', 'https://', 'https://example.com/path', 'https://example.com?x=1',
      'https://example.com#x', 'https://user:pass@example.com', 'https://*.com', 'https://*.*.example.com',
      'https://a.*.example.com', 'https://*.192.168.0.1', 'https://*', 'javascript:alert(1)', 'null',
      `https://${'a'.repeat(190)}.com`,
    ]) {
      expect(normalizeOrigin(input), input).toBeNull()
    }
  })

  it('reconnaît les jokers de sous-domaine', () => {
    expect(isWildcardOrigin('https://*.example.com')).toBe(true)
    expect(isWildcardOrigin('https://example.com')).toBe(false)
  })

  it('compare l\'origine d\'une requête : exacte ou joker (même schéma et port, jamais le domaine nu)', () => {
    const allowed = ['https://www.example.com', 'http://localhost:3000', 'https://*.preview.example.com', 'https://*.dev.test:8443']
    expect(isOriginAllowed('https://www.example.com', allowed)).toBe(true)
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true)
    expect(isOriginAllowed('https://pr-12.preview.example.com', allowed)).toBe(true)
    expect(isOriginAllowed('https://a.b.preview.example.com', allowed)).toBe(true)
    expect(isOriginAllowed('https://app.dev.test:8443', allowed)).toBe(true)

    expect(isOriginAllowed('http://www.example.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://example.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://preview.example.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://evil-preview.example.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://preview.example.com.evil.net', allowed)).toBe(false)
    expect(isOriginAllowed('http://pr-12.preview.example.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://app.dev.test', allowed)).toBe(false)
    expect(isOriginAllowed('http://localhost:3001', allowed)).toBe(false)
    expect(isOriginAllowed('null', allowed)).toBe(false)
    expect(isOriginAllowed('', allowed)).toBe(false)
  })

  it('le schéma d\'ajout normalise ou refuse', () => {
    expect(addOriginSchema.parse({ origin: 'HTTPS://Site.example.com/' }).origin).toBe('https://site.example.com')
    expect(addOriginSchema.safeParse({ origin: 'https://site.example.com/admin' }).success).toBe(false)
  })
})

describe('confirmation du mot de passe', () => {
  it('reste valable pendant la fenêtre, puis expire', () => {
    const now = Date.parse('2026-09-29T12:00:00Z')
    expect(isRecentlyVerified(new Date(now - 1000), now)).toBe(true)
    expect(isRecentlyVerified(new Date(now - (REAUTH_WINDOW_SECONDS * 1000 - 1)), now)).toBe(true)
    expect(isRecentlyVerified(new Date(now - REAUTH_WINDOW_SECONDS * 1000), now)).toBe(false)
    expect(isRecentlyVerified('2026-09-29T11:00:00Z', now)).toBe(false)
  })
})

describe('appareils de confiance', () => {
  it('lit la durée configurée : jours entiers, 0 = option désactivée, plafonnée', () => {
    expect(TRUSTED_DEVICE_DEFAULT_DAYS).toBe(15)
    expect(trustedDeviceDays(15)).toBe(15)
    expect(trustedDeviceDays('30')).toBe(30)
    expect(trustedDeviceDays(7.9)).toBe(7)
    expect(trustedDeviceDays(0)).toBe(0)
    expect(trustedDeviceDays(-3)).toBe(0)
    expect(trustedDeviceDays('abc')).toBe(0)
    expect(trustedDeviceDays(undefined)).toBe(0)
    expect(trustedDeviceDays(10_000)).toBe(TRUSTED_DEVICE_MAX_DAYS)
  })

  it('confirmation : la case est facultative et booléenne', () => {
    expect(confirmPasswordSchema.parse({ password: 'x' })).toEqual({ password: 'x' })
    expect(confirmPasswordSchema.parse({ password: 'x', trustDevice: true }).trustDevice).toBe(true)
    expect(confirmPasswordSchema.safeParse({ password: 'x', trustDevice: 'yes' }).success).toBe(false)
  })

  it('retrait : cet appareil ou tous', () => {
    expect(forgetTrustedDevicesSchema.parse({ scope: 'current' }).scope).toBe('current')
    expect(forgetTrustedDevicesSchema.parse({ scope: 'all' }).scope).toBe('all')
    expect(forgetTrustedDevicesSchema.safeParse({}).success).toBe(false)
    expect(forgetTrustedDevicesSchema.safeParse({ scope: 'others' }).success).toBe(false)
  })
})
