import { rotateKeySchema } from '#shared/schemas/credentials'
import { findProjectKey, rotateProjectKey, tokenAuditLabel } from '../../../../../../lib/credentials/service'

/**
 * POST /api/admin/projects/:id/keys/:keyId/rotate — { overlap: 'now' | '1h' | '24h' | '7d' }
 * (portée project:credentials ; clé secrète : confirmation récente du mot de passe).
 * Crée la clé de remplacement ; l'ancienne reste valable pendant la période de recouvrement.
 * 201 { key, value } · 403 REAUTH_REQUIRED · 404 · 409 TOKEN_NOT_ACTIVE / TOKEN_REPLACED.
 */
export default defineEventHandler(async (event) => {
  const access = await requireSpaceAccess(event, spaceFor(getRouterParam(event, 'id')), 'project:credentials')
  const key = await findProjectKey(access.project!.id, getRouterParam(event, 'keyId') ?? '')
  const { overlap } = await readValidatedBody(event, body => rotateKeySchema.parse(body))
  if (key.type === 'SECRET') await requireRecentPassword(event)

  const rotated = await rotateProjectKey(key, access.user, overlap)
  await recordAudit(event, {
    action: 'key.rotated',
    projectId: access.project!.id,
    targetType: 'token',
    targetId: key.id,
    data: { label: tokenAuditLabel(key), type: key.type, environment: key.environment, overlap, replacedBy: tokenAuditLabel(rotated.key) },
  })
  setResponseStatus(event, 201)
  return rotated
})
