import type { CreateTagInput, UpdateTagInput } from '#shared/schemas/tags'
import {
  carriedTagIds,
  MEDIA_TAG_LIMIT,
  mergeTagIds,
  TAG_DEFAULT_COLOR,
  TAG_LIMIT,
  type TagColor,
  type TagLevel,
  tagLevel,
  type TagMatch,
  tagNameKey,
  tagUsableIn,
  type TagViewer,
  visibleTags,
} from '#shared/utils/tags'
import type { Media, Prisma, Tag } from '../../generated/prisma/client'
import type { Space } from '../../utils/access'
import { tagError } from '../../utils/tags'
import { bumpGlobalTagsRevision, bumpRevision } from '../cache/revisions'
import { mediaChanged } from '../media/cache'

/**
 * Étiquettes des médias (architecture : .claude/architecture-tags.md, TG1 à TG15).
 *
 * Deux niveaux : globales (`projectId` null, bibliothèque et tous les projets) et propres à un projet.
 * Un nom (sans casse ni accents, `nameKey`) et un slug n'existent qu'une fois parmi les étiquettes
 * qu'un même média peut porter : une étiquette de projet est comparée aux globales et à son projet,
 * une globale à toutes. Unicité vérifiée ici, dans une transaction, par des requêtes indexées.
 *
 * Confidentialité : toute sortie passe par `visibleTags` (ou un `where` équivalent), toute entrée
 * par `resolveTags` avec le même lecteur ; un lecteur qui ne voit pas les confidentielles ne les
 * retire jamais d'un média (`mergeTagIds`). Les contrôles d'accès sont faits par les routes.
 */

type Transaction = Prisma.TransactionClient

/** Étiquettes d'un média telles que lues avec lui (`TAG_LINK_INCLUDE`). */
export interface MediaTagLink { tag: Tag }

/** Inclusion Prisma des étiquettes d'un média (sérialisées par `mediaTagViews`). */
export const TAG_LINK_INCLUDE = { tags: { select: { tag: true } } } as const

function projectIdOf(space: Space): string | null {
  return space.type === 'project' ? space.id : null
}

function spaceOfProjectId(projectId: string | null): Space {
  return projectId ? { type: 'project', id: projectId } : { type: 'library' }
}

/** Ordre d'affichage : globales d'abord, puis par nom (sans casse ni accents). */
function compareTags(a: Pick<Tag, 'projectId' | 'nameKey'>, b: Pick<Tag, 'projectId' | 'nameKey'>): number {
  const level = Number(a.projectId !== null) - Number(b.projectId !== null)
  return level || a.nameKey.localeCompare(b.nameKey)
}

// ─── Représentation ──────────────────────────────────────────────────────────

/** Étiquette telle que l'administration la montre (`confidential` seulement pour qui la voit). */
export function toTagView(tag: Tag) {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    color: tag.color as TagColor,
    level: tagLevel(tag) as TagLevel,
    confidential: tag.confidential,
  }
}
export type TagView = ReturnType<typeof toTagView>

/** Étiquette d'une page de gestion : vue + dates, nombre de médias actifs (null s'il n'est pas calculé). */
export function toTagSummary(tag: Tag, mediaCount: number | null) {
  return { ...toTagView(tag), projectId: tag.projectId, mediaCount, createdAt: tag.createdAt, updatedAt: tag.updatedAt }
}

/** Étiquettes d'un média pour un lecteur : confidentielles retirées s'il ne les voit pas, triées. */
export function mediaTagViews(links: readonly MediaTagLink[] | undefined, viewer: TagViewer): TagView[] {
  const tags = visibleTags((links ?? []).map(link => link.tag), viewer)
  return tags.sort(compareTags).map(toTagView)
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

export async function findTag(id: string): Promise<Tag | null> {
  const prisma = await usePrisma()
  return prisma.tag.findUnique({ where: { id } })
}

/** Filtre Prisma des étiquettes visibles d'un lecteur. */
function visibleWhere(viewer: TagViewer): Prisma.TagWhereInput {
  return viewer.confidential ? {} : { confidential: false }
}

export interface ListTagsOptions {
  /** Projet : ses étiquettes en plus des globales ; null = globales seulement. */
  projectId: string | null
  viewer: TagViewer
  /**
   * Nombre de médias actifs par étiquette : dans le projet (`project`), dans toute l'installation
   * (`all`, réservé à l'ADMIN), ou rien (`none`).
   */
  counts: 'project' | 'all' | 'none'
}

/** Étiquettes utilisables dans un espace (globales + projet), visibles par le lecteur, triées. */
export async function listTags(options: ListTagsOptions) {
  const prisma = await usePrisma()
  const tags = await prisma.tag.findMany({
    where: {
      OR: options.projectId ? [{ projectId: null }, { projectId: options.projectId }] : [{ projectId: null }],
      ...visibleWhere(options.viewer),
    },
  })
  tags.sort(compareTags)
  if (options.counts === 'none' || tags.length === 0) return tags.map(tag => toTagSummary(tag, null))

  const media: Prisma.MediaWhereInput = { deletedAt: null, ...(options.counts === 'project' ? { projectId: options.projectId } : {}) }
  const rows = await prisma.mediaTag.groupBy({
    by: ['tagId'],
    where: { tagId: { in: tags.map(tag => tag.id) }, media },
    _count: { _all: true },
  })
  const counts = new Map(rows.map(row => [row.tagId, row._count._all]))
  return tags.map(tag => toTagSummary(tag, counts.get(tag.id) ?? 0))
}

// ─── Gestion des listes ──────────────────────────────────────────────────────

/** Conflit de nom ou de slug (TG7), ou null. `projects` : projets en conflit pour une globale. */
async function findConflict(tx: Transaction, projectId: string | null, nameKey: string | undefined, slug: string | undefined, exceptId?: string) {
  const fields: Prisma.TagWhereInput[] = []
  if (nameKey !== undefined) fields.push({ nameKey })
  if (slug !== undefined) fields.push({ slug })
  if (fields.length === 0) return null
  const level: Prisma.TagWhereInput = projectId ? { OR: [{ projectId: null }, { projectId }] } : {}
  const clashes = await tx.tag.findMany({
    where: { AND: [level, { OR: fields }], ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { nameKey: true, slug: true, projectId: true, project: { select: { id: true, name: true } } },
    take: 50,
  })
  if (clashes.length === 0) return null
  const code = nameKey !== undefined && clashes.some(tag => tag.nameKey === nameKey) ? 'TAG_NAME_TAKEN' as const : 'TAG_SLUG_TAKEN' as const
  const projects = projectId
    ? []
    : [...new Map(clashes.filter(tag => tag.project).map(tag => [tag.project!.id, tag.project!])).values()]
  return { code, projects }
}

async function assertNoConflict(tx: Transaction, projectId: string | null, nameKey: string | undefined, slug: string | undefined, exceptId?: string) {
  const conflict = await findConflict(tx, projectId, nameKey, slug, exceptId)
  // Une globale en conflit avec des projets les cite (l'ADMIN les voit tous) ; sinon aucun détail.
  if (conflict) throw tagError(409, conflict.code, conflict.projects.length ? { projects: conflict.projects } : {})
}

async function tagsChanged(projectId: string | null): Promise<void> {
  if (projectId) await bumpRevision(spaceOfProjectId(projectId))
  else await bumpGlobalTagsRevision()
}

/** Nouvelle étiquette du niveau (`projectId` null = globale) : limite, unicité. */
export async function createTag(projectId: string | null, input: CreateTagInput): Promise<Tag> {
  const prisma = await usePrisma()
  const nameKey = tagNameKey(input.name)
  const tag = await prisma.$transaction(async (tx) => {
    if (await tx.tag.count({ where: { projectId } }) >= TAG_LIMIT) throw tagError(409, 'TAG_LIMIT_REACHED')
    await assertNoConflict(tx, projectId, nameKey, input.slug)
    return tx.tag.create({
      data: {
        projectId,
        name: input.name,
        nameKey,
        slug: input.slug,
        color: input.color ?? TAG_DEFAULT_COLOR,
        confidential: input.confidential ?? false,
      },
    })
  })
  await tagsChanged(projectId)
  return tag
}

/** Modification (nom, slug, couleur, confidentialité) ; le slug ne suit pas le nom (TG7). */
export async function updateTag(tag: Tag, input: UpdateTagInput): Promise<Tag> {
  const prisma = await usePrisma()
  const nameKey = input.name === undefined ? undefined : tagNameKey(input.name)
  const updated = await prisma.$transaction(async (tx) => {
    await assertNoConflict(
      tx,
      tag.projectId,
      nameKey !== undefined && nameKey !== tag.nameKey ? nameKey : undefined,
      input.slug !== undefined && input.slug !== tag.slug ? input.slug : undefined,
      tag.id,
    )
    return tx.tag.update({
      where: { id: tag.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name, nameKey }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.confidential === undefined ? {} : { confidential: input.confidential }),
      },
    })
  })
  await tagsChanged(tag.projectId)
  return updated
}

/** Suppression : l'étiquette quitte tous ses médias (cascade). → nombre de médias actifs qui la portaient. */
export async function deleteTag(tag: Tag): Promise<{ mediaCount: number }> {
  const prisma = await usePrisma()
  const mediaCount = await prisma.$transaction(async (tx) => {
    const count = await tx.mediaTag.count({ where: { tagId: tag.id, media: { deletedAt: null } } })
    await tx.tag.delete({ where: { id: tag.id } })
    return count
  })
  await tagsChanged(tag.projectId)
  return { mediaCount }
}

// ─── Affectation ─────────────────────────────────────────────────────────────

/**
 * Étiquettes demandées pour des médias d'un espace (`projectId` null = bibliothèque) : chacune doit
 * exister, être utilisable dans l'espace et visible par le lecteur ; sinon 404 TAG_NOT_FOUND avec
 * `tags` = identifiants refusés (une confidentielle cachée est refusée comme une inconnue).
 */
export async function resolveTags(projectId: string | null, ids: readonly string[], viewer: TagViewer): Promise<Tag[]> {
  if (ids.length === 0) return []
  const prisma = await usePrisma()
  const found = await prisma.tag.findMany({ where: { id: { in: [...ids] } } })
  const usable = new Map(found
    .filter(tag => tagUsableIn(tag, projectId) && (viewer.confidential || !tag.confidential))
    .map(tag => [tag.id, tag]))
  const missing = ids.filter(id => !usable.has(id))
  if (missing.length) throw tagError(404, 'TAG_NOT_FOUND', { tags: missing })
  return ids.map(id => usable.get(id)!)
}

/** Remplacement préparé des étiquettes d'un média (vérifié, rien d'écrit) : appliqué par `applyMediaTags`. */
export interface MediaTagsPlan {
  mediaId: string
  space: Space
  tagIds: string[]
  changed: boolean
}

/**
 * Prépare le remplacement des étiquettes d'un média par `ids` (TG2, TG4) : les confidentielles
 * déjà posées que le lecteur ne voit pas restent ; 422 TOO_MANY_TAGS au-delà de la limite.
 */
export async function planMediaTags(media: Pick<Media, 'id' | 'projectId'>, ids: readonly string[], viewer: TagViewer): Promise<MediaTagsPlan> {
  await resolveTags(media.projectId, ids, viewer)
  const prisma = await usePrisma()
  const current = await prisma.mediaTag.findMany({ where: { mediaId: media.id }, select: { tag: { select: { id: true, confidential: true } } } })
  const tagIds = mergeTagIds(current.map(link => link.tag), ids, viewer)
  if (tagIds.length > MEDIA_TAG_LIMIT) throw tagError(422, 'TOO_MANY_TAGS', { max: MEDIA_TAG_LIMIT })
  const before = new Set(current.map(link => link.tag.id))
  const changed = tagIds.length !== before.size || tagIds.some(id => !before.has(id))
  return { mediaId: media.id, space: spaceOfProjectId(media.projectId), tagIds, changed }
}

/** Écrit un remplacement préparé (rien si l'ensemble ne change pas). */
export async function applyMediaTags(plan: MediaTagsPlan): Promise<void> {
  if (!plan.changed) return
  const prisma = await usePrisma()
  await prisma.$transaction(async (tx) => {
    await tx.mediaTag.deleteMany({ where: { mediaId: plan.mediaId, tagId: { notIn: plan.tagIds } } })
    const existing = await tx.mediaTag.findMany({ where: { mediaId: plan.mediaId }, select: { tagId: true } })
    const present = new Set(existing.map(link => link.tagId))
    const missing = plan.tagIds.filter(id => !present.has(id))
    if (missing.length) await tx.mediaTag.createMany({ data: missing.map(tagId => ({ mediaId: plan.mediaId, tagId })) })
    await tx.media.update({ where: { id: plan.mediaId }, data: { updatedAt: new Date() } })
  })
  await mediaChanged([plan.mediaId], plan.space)
}

/**
 * Affectation en lot (TG8) : ajoute `add` et retire `remove` aux médias actifs de l'espace parmi
 * `ids` (ceux d'un autre espace ou de la corbeille sont ignorés). Un média qui dépasserait la
 * limite est laissé tel quel et compté dans `skipped`. Les étiquettes doivent être visibles par le
 * lecteur : une confidentielle qu'il ne voit pas n'est jamais ajoutée ni retirée.
 */
export async function bulkTagMedia(space: Space, ids: readonly string[], add: readonly string[], remove: readonly string[], viewer: TagViewer) {
  const projectId = projectIdOf(space)
  await resolveTags(projectId, [...add, ...remove], viewer)
  const prisma = await usePrisma()
  const result = await prisma.$transaction(async (tx) => {
    const media = await tx.media.findMany({ where: { id: { in: [...ids] }, projectId, deletedAt: null }, select: { id: true } })
    const mediaIds = media.map(item => item.id)
    const links = await tx.mediaTag.findMany({ where: { mediaId: { in: mediaIds } }, select: { mediaId: true, tagId: true } })
    const byMedia = new Map(mediaIds.map(id => [id, new Set<string>()]))
    for (const link of links) byMedia.get(link.mediaId)!.add(link.tagId)

    const created: { mediaId: string, tagId: string }[] = []
    const removedFrom: string[] = []
    const updated: string[] = []
    let skipped = 0
    for (const [mediaId, current] of byMedia) {
      const toAdd = add.filter(id => !current.has(id))
      const toRemove = remove.filter(id => current.has(id))
      if (toAdd.length === 0 && toRemove.length === 0) continue
      if (current.size + toAdd.length - toRemove.length > MEDIA_TAG_LIMIT) {
        skipped++
        continue
      }
      created.push(...toAdd.map(tagId => ({ mediaId, tagId })))
      if (toRemove.length) removedFrom.push(mediaId)
      updated.push(mediaId)
    }
    if (removedFrom.length && remove.length) await tx.mediaTag.deleteMany({ where: { mediaId: { in: removedFrom }, tagId: { in: [...remove] } } })
    if (created.length) await tx.mediaTag.createMany({ data: created })
    if (updated.length) await tx.media.updateMany({ where: { id: { in: updated } }, data: { updatedAt: new Date() } })
    return { updated, skipped }
  })
  if (result.updated.length) await mediaChanged(result.updated, space)
  return { updated: result.updated.length, skipped: result.skipped }
}

// ─── Filtre des listes ───────────────────────────────────────────────────────

export interface TagFilter {
  /** Slugs demandés (vides : aucun filtre, TG3). */
  slugs?: readonly string[]
  match: TagMatch
  /** Médias sans étiquette (visible) ; ignoré si des étiquettes sont demandées. */
  untagged?: boolean
}

/**
 * Identifiants des étiquettes demandées par slug dans un espace, visibles par le lecteur. `strict` :
 * un slug inconnu → 404 TAG_NOT_FOUND (`tags` = slugs inconnus, API v1) ; sinon ignoré (administration).
 */
export async function resolveTagSlugs(projectId: string | null, slugs: readonly string[], viewer: TagViewer, strict: boolean): Promise<string[]> {
  if (slugs.length === 0) return []
  const prisma = await usePrisma()
  const tags = await prisma.tag.findMany({
    where: {
      slug: { in: [...slugs] },
      OR: projectId ? [{ projectId: null }, { projectId }] : [{ projectId: null }],
      ...visibleWhere(viewer),
    },
    select: { id: true, slug: true },
  })
  if (strict) {
    const known = new Set(tags.map(tag => tag.slug))
    const missing = slugs.filter(slug => !known.has(slug))
    if (missing.length) throw tagError(404, 'TAG_NOT_FOUND', { tags: missing })
  }
  return tags.map(tag => tag.id)
}

/**
 * Médias étiquetés lus d'avance au plus : en deçà, le filtre devient `id IN (…)` (servi par la clé
 * primaire) ; au-delà, une condition sur la relation (EXISTS corrélé), efficace quand les médias
 * étiquetés sont nombreux (la page se remplit vite). Mesure (architecture-tags.md § 5.1) : sous SQLite,
 * 100 000 médias, une étiquette de 10 médias passait de 170 ms à quelques ms.
 */
const TAG_PREFETCH_LIMIT = 1000

/**
 * Condition Prisma d'un filtre d'étiquettes (TG3) : rien sans étiquette demandée ; `any` = au moins
 * une ; `all` = toutes. Prisma traduit une condition sur la relation en `EXISTS` corrélé, que SQLite
 * évalue média par média : pour une étiquette rare dans un grand espace, on lit d'abord ses médias
 * (index `(tagId, mediaId)`). `untagged` : aucune étiquette visible par le lecteur. `tagIds` vide alors
 * que des slugs étaient demandés (tous inconnus, mode non strict) : aucun filtre.
 */
export async function tagFilterWhere(tagIds: readonly string[], filter: TagFilter, viewer: TagViewer): Promise<Prisma.MediaWhereInput | null> {
  if (tagIds.length > 0) {
    const prisma = await usePrisma()
    const counts = await prisma.mediaTag.groupBy({ by: ['tagId'], where: { tagId: { in: [...tagIds] } }, _count: { _all: true } })
    const countOf = new Map(counts.map(row => [row.tagId, row._count._all]))
    if (filter.match === 'all') {
      const rarest = [...tagIds].sort((a, b) => (countOf.get(a) ?? 0) - (countOf.get(b) ?? 0))[0]!
      const others = tagIds.filter(id => id !== rarest).map(tagId => ({ tags: { some: { tagId } } }))
      if ((countOf.get(rarest) ?? 0) <= TAG_PREFETCH_LIMIT) {
        const links = await prisma.mediaTag.findMany({ where: { tagId: rarest }, select: { mediaId: true } })
        return { id: { in: links.map(link => link.mediaId) }, ...(others.length ? { AND: others } : {}) }
      }
      return { AND: [{ tags: { some: { tagId: rarest } } }, ...others] }
    }
    const total = tagIds.reduce((sum, id) => sum + (countOf.get(id) ?? 0), 0)
    if (total <= TAG_PREFETCH_LIMIT) {
      const links = await prisma.mediaTag.findMany({ where: { tagId: { in: [...tagIds] } }, select: { mediaId: true } })
      return { id: { in: [...new Set(links.map(link => link.mediaId))] } }
    }
    return { tags: { some: { tagId: { in: [...tagIds] } } } }
  }
  if (filter.untagged && !filter.slugs?.length) {
    return viewer.confidential ? { tags: { none: {} } } : { tags: { none: { tag: { confidential: false } } } }
  }
  return null
}

// ─── Changement d'espace (TG9) ───────────────────────────────────────────────

/**
 * Étiquettes qu'un média garde (déplacement) ou que sa copie reçoit (duplication) dans l'espace cible :
 * globales gardées, étiquettes de projet rapprochées par nom dans le projet cible, aucune créée.
 */
export async function carriedTags(tx: Transaction, sourceMediaId: string, targetProjectId: string | null): Promise<string[]> {
  const links = await tx.mediaTag.findMany({ where: { mediaId: sourceMediaId }, select: { tag: { select: { id: true, projectId: true, nameKey: true } } } })
  if (links.length === 0) return []
  const source = links.map(link => link.tag)
  const needsMatch = source.some(tag => tag.projectId !== null && tag.projectId !== targetProjectId)
  const target = needsMatch && targetProjectId
    ? await tx.tag.findMany({
        where: { projectId: targetProjectId, nameKey: { in: source.map(tag => tag.nameKey) } },
        select: { id: true, projectId: true, nameKey: true },
      })
    : []
  return carriedTagIds(source, targetProjectId, target)
}

/** Remplace les liaisons d'un média par `tagIds` (dans une transaction déjà ouverte). */
export async function replaceMediaTagLinks(tx: Transaction, mediaId: string, tagIds: readonly string[]): Promise<void> {
  await tx.mediaTag.deleteMany({ where: { mediaId, tagId: { notIn: [...tagIds] } } })
  const existing = await tx.mediaTag.findMany({ where: { mediaId }, select: { tagId: true } })
  const present = new Set(existing.map(link => link.tagId))
  const missing = tagIds.filter(id => !present.has(id))
  if (missing.length) await tx.mediaTag.createMany({ data: missing.map(tagId => ({ mediaId, tagId })) })
}
