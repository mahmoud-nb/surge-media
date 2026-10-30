/**
 * GET /api/auth/license — fonctions payantes actives, pour adapter l'interface (useLicense). Tout compte
 * connecté ; ni titulaire ni dates (Réglages › Licence, réservé à `settings:manage`). La sécurité reste
 * assurée côté serveur par `requireLicenseFeature`. 200 { features }.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  return { features: (await licenseStatus(event)).features }
})
