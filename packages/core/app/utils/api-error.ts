export interface ApiErrorInfo {
  /** Statut HTTP, absent si la requête n'a pas abouti (réseau). */
  status?: number
  /** Code métier renvoyé par l'API dans `data.code` (ex. EMAIL_TAKEN). */
  code?: string
  /** En-tête Retry-After, en secondes (réponses 429). */
  retryAfter?: number
}

/** Extrait statut, code métier et Retry-After d'une erreur $fetch (FetchError). */
export function apiError(error: unknown): ApiErrorInfo {
  const { statusCode, data, response } = (error ?? {}) as {
    statusCode?: number
    data?: { data?: { code?: unknown } }
    response?: Response
  }
  const code = data?.data?.code
  const retryAfter = Number(response?.headers.get('retry-after'))
  return {
    status: statusCode,
    code: typeof code === 'string' ? code : undefined,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  }
}
