import { MFA_POLICIES, mfaRequiredFor, type MfaPolicy } from '#shared/utils/mfa'

/**
 * GET /api/admin/security — politique de double authentification (page « Réglages ») : politique en
 * vigueur, clé de chiffrement configurée, et pour chaque politique le nombre de comptes actifs qu'elle
 * concernerait sans qu'ils aient encore activé la double authentification (ils la configureront à leur
 * prochaine connexion). 200 { mfaPolicy, available, withoutMfa: { optional, admins, everyone } }.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'settings:manage')
  const prisma = await usePrisma()
  const accounts = await prisma.user.findMany({
    where: { isActive: true, passwordHash: { not: null }, mfaSecret: null },
    select: { role: true },
  })
  const withoutMfa = Object.fromEntries(MFA_POLICIES.map(policy => [policy, accounts.filter(({ role }) => mfaRequiredFor(role, policy)).length])) as Record<MfaPolicy, number>
  return { mfaPolicy: await readMfaPolicy(), available: mfaAvailable(event), withoutMfa }
})
