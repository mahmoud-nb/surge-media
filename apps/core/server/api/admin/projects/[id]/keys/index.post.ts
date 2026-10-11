import { createProjectKeySchema } from '#shared/schemas/credentials'
import { createProjectKey, tokenAuditLabel } from '../../../../../lib/credentials/service'

/**
 * POST /api/admin/projects/:id/keys — { type, name, environment, scopes?, lifetime? }
 * (portée project:credentials). Clé secrète : confirmation récente du mot de passe exigée
 * (403 REAUTH_REQUIRED). 201 { key, value } : `value` (clé complète) n'est renvoyée qu'ici.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  const input = await readValidatedBody(event, body => createProjectKeySchema.parse(body))
  if (input.type === 'SECRET') await requireRecentPassword(event)

  const created = await createProjectKey(access.project!.id, access.user, input)
  await recordAudit(event, {
    action: 'key.created',
    projectId: access.project!.id,
    targetType: 'token',
    targetId: created.key.id,
    data: { label: tokenAuditLabel(created.key), type: created.key.type, environment: created.key.environment, scopes: created.key.scopes },
  })
  setResponseStatus(event, 201)
  return created
})
