import type { z } from 'zod'

/**
 * Validation accessible d'un formulaire avec un schéma zod partagé avec l'API :
 * messages traduits par champ, focus sur le premier champ en erreur (son message est
 * alors lu grâce à aria-describedby), erreurs posées par le serveur (setError).
 *
 *   const { validate, message, clear } = useFormValidation(schema, { email: 'user-email' })
 *   const data = validate(form)   // null si invalide
 *
 * `fields` associe chaque champ à l'id de son contrôle, dans l'ordre d'affichage.
 */
export function useFormValidation<S extends z.ZodType<Record<string, unknown>>>(
  schema: S,
  fields: Partial<Record<keyof z.input<S> & string, string>>,
) {
  type Field = keyof z.input<S> & string
  const { t } = useI18n()
  const errors = ref<Partial<Record<Field, FieldError>>>({})

  function message(field: Field): string | undefined {
    const error = errors.value[field]
    return error ? t(error.key, error.params) : undefined
  }

  function clear(field: Field) {
    if (errors.value[field]) errors.value = { ...errors.value, [field]: undefined }
  }

  function focusFirstError() {
    const first = (Object.keys(fields) as Field[]).find(field => errors.value[field])
    const id = first ? fields[first] : undefined
    if (id) document.getElementById(id)?.focus()
  }

  function setError(field: Field, key: string, params: FieldError['params'] = {}) {
    errors.value = { ...errors.value, [field]: { key, params } }
    focusFirstError()
  }

  function validate(values: unknown): z.output<S> | null {
    const result = schema.safeParse(values)
    if (result.success) {
      errors.value = {}
      return result.data
    }
    errors.value = fieldErrors(result.error as z.ZodError<Record<Field, unknown>>)
    focusFirstError()
    return null
  }

  return { errors, message, clear, setError, validate }
}
