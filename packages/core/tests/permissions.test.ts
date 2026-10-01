import { describe, expect, it } from 'vitest'
import {
  assignableProjectRoles,
  effectiveProjectRole,
  hasPermission,
  hasScope,
  MEDIA_SCOPES,
  PERMISSIONS,
  PROJECT_ROLES,
  ROLES,
  spaceScopes,
  type ProjectRole,
  type Role,
  type Scope,
} from '../shared/utils/permissions'

/**
 * Matrice de référence écrite à la main (indépendante de l'implémentation) : portées attendues
 * pour chaque rôle de plateforme × rôle de membre dans un projet actif. Toute évolution des
 * règles doit passer par cette table.
 */
const ALL_PROJECT: Scope[] = ['project:read', 'project:credentials', 'project:members', 'project:settings', ...MEDIA_SCOPES]
const DEVELOPER_PROJECT: Scope[] = ['project:read', 'project:credentials', ...MEDIA_SCOPES]
const EDITOR_PROJECT: Scope[] = ['project:read', ...MEDIA_SCOPES]

const EXPECTED_PROJECT_SCOPES: Record<Role, Record<ProjectRole | 'none', Scope[]>> = {
  // L'ADMIN est propriétaire de tous les projets, membre ou non.
  ADMIN: { none: ALL_PROJECT, OWNER: ALL_PROJECT, DEVELOPER: ALL_PROJECT, EDITOR: ALL_PROJECT },
  DEVELOPER: { none: [], OWNER: ALL_PROJECT, DEVELOPER: DEVELOPER_PROJECT, EDITOR: EDITOR_PROJECT },
  // Plafond : un EDITOR de plateforme n'exerce jamais plus que le rôle EDITOR d'un projet.
  EDITOR: { none: [], OWNER: EDITOR_PROJECT, DEVELOPER: EDITOR_PROJECT, EDITOR: EDITOR_PROJECT },
}

const ARCHIVED_ALLOWED: Scope[] = ['project:read', 'project:settings', 'media:read']

function sorted(scopes: readonly Scope[]): Scope[] {
  return [...scopes].sort()
}

describe('permissions de plateforme', () => {
  it('donne toutes les permissions à l\'ADMIN', () => {
    for (const permission of PERMISSIONS) expect(hasPermission('ADMIN', permission)).toBe(true)
  })

  it('limite l\'EDITOR à la bibliothèque', () => {
    expect(PERMISSIONS.filter(permission => hasPermission('EDITOR', permission))).toEqual(['library:manage'])
  })

  it('permet au DEVELOPER de créer des projets et des jetons personnels, et de tester l\'API, sans accès global', () => {
    expect(PERMISSIONS.filter(permission => hasPermission('DEVELOPER', permission)))
      .toEqual(['library:manage', 'projects:create', 'tokens:personal', 'api:docs'])
  })

  it('refuse tout sans rôle', () => {
    expect(hasPermission(null, 'library:manage')).toBe(false)
    expect(hasPermission(undefined, 'users:manage')).toBe(false)
  })
})

describe('rôles de projet', () => {
  it('plafonne les rôles attribuables selon le rôle de plateforme', () => {
    expect(assignableProjectRoles('ADMIN')).toEqual(['OWNER', 'DEVELOPER', 'EDITOR'])
    expect(assignableProjectRoles('DEVELOPER')).toEqual(['OWNER', 'DEVELOPER', 'EDITOR'])
    expect(assignableProjectRoles('EDITOR')).toEqual(['EDITOR'])
  })

  it('calcule le rôle exercé', () => {
    expect(effectiveProjectRole('ADMIN', null)).toBe('OWNER')
    expect(effectiveProjectRole('ADMIN', 'EDITOR')).toBe('OWNER')
    expect(effectiveProjectRole('DEVELOPER', null)).toBeNull()
    expect(effectiveProjectRole('DEVELOPER', 'DEVELOPER')).toBe('DEVELOPER')
    expect(effectiveProjectRole('EDITOR', undefined)).toBeNull()
    expect(effectiveProjectRole('EDITOR', 'OWNER')).toBe('EDITOR')
  })
})

describe('portées par espace', () => {
  it('donne toutes les portées médias de la bibliothèque à chaque rôle', () => {
    for (const role of ROLES) expect(sorted(spaceScopes(role, { type: 'library' }))).toEqual(sorted(MEDIA_SCOPES))
  })

  for (const role of ROLES) {
    for (const memberRole of [null, ...PROJECT_ROLES]) {
      const expected = EXPECTED_PROJECT_SCOPES[role][memberRole ?? 'none']

      it(`${role} / membre ${memberRole ?? 'aucun'} : projet actif`, () => {
        expect(sorted(spaceScopes(role, { type: 'project', memberRole, archived: false }))).toEqual(sorted(expected))
      })

      it(`${role} / membre ${memberRole ?? 'aucun'} : projet archivé (lecture seule)`, () => {
        const archived = spaceScopes(role, { type: 'project', memberRole, archived: true })
        expect(sorted(archived)).toEqual(sorted(expected.filter(scope => ARCHIVED_ALLOWED.includes(scope))))
        for (const scope of ['media:upload', 'media:write', 'media:delete', 'project:members', 'project:credentials'] as const) {
          expect(hasScope(archived, scope)).toBe(false)
        }
      })
    }
  }

  it('rend un projet invisible (aucune portée) à un non-membre qui n\'est pas ADMIN', () => {
    expect(spaceScopes('DEVELOPER', { type: 'project', memberRole: null, archived: false })).toEqual([])
    expect(spaceScopes('EDITOR', { type: 'project', memberRole: null, archived: true })).toEqual([])
  })
})
