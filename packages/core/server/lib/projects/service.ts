import type { CreateProjectInput, ProjectListQuery, UpdateProjectInput } from '#shared/schemas/projects'
import { PROJECTS_PAGE_SIZE } from '#shared/schemas/projects'
import type { ProjectMediaOnDelete } from '#shared/utils/projects'
import { slugify } from '#shared/utils/projects'
import type { Prisma, Project, User } from '../../generated/prisma/client'
import type { SpaceAccess } from '../../utils/access'
import { deleteStoredFiles } from '../media/service'

/**
 * Projets : création, réglages, archivage, suppression et membres. Les contrôles d'accès
 * (portées) sont faits par les routes via server/utils/access.ts ; ce module applique les
 * règles métier (identifiant unique, dernier propriétaire, plafond des rôles…).
 */

type ProjectWithCounts = Project & {
  members: { role: ProjectRole }[]
  _count: { media: number, members: number }
}

/** Représentation d'un projet pour l'administration, du point de vue de `user`. */
export function toProjectSummary(project: ProjectWithCounts, user: User) {
  const memberRole = project.members[0]?.role ?? null
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    /** Rôle exercé (plafonné ; OWNER pour un ADMIN) et rôle de membre enregistré. */
    role: effectiveProjectRole(user.role, memberRole),
    memberRole,
    mediaCount: project._count.media,
    memberCount: project._count.members,
  }
}

function summaryInclude(user: User) {
  return {
    members: { where: { userId: user.id }, select: { role: true } },
    _count: { select: { media: { where: { deletedAt: null } }, members: true } },
  } satisfies Prisma.ProjectInclude
}

/** Projets visibles : tous pour un ADMIN, sinon ceux dont l'utilisateur est membre. */
export async function listProjects(user: User, query: ProjectListQuery) {
  const where: Prisma.ProjectWhereInput = {
    archivedAt: query.status === 'archived' ? { not: null } : null,
  }
  if (!hasPermission(user.role, 'projects:all')) where.members = { some: { userId: user.id } }
  if (query.q) where.OR = textSearch(['name', 'slug', 'description'], query.q)

  const prisma = await usePrisma()
  const [total, items] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      include: summaryInclude(user),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * PROJECTS_PAGE_SIZE,
      take: PROJECTS_PAGE_SIZE,
    }),
  ])
  return { items: items.map(project => toProjectSummary(project, user)), total, page: query.page, pageSize: PROJECTS_PAGE_SIZE }
}

export async function getProjectSummary(access: SpaceAccess) {
  const prisma = await usePrisma()
  const project = await prisma.project.findUniqueOrThrow({ where: { id: access.project!.id }, include: summaryInclude(access.user) })
  const trashCount = await prisma.media.count({ where: { projectId: project.id, deletedAt: { not: null } } })
  return { project: toProjectSummary(project, access.user), trashCount, scopes: access.scopes }
}

/**
 * Nouveau projet ; son créateur en devient propriétaire. Sans identifiant fourni, il est déduit
 * du nom et suffixé (-2, -3…) en cas de doublon ; un identifiant fourni déjà pris → 409 SLUG_TAKEN.
 */
export async function createProject(user: User, input: CreateProjectInput) {
  const prisma = await usePrisma()
  const base = input.slug ?? (slugify(input.name) || 'project')
  for (let attempt = 1; attempt <= 20; attempt++) {
    const slug = attempt === 1 ? base : `${base.slice(0, 55)}-${attempt}`
    try {
      const project = await prisma.project.create({
        data: {
          name: input.name,
          slug,
          description: input.description ?? null,
          createdById: user.id,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
        include: summaryInclude(user),
      })
      return toProjectSummary(project, user)
    }
    catch (error) {
      if (!isUniqueViolation(error)) throw error
      if (input.slug) throw projectError(409, 'SLUG_TAKEN')
    }
  }
  throw projectError(409, 'SLUG_TAKEN')
}

/** Réglages et archivage (archived: true → lecture seule ; false → réactivation). */
export async function updateProject(access: SpaceAccess, input: UpdateProjectInput) {
  const { archived, ...fields } = input
  const data: Prisma.ProjectUpdateInput = { ...fields }
  if (archived !== undefined) data.archivedAt = archived ? (access.project!.archivedAt ?? new Date()) : null

  const prisma = await usePrisma()
  try {
    await prisma.project.update({ where: { id: access.project!.id }, data })
  }
  catch (error) {
    if (isUniqueViolation(error)) throw projectError(409, 'SLUG_TAKEN')
    throw error
  }
}

/**
 * Suppression d'un projet archivé. Ses médias rejoignent la bibliothèque (URL conservées) ou sont
 * supprimés définitivement (enregistrements d'abord, fichiers ensuite en tâche de fond). Membres,
 * clés, origines et dossiers disparaissent avec le projet.
 */
export async function deleteProject(access: SpaceAccess, mediaOnDelete: ProjectMediaOnDelete): Promise<{ media: number }> {
  const project = access.project!
  if (!project.archivedAt) throw projectError(409, 'PROJECT_NOT_ARCHIVED')

  const prisma = await usePrisma()
  const media = await prisma.media.findMany({ where: { projectId: project.id }, select: { id: true, storageKey: true } })
  if (mediaOnDelete === 'library') {
    await prisma.$transaction([
      prisma.media.updateMany({ where: { projectId: project.id }, data: { projectId: null, folderId: null } }),
      prisma.project.delete({ where: { id: project.id } }),
    ])
  }
  else {
    await prisma.$transaction([
      prisma.media.deleteMany({ where: { projectId: project.id } }),
      prisma.project.delete({ where: { id: project.id } }),
    ])
    // Sans attendre : la réponse ne dépend pas du nombre de fichiers.
    void deleteStoredFiles(media)
  }
  return { media: media.length }
}

// ─── Membres ─────────────────────────────────────────────────────────────────

const MEMBER_USER = { select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true } } as const
type MemberWithUser = { role: ProjectRole, createdAt: Date, user: { id: string, name: string | null, email: string, role: Role, isActive: boolean, passwordHash: string | null } }

function toMemberSummary(member: MemberWithUser) {
  const { passwordHash, ...user } = member.user
  return {
    user: { ...user, status: userStatus({ isActive: user.isActive, hasPassword: passwordHash !== null }) },
    role: member.role,
    /** Rôle réellement exercé (plafonné par le rôle de plateforme ; OWNER pour un ADMIN). */
    effectiveRole: effectiveProjectRole(user.role, member.role),
    assignableRoles: assignableProjectRoles(user.role),
    createdAt: member.createdAt,
  }
}

export async function listMembers(projectId: string) {
  const prisma = await usePrisma()
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: MEMBER_USER },
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
  })
  return members.map(toMemberSummary)
}

/** Comptes actifs pouvant être ajoutés (non membres), avec les rôles qu'on peut leur attribuer. */
export async function listMemberCandidates(projectId: string, q?: string) {
  const where: Prisma.UserWhereInput = { isActive: true, projectMemberships: { none: { projectId } } }
  if (q) where.OR = textSearch(['email', 'name'], q)
  const prisma = await usePrisma()
  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ email: 'asc' }],
    take: 20,
  })
  return users.map(user => ({ ...user, assignableRoles: assignableProjectRoles(user.role) }))
}

function assertAssignable(user: { role: Role }, role: ProjectRole): void {
  if (!assignableProjectRoles(user.role).includes(role)) throw projectError(422, 'ROLE_NOT_ASSIGNABLE')
}

export async function addMember(projectId: string, userId: string, role: ProjectRole) {
  const prisma = await usePrisma()
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user?.isActive) throw projectError(404, 'USER_NOT_FOUND')
  assertAssignable(user, role)
  try {
    const member = await prisma.projectMember.create({ data: { projectId, userId, role }, include: { user: MEMBER_USER } })
    return toMemberSummary(member)
  }
  catch (error) {
    if (isUniqueViolation(error)) throw projectError(409, 'ALREADY_MEMBER')
    throw error
  }
}

async function findMemberOr404(projectId: string, userId: string) {
  const prisma = await usePrisma()
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    include: { user: MEMBER_USER },
  })
  if (!member) throw createError({ statusCode: 404, statusMessage: 'Member not found' })
  return member
}

/** Un projet garde toujours au moins un propriétaire enregistré (409 LAST_OWNER). */
async function assertNotLastOwner(projectId: string, member: { role: ProjectRole }): Promise<void> {
  if (member.role !== 'OWNER') return
  const prisma = await usePrisma()
  const owners = await prisma.projectMember.count({ where: { projectId, role: 'OWNER' } })
  if (owners <= 1) throw projectError(409, 'LAST_OWNER')
}

/** Nouveau rôle d'un membre ; renvoie aussi le rôle précédent (journal d'audit). */
export async function updateMemberRole(projectId: string, userId: string, role: ProjectRole) {
  const member = await findMemberOr404(projectId, userId)
  assertAssignable(member.user, role)
  if (role !== 'OWNER') await assertNotLastOwner(projectId, member)
  const prisma = await usePrisma()
  const updated = await prisma.projectMember.update({
    where: { projectId_userId: { projectId, userId } },
    data: { role },
    include: { user: MEMBER_USER },
  })
  return { member: toMemberSummary(updated), previousRole: member.role }
}

/** Retire un membre ; renvoie le membre retiré (journal d'audit). */
export async function removeMember(projectId: string, userId: string) {
  const member = await findMemberOr404(projectId, userId)
  await assertNotLastOwner(projectId, member)
  const prisma = await usePrisma()
  await prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId } } })
  return toMemberSummary(member)
}

// ─── Espaces ─────────────────────────────────────────────────────────────────

/**
 * Espaces où l'utilisateur dispose d'une portée (ex. `media:upload` pour choisir la cible d'une
 * duplication) : la bibliothèque, puis les projets actifs par ordre alphabétique.
 */
export async function listSpaces(user: User, scope: Scope) {
  const spaces: ({ type: 'library' } | { type: 'project', id: string, name: string })[] = []
  if (hasScope(spaceScopes(user.role, { type: 'library' }), scope)) spaces.push({ type: 'library' })

  const prisma = await usePrisma()
  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      ...(hasPermission(user.role, 'projects:all') ? {} : { members: { some: { userId: user.id } } }),
    },
    select: { id: true, name: true, members: { where: { userId: user.id }, select: { role: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
  for (const project of projects) {
    const scopes = spaceScopes(user.role, { type: 'project', memberRole: project.members[0]?.role, archived: false })
    if (hasScope(scopes, scope)) spaces.push({ type: 'project', id: project.id, name: project.name })
  }
  return spaces
}
