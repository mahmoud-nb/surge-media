import { createPersonalTokenSchema } from '#shared/schemas/credentials'
import { createPersonalToken, tokenAuditLabel } from '../../../lib/credentials/service'

/**
 * POST /api/admin/tokens — { name, lifetime, scopes?, allProjects?, projectIds?, includeLibrary? }
 * (permission tokens:personal + confirmation récente du mot de passe, 403 REAUTH_REQUIRED).
 * 201 { token, value } : `value` (jeton complet) n'est renvoyée qu'ici.
 * 422 PROJECT_UNAVAILABLE (projet choisi invisible ou archivé).
 */
export default defineEventHandler(async (event) => {
  const user = await requireAuth(event, 'tokens:personal')
  const input = await readValidatedBody(event, body => createPersonalTokenSchema.parse(body))
  await requireRecentPassword(event)

  const created = await createPersonalToken(user, input)
  await recordAudit(event, {
    action: 'token.created',
    targetType: 'token',
    targetId: created.token.id,
    data: {
      label: tokenAuditLabel(created.token),
      scopes: created.token.scopes,
      allProjects: created.token.allProjects,
      projects: created.token.projects.map(project => project.id),
      includeLibrary: created.token.includeLibrary,
      expiresAt: created.token.expiresAt,
    },
  })
  setResponseStatus(event, 201)
  return created
})
