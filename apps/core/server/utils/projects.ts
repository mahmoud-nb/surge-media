import type { ProjectErrorCode } from '#shared/utils/projects'

/** Erreur métier des projets : statut HTTP + code (`data.code`) traduit par l'interface. */
export function projectError(statusCode: 400 | 403 | 404 | 409 | 422, code: ProjectErrorCode) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}
