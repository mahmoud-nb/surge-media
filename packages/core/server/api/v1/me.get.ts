import type { ApiMe } from '#shared/schemas/api'
import { API_CREDENTIAL_TYPES } from '#shared/utils/api'
import { defineApiHandler } from '../../lib/api/context'
import { getProjectState } from '../../lib/projects/state'

/**
 * GET /api/v1/me — identifiant utilisé : type, nom, préfixe, environnement, portées déclarées,
 * échéance ; propriétaire (jeton personnel), projet (clé) ou sélection (jeton personnel).
 * Accessible à tout identifiant valable, même si son projet est archivé (diagnostic).
 */
export default defineApiHandler(async (_event, { credential }): Promise<ApiMe> => {
  const project = credential.projectId ? await getProjectState(credential.projectId) : null
  let access: ApiMe['access'] = null
  if (credential.type === 'PERSONAL') {
    const prisma = await usePrisma()
    const projects = credential.allProjects
      ? []
      : await prisma.project.findMany({
          where: { id: { in: credential.projectIds } },
          select: { id: true, name: true, slug: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        })
    access = { allProjects: credential.allProjects, library: credential.includeLibrary, projects }
  }
  return {
    credential: {
      id: credential.id,
      type: API_CREDENTIAL_TYPES[credential.type],
      name: credential.name,
      prefix: credential.prefix,
      environment: credential.environment,
      scopes: credential.scopes,
      expiresAt: credential.expiresAt?.toISOString() ?? null,
      createdAt: credential.createdAt.toISOString(),
    },
    user: credential.owner ? { id: credential.owner.id, name: credential.owner.name } : null,
    project: project ? { id: project.id, name: project.name, slug: project.slug, archived: project.archived } : null,
    access,
  }
})
