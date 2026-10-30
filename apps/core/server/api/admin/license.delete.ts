/**
 * DELETE /api/admin/license — retire la licence installée (mode sudo) : retour à l'édition Community, seules
 * les fonctions payantes s'éteignent. Sans licence installée : rien à faire, pas d'entrée d'audit.
 * 200 LicenseStatus & { instanceId } · 403 REAUTH_REQUIRED · 409 LICENSE_FROM_ENV.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  await requireRecentPassword(event)
  if (licenseFromEnv(event)) throw licenseError(409, 'LICENSE_FROM_ENV')

  const removed = await removeLicense(event)
  if (removed) {
    const license = removed.payload
    await recordAudit(event, {
      action: 'settings.license_removed',
      data: license ? { id: license.jti, label: license.licensee.name, plan: license.plan } : {},
    })
  }
  return { ...await licenseStatus(event), instanceId: await readInstanceId() }
})
