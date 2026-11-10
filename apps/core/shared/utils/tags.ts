import { normalizeSearchText } from './search'

/**
 * Étiquettes des médias : règles et calculs purs, partagés par l'interface, le serveur et les tests.
 * Architecture : .claude/architecture-tags.md (décisions TG1 à TG15).
 *
 * Deux niveaux : une étiquette **globale** (`projectId` null, gérée par un administrateur) s'applique
 * aux médias de la bibliothèque et de tous les projets ; une étiquette **de projet** aux médias de son
 * projet seulement. Un nom (sans casse ni accents) et un slug n'existent qu'une fois parmi les
 * étiquettes qu'un même média peut porter (globales + projet). Une étiquette **confidentielle** n'est
 * visible que dans l'interface connectée, par les comptes qui ont la permission `tags:confidential`
 * (ADMIN, MANAGER), et jamais dans l'API v1.
 */

export const TAG_LEVELS = ['global', 'project'] as const
export type TagLevel = (typeof TAG_LEVELS)[number]

export const TAG_NAME_MAX_LENGTH = 64
export const TAG_SLUG_MAX_LENGTH = 64
/** Slug : minuscules ASCII et chiffres, mots séparés par un tiret. */
export const TAG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Palette fixe (jetons `--tag-<teinte>-bg` / `-fg`, contrastes vérifiés en clair et en sombre). */
export const TAG_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet'] as const
export type TagColor = (typeof TAG_COLORS)[number]
export const TAG_DEFAULT_COLOR: TagColor = 'gray'

/** Filtre à plusieurs étiquettes : au moins une (défaut, choix de l'utilisateur) ou toutes. */
export const TAG_MATCHES = ['any', 'all'] as const
export type TagMatch = (typeof TAG_MATCHES)[number]
export const TAG_DEFAULT_MATCH: TagMatch = 'any'

/** Étiquettes au plus par niveau (liste globale, liste d'un projet). */
export const TAG_LIMIT = 500
/** Étiquettes au plus sur un média. */
export const MEDIA_TAG_LIMIT = 50
/** Étiquettes au plus dans un filtre de liste. */
export const TAG_FILTER_MAX = 20
/** Médias au plus dans une affectation en lot. */
export const TAG_BULK_MAX = 100

/** Codes d'erreur métier des étiquettes (`data.code` de l'administration, `code` de l'API v1). */
export const TAG_ERROR_CODES = [
  'TAG_NOT_FOUND', // étiquette inconnue, d'un autre projet, ou confidentielle pour qui ne la voit pas
  'TAG_NAME_TAKEN', // nom déjà pris parmi les étiquettes utilisables sur un même média
  'TAG_SLUG_TAKEN', // slug déjà pris, même règle
  'TAG_LIMIT_REACHED', // TAG_LIMIT atteint pour ce niveau
  'TAG_READ_ONLY', // étiquette globale modifiée par l'API v1 (gérée dans l'interface par un administrateur)
  'TOO_MANY_TAGS', // MEDIA_TAG_LIMIT dépassé sur un média
] as const
export type TagErrorCode = (typeof TAG_ERROR_CODES)[number]

/** Clé d'unicité d'un nom : minuscules, sans accents, espaces réduits (« Été  2026 » = « ete 2026 »). */
export function tagNameKey(name: string): string {
  return normalizeSearchText(name.normalize('NFC'))
}

/** Slug proposé d'après le nom (« Été 2026 » → « ete-2026 ») ; vide si le nom n'a aucun caractère latin ni chiffre. */
export function tagSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAG_SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
}

export function tagLevel(tag: { projectId: string | null }): TagLevel {
  return tag.projectId === null ? 'global' : 'project'
}

/** Une étiquette peut-elle être posée sur un média de cet espace (projet, ou null = bibliothèque) ? */
export function tagUsableIn(tag: { projectId: string | null }, mediaProjectId: string | null): boolean {
  return tag.projectId === null || tag.projectId === mediaProjectId
}

/**
 * Qui regarde les étiquettes : `confidential` = le compte a la permission `tags:confidential` et
 * l'appel vient de l'interface connectée. Toujours faux pour l'API v1, quel que soit l'identifiant.
 */
export interface TagViewer {
  confidential: boolean
}

export const API_TAG_VIEWER: TagViewer = Object.freeze({ confidential: false })

/** Étiquettes visibles par ce lecteur (les confidentielles sont retirées s'il ne peut pas les voir). */
export function visibleTags<T extends { confidential: boolean }>(tags: readonly T[], viewer: TagViewer): T[] {
  return viewer.confidential ? [...tags] : tags.filter(tag => !tag.confidential)
}

/**
 * Nouvel ensemble d'étiquettes d'un média quand un lecteur le remplace par `requested` : il ne
 * remplace que ce qu'il voit ; les confidentielles déjà posées qu'il ne voit pas restent.
 * Ordre : demandées d'abord, puis confidentielles conservées ; sans doublon.
 */
export function mergeTagIds(
  current: readonly { id: string, confidential: boolean }[],
  requested: readonly string[],
  viewer: TagViewer,
): string[] {
  const kept = viewer.confidential ? [] : current.filter(tag => tag.confidential).map(tag => tag.id)
  return [...new Set([...requested, ...kept])]
}

/** Étiquette telle que la voit un changement d'espace (identifiant, niveau, clé du nom). */
export interface CarriedTag {
  id: string
  projectId: string | null
  nameKey: string
}

/**
 * Étiquettes gardées quand un média change d'espace (déplacement, duplication, projet supprimé dont
 * les médias vont dans la bibliothèque) — TG9 : les globales restent ; une étiquette de projet est
 * remplacée par celle de même nom du projet cible s'il y en a une, sinon abandonnée ; aucune n'est
 * créée. `targetTags` = étiquettes du projet cible (vide pour la bibliothèque).
 */
export function carriedTagIds(
  sourceTags: readonly CarriedTag[],
  targetProjectId: string | null,
  targetTags: readonly CarriedTag[],
): string[] {
  const byKey = new Map(
    targetTags
      .filter(tag => targetProjectId !== null && tag.projectId === targetProjectId)
      .map(tag => [tag.nameKey, tag.id]),
  )
  const kept: string[] = []
  for (const tag of sourceTags) {
    if (tag.projectId === null || tag.projectId === targetProjectId) {
      kept.push(tag.id)
      continue
    }
    const match = byKey.get(tag.nameKey)
    if (match) kept.push(match)
  }
  return [...new Set(kept)]
}
