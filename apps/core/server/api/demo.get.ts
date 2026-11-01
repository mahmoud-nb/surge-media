import type { DemoInfo } from '#shared/utils/demo'

/**
 * GET /api/demo — public : `{ enabled: false }` hors du mode démo ; sinon l'heure de la prochaine remise à zéro,
 * les liens du bandeau, les comptes affichés sur la page de connexion (rôle lu en base) et si la session
 * courante est celle d'un compte de référence (non modifiable). Jamais mis en cache.
 */
export default defineEventHandler(async (event): Promise<DemoInfo> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const demo = useDemo()
  if (!demo.enabled) return { enabled: false }

  const prisma = await usePrisma()
  const known = demo.accounts.length
    ? await prisma.user.findMany({ where: { email: { in: demo.accounts.map(account => account.email) } }, select: { email: true, role: true } })
    : []
  const roles = new Map(known.map(user => [user.email, user.role]))
  const user = await currentSessionUser(event)

  return {
    enabled: true,
    nextResetAt: new Date(demoNextResetAt()).toISOString(),
    contactUrl: demo.contactUrl,
    abuseUrl: demo.abuseUrl,
    termsUrl: demo.termsUrl,
    accounts: demo.accounts.map(account => ({ ...account, role: roles.get(account.email) ?? null })),
    protectedAccount: user ? await isDemoReferenceItem(user.createdAt) : false,
  }
})
