import { describe, expect, it } from 'vitest'
import {
  assignableProjectRoles,
  clampProjectRole,
  effectiveProjectRole,
  hasPermission,
  invitableRoles,
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
const ALL_PROJECT: Scope[] = ['project:read', 'project:credentials', 'project:members', 'project:settings', ...MEDIA_SCOPES, 'tags:manage']
const DEVELOPER_PROJECT: Scope[] = ['project:read', 'project:credentials', ...MEDIA_SCOPES]
const EDITOR_PROJECT: Scope[] = ['project:read', ...MEDIA_SCOPES]

const EXPECTED_PROJECT_SCOPES: Record<Role, Record<ProjectRole | 'none', Scope[]>> = {
  // L'ADMIN est propriétaire de tous les projets, membre ou non.
  ADMIN: { none: ALL_PROJECT, OWNER: ALL_PROJECT, DEVELOPER: ALL_PROJECT, EDITOR: ALL_PROJECT },
  // Plancher : un MANAGER administre tout projet dont il est membre, et seulement ceux-là.
  MANAGER: { none: [], OWNER: ALL_PROJECT, DEVELOPER: ALL_PROJECT, EDITOR: ALL_PROJECT },
  // Plafond : un DEVELOPER de plateforme n'administre aucun projet (ni réglages ni membres).
  DEVELOPER: { none: [], OWNER: DEVELOPER_PROJECT, DEVELOPER: DEVELOPER_PROJECT, EDITOR: EDITOR_PROJECT },
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

  it('limite l\'EDITOR à la consultation de la bibliothèque', () => {
    expect(PERMISSIONS.filter(permission => hasPermission('EDITOR', permission))).toEqual(['library:read'])
  })

  it('permet au DEVELOPER les jetons personnels et la documentation de l\'API, sans créer de projet', () => {
    expect(PERMISSIONS.filter(permission => hasPermission('DEVELOPER', permission)))
      .toEqual(['library:read', 'tokens:personal', 'api:docs'])
  })

  it('permet au MANAGER de créer des projets et d\'inviter, sans gestion globale', () => {
    expect(PERMISSIONS.filter(permission => hasPermission('MANAGER', permission)))
      .toEqual(['library:read', 'projects:create', 'tokens:personal', 'api:docs', 'users:invite', 'tags:confidential'])
  })

  it('réserve la gestion de la bibliothèque, des comptes, de l\'audit, des réglages et des étiquettes globales à l\'ADMIN', () => {
    for (const permission of ['library:manage', 'projects:all', 'users:manage', 'audit:read', 'settings:manage', 'tags:global'] as const) {
      expect(ROLES.filter(role => hasPermission(role, permission))).toEqual(['ADMIN'])
    }
  })

  it('réserve les étiquettes confidentielles à l\'ADMIN et au MANAGER', () => {
    expect(ROLES.filter(role => hasPermission(role, 'tags:confidential'))).toEqual(['ADMIN', 'MANAGER'])
  })

  it('limite les rôles qu\'on peut inviter', () => {
    expect(invitableRoles('ADMIN')).toEqual(['ADMIN', 'MANAGER', 'DEVELOPER', 'EDITOR'])
    expect(invitableRoles('MANAGER')).toEqual(['DEVELOPER', 'EDITOR'])
    expect(invitableRoles('DEVELOPER')).toEqual([])
    expect(invitableRoles('EDITOR')).toEqual([])
    expect(invitableRoles(null)).toEqual([])
  })

  it('refuse tout sans rôle', () => {
    expect(hasPermission(null, 'library:manage')).toBe(false)
    expect(hasPermission(undefined, 'users:manage')).toBe(false)
  })
})

describe('rôles de projet', () => {
  it('encadre les rôles attribuables selon le rôle de plateforme', () => {
    expect(assignableProjectRoles('ADMIN')).toEqual(['OWNER', 'DEVELOPER', 'EDITOR'])
    expect(assignableProjectRoles('MANAGER')).toEqual(['OWNER'])
    expect(assignableProjectRoles('DEVELOPER')).toEqual(['DEVELOPER', 'EDITOR'])
    expect(assignableProjectRoles('EDITOR')).toEqual(['EDITOR'])
  })

  it('ramène un rôle de membre entre plancher et plafond (normalisation des adhésions)', () => {
    expect(clampProjectRole('MANAGER', 'EDITOR')).toBe('OWNER')
    expect(clampProjectRole('DEVELOPER', 'OWNER')).toBe('DEVELOPER')
    expect(clampProjectRole('DEVELOPER', 'EDITOR')).toBe('EDITOR')
    expect(clampProjectRole('EDITOR', 'DEVELOPER')).toBe('EDITOR')
    expect(clampProjectRole('ADMIN', 'EDITOR')).toBe('EDITOR')
  })

  it('calcule le rôle exercé', () => {
    expect(effectiveProjectRole('ADMIN', null)).toBe('OWNER')
    expect(effectiveProjectRole('ADMIN', 'EDITOR')).toBe('OWNER')
    expect(effectiveProjectRole('DEVELOPER', null)).toBeNull()
    expect(effectiveProjectRole('DEVELOPER', 'DEVELOPER')).toBe('DEVELOPER')
    expect(effectiveProjectRole('DEVELOPER', 'OWNER')).toBe('DEVELOPER')
    expect(effectiveProjectRole('MANAGER', null)).toBeNull()
    expect(effectiveProjectRole('MANAGER', 'EDITOR')).toBe('OWNER')
    expect(effectiveProjectRole('EDITOR', undefined)).toBeNull()
    expect(effectiveProjectRole('EDITOR', 'OWNER')).toBe('EDITOR')
  })
})

describe('portées par espace', () => {
  it('donne la gestion de la bibliothèque à l\'ADMIN et sa seule lecture aux autres rôles', () => {
    expect(sorted(spaceScopes('ADMIN', { type: 'library' }))).toEqual(sorted(MEDIA_SCOPES))
    for (const role of ['MANAGER', 'DEVELOPER', 'EDITOR'] as const) expect(spaceScopes(role, { type: 'library' })).toEqual(['media:read'])
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
        for (const scope of ['media:upload', 'media:write', 'media:delete', 'project:members', 'project:credentials', 'tags:manage'] as const) {
          expect(hasScope(archived, scope)).toBe(false)
        }
      })
    }
  }

  it('ne donne aucune gestion d\'étiquettes dans la bibliothèque (la liste globale relève de tags:global)', () => {
    for (const role of ROLES) expect(hasScope(spaceScopes(role, { type: 'library' }), 'tags:manage')).toBe(false)
  })

  it('rend un projet invisible (aucune portée) à un non-membre qui n\'est pas ADMIN', () => {
    expect(spaceScopes('DEVELOPER', { type: 'project', memberRole: null, archived: false })).toEqual([])
    expect(spaceScopes('MANAGER', { type: 'project', memberRole: null, archived: false })).toEqual([])
    expect(spaceScopes('EDITOR', { type: 'project', memberRole: null, archived: true })).toEqual([])
  })
})
