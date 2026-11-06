import { licenseUsageSchema } from '#shared/schemas/license'

/**
 * PUT /api/admin/license/usage — { usage } : déclare l'usage de cette instance (évaluation, Community,
 * commercial ; architecture : .claude/architecture-usage.md). Redéclarer la même valeur la confirme (le
 * tableau de bord la redemande après un an). Une déclaration, pas un réglage de sécurité : pas de mode sudo.
 * 200 LicenseStatus & { instanceId, version, usage } · 400 · 403 DEMO_READ_ONLY (démo).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  const { usage } = await readValidatedBody(event, body => licenseUsageSchema.parse(body))

  const { previous, current } = await declareLicenseUsage(usage)
  await recordAudit(event, {
    action: 'settings.license_usage_declared',
    data: { from: previous?.usage ?? null, to: current.usage },
  })
  return { ...await licenseStatus(event), ...await licenseExtras() }
})
