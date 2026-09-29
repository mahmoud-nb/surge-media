import type { MediaErrorCode } from '#shared/utils/media'

/** Erreur métier des médias : statut HTTP + code (`data.code`) traduit par l'interface. */
export function mediaError(
  statusCode: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 503,
  code: MediaErrorCode,
  details: Record<string, unknown> = {},
) {
  return createError({ statusCode, statusMessage: code, data: { code, ...details } })
}
