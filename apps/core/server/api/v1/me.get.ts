import type { ApiMe } from '#shared/schemas/api'
import { API_CREDENTIAL_TYPES, DELEGATED_TOKEN_PREFIX } from '#shared/utils/api'
import { defineApiHandler } from '../../lib/api/context'
import { apiUploadRules } from '../../lib/api/writes'
import { getProjectState } from '../../lib/projects/state'

defineRouteMeta({
  openAPI: {
    'operationId': 'getMe',
    'tags': ['identity'],
    'summary': 'Identifiant utilisé',
    'description': 'Type, nom, préfixe, environnement, portées déclarées et échéance de l\'identifiant ; propriétaire (jeton personnel), projet (clé, jeton délégué) ou sélection de projets (jeton personnel) ; sujet, origine et contraintes d\'un jeton délégué ; règles d\'envoi effectives (`upload` : types acceptés en ce moment avec leur taille maximale, envois restants, visibilité et dossier imposés), de quoi contrôler un fichier avant de l\'envoyer. Répond aussi quand le projet est archivé (diagnostic).',
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'responses': { 200: { $ref: '#/components/responses/Me' } },
    'x-i18n': {
      en: {
        summary: 'Credential in use',
        description: 'Type, name, prefix, environment, declared scopes and expiry of the credential; owner (personal token), project (key, delegated token) or project selection (personal token); subject, origin and constraints of a delegated token; effective upload rules (`upload`: types accepted right now with their maximum size, remaining uploads, enforced visibility and folder), enough to check a file before uploading it. Also answers when the project is archived (diagnostics).',
      },
    },
  },
})

/**
 * GET /api/v1/me — identifiant utilisé : type, nom, préfixe, environnement, portées déclarées,
 * échéance ; propriétaire (jeton personnel), projet (clé, jeton délégué) ou sélection (jeton
 * personnel) ; sujet, origine et contraintes d'un jeton délégué (sans rien révéler de son émetteur) ;
 * règles d'envoi effectives (`upload`, null sans media:upload).
 * Accessible à tout identifiant valable, même si son projet est archivé (diagnostic).
 */
export default defineApiHandler(async (_event, principal): Promise<ApiMe> => {
  const { credential, delegated } = principal
  const upload = await apiUploadRules(principal)
  if (delegated) {
    const project = await getProjectState(delegated.projectId)
    return {
      credential: {
        id: delegated.jti,
        type: 'delegated',
        name: 'Delegated token',
        prefix: DELEGATED_TOKEN_PREFIX,
        environment: credential.environment,
        scopes: delegated.scopes,
        expiresAt: delegated.expiresAt.toISOString(),
        createdAt: delegated.issuedAt.toISOString(),
      },
      delegated: { subject: delegated.subject, origin: delegated.origin, upload: delegated.upload },
      user: null,
      project: project ? { id: project.id, name: project.name, slug: project.slug, archived: project.archived } : null,
      access: null,
      upload,
    }
  }

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
    delegated: null,
    user: credential.owner ? { id: credential.owner.id, name: credential.owner.name } : null,
    project: project ? { id: project.id, name: project.name, slug: project.slug, archived: project.archived } : null,
    access,
    upload,
  }
})
