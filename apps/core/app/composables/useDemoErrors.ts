/**
 * Messages des erreurs propres au mode démo (`demo.errors.*`) : élément du contenu de référence en lecture
 * seule (`403 DEMO_READ_ONLY`, selon la ressource) et volume d'envoi du cycle épuisé (`429 DEMO_QUOTA`).
 * `errorFallback` remplace le message générique des écrans : le code de la démo s'il y en a un, sinon
 * « L'opération a échoué ».
 */
export function useDemoErrors() {
  const { t } = useI18n()

  function demoErrorMessage(code: string | undefined, details?: Record<string, unknown>, retryAfter?: number): string | null {
    if (code === 'DEMO_READ_ONLY') {
      const resource = details?.resource
      const key = resource === 'media' || resource === 'user' || resource === 'setting' ? resource : 'item'
      return t(`demo.errors.readOnly.${key}`)
    }
    if (code === 'DEMO_QUOTA') {
      const seconds = retryAfter ?? (typeof details?.retryAfter === 'number' ? details.retryAfter : 60)
      return t('demo.errors.quota', { minutes: Math.max(1, Math.ceil(seconds / 60)) })
    }
    return null
  }

  function errorFallback(error: unknown): string {
    const { code, details, retryAfter } = apiError(error)
    return demoErrorMessage(code, details, retryAfter) ?? t('common.unexpectedError')
  }

  return { demoErrorMessage, errorFallback }
}
