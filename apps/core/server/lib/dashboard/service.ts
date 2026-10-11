import type { H3Event } from 'h3'
import { DASHBOARD_ACTIVITY, DASHBOARD_PROJECTS, EXPIRING_SOON_DAYS, hourlyCounts, startOfUtcHour, UPLOAD_WINDOW_HOURS, type DashboardAttention } from '#shared/utils/dashboard'
import type { MediaKind, Prisma, User } from '../../generated/prisma/client'
import { listAuditEvents } from '../audit/service'
import { readDatabasePressure } from '../database/pressure'
import { mailEnabled } from '../mail/transport'

/**
 * Données du tableau de bord, limitées à ce que l'utilisateur peut voir : ses espaces (bibliothèque
 * et projets visibles, selon spaceScopes), ses jetons, et selon ses permissions les comptes
 * (users:manage), ses invitations (users:invite), les clés des projets dont il gère les
 * identifiants (project:credentials) et le journal (audit:read). Une seule requête par widget,
 * agrégée en base (groupBy, count, aggregate) ; les envois récents sont comptés par heure UTC.
 */

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const MEDIA_KINDS: MediaKind[] = ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'OTHER']

/** Jeton ou clé encore valable (non révoqué, sans échéance ou échéance future). */
function activeToken(now: Date): Prisma.AccessTokenWhereInput {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
}

export async function dashboardData(event: H3Event, user: User) {
  const prisma = await usePrisma()
  const now = new Date()
  const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * DAY_MS)
  const seesAll = hasPermission(user.role, 'projects:all')

  // ─── Espaces visibles ────────────────────────────────────────────────────
  const rows = await prisma.project.findMany({
    where: seesAll ? {} : { members: { some: { userId: user.id } } },
    select: {
      id: true,
      name: true,
      slug: true,
      archivedAt: true,
      members: { where: { userId: user.id }, select: { role: true } },
      _count: { select: { media: { where: { deletedAt: null } } } },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  const projects = rows.map((row) => {
    const memberRole = row.members[0]?.role ?? null
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      archived: row.archivedAt !== null,
      role: effectiveProjectRole(user.role, memberRole),
      mediaCount: row._count.media,
      scopes: spaceScopes(user.role, { type: 'project', memberRole, archived: row.archivedAt !== null }),
    }
  })
  const projectNames = new Map(projects.map(project => [project.id, project.name]))
  const libraryReadable = hasScope(spaceScopes(user.role, { type: 'library' }), 'media:read')
  const readableIds = projects.filter(project => hasScope(project.scopes, 'media:read')).map(project => project.id)
  const spaces: Prisma.MediaWhereInput | null = seesAll
    ? {}
    : libraryReadable || readableIds.length
      ? { OR: [...(libraryReadable ? [{ projectId: null }] : []), ...(readableIds.length ? [{ projectId: { in: readableIds } }] : [])] }
      : null
  const credentialIds = projects.filter(project => hasScope(project.scopes, 'project:credentials')).map(project => project.id)

  // ─── Médias, dérivés, envois récents, corbeille ──────────────────────────
  const since = new Date(startOfUtcHour(now).getTime() - (UPLOAD_WINDOW_HOURS - 1) * HOUR_MS)
  const active = spaces ? { AND: [spaces, { deletedAt: null }] } : null
  const [byKind, byVisibility, variants, recent, trash] = active && spaces
    ? await Promise.all([
        prisma.media.groupBy({ by: ['kind'], where: active, _count: { _all: true }, _sum: { size: true } }),
        prisma.media.groupBy({ by: ['visibility'], where: active, _count: { _all: true } }),
        prisma.mediaVariant.aggregate({ where: { media: active }, _count: { _all: true }, _sum: { size: true } }),
        prisma.media.findMany({ where: { AND: [spaces, { createdAt: { gte: since } }] }, select: { createdAt: true } }),
        prisma.media.groupBy({ by: ['projectId'], where: { AND: [spaces, { deletedAt: { not: null } }] }, _count: { _all: true } }),
      ])
    : [[], [], null, [], []]

  const kinds = Object.fromEntries(MEDIA_KINDS.map((kind) => {
    const group = byKind.find(item => item.kind === kind)
    return [kind, { count: group?._count._all ?? 0, size: group?._sum.size ?? 0 }]
  })) as Record<MediaKind, { count: number, size: number }>
  const media = spaces
    ? {
        total: byKind.reduce((sum, item) => sum + item._count._all, 0),
        size: byKind.reduce((sum, item) => sum + (item._sum.size ?? 0), 0),
        kinds,
        public: byVisibility.find(item => item.visibility === 'PUBLIC')?._count._all ?? 0,
        private: byVisibility.find(item => item.visibility === 'PRIVATE')?._count._all ?? 0,
        trash: trash.reduce((sum, item) => sum + item._count._all, 0),
      }
    : null

  // ─── Comptes et invitations ──────────────────────────────────────────────
  const manageUsers = hasPermission(user.role, 'users:manage')
  const inviteUsers = hasPermission(user.role, 'users:invite')
  const userScope: Prisma.UserWhereInput = manageUsers ? {} : { invitedById: user.id }
  const [byRole, inactive, invited] = inviteUsers
    ? await Promise.all([
        prisma.user.groupBy({ by: ['role'], where: userScope, _count: { _all: true } }),
        prisma.user.count({ where: { ...userScope, isActive: false } }),
        prisma.user.findMany({
          where: { ...userScope, isActive: true, passwordHash: null },
          select: { id: true, passwordTokens: { where: { usedAt: null, expiresAt: { gt: now } }, select: { id: true }, take: 1 } },
        }),
      ])
    : [[], 0, []]
  const users = inviteUsers
    ? {
        scope: manageUsers ? 'all' as const : 'invited' as const,
        total: byRole.reduce((sum, item) => sum + item._count._all, 0),
        roles: Object.fromEntries(ROLES.map(role => [role, byRole.find(item => item.role === role)?._count._all ?? 0])) as Record<Role, number>,
        invited: invited.length,
        inactive,
      }
    : null
  const expiredInvitations = invited.filter(item => item.passwordTokens.length === 0).length

  // ─── Identifiants d'API ──────────────────────────────────────────────────
  const personal = hasPermission(user.role, 'tokens:personal')
  const [personalCount, expiringTokens, keyCount, expiringKeys] = await Promise.all([
    personal ? prisma.accessToken.count({ where: { type: 'PERSONAL', userId: user.id, ...activeToken(now) } }) : null,
    personal
      ? prisma.accessToken.findMany({
          where: { type: 'PERSONAL', userId: user.id, revokedAt: null, expiresAt: { gt: now, lte: soon } },
          select: { id: true, name: true, expiresAt: true },
          orderBy: { expiresAt: 'asc' },
        })
      : [],
    credentialIds.length ? prisma.accessToken.count({ where: { type: { in: ['SECRET', 'PUBLISHABLE'] }, projectId: { in: credentialIds }, ...activeToken(now) } }) : null,
    credentialIds.length
      ? prisma.accessToken.findMany({
          // Une clé remplacée (rotation) expire comme prévu : pas d'alerte.
          where: { type: 'SECRET', projectId: { in: credentialIds }, revokedAt: null, replacedById: null, expiresAt: { gt: now, lte: soon } },
          select: { id: true, name: true, type: true, environment: true, expiresAt: true, projectId: true },
          orderBy: { expiresAt: 'asc' },
        })
      : [],
  ])

  // ─── Points d'attention ──────────────────────────────────────────────────
  const attention: DashboardAttention[] = []
  if (hasPermission(user.role, 'settings:manage')) {
    // Base SQLite sous pression (constat des dernières 24 h, tous processus) : en tête, c'est le plus urgent.
    const pressure = await readDatabasePressure(prisma)
    if (pressure) attention.push({ kind: 'database', ...pressure })
    if (!useRuntimeConfig(event).siteUrl && !import.meta.dev) attention.push({ kind: 'siteUrl' })
  }
  if (expiringTokens.length) {
    attention.push({ kind: 'expiringTokens', items: expiringTokens.map(token => ({ id: token.id, name: token.name, expiresAt: token.expiresAt! })) })
  }
  if (expiringKeys.length) {
    attention.push({
      kind: 'expiringKeys',
      items: expiringKeys.map(key => ({
        id: key.id,
        name: key.name,
        type: key.type,
        environment: key.environment,
        project: { id: key.projectId!, name: projectNames.get(key.projectId!) ?? '' },
        expiresAt: key.expiresAt!,
      })),
    })
  }
  if (invited.length) attention.push({ kind: 'invitations', pending: invited.length, expired: expiredInvitations })
  if (media?.trash) {
    attention.push({
      kind: 'trash',
      total: media.trash,
      spaces: trash
        .map(item => item.projectId
          ? { type: 'project' as const, id: item.projectId, name: projectNames.get(item.projectId) ?? '', count: item._count._all }
          : { type: 'library' as const, count: item._count._all })
        .sort((a, b) => b.count - a.count),
    })
  }
  if (manageUsers && !mailEnabled(event)) attention.push({ kind: 'mail' })

  // ─── Journal ─────────────────────────────────────────────────────────────
  const activity = hasPermission(user.role, 'audit:read') ? (await listAuditEvents({ page: 1 }, DASHBOARD_ACTIVITY)).items : null

  const activeProjects = projects.filter(project => !project.archived)
  return {
    media,
    variants: variants ? { count: variants._count._all, size: variants._sum.size ?? 0 } : null,
    uploads: spaces ? { since, hours: hourlyCounts(recent.map(item => item.createdAt), since) } : null,
    projects: {
      active: activeProjects.length,
      archived: projects.length - activeProjects.length,
      items: activeProjects.slice(0, DASHBOARD_PROJECTS).map(({ scopes: _scopes, archived: _archived, ...project }) => project),
    },
    users,
    credentials: personalCount === null && keyCount === null ? null : { personalTokens: personalCount, projectKeys: keyCount },
    attention,
    activity,
  }
}
