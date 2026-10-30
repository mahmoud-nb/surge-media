import { licenseInstallSchema } from '#shared/schemas/license'

/**
 * PUT /api/admin/license — { token } : installe une licence collée (mode sudo), après vérification de sa
 * signature. Une licence échue ou pas encore valable s'installe aussi : son état le dira.
 * 200 LicenseStatus & { instanceId } · 403 REAUTH_REQUIRED · 409 LICENSE_FROM_ENV · 422 LICENSE_INVALID (+ reason).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  await requireRecentPassword(event)
  if (licenseFromEnv(event)) throw licenseError(409, 'LICENSE_FROM_ENV')
  const { token } = await readValidatedBody(event, body => licenseInstallSchema.parse(body))

  const license = await installLicense(event, token)
  await recordAudit(event, {
    action: 'settings.license_installed',
    data: { id: license.jti, label: license.licensee.name, plan: license.plan },
  })
  return { ...await licenseStatus(event), instanceId: await readInstanceId() }
})
