import { z } from 'zod'
import {
  apiMediaListQuerySchema,
  apiMediaListSchema,
  apiMediaSchema,
  apiMeSchema,
  apiProblemSchema,
  apiProjectListQuerySchema,
  apiProjectListSchema,
  apiProjectSchema,
  apiSignedUrlBodySchema,
  apiSignedUrlSchema,
} from '#shared/schemas/api'
import { API_ERRORS } from '#shared/utils/api'

/**
 * Spécification OpenAPI 3.1 de l'API v1, générée depuis les schémas zod partagés (une seule source
 * pour la validation, les réponses et la documentation). Servie par GET /api/v1/openapi.json.
 */

type JsonSchema = Record<string, unknown>

/** Retire les mots-clés propres aux documents JSON Schema autonomes. */
function clean(schema: JsonSchema): JsonSchema {
  const { $schema: _schema, $id: _id, ...rest } = schema
  return rest
}

function inputSchema(schema: z.ZodType): JsonSchema {
  return clean(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema)
}

function queryParameters(schema: z.ZodObject) {
  return Object.entries(schema.shape).map(([name, field]) => {
    const json = inputSchema(field as z.ZodType)
    const { description, ...rest } = json
    return { name, in: 'query', required: false, ...(description ? { description } : {}), schema: rest }
  })
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` })
const json = (id: string) => ({ 'application/json': { schema: ref(id) } })
const problem = (description: string) => ({ description, content: { 'application/problem+json': { schema: ref('Problem') } } })
const pathParam = (name: string, description: string) => ({ name, in: 'path', required: true, description, schema: { type: 'string' } })

const ERRORS = {
  400: problem('Paramètres invalides (INVALID_REQUEST, INVALID_CURSOR).'),
  401: problem('Identifiant absent, invalide, expiré ou révoqué (TOKEN_*).'),
  403: problem('Portée insuffisante, origine refusée, secret utilisé depuis un navigateur, projet archivé…'),
  404: problem('Projet ou média introuvable ou hors du périmètre de l\'identifiant.'),
  429: problem('Trop de requêtes (en-têtes RateLimit, Retry-After).'),
}

export function buildOpenApiDocument(serverUrl: string) {
  const registry = z.registry<{ id: string }>()
  registry.add(apiMediaSchema, { id: 'Media' })
  registry.add(apiMediaListSchema, { id: 'MediaList' })
  registry.add(apiProjectSchema, { id: 'Project' })
  registry.add(apiProjectListSchema, { id: 'ProjectList' })
  registry.add(apiMeSchema, { id: 'Me' })
  registry.add(apiSignedUrlSchema, { id: 'SignedUrl' })
  registry.add(apiProblemSchema, { id: 'Problem' })
  const { schemas } = z.toJSONSchema(registry, { uri: id => `#/components/schemas/${id}`, unrepresentable: 'any' }) as { schemas: Record<string, JsonSchema> }

  const projectId = pathParam('projectId', 'Identifiant du projet.')
  const mediaId = pathParam('mediaId', 'Identifiant du média.')
  const notModified = { description: 'Inchangé depuis l\'ETag fourni (If-None-Match).' }

  return {
    openapi: '3.1.0',
    info: {
      title: 'surgeMedia API',
      version: '1.0.0',
      description: [
        'API publique de surgeMedia. Authentification : `Authorization: Bearer <identifiant>` (clé publique `sm_pk_`, clé secrète `sm_sk_`, jeton personnel `sm_pat_`), jamais de cookie.',
        'Le projet est explicite dans chaque URL ; un projet ou un média hors du périmètre de l\'identifiant répond 404.',
        'Erreurs au format RFC 9457 (`application/problem+json`, champ `code` stable). Listes paginées par curseur (`nextCursor`).',
      ].join('\n\n'),
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: 'Identité' }, { name: 'Projets' }, { name: 'Médias' }],
    paths: {
      '/me': {
        get: { tags: ['Identité'], summary: 'Identifiant utilisé', operationId: 'getMe', responses: { 200: { description: 'Identifiant', content: json('Me') }, 401: ERRORS[401], 429: ERRORS[429] } },
      },
      '/projects': {
        get: {
          tags: ['Projets'],
          summary: 'Projets accessibles',
          operationId: 'listProjects',
          parameters: queryParameters(apiProjectListQuerySchema),
          responses: { 200: { description: 'Projets actifs accessibles', content: json('ProjectList') }, 400: ERRORS[400], 401: ERRORS[401], 429: ERRORS[429] },
        },
      },
      '/projects/{projectId}': {
        get: {
          tags: ['Projets'],
          summary: 'Projet',
          operationId: 'getProject',
          parameters: [projectId],
          responses: { 200: { description: 'Projet et portées effectives', content: json('Project') }, 401: ERRORS[401], 403: ERRORS[403], 404: ERRORS[404], 429: ERRORS[429] },
        },
      },
      '/projects/{projectId}/media': {
        get: {
          tags: ['Médias'],
          summary: 'Liste et recherche des médias',
          description: 'Portée `media:read`. Clé publique : médias publics, liste seulement si le projet l\'autorise (sinon `ids`).',
          operationId: 'listMedia',
          parameters: [projectId, ...queryParameters(apiMediaListQuerySchema)],
          responses: { 200: { description: 'Page de médias', content: json('MediaList') }, 304: notModified, 400: ERRORS[400], 401: ERRORS[401], 403: ERRORS[403], 404: ERRORS[404], 429: ERRORS[429] },
        },
      },
      '/projects/{projectId}/media/{mediaId}': {
        get: {
          tags: ['Médias'],
          summary: 'Média',
          operationId: 'getMedia',
          parameters: [projectId, mediaId],
          responses: { 200: { description: 'Média', content: json('Media') }, 304: notModified, 401: ERRORS[401], 403: ERRORS[403], 404: ERRORS[404], 429: ERRORS[429] },
        },
      },
      '/projects/{projectId}/media/{mediaId}/signed-url': {
        post: {
          tags: ['Médias'],
          summary: 'Lien temporaire vers un média',
          description: 'Portée `media:read`, clé secrète ou jeton personnel.',
          operationId: 'createSignedUrl',
          parameters: [projectId, mediaId],
          requestBody: { required: false, content: { 'application/json': { schema: inputSchema(apiSignedUrlBodySchema) } } },
          responses: { 200: { description: 'Lien signé', content: json('SignedUrl') }, 400: ERRORS[400], 401: ERRORS[401], 403: ERRORS[403], 404: ERRORS[404], 429: ERRORS[429] },
        },
      },
      '/errors': {
        get: {
          tags: ['Identité'],
          summary: 'Catalogue des codes d\'erreur',
          operationId: 'listErrors',
          security: [],
          responses: { 200: { description: `Codes : ${Object.keys(API_ERRORS).join(', ')}.` } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Clé publique (sm_pk_), clé secrète (sm_sk_) ou jeton personnel (sm_pat_).' },
      },
      schemas: Object.fromEntries(Object.entries(schemas).map(([id, schema]) => [id, clean(schema)])),
    },
  }
}
