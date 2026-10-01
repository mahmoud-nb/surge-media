import { z } from 'zod'
import {
  apiDelegatedTokenBodySchema,
  apiDelegatedTokenSchema,
  apiDuplicateBodySchema,
  apiFolderCreateSchema,
  apiFolderDeleteQuerySchema,
  apiFolderListSchema,
  apiFolderSchema,
  apiFolderUpdateSchema,
  apiMediaListQuerySchema,
  apiMediaListSchema,
  apiMediaSchema,
  apiMediaUpdateSchema,
  apiMediaUploadFieldsSchema,
  apiMeSchema,
  apiProblemSchema,
  apiProjectListQuerySchema,
  apiProjectListSchema,
  apiProjectSchema,
  apiSignedUrlBodySchema,
  apiSignedUrlSchema,
  apiUploadConstraintsSchema,
  delegatedTokenClaimsSchema,
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
  404: problem('Projet, média ou dossier introuvable ou hors du périmètre de l\'identifiant.'),
  409: problem('Conflit : fichier remplacé entre-temps (VERSION_CONFLICT), nom de dossier déjà pris (FOLDER_NAME_TAKEN), dossier non vide (FOLDER_NOT_EMPTY), trop de dossiers (FOLDER_LIMIT_REACHED).'),
  413: problem('Fichier trop volumineux (FILE_TOO_LARGE).'),
  415: problem('Type de fichier non accepté, détecté d\'après le contenu (UNSUPPORTED_TYPE).'),
  422: problem('Fichier illisible, image trop grande ou d\'un autre genre (UNREADABLE_FILE, DIMENSIONS_TOO_LARGE, KIND_MISMATCH) ; arborescence invalide (FOLDER_DEPTH_EXCEEDED, FOLDER_CYCLE).'),
  429: problem('Trop de requêtes (en-têtes RateLimit, Retry-After).'),
  503: problem('Serveur occupé par d\'autres traitements (SERVER_BUSY, Retry-After).'),
}

/** Réponses d'erreur d'une opération. */
function errors(...statuses: (keyof typeof ERRORS)[]) {
  return Object.fromEntries(statuses.map(status => [status, ERRORS[status]]))
}

/** Corps multipart d'un envoi : le fichier et, pour un nouveau média, ses champs texte. */
function multipartBody(withFields: boolean) {
  const fields = withFields ? (inputSchema(apiMediaUploadFieldsSchema).properties as JsonSchema | undefined) ?? {} : {}
  return {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['file'],
          properties: { file: { type: 'string', format: 'binary', description: 'Fichier (un seul) ; type détecté d\'après le contenu.' }, ...fields },
        },
      },
    },
  }
}

export function buildOpenApiDocument(serverUrl: string) {
  const registry = z.registry<{ id: string }>()
  registry.add(apiMediaSchema, { id: 'Media' })
  registry.add(apiMediaListSchema, { id: 'MediaList' })
  registry.add(apiFolderSchema, { id: 'Folder' })
  registry.add(apiFolderListSchema, { id: 'FolderList' })
  registry.add(apiProjectSchema, { id: 'Project' })
  registry.add(apiProjectListSchema, { id: 'ProjectList' })
  registry.add(apiMeSchema, { id: 'Me' })
  registry.add(apiSignedUrlSchema, { id: 'SignedUrl' })
  registry.add(apiDelegatedTokenSchema, { id: 'DelegatedToken' })
  registry.add(delegatedTokenClaimsSchema, { id: 'DelegatedTokenClaims' })
  registry.add(apiUploadConstraintsSchema, { id: 'UploadConstraints' })
  registry.add(apiProblemSchema, { id: 'Problem' })
  const { schemas } = z.toJSONSchema(registry, { uri: id => `#/components/schemas/${id}`, unrepresentable: 'any' }) as { schemas: Record<string, JsonSchema> }

  const projectId = pathParam('projectId', 'Identifiant du projet.')
  const mediaId = pathParam('mediaId', 'Identifiant du média.')
  const folderId = pathParam('folderId', 'Identifiant du dossier.')
  const notModified = { description: 'Inchangé depuis l\'ETag fourni (If-None-Match).' }
  const jsonBody = (schema: z.ZodType, required = true) => ({ required, content: { 'application/json': { schema: inputSchema(schema) } } })
  const mediaResponse = (description: string) => ({ description, content: json('Media') })

  return {
    openapi: '3.1.0',
    info: {
      title: 'surgeMedia API',
      version: '1.0.0',
      description: [
        'API publique de surgeMedia. Authentification : `Authorization: Bearer <identifiant>` (clé publique `sm_pk_`, clé secrète `sm_sk_`, jeton personnel `sm_pat_`, jeton délégué `sm_dt_`), jamais de cookie.',
        'Le projet est explicite dans chaque URL ; un projet ou un média hors du périmètre de l\'identifiant répond 404.',
        'Les clés secrètes et les jetons personnels sont refusés depuis un navigateur : un composant dans une page utilise une clé publique (lecture des médias publics) ou un jeton délégué de quelques minutes, émis par votre serveur (`POST /projects/{projectId}/delegated-tokens`).',
        'Erreurs au format RFC 9457 (`application/problem+json`, champ `code` stable). Listes paginées par curseur (`nextCursor`).',
      ].join('\n\n'),
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: [{ name: 'Identité' }, { name: 'Projets' }, { name: 'Médias' }, { name: 'Dossiers' }, { name: 'Jetons délégués' }],
    paths: {
      '/me': {
        get: { tags: ['Identité'], summary: 'Identifiant utilisé', operationId: 'getMe', responses: { 200: { description: 'Identifiant', content: json('Me') }, ...errors(401, 429) } },
      },
      '/projects': {
        get: {
          tags: ['Projets'],
          summary: 'Projets accessibles',
          operationId: 'listProjects',
          parameters: queryParameters(apiProjectListQuerySchema),
          responses: { 200: { description: 'Projets actifs accessibles', content: json('ProjectList') }, ...errors(400, 401, 429) },
        },
      },
      '/projects/{projectId}': {
        get: {
          tags: ['Projets'],
          summary: 'Projet',
          operationId: 'getProject',
          parameters: [projectId],
          responses: { 200: { description: 'Projet et portées effectives', content: json('Project') }, ...errors(401, 403, 404, 429) },
        },
      },
      '/projects/{projectId}/delegated-tokens': {
        post: {
          tags: ['Jetons délégués'],
          summary: 'Émettre un jeton délégué',
          description: 'Clé secrète ou jeton personnel. Portées ⊆ celles de l\'émetteur dans ce projet ; 1 à 60 minutes (bornées par l\'échéance de l\'émetteur) ; contraintes d\'envoi facultatives. Révoquer l\'émetteur invalide ses jetons délégués. La charge du jeton (`DelegatedTokenClaims`) est lisible par le composant.',
          operationId: 'createDelegatedToken',
          parameters: [projectId],
          requestBody: jsonBody(apiDelegatedTokenBodySchema),
          responses: { 201: { description: 'Jeton délégué', content: json('DelegatedToken') }, ...errors(400, 401, 403, 404, 429) },
        },
      },
      '/projects/{projectId}/folders': {
        get: {
          tags: ['Dossiers'],
          summary: 'Arborescence des dossiers',
          description: 'Portée `media:read` ; pas avec une clé publique. Tous les dossiers du projet, à plat (arbre par `parentId`). ETag → 304.',
          operationId: 'listFolders',
          parameters: [projectId],
          responses: { 200: { description: 'Dossiers', content: json('FolderList') }, 304: notModified, ...errors(401, 403, 404, 429) },
        },
        post: {
          tags: ['Dossiers'],
          summary: 'Créer un dossier',
          description: 'Portée `media:write`. Nom unique parmi les dossiers frères (sans tenir compte de la casse), 8 niveaux au plus.',
          operationId: 'createFolder',
          parameters: [projectId],
          requestBody: jsonBody(apiFolderCreateSchema),
          responses: { 201: { description: 'Dossier créé', content: json('Folder') }, ...errors(400, 401, 403, 404, 409, 422, 429) },
        },
      },
      '/projects/{projectId}/folders/{folderId}': {
        patch: {
          tags: ['Dossiers'],
          summary: 'Renommer ou déplacer un dossier',
          description: 'Portée `media:write`. `parentId: null` : à la racine. Jamais dans lui-même ou un de ses sous-dossiers.',
          operationId: 'updateFolder',
          parameters: [projectId, folderId],
          requestBody: jsonBody(apiFolderUpdateSchema),
          responses: { 200: { description: 'Dossier modifié', content: json('Folder') }, ...errors(400, 401, 403, 404, 409, 422, 429) },
        },
        delete: {
          tags: ['Dossiers'],
          summary: 'Supprimer un dossier',
          description: 'Portée `media:write`. Dossier vide, ou `content=parent` pour remonter d\'abord son contenu dans le dossier parent.',
          operationId: 'deleteFolder',
          parameters: [projectId, folderId, ...queryParameters(apiFolderDeleteQuerySchema)],
          responses: { 204: { description: 'Dossier supprimé' }, ...errors(400, 401, 403, 404, 409, 429) },
        },
      },
      '/projects/{projectId}/media': {
        get: {
          tags: ['Médias'],
          summary: 'Liste et recherche des médias',
          description: 'Portée `media:read`. Clé publique : médias publics, liste seulement si le projet l\'autorise (sinon `ids`).',
          operationId: 'listMedia',
          parameters: [projectId, ...queryParameters(apiMediaListQuerySchema)],
          responses: { 200: { description: 'Page de médias', content: json('MediaList') }, 304: notModified, ...errors(400, 401, 403, 404, 429) },
        },
        post: {
          tags: ['Médias'],
          summary: 'Envoyer un média',
          description: 'Portée `media:upload` (clé secrète, jeton personnel, jeton délégué). Un fichier par requête ; jeton délégué : nombre de fichiers, taille, types et visibilité selon ses contraintes (`UPLOAD_LIMIT_REACHED`). En-tête `Location` : URL du média dans l\'API.',
          operationId: 'uploadMedia',
          parameters: [projectId],
          requestBody: multipartBody(true),
          responses: { 201: mediaResponse('Média créé'), ...errors(400, 401, 403, 404, 413, 415, 422, 429, 503) },
        },
      },
      '/projects/{projectId}/media/{mediaId}': {
        get: {
          tags: ['Médias'],
          summary: 'Média',
          operationId: 'getMedia',
          parameters: [projectId, mediaId],
          responses: { 200: mediaResponse('Média'), 304: notModified, ...errors(401, 403, 404, 429) },
        },
        patch: {
          tags: ['Médias'],
          summary: 'Modifier un média',
          description: 'Portée `media:write`. Champs absents inchangés ; `null` ou texte vide efface le titre ou le texte alternatif.',
          operationId: 'updateMedia',
          parameters: [projectId, mediaId],
          requestBody: jsonBody(apiMediaUpdateSchema),
          responses: { 200: mediaResponse('Média modifié'), ...errors(400, 401, 403, 404, 429) },
        },
        delete: {
          tags: ['Médias'],
          summary: 'Mettre un média à la corbeille',
          description: 'Portée `media:delete`. Le média n\'est plus diffusé ; restauration ou suppression définitive depuis l\'administration.',
          operationId: 'deleteMedia',
          parameters: [projectId, mediaId],
          responses: { 204: { description: 'Média mis à la corbeille' }, ...errors(401, 403, 404, 429) },
        },
      },
      '/projects/{projectId}/media/{mediaId}/file': {
        put: {
          tags: ['Médias'],
          summary: 'Remplacer le fichier',
          description: 'Portée `media:write`. Identifiant, titre, texte alternatif et visibilité conservés ; version incrémentée (nouvelles URL).',
          operationId: 'replaceMediaFile',
          parameters: [projectId, mediaId],
          requestBody: multipartBody(false),
          responses: { 200: mediaResponse('Média avec son nouveau fichier'), ...errors(400, 401, 403, 404, 409, 413, 415, 422, 429, 503) },
        },
      },
      '/projects/{projectId}/media/{mediaId}/duplicate': {
        post: {
          tags: ['Médias'],
          summary: 'Dupliquer un média',
          description: 'Copie indépendante (nouvel identifiant, fichier copié). Portées `media:read` ici et `media:upload` dans la cible ; clé secrète (son projet) ou jeton personnel (autre projet, bibliothèque).',
          operationId: 'duplicateMedia',
          parameters: [projectId, mediaId],
          requestBody: jsonBody(apiDuplicateBodySchema, false),
          responses: { 201: mediaResponse('Copie créée'), ...errors(400, 401, 403, 404, 429) },
        },
      },
      '/projects/{projectId}/media/{mediaId}/signed-url': {
        post: {
          tags: ['Médias'],
          summary: 'Lien temporaire vers un média',
          description: 'Portée `media:read` ; clé secrète, jeton personnel ou jeton délégué (1 h au plus).',
          operationId: 'createSignedUrl',
          parameters: [projectId, mediaId],
          requestBody: jsonBody(apiSignedUrlBodySchema, false),
          responses: { 200: { description: 'Lien signé', content: json('SignedUrl') }, ...errors(400, 401, 403, 404, 429) },
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
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Clé publique (sm_pk_), clé secrète (sm_sk_), jeton personnel (sm_pat_) ou jeton délégué (sm_dt_).' },
      },
      schemas: Object.fromEntries(Object.entries(schemas).map(([id, schema]) => [id, clean(schema)])),
    },
  }
}
