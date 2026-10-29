import { MFA_ERROR_CODES, type MfaErrorCode } from '#shared/utils/mfa'

/**
 * Messages traduits des erreurs de la double authentification (`mfa.errors.*`) : code métier de l'API,
 * trop d'essais (429, avec le délai), ou message générique. Le détail technique n'est jamais affiché.
 */
export function useMfaErrors() {
  const { t } = useI18n()

  function mfaErrorCode(error: unknown): MfaErrorCode | undefined {
    const { code } = apiError(error)
    return (MFA_ERROR_CODES as readonly string[]).includes(code ?? '') ? code as MfaErrorCode : undefined
  }

  function mfaErrorMessage(error: unknown): string {
    const { status, retryAfter } = apiError(error)
    const code = mfaErrorCode(error)
    if (code) return t(`mfa.errors.${code}`)
    if (status === 429) return t('mfa.errors.tooManyAttempts', { minutes: Math.ceil((retryAfter ?? 60) / 60) })
    return t('mfa.errors.unexpected')
  }

  return { mfaErrorCode, mfaErrorMessage }
}
