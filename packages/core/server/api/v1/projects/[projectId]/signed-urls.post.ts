import { API_SIGNED_URL_ITEM_ERRORS, apiSignedUrlsBodySchema } from '#shared/schemas/api'
import { DELEGATED_SIGNED_URL_MAX_TTL } from '#shared/utils/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../lib/api/context'
import { apiProblem, toProblem } from '../../../../lib/api/problem'
import { findApiMediaByIds } from '../../../../lib/api/queries'
import { issueSignedUrl, type SignedUrlResult } from '../../../../lib/api/signed-urls'
import { mediaBaseUrl } from '../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'createSignedUrls',
    'tags': ['media'],
    'summary': 'Liens par lot',
    'description': 'Jusqu\'à 100 liens en un appel (par exemple toutes les sources `srcset` d\'une page), mêmes règles que `POST …/media/{mediaId}/signed-url`, une seule échéance pour tout le lot. Un lien impossible (média introuvable, préréglage inconnu, transformation invalide ou refusée) donne `error` à sa place sans faire échouer les autres.',
    'x-scopes': ['media:read'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'INVALID_REQUEST',
      'CREDENTIAL_NOT_ALLOWED',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/SignedUrlsRequest' },
    'responses': { 200: { $ref: '#/components/responses/SignedUrlList' } },
    'x-i18n': {
      en: {
        summary: 'Links in bulk',
        description: 'Up to 100 links in one call (for instance every `srcset` source of a page), same rules as `POST …/media/{mediaId}/signed-url`, one expiry for the whole batch. A link that cannot be issued (media item not found, unknown preset, invalid or refused transformation) gets `error` in its place without failing the others.',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/signed-urls — { items: [{ mediaId, target?, preset?, transform?,
 * format? }], expiresIn? } (portée media:read ; comme le lien unitaire). Médias lus en une requête ;
 * résultats dans l'ordre des demandes, erreur par lien (codes API_SIGNED_URL_ITEM_ERRORS).
 * → { items: [{ url, query, expiresAt } | { error: { code, detail? } }] }
 */
export default defineApiHandler(async (event, principal) => {
  if (principal.type === 'publishable') {
    throw apiProblem('CREDENTIAL_NOT_ALLOWED', 'Signed links are issued to secret keys, personal tokens and delegated tokens only.')
  }
  const { project } = await requireApiProject(event, principal, 'media:read')
  const body = await readApiBody(event, apiSignedUrlsBodySchema)
  if (principal.delegated && body.expiresIn > DELEGATED_SIGNED_URL_MAX_TTL) {
    throw apiProblem('INVALID_REQUEST', `Delegated tokens can request links valid for ${DELEGATED_SIGNED_URL_MAX_TTL} seconds at most.`)
  }

  const media = await findApiMediaByIds(project.id, body.items.map(item => item.mediaId))
  const options = {
    base: mediaBaseUrl(event),
    policy: project.transformPolicy,
    delegated: Boolean(principal.delegated),
    expires: Math.floor(Date.now() / 1000) + body.expiresIn,
  }
  const items: (SignedUrlResult | { error: { code: string, detail?: string } })[] = []
  for (const { mediaId, ...request } of body.items) {
    const item = media.get(mediaId)
    if (!item) {
      items.push({ error: { code: 'MEDIA_NOT_FOUND', detail: 'No such active media item in this project.' } })
      continue
    }
    try {
      items.push(await issueSignedUrl(item, request, options))
    }
    catch (error) {
      const problem = toProblem(error)
      if (!(API_SIGNED_URL_ITEM_ERRORS as readonly string[]).includes(problem.code)) throw error
      items.push({ error: { code: problem.code, ...(problem.options.detail ? { detail: problem.options.detail } : {}) } })
    }
  }
  return { items }
})
