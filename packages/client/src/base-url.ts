/** Adresse de l'installation et de l'API, quelle que soit la forme donnée (avec ou sans `/api/v1`, barre finale). */
export function normalizeBaseUrl(value: string): { baseUrl: string, apiBaseUrl: string } {
  const trimmed = value.trim().replace(/\/+$/, '')
  const baseUrl = trimmed.replace(/\/api\/v1$/, '')
  return { baseUrl, apiBaseUrl: `${baseUrl}/api/v1` }
}
