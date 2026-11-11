import { afterEach, describe, expect, it, vi } from 'vitest'
import { mediaSpacesWhere, readableSpaces, SPACE_IDS_MAX, tagSpacesWhere, toSpaceSummaries } from '../server/lib/media/spaces'
import { resolveTagSlugGroups, TAG_PREFETCH_LIMIT, tagFilterWhere, tagGroupsFilterWhere } from '../server/lib/tags/service'
import { mediaListQuerySchema } from '../shared/schemas/media'
import { tagsQuerySchema } from '../shared/schemas/tags'

/** Page « Médias » : espaces réunis et étiquettes sur plusieurs espaces (architecture-media-view.md). */

const VIEWER = { confidential: false }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('médias de plusieurs espaces (mediaSpacesWhere)', () => {
  const member = (ids: string[]) => ({ member: 'u1', includeArchived: false, ids })

  it('liste d\'identifiants : bibliothèque et projets, une seule condition sans OR', () => {
    expect(mediaSpacesWhere(true, member(['p1', 'p2']))).toEqual({ OR: [{ projectId: null }, { projectId: { in: ['p1', 'p2'] } }] })
    expect(mediaSpacesWhere(true, member([]))).toEqual({ projectId: null })
    expect(mediaSpacesWhere(false, member(['p1']))).toEqual({ projectId: { in: ['p1'] } })
  })

  it('aucun espace lisible : null', () => {
    expect(mediaSpacesWhere(false, member([]))).toBeNull()
  })

  it('tous les projets : sans exclusion (tableau de bord) ou sauf les archivés (MV3), par identifiants', () => {
    expect(mediaSpacesWhere(true, { all: true, excludedIds: [] })).toEqual({})
    expect(mediaSpacesWhere(false, { all: true, excludedIds: [] })).toEqual({ projectId: { not: null } })
    expect(mediaSpacesWhere(true, { all: true, excludedIds: ['old'] })).toEqual({ OR: [{ projectId: null }, { projectId: { notIn: ['old'] } }] })
    expect(mediaSpacesWhere(false, { all: true, excludedIds: ['old'] })).toEqual({ projectId: { notIn: ['old'] } })
  })

  it('au-delà de SPACE_IDS_MAX identifiants : condition sur la relation (limite de paramètres de SQLite)', () => {
    const many = Array.from({ length: SPACE_IDS_MAX + 1 }, (_, i) => `p${i}`)
    expect(mediaSpacesWhere(true, { all: true, excludedIds: many })).toEqual({ OR: [{ projectId: null }, { project: { archivedAt: null } }] })
    expect(mediaSpacesWhere(true, { member: 'u1', includeArchived: false, ids: many }))
      .toEqual({ OR: [{ projectId: null }, { project: { members: { some: { userId: 'u1' } }, archivedAt: null } }] })
    expect(mediaSpacesWhere(false, { member: 'u1', includeArchived: true, ids: many })).toEqual({ project: { members: { some: { userId: 'u1' } } } })
    expect(mediaSpacesWhere(false, { member: 'u1', includeArchived: true, ids: many.slice(0, SPACE_IDS_MAX) })).toEqual({ projectId: { in: many.slice(0, SPACE_IDS_MAX) } })
  })
})

describe('étiquettes de plusieurs espaces (tagSpacesWhere)', () => {
  it('toujours les globales, plus celles des projets lisibles', () => {
    expect(tagSpacesWhere({ member: 'u1', includeArchived: false, ids: [] })).toEqual({ projectId: null })
    expect(tagSpacesWhere({ member: 'u1', includeArchived: false, ids: ['p1'] })).toEqual({ OR: [{ projectId: null }, { projectId: { in: ['p1'] } }] })
    expect(tagSpacesWhere({ all: true, excludedIds: ['old'] })).toEqual({ OR: [{ projectId: null }, { projectId: { notIn: ['old'] } }] })
    expect(tagSpacesWhere({ all: true, excludedIds: [] })).toEqual({})
  })
})

describe('lecture d\'avance des médias étiquetés', () => {
  it('reste sous la limite de 999 paramètres de SQLite, avec de la marge pour les autres filtres', () => {
    expect(TAG_PREFETCH_LIMIT + SPACE_IDS_MAX).toBeLessThan(999 - 50)
  })
})

describe('espaces lisibles (readableSpaces)', () => {
  function stubProjects(rows: { id: string, name: string, archivedAt?: Date | null, members: { role: string }[] }[]) {
    const findMany = vi.fn(async () => rows.map(row => ({ archivedAt: null, ...row })))
    vi.stubGlobal('usePrisma', async () => ({ project: { findMany } }))
    return findMany
  }

  it('ADMIN : bibliothèque gérée, tous les projets sauf les archivés (exclus par identifiant)', async () => {
    const findMany = stubProjects([{ id: 'p1', name: 'Alpha', members: [] }, { id: 'p9', name: 'Ancien', archivedAt: new Date(), members: [] }])
    const spaces = await readableSpaces({ id: 'admin', role: 'ADMIN' })
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: {} })
    expect(spaces.library).toContain('media:upload')
    expect(spaces.projects).toEqual([expect.objectContaining({ id: 'p1', name: 'Alpha', scopes: expect.arrayContaining(['media:read', 'tags:manage']) })])
    expect(spaces.selection).toEqual({ all: true, excludedIds: ['p9'] })
  })

  it('EDITOR : bibliothèque en lecture, projets actifs dont il est membre seulement', async () => {
    const findMany = stubProjects([{ id: 'p2', name: 'Beta', members: [{ role: 'EDITOR' }] }, { id: 'p3', name: 'Gamma', archivedAt: new Date(), members: [{ role: 'EDITOR' }] }])
    const spaces = await readableSpaces({ id: 'editor', role: 'EDITOR' })
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { members: { some: { userId: 'editor' } } } })
    expect(spaces.library).toEqual(['media:read'])
    expect(spaces.projects[0]!.scopes).toContain('media:upload')
    expect(spaces.projects[0]!.scopes).not.toContain('tags:manage')
    expect(spaces.selection).toEqual({ member: 'editor', includeArchived: false, ids: ['p2'] })
  })

  it('résumés : bibliothèque d\'abord, nombre de médias actifs par espace (0 par défaut)', async () => {
    stubProjects([{ id: 'p1', name: 'Alpha', members: [{ role: 'OWNER' }] }, { id: 'p2', name: 'Beta', members: [{ role: 'EDITOR' }] }])
    const spaces = await readableSpaces({ id: 'manager', role: 'MANAGER' })
    const summaries = toSpaceSummaries(spaces, new Map([[null, 3], ['p2', 5]]))
    expect(summaries.map(space => [space.type, space.id, space.mediaCount])).toEqual([['library', null, 3], ['project', 'p1', 0], ['project', 'p2', 5]])
    // Un MANAGER membre est toujours propriétaire (plancher) : il gère les étiquettes du projet.
    expect(summaries[2]!.scopes).toContain('tags:manage')
  })
})

describe('étiquettes groupées par slug (MV10)', () => {
  /** Base factice : liaisons média ↔ étiquette. */
  function stubLinks(links: [mediaId: string, tagId: string][], tags: { id: string, slug: string }[] = []) {
    const tagFindMany = vi.fn(async () => tags)
    const groupBy = vi.fn(async ({ where }: { where: { tagId: { in: string[] } } }) => {
      const ids = where.tagId.in
      return ids.map(tagId => ({ tagId, _count: { _all: links.filter(link => link[1] === tagId).length } }))
    })
    const findMany = vi.fn(async ({ where }: { where: { tagId: string | { in: string[] } } }) => {
      const ids = typeof where.tagId === 'string' ? [where.tagId] : where.tagId.in
      return links.filter(link => ids.includes(link[1])).map(link => ({ mediaId: link[0] }))
    })
    vi.stubGlobal('usePrisma', async () => ({ tag: { findMany: tagFindMany }, mediaTag: { groupBy, findMany } }))
    return { tagFindMany, findMany }
  }

  it('un slug présent dans deux projets donne un groupe de deux étiquettes, slugs inconnus ignorés', async () => {
    const { tagFindMany } = stubLinks([], [{ id: 'ete-b', slug: 'ete' }, { id: 'hero', slug: 'hero' }, { id: 'ete-a', slug: 'ete' }])
    const scope = { OR: [{ projectId: null }, { projectId: { in: ['a', 'b'] } }] }
    expect(await resolveTagSlugGroups(scope, ['ete', 'inconnu', 'hero'], VIEWER)).toEqual([['ete-a', 'ete-b'], ['hero']])
    expect(tagFindMany.mock.calls[0]![0]).toEqual({
      where: { AND: [scope, { slug: { in: ['ete', 'inconnu', 'hero'] } }, { confidential: false }] },
      select: { id: true, slug: true },
    })
  })

  it('« toutes » : pour chaque slug, l\'une de ses étiquettes (pas toutes les étiquettes du slug)', async () => {
    // m1 (projet A) : Été + Hero ; m2 (projet B) : Été seulement ; m3 (projet B) : Été + Hero.
    stubLinks([['m1', 'ete-a'], ['m1', 'hero'], ['m2', 'ete-b'], ['m3', 'ete-b'], ['m3', 'hero']])
    const where = await tagGroupsFilterWhere([['ete-a', 'ete-b'], ['hero']], { slugs: ['ete', 'hero'], match: 'all' }, VIEWER)
    // Le groupe le moins fourni (Hero, 2 médias) est lu d'avance ; l'autre devient une condition « l'une de ».
    expect(where).toEqual({ id: { in: ['m1', 'm3'] }, AND: [{ tags: { some: { tagId: { in: ['ete-a', 'ete-b'] } } } }] })
  })

  it('« au moins une » : union de toutes les étiquettes des groupes', async () => {
    stubLinks([['m1', 'ete-a'], ['m2', 'ete-b'], ['m2', 'hero']])
    const where = await tagGroupsFilterWhere([['ete-a', 'ete-b'], ['hero']], { slugs: ['ete', 'hero'], match: 'any' }, VIEWER)
    expect(where).toEqual({ id: { in: ['m1', 'm2'] } })
  })

  it('groupes d\'une étiquette : exactement la condition de tagFilterWhere (un seul espace, API v1)', async () => {
    stubLinks([['m1', 't1'], ['m1', 't2'], ['m2', 't2']])
    const grouped = await tagGroupsFilterWhere([['t1'], ['t2']], { slugs: ['a', 'b'], match: 'all' }, VIEWER)
    const single = await tagFilterWhere(['t1', 't2'], { slugs: ['a', 'b'], match: 'all' }, VIEWER)
    expect(grouped).toEqual(single)
    expect(single).toEqual({ id: { in: ['m1'] }, AND: [{ tags: { some: { tagId: 't2' } } }] })
  })

  it('aucun groupe : « sans étiquette » ou aucun filtre', async () => {
    stubLinks([])
    expect(await tagGroupsFilterWhere([], { match: 'any', untagged: true }, VIEWER)).toEqual({ tags: { none: { tag: { confidential: false } } } })
    expect(await tagGroupsFilterWhere([], { slugs: ['inconnu'], match: 'any', untagged: true }, VIEWER)).toBeNull()
  })
})

describe('paramètres de la page « Médias »', () => {
  it('scope=all reconnu, toute autre valeur ignorée', () => {
    expect(mediaListQuerySchema.parse({ scope: 'all' }).scope).toBe('all')
    expect(mediaListQuerySchema.parse({ scope: 'tout' }).scope).toBeUndefined()
    expect(tagsQuerySchema.parse({ scope: 'all', project: 'p1' })).toEqual({ scope: 'all', project: 'p1' })
    expect(tagsQuerySchema.parse({ scope: 'x' }).scope).toBeUndefined()
  })
})
