/**
 * GET /api/admin/status — état de l'instance pour les administrateurs.
 * `bootstrapCredentialsSet` : les identifiants d'amorçage sont encore définis dans
 * l'environnement alors qu'ils ne servent plus (à supprimer).
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event, 'users:manage')
  const { bootstrapAdmin } = useRuntimeConfig(event)
  return { bootstrapCredentialsSet: Boolean(bootstrapAdmin.email || bootstrapAdmin.password) }
})
