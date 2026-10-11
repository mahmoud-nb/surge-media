import { describe, expect, it } from 'vitest'
import { apiFolderCreateSchema, apiFolderUpdateSchema, apiMediaListQuerySchema, apiUploadConstraintsSchema } from '../shared/schemas/api'
import { assignFolderSchema, createFolderSchema, folderFormSchema, updateFolderSchema } from '../shared/schemas/folders'
import { mediaListQuerySchema } from '../shared/schemas/media'
import {
  descendantIds,
  folderAncestors,
  folderDepth,
  folderMoveProblem,
  folderNameKey,
  folderPathLabel,
  flattenFolders,
  indexFolders,
  subtreeHeight,
} from '../shared/utils/folders'

// Arbre : Campagnes > Été 2026 > Plage ; Campagnes > Hiver ; Produits (racine).
const TREE = [
  { id: 'c', parentId: null, name: 'Campagnes' },
  { id: 'e', parentId: 'c', name: 'Été 2026' },
  { id: 'p', parentId: 'e', name: 'Plage' },
  { id: 'h', parentId: 'c', name: 'Hiver' },
  { id: 'r', parentId: null, name: 'Produits' },
]

/** Chaîne de `depth` dossiers imbriqués (d1 > d2 > …). */
function chain(depth: number) {
  return Array.from({ length: depth }, (_, i) => ({ id: `d${i + 1}`, parentId: i === 0 ? null : `d${i}`, name: `Niveau ${i + 1}` }))
}

describe('arborescence des dossiers', () => {
  const index = indexFolders(TREE)

  it('enfants triés par nom, chemins, niveaux', () => {
    expect(index.children.get(null)?.map(folder => folder.id)).toEqual(['c', 'r'])
    expect(index.children.get('c')?.map(folder => folder.id)).toEqual(['e', 'h'])
    expect(folderAncestors(index, 'p').map(folder => folder.name)).toEqual(['Campagnes', 'Été 2026', 'Plage'])
    expect(folderPathLabel(index, 'p')).toBe('Campagnes / Été 2026 / Plage')
    expect([folderDepth(index, null), folderDepth(index, 'c'), folderDepth(index, 'p')]).toEqual([0, 1, 3])
    expect(folderAncestors(index, 'inconnu')).toEqual([])
  })

  it('descendants (filtre récursif) et hauteur des sous-arbres', () => {
    expect(descendantIds(index, 'c').sort()).toEqual(['c', 'e', 'h', 'p'])
    expect(descendantIds(index, 'p')).toEqual(['p'])
    expect([subtreeHeight(index, 'c'), subtreeHeight(index, 'e'), subtreeHeight(index, 'r')]).toEqual([3, 2, 1])
  })

  it('ordre d\'affichage en profondeur avec les niveaux', () => {
    expect(flattenFolders(index).map(({ folder, depth }) => `${folder.id}${depth}`)).toEqual(['c1', 'e2', 'p3', 'h2', 'r1'])
  })

  it('déplacement : pas dans lui-même ni un descendant, 8 niveaux au plus', () => {
    expect(folderMoveProblem(index, 'c', 'c')).toBe('FOLDER_CYCLE')
    expect(folderMoveProblem(index, 'c', 'p')).toBe('FOLDER_CYCLE')
    expect(folderMoveProblem(index, 'e', 'r')).toBeNull()
    expect(folderMoveProblem(index, 'p', null)).toBeNull()
    const deep = indexFolders([...chain(6), { id: 'x', parentId: null, name: 'X' }, { id: 'y', parentId: 'x', name: 'Y' }, { id: 'z', parentId: 'y', name: 'Z' }])
    // 6 niveaux + un sous-arbre de 2 = 8 : permis ; + 3 = 9 : refusé.
    expect(folderMoveProblem(deep, 'y', 'd6')).toBeNull()
    expect(folderMoveProblem(deep, 'x', 'd6')).toBe('FOLDER_DEPTH_EXCEEDED')
  })

  it('résiste aux données incohérentes (parent inconnu, cycle en base)', () => {
    const broken = indexFolders([{ id: 'a', parentId: 'disparu', name: 'A' }, { id: 'b', parentId: 'c2', name: 'B' }, { id: 'c2', parentId: 'b', name: 'C' }])
    expect(broken.children.get(null)?.map(folder => folder.id)).toEqual(['a'])
    expect(folderAncestors(broken, 'b').length).toBeLessThanOrEqual(2)
    expect(descendantIds(broken, 'b').sort()).toEqual(['b', 'c2'])
  })

  it('unicité des noms sans tenir compte de la casse', () => {
    expect(folderNameKey('  Été 2026 ')).toBe(folderNameKey('été 2026'))
    expect(folderNameKey('Ete 2026')).not.toBe(folderNameKey('Été 2026'))
    // NFC : « é » composé et décomposé sont le même nom.
    expect(folderNameKey('Été')).toBe(folderNameKey('Été'))
  })
})

describe('schémas des dossiers', () => {
  it('administration : nom normalisé, caractères interdits, identifiants', () => {
    expect(folderFormSchema.parse({ name: '  Été 2026  ' })).toEqual({ name: 'Été 2026' })
    for (const name of ['', '   ', 'a/b', 'a\\b', '.', '..', 'x'.repeat(101), 'a\nb']) {
      expect(folderFormSchema.safeParse({ name }).success, JSON.stringify(name)).toBe(false)
    }
    expect(createFolderSchema.parse({ name: 'Plage', parentId: null })).toEqual({ name: 'Plage', parentId: null })
    expect(updateFolderSchema.parse({ parentId: null })).toEqual({ parentId: null })
    expect(assignFolderSchema.safeParse({ ids: [], folderId: null }).success).toBe(false)
    expect(assignFolderSchema.safeParse({ ids: Array.from({ length: 101 }, (_, i) => `m${i}`), folderId: null }).success).toBe(false)
  })

  it('filtres de la médiathèque : dossier et sous-dossiers tolérants', () => {
    expect(mediaListQuerySchema.parse({ folder: 'cmfolder01', recursive: '1' })).toMatchObject({ folder: 'cmfolder01', recursive: true })
    expect(mediaListQuerySchema.parse({ recursive: 'oui' }).recursive).toBeUndefined()
  })

  it('API v1 : champs stricts, dossier racine, contrainte de dossier des jetons délégués', () => {
    expect(apiFolderCreateSchema.parse({ name: ' Plage ' })).toEqual({ name: 'Plage' })
    expect(apiFolderCreateSchema.safeParse({ name: 'Plage', color: 'bleu' }).success).toBe(false)
    expect(apiFolderUpdateSchema.safeParse({ name: 'a/b' }).success).toBe(false)
    expect(apiFolderUpdateSchema.parse({ parentId: null })).toEqual({ parentId: null })
    expect(apiMediaListQuerySchema.parse({ folder: 'root', recursive: 'true' })).toMatchObject({ folder: 'root', recursive: true })
    expect(apiMediaListQuerySchema.parse({ folder: 'cmfolder0001' }).folder).toBe('cmfolder0001')
    expect(apiMediaListQuerySchema.safeParse({ folder: '../x' }).success).toBe(false)
    expect(apiUploadConstraintsSchema.parse({ folderId: 'cmfolder0001' })).toEqual({ folderId: 'cmfolder0001' })
  })
})
