import type { LicenseFeature } from '#shared/utils/license'

/**
 * Fonctions payantes actives (GET /api/auth/license), pour adapter l'interface : masquer ou expliquer ce
 * que la licence ne couvre pas. La sécurité reste assurée par l'API (`requireLicenseFeature`). Clé partagée
 * `license-features` : Réglages › Licence la rafraîchit après une installation ou un retrait.
 */
export function useLicense() {
  const { data, refresh } = useApiFetch('/api/auth/license', { key: 'license-features' })
  const features = computed(() => data.value?.features ?? [])

  function allows(feature: LicenseFeature): boolean {
    return features.value.includes(feature)
  }

  return { features, allows, refresh }
}
