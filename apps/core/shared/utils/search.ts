/**
 * Recherche normalisée : les colonnes `Media.search*` et la saisie sont réduites à la même forme
 * (minuscules, sans accents ni espaces superflus), ce qui rend la recherche insensible à la casse
 * ET aux accents sur SQLite, PostgreSQL et MySQL avec un simple `contains`.
 */

/** VARCHAR(191) sous MySQL. */
export const SEARCH_TEXT_MAX_LENGTH = 191

/** « Été à Paris » → « ete a paris ». */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_TEXT_MAX_LENGTH)
}

/** Colonnes de recherche d'un média, à écrire avec ses champs texte. */
export function mediaSearchColumns(media: { originalName: string, title: string | null, altText: string | null }) {
  return {
    searchName: normalizeSearchText(media.originalName),
    searchTitle: media.title ? normalizeSearchText(media.title) : null,
    searchAlt: media.altText ? normalizeSearchText(media.altText) : null,
  }
}
