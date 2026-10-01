import { hasPermission, hasScope, spaceScopes } from '#shared/utils/permissions'
import type { User } from '../../generated/prisma/client'

/**
 * Données réelles de la documentation interactive (/admin/api) : projets actifs de l'utilisateur
 * (exemples de `projectId`, variables d'environnement) et, pour ceux dont il gère les identifiants
 * (`project:credentials`, comme GET /api/admin/projects/:id/keys), leurs clés valables — valeur
 * complète d'une clé publique seulement (les secrets ne sont jamais relisibles : préfixe seul).
 */

/** Projets proposés (par nom) : au-delà, l'identifiant se saisit à la main dans la documentation. */
export const DOCS_PROJECTS_MAX = 100

export async function docsProjects(user: User) {
  const now = new Date()
  const prisma = await usePrisma()
  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      ...(hasPermission(user.role, 'projects:all') ? {} : { members: { some: { userId: user.id } } }),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      members: { where: { userId: user.id }, select: { role: true } },
      // Clés valables, hors anciennes clés en recouvrement après une rotation.
      accessTokens: {
        where: {
          type: { in: ['PUBLISHABLE', 'SECRET'] },
          revokedAt: null,
          replacedById: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true, type: true, name: true, environment: true, prefix: true, publicValue: true },
        orderBy: [{ environment: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: DOCS_PROJECTS_MAX,
  })

  return projects.map((project) => {
    const scopes = spaceScopes(user.role, { type: 'project', memberRole: project.members[0]?.role, archived: false })
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      /** null : l'utilisateur ne gère pas les identifiants de ce projet. */
      keys: hasScope(scopes, 'project:credentials')
        ? project.accessTokens.map(key => ({
            id: key.id,
            type: key.type as 'PUBLISHABLE' | 'SECRET',
            name: key.name,
            environment: key.environment ?? '',
            prefix: key.prefix,
            publicValue: key.type === 'PUBLISHABLE' ? key.publicValue : null,
          }))
        : null,
    }
  })
}
