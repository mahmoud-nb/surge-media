/**
 * Libellés traduits communs aux écrans des identifiants d'API (clés de projet, jetons personnels)
 * et tri des environnements : ceux proposés d'abord (production, staging…), puis les étiquettes
 * libres par ordre alphabétique.
 */
export function useCredentialLabels() {
  const { t } = useI18n()
  const { errorFallback } = useDemoErrors()

  function environmentLabel(environment: string): string {
    return (KEY_ENVIRONMENTS as readonly string[]).includes(environment)
      ? t(`credentials.environments.${environment}`)
      : environment
  }

  function compareEnvironments(a: string, b: string): number {
    const rank = (value: string) => {
      const index = (KEY_ENVIRONMENTS as readonly string[]).indexOf(value)
      return index === -1 ? KEY_ENVIRONMENTS.length : index
    }
    return rank(a) - rank(b) || a.localeCompare(b)
  }

  /**
   * Portées proposées pour un jeton personnel ou une clé secrète. `held` (clé de projet) : seulement celles
   * que le créateur détient lui-même dans le projet (une clé ne donne jamais plus, ex. tags:manage).
   */
  function scopeOptions(held?: readonly string[]) {
    return TOKEN_OPTIONAL_SCOPES.filter(scope => !held || held.includes(scope)).map(scope => ({
      value: scope,
      label: t(`scopes.${scope.replace(':', '.')}.label`),
      description: t(`scopes.${scope.replace(':', '.')}.description`),
    }))
  }

  /** Message traduit d'une erreur d'API des identifiants (codes connus), sinon générique. */
  function credentialErrorMessage(error: unknown): string {
    const { code } = apiError(error)
    if (code && (CREDENTIAL_ERROR_CODES as readonly string[]).includes(code)) return t(`credentials.errors.${code}`)
    if (code && (PROJECT_ERROR_CODES as readonly string[]).includes(code)) return t(`projects.errors.${code}`)
    return errorFallback(error)
  }

  return { environmentLabel, compareEnvironments, scopeOptions, credentialErrorMessage }
}
