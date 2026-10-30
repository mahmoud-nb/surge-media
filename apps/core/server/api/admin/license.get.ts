/**
 * GET /api/admin/license — licence commerciale (Réglages › Licence) : état, source (variable
 * NUXT_LICENSE_KEY ou base), détail, raison d'un refus, date de référence et retard de l'horloge,
 * identifiant de cette installation. 200 LicenseStatus & { instanceId }.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  return { ...await licenseStatus(event, { fresh: true }), instanceId: await readInstanceId() }
})
