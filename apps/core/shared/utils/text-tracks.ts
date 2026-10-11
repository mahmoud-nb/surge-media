/**
 * Pistes de texte des vidéos (phase D2, élément HTML <track>) : constantes et règles partagées par le
 * serveur et l'interface. Architecture : .claude/architecture-phase-d.md § 20.
 */

/** Sous-titres, sous-titres pour sourds et malentendants, descriptions, chapitres. */
export const TEXT_TRACK_KINDS = ['SUBTITLES', 'CAPTIONS', 'DESCRIPTIONS', 'CHAPTERS'] as const
export type TextTrackKind = (typeof TEXT_TRACK_KINDS)[number]

/** Pistes au plus par vidéo. */
export const TEXT_TRACKS_MAX = 20
export const TEXT_TRACK_LABEL_MAX_LENGTH = 100
/** Extensions acceptées (l'analyse du contenu reste seule juge). */
export const TEXT_TRACK_EXTENSIONS = ['vtt', 'srt'] as const

/**
 * Une piste « par défaut » au plus par groupe, comme l'exige HTML : sous-titres et sous-titres SME
 * ensemble, descriptions, chapitres.
 */
export function textTrackGroup(kind: TextTrackKind): 'text' | 'descriptions' | 'chapters' {
  if (kind === 'DESCRIPTIONS') return 'descriptions'
  if (kind === 'CHAPTERS') return 'chapters'
  return 'text'
}

/** Étiquette de langue BCP 47 canonique (`fr`, `en-GB`, `pt-BR`), ou null si elle est invalide. */
export function canonicalLanguage(tag: string): string | null {
  const value = tag.trim()
  if (!value || value.length > 35) return null
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null
  }
  catch {
    return null
  }
}

/** Valeur de l'attribut HTML `kind` (`subtitles`, `captions`…). */
export function htmlTrackKind(kind: TextTrackKind): string {
  return kind.toLowerCase()
}
