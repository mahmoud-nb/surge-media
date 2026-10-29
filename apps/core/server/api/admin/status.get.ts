/**
 * GET /api/admin/status — état de l'instance pour les administrateurs.
 * `bootstrapCredentialsSet` : les identifiants d'amorçage sont encore définis dans
 * l'environnement alors qu'ils ne servent plus (à supprimer).
 * `mfa` : clé de chiffrement configurée (`available`), politique, et administrateurs actifs sans double
 * authentification (`adminsWithoutMfa`).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'users:manage')
  const { bootstrapAdmin } = useRuntimeConfig(event)
  const prisma = await usePrisma()
  const adminsWithoutMfa = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, passwordHash: { not: null }, mfaSecret: null } })
  return {
    bootstrapCredentialsSet: Boolean(bootstrapAdmin.email || bootstrapAdmin.password),
    mfa: { available: mfaAvailable(event), policy: await readMfaPolicy(), adminsWithoutMfa },
  }
})
