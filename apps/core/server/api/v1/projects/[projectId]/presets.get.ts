import { defineApiHandler, requireApiProject } from '../../../../lib/api/context'
import { etagMatches, toApiPreset, weakEtag } from '../../../../lib/api/serializers'
import { projectPresets } from '../../../../lib/transforms/service'

defineRouteMeta({
  openAPI: {
    'operationId': 'listPresets',
    'tags': ['transformations'],
    'summary': 'Préréglages de transformation',
    'description': 'Préréglages utilisables dans les URL de diffusion du projet (`/m/<id>/v<n>/<nom>/<fichier>.<format>`, format donné par l\'extension) : intégrés (`preview`, `full`), du projet, puis globaux non masqués par le projet. Servis quelle que soit la politique du projet (`transformPolicy`). Accessible à toute clé, y compris publique.',
    'x-scopes': ['media:read'],
    'x-credentials': ['publishable', 'secret', 'personal', 'delegated'],
    'x-errors': ['PROJECT_NOT_FOUND', 'PROJECT_ARCHIVED', 'INSUFFICIENT_SCOPE'],
    'responses': {
      200: { $ref: '#/components/responses/PresetList' },
      304: { $ref: '#/components/responses/NotModified' },
    },
    'x-i18n': {
      en: {
        summary: 'Transformation presets',
        description: 'Presets usable in the delivery URLs of the project (`/m/<id>/v<n>/<name>/<file>.<format>`, format given by the extension): built-in (`preview`, `full`), project ones, then global ones not hidden by the project. Served whatever the project policy (`transformPolicy`). Available to every key, publishable included.',
      },
    },
  },
})

/**
 * GET /api/v1/projects/:projectId/presets — préréglages utilisables dans le projet (intégrés, du
 * projet, globaux non masqués), toute clé (`media:read`, y compris publique : les préréglages ne
 * sont pas secrets). ETag sur le contenu → 304. → { items: Preset[] }
 */
export default defineApiHandler(async (event, principal) => {
  const { project } = await requireApiProject(event, principal, 'media:read')
  const items = (await projectPresets(project.id)).map(toApiPreset)
  const etag = weakEtag(['presets', project.id, items])
  setResponseHeader(event, 'ETag', etag)
  if (etagMatches(getRequestHeader(event, 'if-none-match'), etag)) {
    setResponseStatus(event, 304)
    return null
  }
  return { items }
})
