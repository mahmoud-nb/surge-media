import { describe, expect, it } from 'vitest'
import type { Tag } from '../server/generated/prisma/client'
import { mediaEtag, toApiTags } from '../server/lib/api/serializers'
import { apiMediaListQuerySchema, apiMediaTagsBulkSchema, apiMediaUpdateSchema, apiMediaUploadFieldsSchema, apiTagCreateSchema, apiTagUpdateSchema, delegatedTokenClaimsSchema } from '../shared/schemas/api'
import { mediaListQuerySchema } from '../shared/schemas/media'
import { createProjectKeySchema, createPersonalTokenSchema } from '../shared/schemas/credentials'
import { createTagSchema, mediaTagIdsSchema, mediaTagsBulkSchema, tagNameSchema, tagSlugSchema, updateTagSchema } from '../shared/schemas/tags'
import {
  credentialScopes,
  DELEGATED_TOKEN_SCOPES,
  spaceScopes,
  TOKEN_OPTIONAL_SCOPES,
  TOKEN_SCOPES,
  unheldScopes,
} from '../shared/utils/permissions'
import {
  API_TAG_VIEWER,
  carriedTagIds,
  MEDIA_TAG_LIMIT,
  mergeTagIds,
  TAG_BULK_MAX,
  TAG_NAME_MAX_LENGTH,
  tagLevel,
  tagNameKey,
  tagSlug,
  tagUsableIn,
  visibleTags,
} from '../shared/utils/tags'

describe('étiquettes : noms et slugs', () => {
  it('clé de nom sans casse, sans accents, espaces réduits', () => {
    expect(tagNameKey('  Été   2026 ')).toBe('ete 2026')
    expect(tagNameKey('ÉTÉ 2026')).toBe(tagNameKey('ete 2026'))
    expect(tagNameKey('Héro')).toBe(tagNameKey('hero'))
    expect(tagNameKey('Hero')).not.toBe(tagNameKey('Heros'))
  })

  it('slug proposé d\'après le nom, vide sans caractère latin ni chiffre', () => {
    expect(tagSlug('Été 2026')).toBe('ete-2026')
    expect(tagSlug('  À retoucher !  ')).toBe('a-retoucher')
    expect(tagSlug('Œuvre & co')).toBe('uvre-co')
    expect(tagSlug('日本')).toBe('')
    expect(tagSlug('a'.repeat(63) + ' b')).toBe('a'.repeat(63))
  })

  it('schéma du nom : normalise, borne la longueur, refuse les caractères de contrôle', () => {
    expect(tagNameSchema.parse('  Été\t 2026 ')).toBe('Été 2026')
    expect(tagNameSchema.safeParse('').success).toBe(false)
    expect(tagNameSchema.safeParse('x'.repeat(TAG_NAME_MAX_LENGTH + 1)).success).toBe(false)
    expect(tagNameSchema.safeParse('a\u0007b').success).toBe(false)
  })

  it('schéma du slug : minuscules, chiffres et tirets simples', () => {
    expect(tagSlugSchema.parse(' Hero-2026 ')).toBe('hero-2026')
    for (const invalid of ['-hero', 'hero-', 'he--ro', 'héro', 'he ro', '']) expect(tagSlugSchema.safeParse(invalid).success, invalid).toBe(false)
  })

  it('création : slug proposé, couleur et confidentialité facultatives', () => {
    expect(createTagSchema.parse({ name: 'Été 2026' })).toEqual({ name: 'Été 2026', slug: 'ete-2026' })
    expect(createTagSchema.parse({ name: 'Hero', slug: 'une', color: 'blue', confidential: true }))
      .toEqual({ name: 'Hero', slug: 'une', color: 'blue', confidential: true })
    expect(createTagSchema.safeParse({ name: 'Hero', color: 'pink' }).success).toBe(false)
    const result = createTagSchema.safeParse({ name: '日本' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({ path: ['slug'], message: 'validation.tagSlugRequired' })
    expect(createTagSchema.safeParse({ name: '日本', slug: 'japon' }).success).toBe(true)
  })

  it('modification : au moins un champ', () => {
    expect(updateTagSchema.safeParse({}).success).toBe(false)
    expect(updateTagSchema.parse({ confidential: false })).toEqual({ confidential: false })
  })
})

describe('étiquettes : niveaux', () => {
  const global = { projectId: null }
  const own = { projectId: 'p1' }

  it('niveau et usage : une globale partout, une étiquette de projet dans son projet', () => {
    expect(tagLevel(global)).toBe('global')
    expect(tagLevel(own)).toBe('project')
    expect(tagUsableIn(global, null)).toBe(true)
    expect(tagUsableIn(global, 'p2')).toBe(true)
    expect(tagUsableIn(own, 'p1')).toBe(true)
    expect(tagUsableIn(own, 'p2')).toBe(false)
    expect(tagUsableIn(own, null)).toBe(false)
  })

  it('changement d\'espace : globales gardées, étiquettes de projet rapprochées par nom, aucune créée', () => {
    const source = [
      { id: 'g1', projectId: null, nameKey: 'hero' },
      { id: 'a1', projectId: 'pA', nameKey: 'ete 2026' },
      { id: 'a2', projectId: 'pA', nameKey: 'a retoucher' },
    ]
    const targetB = [
      { id: 'b1', projectId: 'pB', nameKey: 'ete 2026' },
      { id: 'b2', projectId: 'pB', nameKey: 'autre' },
    ]
    expect(carriedTagIds(source, 'pB', targetB)).toEqual(['g1', 'b1'])
    // Vers la bibliothèque : seules les globales.
    expect(carriedTagIds(source, null, [])).toEqual(['g1'])
    // Même projet (duplication) : tout est copié.
    expect(carriedTagIds(source, 'pA', [])).toEqual(['g1', 'a1', 'a2'])
    // Les étiquettes d'un autre projet que la cible ne servent jamais de correspondance.
    expect(carriedTagIds(source, 'pB', [{ id: 'c1', projectId: 'pC', nameKey: 'ete 2026' }])).toEqual(['g1'])
  })
})

describe('étiquettes confidentielles', () => {
  const tags = [
    { id: 't1', confidential: false },
    { id: 't2', confidential: true },
    { id: 't3', confidential: false },
  ]

  it('visibles seulement par qui peut les voir, jamais par l\'API', () => {
    expect(visibleTags(tags, { confidential: true }).map(tag => tag.id)).toEqual(['t1', 't2', 't3'])
    expect(visibleTags(tags, { confidential: false }).map(tag => tag.id)).toEqual(['t1', 't3'])
    expect(visibleTags(tags, API_TAG_VIEWER).map(tag => tag.id)).toEqual(['t1', 't3'])
  })

  it('un lecteur qui ne les voit pas ne les retire pas en remplaçant les étiquettes', () => {
    expect(mergeTagIds(tags, ['t3'], { confidential: false })).toEqual(['t3', 't2'])
    expect(mergeTagIds(tags, [], API_TAG_VIEWER)).toEqual(['t2'])
    expect(mergeTagIds(tags, ['t3'], { confidential: true })).toEqual(['t3'])
    expect(mergeTagIds(tags, ['t2', 't3'], { confidential: false })).toEqual(['t2', 't3'])
  })
})

describe('étiquettes : affectation', () => {
  it('ensemble d\'un média : doublons retirés, limite par média', () => {
    expect(mediaTagIdsSchema.parse(['a', 'b', 'a'])).toEqual(['a', 'b'])
    expect(mediaTagIdsSchema.safeParse(Array.from({ length: MEDIA_TAG_LIMIT + 1 }, (_, index) => `t${index}`)).success).toBe(false)
  })

  it('lot : médias bornés, au moins un changement, jamais ajouter et retirer la même étiquette', () => {
    expect(mediaTagsBulkSchema.parse({ ids: ['m1', 'm1'], add: ['t1'] })).toEqual({ ids: ['m1'], add: ['t1'], remove: [] })
    expect(mediaTagsBulkSchema.safeParse({ ids: ['m1'] }).success).toBe(false)
    expect(mediaTagsBulkSchema.safeParse({ ids: [], add: ['t1'] }).success).toBe(false)
    expect(mediaTagsBulkSchema.safeParse({ ids: Array.from({ length: TAG_BULK_MAX + 1 }, (_, index) => `m${index}`), add: ['t1'] }).success).toBe(false)
    expect(mediaTagsBulkSchema.safeParse({ ids: ['m1'], add: ['t1'], remove: ['t1'] }).success).toBe(false)
  })
})

describe('portée tags:manage des identifiants', () => {
  const owner = (role: 'ADMIN' | 'MANAGER' | 'DEVELOPER' | 'EDITOR', memberRole?: 'OWNER' | 'DEVELOPER' | 'EDITOR') =>
    spaceScopes(role, { type: 'project', memberRole, archived: false })

  it('optionnelle pour un jeton personnel ou une clé secrète, jamais pour un jeton délégué', () => {
    expect(TOKEN_SCOPES).toContain('tags:manage')
    expect(TOKEN_OPTIONAL_SCOPES).toContain('tags:manage')
    expect(DELEGATED_TOKEN_SCOPES).not.toContain('tags:manage')
    expect(createProjectKeySchema.parse({ type: 'SECRET', name: 'API', environment: 'production', scopes: ['tags:manage'] }).scopes).toEqual(['tags:manage'])
    expect(createPersonalTokenSchema.parse({ name: 'CLI', lifetime: '30', scopes: ['tags:manage'], allProjects: true }).scopes).toEqual(['tags:manage'])
  })

  it('jeton personnel : seulement si son propriétaire gère le projet aujourd\'hui', () => {
    const scopes = ['project:read', 'media:read', 'tags:manage']
    expect(credentialScopes({ type: 'PERSONAL', scopes, inSelection: true, ownerScopes: owner('ADMIN') })).toEqual(scopes)
    expect(credentialScopes({ type: 'PERSONAL', scopes, inSelection: true, ownerScopes: owner('MANAGER', 'OWNER') })).toEqual(scopes)
    expect(credentialScopes({ type: 'PERSONAL', scopes, inSelection: true, ownerScopes: owner('DEVELOPER', 'OWNER') })).toEqual(['project:read', 'media:read'])
    expect(credentialScopes({ type: 'PERSONAL', scopes, inSelection: true, ownerScopes: spaceScopes('ADMIN', { type: 'library' }) })).toEqual(['media:read'])
    // Projet archivé : plus de gestion des étiquettes.
    expect(credentialScopes({ type: 'PERSONAL', scopes, inSelection: true, ownerScopes: spaceScopes('ADMIN', { type: 'project', memberRole: null, archived: true }) }))
      .toEqual(['project:read', 'media:read'])
  })

  it('clé secrète : son créateur doit détenir la portée (TG6)', () => {
    expect(unheldScopes(['media:upload', 'tags:manage'], owner('MANAGER', 'OWNER'))).toEqual([])
    expect(unheldScopes(['media:upload', 'tags:manage'], owner('DEVELOPER', 'DEVELOPER'))).toEqual(['tags:manage'])
    expect(unheldScopes(['media:upload', 'media:write', 'media:delete'], owner('DEVELOPER', 'DEVELOPER'))).toEqual([])
    expect(unheldScopes([], owner('EDITOR', 'EDITOR'))).toEqual([])
  })

  it('clé publique et jeton délégué : jamais tags:manage', () => {
    expect(credentialScopes({ type: 'PUBLISHABLE', ownProject: true })).not.toContain('tags:manage')
    expect(credentialScopes({ type: 'DELEGATED', scopes: ['media:read', 'tags:manage'], ownProject: true, issuerScopes: [...TOKEN_SCOPES] }))
      .toEqual(['media:read'])
    const claims = { v: 1, jti: 'abcdefgh', iss: 'cm1issuer', project: 'cm1project', scopes: ['tags:manage'], iat: 1, exp: 2 }
    expect(delegatedTokenClaimsSchema.safeParse(claims).success).toBe(false)
  })
})

describe('étiquettes : API v1', () => {
  const tag = (overrides: Partial<Tag>): Tag => ({
    id: 't', projectId: null, name: 'Hero', nameKey: 'hero', slug: 'hero', color: 'blue', confidential: false,
    createdAt: new Date('2026-11-10T10:00:00Z'), updatedAt: new Date('2026-11-10T10:00:00Z'), ...overrides,
  })

  it('filtre de la liste : slugs dédoublonnés, au moins une par défaut, refus des formes invalides', () => {
    expect(apiMediaListQuerySchema.parse({ tags: 'hero, ete-2026,hero' })).toMatchObject({ tags: ['hero', 'ete-2026'], tagMatch: 'any' })
    expect(apiMediaListQuerySchema.parse({ tags: 'hero', tagMatch: 'all' }).tagMatch).toBe('all')
    expect(apiMediaListQuerySchema.parse({ untagged: 'true' }).untagged).toBe(true)
    for (const query of [{ tags: 'Héro' }, { tags: ',' }, { tags: 'hero', untagged: 'true' }, { tagMatch: 'some' }, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(',') }]) {
      expect(apiMediaListQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false)
    }
  })

  it('filtre de l\'administration : valeurs invalides ignorées, au moins une par défaut', () => {
    expect(mediaListQuerySchema.parse({ tags: 'Hero,ete-2026,mal formé', match: 'nimporte' })).toMatchObject({ tags: ['hero', 'ete-2026'], match: 'any' })
    expect(mediaListQuerySchema.parse({}).tags).toBeUndefined()
  })

  it('affectation : PATCH (tableau), envoi (liste à virgules), lot', () => {
    expect(apiMediaUpdateSchema.parse({ tags: ['hero', 'hero'] }).tags).toEqual(['hero'])
    expect(apiMediaUpdateSchema.parse({ tags: [] }).tags).toEqual([])
    expect(apiMediaUploadFieldsSchema.parse({ tags: 'hero,ete-2026' }).tags).toEqual(['hero', 'ete-2026'])
    expect(apiMediaTagsBulkSchema.parse({ ids: ['cm1media00', 'cm1media00'], add: ['hero'] })).toEqual({ ids: ['cm1media00'], add: ['hero'], remove: [] })
    expect(apiMediaTagsBulkSchema.safeParse({ ids: ['cm1media00'] }).success).toBe(false)
    expect(apiMediaTagsBulkSchema.safeParse({ ids: ['cm1media00'], add: ['hero'], remove: ['hero'] }).success).toBe(false)
  })

  it('création et modification : jamais de confidentialité par l\'API', () => {
    expect(apiTagCreateSchema.safeParse({ name: 'Hero', confidential: true }).success).toBe(false)
    expect(apiTagCreateSchema.parse({ name: '  Été  2026 ' }).name).toBe('Été 2026')
    expect(apiTagUpdateSchema.safeParse({}).success).toBe(false)
    expect(apiTagUpdateSchema.safeParse({ confidential: false }).success).toBe(false)
  })

  it('Media.tags : sans les confidentielles, globales d\'abord puis par nom', () => {
    const links = [
      { tag: tag({ id: 'p1', projectId: 'p', name: 'Été', nameKey: 'ete', slug: 'ete' }) },
      { tag: tag({ id: 'c1', projectId: 'p', name: 'Secret', nameKey: 'secret', slug: 'secret', confidential: true }) },
      { tag: tag({ id: 'g1' }) },
    ]
    expect(toApiTags(links)).toEqual([
      { id: 'g1', slug: 'hero', name: 'Hero', color: 'blue', level: 'global' },
      { id: 'p1', slug: 'ete', name: 'Été', color: 'blue', level: 'project' },
    ])
  })

  it('ETag d\'un média : suit les étiquettes visibles (renommage), ignore les confidentielles', () => {
    const media = { id: 'm', version: 1, updatedAt: new Date('2026-11-10T10:00:00Z'), visibility: 'PUBLIC' as const, processingState: null, jobs: [] }
    const bare = mediaEtag(media, 0)
    const tagged = mediaEtag({ ...media, tags: [{ tag: tag({ id: 'g1' }) }] }, 0)
    const renamed = mediaEtag({ ...media, tags: [{ tag: tag({ id: 'g1', updatedAt: new Date('2026-11-10T11:00:00Z') }) }] }, 0)
    const confidential = mediaEtag({ ...media, tags: [{ tag: tag({ id: 'c1', confidential: true }) }] }, 0)
    expect(new Set([bare, tagged, renamed]).size).toBe(3)
    expect(confidential).toBe(bare)
  })
})
