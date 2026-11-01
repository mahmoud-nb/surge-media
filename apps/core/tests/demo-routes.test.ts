import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bodyIds, DEMO_ALLOWED_WRITES, DEMO_GUARDED_ROUTES, matchDemoRoute } from '../server/lib/demo/guarded-routes'
import { createDemoUploadQuota } from '../server/lib/demo/quota'

const API_DIR = fileURLToPath(new URL('../server/api', import.meta.url))

/** Routes d'écriture de server/api, sous la forme « MÉTHODE /api/chemin/:param ». */
function writeRoutes(): string[] {
  const routes: string[] = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      const found = /^(.*)\.(post|put|patch|delete)\.ts$/.exec(relative(API_DIR, path).split(sep).join('/'))
      if (!found) continue
      const route = `/api/${found[1]}`.replace(/\[([a-z]+)\]/gi, ':$1').replace(/\/index$/, '')
      routes.push(`${found[2]!.toUpperCase()} ${route}`)
    }
  }
  walk(API_DIR)
  return routes.sort()
}

describe('mode démo : classement des routes d\'écriture', () => {
  it('chaque route d\'écriture est gardée ou explicitement permise, sans entrée périmée', () => {
    const guarded = DEMO_GUARDED_ROUTES.map(route => `${route.method} ${route.path}`)
    const classified = [...guarded, ...DEMO_ALLOWED_WRITES].sort()
    expect(new Set(classified).size).toBe(classified.length)
    expect(classified).toEqual(writeRoutes())
  })

  it('les réglages globaux et les comptes de la démo sont gardés', () => {
    expect(matchDemoRoute('PUT', '/api/admin/security')?.route.target).toEqual({ kind: 'setting' })
    expect(matchDemoRoute('PATCH', '/api/admin/transforms')?.route.target).toEqual({ kind: 'project-query' })
    expect(matchDemoRoute('delete', '/api/admin/license')?.route.target).toEqual({ kind: 'setting' })
    expect(matchDemoRoute('POST', '/api/auth/mfa/setup')?.route.target).toEqual({ kind: 'session' })
    expect(matchDemoRoute('POST', '/api/admin/users/u1/password-link/email')).toEqual({
      route: expect.objectContaining({ target: { kind: 'param', resource: 'user', param: 'id' } }),
      params: { id: 'u1' },
    })
  })

  it('paramètres décodés ; médias et pistes suivent le média ; adhésions par projet et compte', () => {
    expect(matchDemoRoute('PUT', '/api/admin/media/m%2D1/tracks/t1/file')).toEqual({
      route: expect.objectContaining({ target: { kind: 'param', resource: 'media', param: 'id' } }),
      params: { id: 'm-1', trackId: 't1' },
    })
    expect(matchDemoRoute('DELETE', '/api/v1/projects/p1/media/m1')?.params).toEqual({ projectId: 'p1', mediaId: 'm1' })
    expect(matchDemoRoute('PATCH', '/api/admin/projects/p1/members/u1')).toEqual({
      route: expect.objectContaining({ target: { kind: 'member' } }),
      params: { id: 'p1', userId: 'u1' },
    })
    expect(matchDemoRoute('POST', '/api/admin/projects/p1/keys/k1/rotate')?.params).toEqual({ id: 'p1', keyId: 'k1' })
  })

  it('créations, lectures, liens et autres méthodes ne sont pas gardés', () => {
    expect(matchDemoRoute('POST', '/api/admin/media')).toBeNull()
    expect(matchDemoRoute('POST', '/api/admin/media/m1/duplicate')).toBeNull()
    expect(matchDemoRoute('POST', '/api/v1/projects/p1/media/m1/signed-url')).toBeNull()
    expect(matchDemoRoute('GET', '/api/admin/media/m1')).toBeNull()
    expect(matchDemoRoute('PATCH', '/api/admin/media/m1/extra')).toBeNull()
    // Encodage invalide : la route répond elle-même.
    expect(matchDemoRoute('DELETE', '/api/admin/media/%E0%A4%A')).toBeNull()
  })

  it('classement en lot : identifiants du corps', () => {
    expect(bodyIds({ ids: ['a', 'b', 3, '', null], folderId: null })).toEqual(['a', 'b'])
    expect(bodyIds({ ids: Array.from({ length: 150 }, (_, i) => `m${i}`) })).toHaveLength(100)
    for (const body of [null, undefined, 'texte', { ids: 'a' }, {}]) expect(bodyIds(body)).toEqual([])
  })
})

describe('mode démo : volume d\'envoi du cycle', () => {
  it('un quart par adresse, le total pour tous ; un envoi commencé avant la limite passe', () => {
    const quota = createDemoUploadQuota(100)
    expect(quota.allows('a')).toBe(true)
    quota.record('a', 24)
    expect(quota.allows('a')).toBe(true)
    quota.record('a', 30) // dépasse le quart (25) : le fichier est admis, le suivant non
    expect(quota.allows('a')).toBe(false)
    expect(quota.allows('b')).toBe(true)
    quota.record('b', 25)
    quota.record('c', 25)
    expect(quota.allows('d')).toBe(false) // total atteint (104)
  })

  it('tailles nulles ou invalides ignorées', () => {
    const quota = createDemoUploadQuota(8)
    quota.record('a', 0)
    quota.record('a', Number.NaN)
    quota.record('a', -5)
    expect(quota.allows('a')).toBe(true)
  })
})
