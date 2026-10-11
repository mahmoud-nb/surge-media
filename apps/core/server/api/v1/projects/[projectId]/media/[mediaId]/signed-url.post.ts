import { apiSignedUrlBodySchema } from '#shared/schemas/api'
import { DELEGATED_SIGNED_URL_MAX_TTL } from '#shared/utils/api'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../../../lib/api/context'
import { apiProblem } from '../../../../../../lib/api/problem'
import { findApiMedia } from '../../../../../../lib/api/queries'
import { issueSignedUrl } from '../../../../../../lib/api/signed-urls'
import { mediaBaseUrl } from '../../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'createSignedUrl',
    'tags': ['media'],
    'summary': 'Lien vers un média ou un dérivé',
    'description': 'URL de l\'original (`file`), d\'un préréglage (`preset`), d\'une transformation libre (`transform`, renvoyée sous sa forme canonique) dans le format demandé, ou signature valable pour tout dérivé de la version (`derived` : `query` à ajouter aux URL construites avec `urlTemplate`). Média privé : lien à échéance exacte (60 s à 7 jours ; 1 h au plus avec un jeton délégué). Média public : URL permanente (`expiresAt: null`), signée sans échéance pour une transformation libre quand la politique du projet est `signed` (à échéance avec un jeton délégué). Politique `presets` : transformation libre refusée. Cible `file` d\'une vidéo : aussi `sources`, ses sources de lecture (rendus et original, comme `Media.sources`) signées jusqu\'à la même échéance — à reprendre dans `<source src type>` pour une longue lecture d\'une vidéo privée.',
    'x-scopes': ['media:read'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'INVALID_REQUEST',
      'INVALID_TRANSFORM',
      'CREDENTIAL_NOT_ALLOWED',
      'TRANSFORM_NOT_ALLOWED',
      'MEDIA_NOT_FOUND',
      'PRESET_NOT_FOUND',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/SignedUrlRequest' },
    'responses': { 200: { $ref: '#/components/responses/SignedUrl' } },
    'x-i18n': {
      en: {
        summary: 'Link to a media item or a derivative',
        description: 'URL of the original (`file`), a preset (`preset`), a free transformation (`transform`, returned in its canonical form) in the requested format, or a signature valid for any derivative of the version (`derived`: `query` to append to URLs built from `urlTemplate`). Private media item: link with an exact expiry (60 s to 7 days; 1 h at most with a delegated token). Public media item: permanent URL (`expiresAt: null`), signed without expiry for a free transformation when the project policy is `signed` (with an expiry for a delegated token). `presets` policy: free transformations refused. Target `file` of a video: also `sources`, its playback sources (renditions and original, like `Media.sources`) signed until the same expiry — to use in `<source src type>` for a long playback of a private video.',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/media/:mediaId/signed-url — { target?, preset?, transform?,
 * format?, expiresIn? } (portée media:read ; clé secrète, jeton personnel ou jeton délégué — 1 h au
 * plus ; 403 CREDENTIAL_NOT_ALLOWED pour une clé publique). Lien vers l'original, un préréglage, une
 * transformation libre, ou signature `derived` : lib/api/signed-urls.ts.
 * → { url, query, expiresAt, sources? } (`sources` : cible `file` d'une vidéo, signées jusqu'à la même échéance).
 */
export default defineApiHandler(async (event, principal) => {
  if (principal.type === 'publishable') {
    throw apiProblem('CREDENTIAL_NOT_ALLOWED', 'Signed links are issued to secret keys, personal tokens and delegated tokens only.')
  }
  const { project } = await requireApiProject(event, principal, 'media:read')
  const { expiresIn, ...request } = await readApiBody(event, apiSignedUrlBodySchema)
  if (principal.delegated && expiresIn > DELEGATED_SIGNED_URL_MAX_TTL) {
    throw apiProblem('INVALID_REQUEST', `Delegated tokens can request links valid for ${DELEGATED_SIGNED_URL_MAX_TTL} seconds at most.`)
  }
  const media = await findApiMedia(project.id, getRouterParam(event, 'mediaId') ?? '', false)
  if (!media) throw apiProblem('MEDIA_NOT_FOUND')

  return issueSignedUrl(media, request, {
    base: mediaBaseUrl(event),
    policy: project.transformPolicy,
    delegated: Boolean(principal.delegated),
    expires: Math.floor(Date.now() / 1000) + expiresIn,
  })
})
