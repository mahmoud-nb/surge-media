/**
 * Dossiers d'un espace (bibliothèque ou projet) : règles et calculs sur l'arborescence, partagés
 * par l'interface, le serveur et les tests (fonctions pures). Architecture de la phase B § 11.
 *
 * Un dossier appartient à un espace, a au plus un parent du même espace, un nom unique parmi ses
 * frères (sans tenir compte de la casse) ; profondeur de 8 niveaux au plus. Un média est dans 0 ou
 * 1 dossier de son espace. L'arbre d'un espace est petit : il est chargé en entier et parcouru en
 * mémoire (filtre récursif = liste des descendants).
 */

export const FOLDER_NAME_MAX_LENGTH = 100
/** Niveaux d'imbrication au plus (un dossier à la racine est au niveau 1). */
export const FOLDER_MAX_DEPTH = 8
/** Dossiers par espace au plus (arbre chargé en entier, filtre récursif en IN). */
export const FOLDERS_PER_SPACE_MAX = 1000

/** Codes d'erreur métier des dossiers (`data.code`), traduits par l'interface. */
export const FOLDER_ERROR_CODES = [
  'FOLDER_NOT_FOUND', // dossier inexistant ou d'un autre espace
  'FOLDER_NAME_TAKEN', // un dossier frère porte déjà ce nom
  'FOLDER_NOT_EMPTY', // suppression d'un dossier qui contient des médias ou des sous-dossiers
  'FOLDER_DEPTH_EXCEEDED', // plus de FOLDER_MAX_DEPTH niveaux
  'FOLDER_CYCLE', // déplacement d'un dossier dans lui-même ou l'un de ses descendants
  'FOLDER_LIMIT_REACHED', // FOLDERS_PER_SPACE_MAX dossiers dans l'espace
] as const
export type FolderErrorCode = (typeof FOLDER_ERROR_CODES)[number]

export interface FolderNode {
  id: string
  parentId: string | null
  name: string
}

/** Clé de comparaison des noms (unicité parmi les frères) : NFC, sans tenir compte de la casse. */
export function folderNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase()
}

export interface FolderIndex<T extends FolderNode> {
  byId: Map<string, T>
  /** Enfants par parent (`null` = racine), triés par nom. */
  children: Map<string | null, T[]>
}

export function indexFolders<T extends FolderNode>(folders: readonly T[]): FolderIndex<T> {
  const byId = new Map(folders.map(folder => [folder.id, folder]))
  const children = new Map<string | null, T[]>()
  for (const folder of folders) {
    // Parent inconnu (incohérence) : rattaché à la racine plutôt que perdu.
    const parent = folder.parentId && byId.has(folder.parentId) ? folder.parentId : null
    const list = children.get(parent)
    if (list) list.push(folder)
    else children.set(parent, [folder])
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return { byId, children }
}

/** Chemin de la racine au dossier (inclus) ; vide si le dossier est inconnu. */
export function folderAncestors<T extends FolderNode>(index: FolderIndex<T>, id: string): T[] {
  const path: T[] = []
  const seen = new Set<string>()
  let current = index.byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? index.byId.get(current.parentId) : undefined
  }
  return path
}

/** Niveau d'un dossier (1 à la racine) ; 0 pour la racine elle-même (`null`). */
export function folderDepth<T extends FolderNode>(index: FolderIndex<T>, id: string | null): number {
  return id ? folderAncestors(index, id).length : 0
}

/** Le dossier et tous ses descendants (parcours en largeur). */
export function descendantIds<T extends FolderNode>(index: FolderIndex<T>, id: string): string[] {
  const result: string[] = []
  const queue = [id]
  const seen = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()!
    if (seen.has(current)) continue
    seen.add(current)
    result.push(current)
    for (const child of index.children.get(current) ?? []) queue.push(child.id)
  }
  return result
}

/** Hauteur du sous-arbre (1 pour un dossier sans sous-dossier). */
export function subtreeHeight<T extends FolderNode>(index: FolderIndex<T>, id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return 0
  seen.add(id)
  const heights = (index.children.get(id) ?? []).map(child => subtreeHeight(index, child.id, seen))
  return 1 + Math.max(0, ...heights)
}

/**
 * Déplacer le dossier `id` sous `parentId` (`null` = racine) est-il permis ? Refus : dans lui-même
 * ou un descendant (cycle), ou profondeur finale au-delà de FOLDER_MAX_DEPTH.
 */
export function folderMoveProblem<T extends FolderNode>(index: FolderIndex<T>, id: string, parentId: string | null): 'FOLDER_CYCLE' | 'FOLDER_DEPTH_EXCEEDED' | null {
  if (parentId && descendantIds(index, id).includes(parentId)) return 'FOLDER_CYCLE'
  if (folderDepth(index, parentId) + subtreeHeight(index, id) > FOLDER_MAX_DEPTH) return 'FOLDER_DEPTH_EXCEEDED'
  return null
}

/** Arbre aplati en profondeur (ordre d'affichage), avec le niveau de chaque dossier. */
export function flattenFolders<T extends FolderNode>(index: FolderIndex<T>): { folder: T, depth: number }[] {
  const result: { folder: T, depth: number }[] = []
  const seen = new Set<string>()
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of index.children.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue
      seen.add(folder.id)
      result.push({ folder, depth })
      visit(folder.id, depth + 1)
    }
  }
  visit(null, 1)
  return result
}

/** Chemin lisible d'un dossier : noms séparés par « / » (listes de choix, fil d'Ariane textuel). */
export function folderPathLabel<T extends FolderNode>(index: FolderIndex<T>, id: string, separator = ' / '): string {
  return folderAncestors(index, id).map(folder => folder.name).join(separator)
}
