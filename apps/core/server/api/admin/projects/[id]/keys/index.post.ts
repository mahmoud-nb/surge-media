import { createProjectKeySchema } from '#shared/schemas/credentials'
import { createProjectKey, tokenAuditLabel } from '../../../../../lib/credentials/service'

/**
 * POST /api/admin/projects/:id/keys — { type, name, environment, scopes?, lifetime? }
 * (portée project:credentials). Clé secrète : confirmation récente du mot de passe exigée
 * (403 REAUTH_REQUIRED). 201 { key, value } : `value` (clé complète) n'est renvoyée qu'ici.
 * 403 SCOPE_NOT_HELD : portée demandée que le créateur n'a pas dans le projet (TG6, `tags:manage`).
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  const input = await readValidatedBody(event, body => createProjectKeySchema.parse(body))
  // Une clé ne donne jamais plus que les droits de son créateur dans le projet (ex. tags:manage).
  if (input.type === 'SECRET' && unheldScopes(input.scopes, access.scopes).length > 0) throw credentialError(403, 'SCOPE_NOT_HELD')
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
