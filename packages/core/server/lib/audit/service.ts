import { AUDIT_PAGE_SIZE, type AuditQuery } from '#shared/schemas/credentials'
import type { Prisma } from '../../generated/prisma/client'

/**
 * Lecture du journal d'audit (permission audit:read). Les entrées n'ont pas de clés étrangères :
 * auteurs, identifiants d'API (actions faites par l'API v1) et projets sont résolus ici, et restent
 * affichés (« supprimé ») après leur disparition.
 */
export async function listAuditEvents(query: AuditQuery) {
  const where: Prisma.AuditEventWhereInput = {}
  if (query.category) where.action = { startsWith: `${query.category}.` }
  if (query.project) where.projectId = query.project

  const prisma = await usePrisma()
  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
  ])

  const userIds = [...new Set(events.map(event => event.actorUserId).filter((id): id is string => Boolean(id)))]
  const projectIds = [...new Set([query.project, ...events.map(event => event.projectId)].filter((id): id is string => Boolean(id)))]
  const tokenIds = [...new Set(events.map(event => event.tokenId).filter((id): id is string => Boolean(id)))]
  const [users, projects, tokens] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
    prisma.accessToken.findMany({ where: { id: { in: tokenIds } }, select: { id: true, name: true, type: true, prefix: true } }),
  ])
  const usersById = new Map(users.map(user => [user.id, user]))
  const tokensById = new Map(tokens.map(token => [token.id, token]))
  const projectsById = new Map(projects.map(project => [project.id, project]))

  const items = events.map((event) => {
    const data = (event.data ?? {}) as Record<string, unknown>
    return {
      id: event.id,
      at: event.at,
      action: event.action,
      /** Auteur : compte existant, compte supprimé (`deleted`), ou aucun (système). */
      actor: event.actorUserId ? (usersById.get(event.actorUserId) ?? { id: event.actorUserId, deleted: true as const }) : null,
      project: event.projectId ? (projectsById.get(event.projectId) ?? { id: event.projectId, deleted: true as const }) : null,
      /** Identifiant d'API à l'origine de l'action (émetteur pour un jeton délégué), ou null (interface). */
      token: event.tokenId ? (tokensById.get(event.tokenId) ?? { id: event.tokenId, deleted: true as const }) : null,
      targetType: event.targetType,
      targetId: event.targetId,
      label: typeof data.label === 'string' ? data.label : null,
      data,
      ipAddress: event.ipAddress,
    }
  })

  const filterProject = query.project ? (projectsById.get(query.project) ?? { id: query.project, deleted: true as const }) : null
  return { items, total, page: query.page, pageSize: AUDIT_PAGE_SIZE, filterProject }
}
