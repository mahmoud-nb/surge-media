import type { z } from 'zod'

export interface FieldError {
  /** Clé i18n (`validation.*`) portée par le message du schéma zod. */
  key: string
  params: Record<string, string | number>
}

/**
 * Première erreur de chaque champ d'un résultat zod, sous forme de clé i18n + paramètres,
 * à traduire dans le composant : t(error.key, error.params).
 */
export function fieldErrors<T extends Record<string, unknown>>(error: z.ZodError<T>): Partial<Record<keyof T, FieldError>> {
  const errors: Partial<Record<keyof T, FieldError>> = {}
  for (const issue of error.issues) {
    const field = issue.path[0] as keyof T | undefined
    if (field === undefined || errors[field]) continue
    const params: FieldError['params'] = {}
    if (issue.code === 'too_big') params.max = Number(issue.maximum)
    if (issue.code === 'too_small') params.min = Number(issue.minimum)
    // Contrôle personnalisé (refine) : paramètres du message passés par `params`.
    if (issue.code === 'custom' && issue.params) Object.assign(params, issue.params)
    errors[field] = { key: issue.message, params }
  }
  return errors
}
