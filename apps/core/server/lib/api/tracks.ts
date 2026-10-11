import type { ApiTextTrackUpdate } from '#shared/schemas/api'
import type { TextTrackInput, TextTrackUpdate } from '#shared/schemas/media'
import { canonicalLanguage, type TextTrackKind } from '#shared/utils/text-tracks'
import { apiProblem } from './problem'

/**
 * Pistes de texte dans l'API v1 : champs publics (types en minuscules, `default`) → saisie du service
 * (server/lib/media/tracks.ts). Langue invalide : 400 INVALID_REQUEST.
 */

function language(value: string): string {
  const canonical = canonicalLanguage(value)
  if (!canonical) throw apiProblem('INVALID_REQUEST', `Invalid language tag "${value}" (expected BCP 47, e.g. "fr" or "en-GB").`)
  return canonical
}

export function toTrackInput(fields: { kind: string, language: string, label: string, default: string }): TextTrackInput {
  return {
    kind: fields.kind.toUpperCase() as TextTrackKind,
    language: language(fields.language),
    label: fields.label,
    isDefault: fields.default === 'true',
  }
}

export function toTrackUpdate(body: ApiTextTrackUpdate): TextTrackUpdate {
  return {
    ...(body.kind === undefined ? {} : { kind: body.kind.toUpperCase() as TextTrackKind }),
    ...(body.language === undefined ? {} : { language: language(body.language) }),
    ...(body.label === undefined ? {} : { label: body.label }),
    ...(body.default === undefined ? {} : { isDefault: body.default }),
  }
}
