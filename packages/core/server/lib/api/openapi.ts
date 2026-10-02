import { z } from 'zod'
import {
  apiDelegatedTokenBodySchema,
  apiDelegatedTokenSchema,
  apiDuplicateBodySchema,
  apiErrorCatalogSchema,
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
  apiPresetListSchema,
  apiPresetSchema,
  apiOpenApiQuerySchema,
  apiProblemSchema,
  apiProjectListQuerySchema,
  apiProjectListSchema,
  apiProjectSchema,
  apiSignedUrlBodySchema,
  apiSignedUrlErrorSchema,
  apiSignedUrlListSchema,
  apiSignedUrlSchema,
  apiSignedUrlsBodySchema,
  apiUploadConstraintsSchema,
  delegatedTokenClaimsSchema,
} from '#shared/schemas/api'
import { API_ERRORS, type ApiCredentialType, type ApiErrorCode, type OpenApiLang } from '#shared/utils/api'

/**
 * Spécification OpenAPI 3.1 de l'API v1, générée depuis le code (GET /api/v1/openapi.json) :
 *   - chaque route de server/api/v1 décrit son opération avec `defineRouteMeta({ openAPI })`, lu
 *     par Nitro à la compilation (`nitro.experimental.openAPI`) : la méthode et le chemin viennent
 *     du nom du fichier, le reste de ces métadonnées. Une nouvelle route apparaît d'elle-même ;
 *     sans métadonnées, elle est listée a minima et signalée en développement ;
 *   - les schémas (réponses, corps, paramètres de requête) viennent des schémas zod partagés
 *     (shared/schemas/api.ts), qui valident aussi les requêtes : une seule source ;
 *   - ce module assemble le document (paramètres de chemin, erreurs par code avec exemples,
 *     portées et identifiants admis, en-têtes) puis le traduit.
 *
 * Extensions reconnues dans `openAPI` (retirées du document servi) :
 *   x-scopes       portée(s) exigée(s) ;
 *   x-credentials  types d'identifiants admis (publishable, secret, personal, delegated) ;
 *   x-query        paramètres de requête : nom d'un schéma de QUERY_SCHEMAS ;
 *   x-errors       codes d'erreur propres à l'opération (catalogue API_ERRORS, statut déduit) ; les
 *                  erreurs d'authentification et de débit sont ajoutées d'office ;
 *   x-i18n         traductions { en: { summary, description } } (le français est la référence).
 * `security: []` marque une route publique. Les métadonnées ne contiennent que des littéraux
 * (ni variables, ni gabarits `${…}`, ni appels) : Nitro les lit sans exécuter le fichier.
 */

type Json = Record<string, unknown>

/** Route Nitro et ses métadonnées (module virtuel `#nitro-internal-virtual/server-handlers-meta`). */
export interface RouteMetaEntry {
  route?: string
  method?: string
  meta?: { openAPI?: object } | null
}

export interface OpenApiOptions {
  /** URL absolue de l'API v1 (serveur du document, liens du catalogue d'erreurs). */
  serverUrl: string
  lang: OpenApiLang
}

const API_PREFIX = '/api/v1'
const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const methodRank = (method: string) => (METHODS.includes(method) ? METHODS.indexOf(method) : METHODS.length)

// ─── Textes ──────────────────────────────────────────────────────────────────

/** Champs en français (référence) et leur traduction anglaise (`x-i18n`, appliquée par `localize`). */
function texts(fr: Record<string, string>, en: Record<string, string>): Json {
  return { ...fr, 'x-i18n': { en } }
}

/** Description bilingue. */
function t(fr: string, en: string): Json {
  return texts({ description: fr }, { description: en })
}

const CREDENTIAL_LABELS: Record<ApiCredentialType, [string, string]> = {
  publishable: ['clé publique', 'publishable key'],
  secret: ['clé secrète', 'secret key'],
  personal: ['jeton personnel', 'personal token'],
  delegated: ['jeton délégué', 'delegated token'],
}

const STATUS_LABELS: Record<number, [string, string]> = {
  400: ['Requête invalide', 'Invalid request'],
  401: ['Identifiant absent ou refusé', 'Missing or rejected credential'],
  403: ['Accès refusé', 'Access denied'],
  404: ['Introuvable', 'Not found'],
  405: ['Méthode non permise', 'Method not allowed'],
  409: ['Conflit', 'Conflict'],
  413: ['Fichier trop volumineux', 'Payload too large'],
  415: ['Type de fichier non accepté', 'Unsupported media type'],
  422: ['Contenu non traitable', 'Unprocessable content'],
  429: ['Trop de requêtes', 'Too many requests'],
  500: ['Erreur interne', 'Internal error'],
  503: ['Serveur occupé', 'Server busy'],
}

const TAGS = [
  texts({ 'name': 'identity', 'x-displayName': 'Identité', 'description': 'Identifiant utilisé et ses droits.' }, { 'x-displayName': 'Identity', 'description': 'The credential in use and its rights.' }),
  texts({ 'name': 'projects', 'x-displayName': 'Projets', 'description': 'Projets accessibles à l\'identifiant.' }, { 'x-displayName': 'Projects', 'description': 'Projects the credential can access.' }),
  texts({ 'name': 'media', 'x-displayName': 'Médias', 'description': 'Liste, recherche, envoi, modification et diffusion des médias d\'un projet.' }, { 'x-displayName': 'Media', 'description': 'List, search, upload, update and deliver the media of a project.' }),
  texts({ 'name': 'folders', 'x-displayName': 'Dossiers', 'description': 'Arborescence des dossiers d\'un projet.' }, { 'x-displayName': 'Folders', 'description': 'Folder tree of a project.' }),
  texts({ 'name': 'transformations', 'x-displayName': 'Transformations', 'description': 'Préréglages et politique des transformations d\'images par URL de diffusion.' }, { 'x-displayName': 'Transformations', 'description': 'Presets and policy of image transformations through delivery URLs.' }),
  texts({ 'name': 'delegated-tokens', 'x-displayName': 'Jetons délégués', 'description': 'Jetons de quelques minutes pour les composants dans le navigateur, émis par votre serveur.' }, { 'x-displayName': 'Delegated tokens', 'description': 'Short-lived tokens for in-browser components, issued by your server.' }),
  texts({ 'name': 'reference', 'x-displayName': 'Référence', 'description': 'Documents publics : catalogue des erreurs et cette spécification.' }, { 'x-displayName': 'Reference', 'description': 'Public documents: error catalog and this specification.' }),
]

const INFO_FR = `API publique de surgeMedia : médias, dossiers et projets, pour vos applications.

## Authentification
Chaque requête porte un identifiant dans l'en-tête \`Authorization: Bearer <identifiant>\` — jamais de cookie, jamais dans l'URL :

| Identifiant | Préfixe | Usage |
| --- | --- | --- |
| Clé publique | \`sm_pk_\` | Navigateur : lecture des médias publics, depuis les origines autorisées du projet. |
| Clé secrète | \`sm_sk_\` | Votre serveur : un projet, portées choisies. |
| Jeton personnel | \`sm_pat_\` | Scripts et outils : vos projets, avec vos droits actuels. |
| Jeton délégué | \`sm_dt_\` | Navigateur : quelques minutes, un projet, portées et contraintes fixées par votre serveur. |

Les clés secrètes et les jetons personnels sont **refusés depuis un navigateur** (\`SECRET_IN_BROWSER\`) : un composant dans une page utilise une clé publique, ou un jeton délégué demandé par votre serveur (\`POST /projects/{projectId}/delegated-tokens\`).

## Conventions
- Le projet est explicite dans chaque URL ; un projet ou un média hors du périmètre de l'identifiant répond \`404\`.
- Erreurs au format RFC 9457 (\`application/problem+json\`) avec un \`code\` stable : voir \`GET /errors\`.
- Listes paginées par curseur (\`nextCursor\`) ; \`ETag\` et \`If-None-Match\` → \`304\` sur les lectures.
- Débit limité par identifiant : en-têtes \`RateLimit\` et \`RateLimit-Policy\`, \`429\` avec \`Retry-After\` au-delà.
- Chaque réponse porte \`X-Request-Id\` (aussi \`requestId\` des erreurs).

## Diffusion des médias
Les champs \`url\` et \`previewUrl\` sont des adresses absolues, utilisables telles quelles (\`<img src>\`) : permanentes et mises en cache pour un média public, signées et temporaires pour un média privé. Un lien signé à la demande s'obtient avec \`POST …/signed-url\` (ou \`POST …/signed-urls\` pour tout un lot).

## Transformations d'images
Chaque image se décline par son URL de diffusion, dont \`urlTemplate\` donne le gabarit :

\`/m/<id>/v<version>/<transformation>/<nom>.<format>\`

- \`<format>\` : \`jpg\`, \`png\`, \`webp\` ou \`avif\` (formats activés sur le serveur), toujours donné par l'extension.
- \`<transformation>\` : un **préréglage** (\`preview\`, \`full\` = image entière réencodée, ceux de \`GET /projects/{projectId}/presets\`) ou des **paramètres** \`clé_valeur\` séparés par des virgules (\`w_800,h_450,q_75\`) :

| Paramètre | Valeurs | Effet |
| --- | --- | --- |
| \`w\`, \`h\` | 1 à 4096 | dimensions ; jamais d'agrandissement (réduites en gardant le rapport demandé) |
| \`fit\` | \`cover\` (défaut), \`contain\`, \`fill\`, \`inside\`, \`outside\` | ajustement à \`w\` × \`h\` |
| \`g\` | \`focal\` (défaut : point d'intérêt \`focalPoint\`, sinon centre), \`center\`, \`north\`, \`northeast\`… \`northwest\`, \`attention\`, \`entropy\` | ancrage du recadrage \`cover\` |
| \`q\` | 1 à 100 | qualité (défaut : 80 en JPEG et WebP, 50 en AVIF ; PNG sans perte) |
| \`dpr\` | 1 à 3, par pas de 0,5 | densité de pixels : multiplie \`w\` et \`h\` |
| \`r\` | \`90\`, \`180\`, \`270\` | rotation horaire |
| \`flip\` | \`h\`, \`v\`, \`hv\` | miroir |
| \`crop\` | \`x-y-largeur-hauteur\` | zone extraite, en pixels de l'image tournée |
| \`bg\` | \`rrggbb\` | fond de \`contain\` et de la transparence convertie en JPEG |

Une URL non canonique (ordre des paramètres, valeurs par défaut, \`dpr\`, \`jpeg\`) est redirigée (\`301\`) vers sa forme canonique ; une URL valable est mise en cache sans limite (une semaine, puis revalidée, pour un préréglage du projet ou de l'installation, modifiable). Selon la politique du projet (\`transformPolicy\`), les paramètres libres sont acceptés (\`open\`), seulement signés (\`signed\` : \`POST …/signed-url\`, ou signature de \`urlTemplate\` pour un média privé) ou refusés (\`presets\`) ; les préréglages sont toujours servis. Les erreurs de \`/m/\` sont en JSON avec un code dans \`data.code\` : \`INVALID_TRANSFORM\` (400), \`TRANSFORM_NOT_ALLOWED\`, \`MEDIA_FORBIDDEN\`, \`SIGNATURE_INVALID\`, \`SIGNATURE_EXPIRED\` (403), \`TRANSFORM_QUOTA\` (429 : 50 dérivés libres par version, débit de nouvelles générations par adresse IP), \`SERVER_BUSY\` (503).`

const INFO_EN = `Public API of surgeMedia: media, folders and projects, for your applications.

## Authentication
Every request carries a credential in the \`Authorization: Bearer <credential>\` header — never a cookie, never in the URL:

| Credential | Prefix | Use |
| --- | --- | --- |
| Publishable key | \`sm_pk_\` | Browser: read public media, from the allowed origins of the project. |
| Secret key | \`sm_sk_\` | Your server: one project, chosen scopes. |
| Personal token | \`sm_pat_\` | Scripts and tools: your projects, with your current rights. |
| Delegated token | \`sm_dt_\` | Browser: a few minutes, one project, scopes and constraints set by your server. |

Secret keys and personal tokens are **rejected from a browser** (\`SECRET_IN_BROWSER\`): an in-page component uses a publishable key, or a delegated token requested by your server (\`POST /projects/{projectId}/delegated-tokens\`).

## Conventions
- The project is explicit in every URL; a project or media item outside the reach of the credential returns \`404\`.
- Errors use RFC 9457 (\`application/problem+json\`) with a stable \`code\`: see \`GET /errors\`.
- Lists are paginated with a cursor (\`nextCursor\`); \`ETag\` and \`If-None-Match\` → \`304\` on reads.
- Rate limited per credential: \`RateLimit\` and \`RateLimit-Policy\` headers, \`429\` with \`Retry-After\` beyond.
- Every response carries \`X-Request-Id\` (also the \`requestId\` of errors).

## Media delivery
The \`url\` and \`previewUrl\` fields are absolute addresses, usable as is (\`<img src>\`): permanent and cached for a public media item, signed and temporary for a private one. An on-demand signed link comes from \`POST …/signed-url\` (or \`POST …/signed-urls\` for a whole batch).

## Image transformations
Every image can be derived through its delivery URL, whose template is given by \`urlTemplate\`:

\`/m/<id>/v<version>/<transformation>/<name>.<format>\`

- \`<format>\`: \`jpg\`, \`png\`, \`webp\` or \`avif\` (formats enabled on the server), always given by the extension.
- \`<transformation>\`: a **preset** (\`preview\`, \`full\` = whole image re-encoded, those of \`GET /projects/{projectId}/presets\`) or comma-separated \`key_value\` **parameters** (\`w_800,h_450,q_75\`):

| Parameter | Values | Effect |
| --- | --- | --- |
| \`w\`, \`h\` | 1 to 4096 | dimensions; never enlarged (reduced while keeping the requested ratio) |
| \`fit\` | \`cover\` (default), \`contain\`, \`fill\`, \`inside\`, \`outside\` | fit into \`w\` × \`h\` |
| \`g\` | \`focal\` (default: focal point \`focalPoint\`, otherwise center), \`center\`, \`north\`, \`northeast\`… \`northwest\`, \`attention\`, \`entropy\` | anchor of the \`cover\` crop |
| \`q\` | 1 to 100 | quality (default: 80 for JPEG and WebP, 50 for AVIF; lossless PNG) |
| \`dpr\` | 1 to 3, in steps of 0.5 | pixel density: multiplies \`w\` and \`h\` |
| \`r\` | \`90\`, \`180\`, \`270\` | clockwise rotation |
| \`flip\` | \`h\`, \`v\`, \`hv\` | mirror |
| \`crop\` | \`x-y-width-height\` | extracted area, in pixels of the rotated image |
| \`bg\` | \`rrggbb\` | background of \`contain\` and of transparency converted to JPEG |

A non-canonical URL (parameter order, default values, \`dpr\`, \`jpeg\`) is redirected (\`301\`) to its canonical form; a valid URL is cached without limit (one week, then revalidated, for a project or installation preset, which can change). Depending on the project policy (\`transformPolicy\`), free parameters are accepted (\`open\`), signed only (\`signed\`: \`POST …/signed-url\`, or the signature of \`urlTemplate\` for a private media item) or refused (\`presets\`); presets are always served. Errors of \`/m/\` are JSON with a code in \`data.code\`: \`INVALID_TRANSFORM\` (400), \`TRANSFORM_NOT_ALLOWED\`, \`MEDIA_FORBIDDEN\`, \`SIGNATURE_INVALID\`, \`SIGNATURE_EXPIRED\` (403), \`TRANSFORM_QUOTA\` (429: 50 free derivatives per version, rate of new generations per IP address), \`SERVER_BUSY\` (503).`

// ─── Schémas zod → JSON Schema ───────────────────────────────────────────────

/**
 * Retire les mots-clés propres aux documents JSON Schema autonomes, et les bornes « entier sûr »
 * que zod ajoute à tout `.int()` (±2⁵³−1) : sans intérêt pour le lecteur, et prises pour exemple
 * par les outils (« size: -9007199254740991 »).
 */
function clean(schema: Json): Json {
  const { $schema: _schema, $id: _id, ...rest } = schema
  return stripSafeIntegerBounds(rest) as Json
}

function stripSafeIntegerBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSafeIntegerBounds)
  if (!node || typeof node !== 'object') return node
  return Object.fromEntries(Object.entries(node)
    .filter(([key, value]) => !(key === 'minimum' && value === Number.MIN_SAFE_INTEGER) && !(key === 'maximum' && value === Number.MAX_SAFE_INTEGER))
    .map(([key, value]) => [key, stripSafeIntegerBounds(value)]))
}

function inputSchema(schema: z.ZodType): Json {
  return clean(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Json)
}

/** Paramètres de requête acceptés par les routes (extension `x-query`). */
const QUERY_SCHEMAS: Record<string, z.ZodObject> = {
  MediaListQuery: apiMediaListQuerySchema,
  ProjectListQuery: apiProjectListQuerySchema,
  FolderDeleteQuery: apiFolderDeleteQuerySchema,
  OpenApiQuery: apiOpenApiQuerySchema,
}

function queryParameters(schema: z.ZodObject): Json[] {
  const json = inputSchema(schema) as { properties?: Record<string, Json>, required?: string[] }
  return Object.entries(json.properties ?? {}).map(([name, property]) => {
    // Description (et sa traduction) au niveau du paramètre, comme l'affichent les outils.
    const { 'description': description, 'x-i18n': i18n, ...rest } = property
    return {
      name,
      in: 'query',
      required: json.required?.includes(name) ?? false,
      ...(description ? { description } : {}),
      ...(i18n ? { 'x-i18n': i18n } : {}),
      schema: rest,
    }
  })
}

const ref = (kind: string, id: string) => ({ $ref: `#/components/${kind}/${id}` })
const jsonContent = (schema: Json) => ({ 'application/json': { schema } })

function jsonBody(schema: z.ZodType, required: boolean, description: Json): Json {
  return { required, ...description, content: jsonContent(inputSchema(schema)) }
}

/** Corps multipart d'un envoi : le fichier et, pour un nouveau média, ses champs texte. */
function multipartBody(withFields: boolean, description: Json): Json {
  const fields = withFields ? (inputSchema(apiMediaUploadFieldsSchema).properties as Json | undefined) ?? {} : {}
  return {
    required: true,
    ...description,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', format: 'binary', ...t('Fichier (un seul) ; type détecté d\'après son contenu.', 'File (only one); type detected from its contents.') },
            ...fields,
          },
        },
      },
    },
  }
}

// ─── Composants ──────────────────────────────────────────────────────────────

function buildComponents() {
  const registry = z.registry<{ id: string }>()
  registry.add(apiMediaSchema, { id: 'Media' })
  registry.add(apiMediaListSchema, { id: 'MediaList' })
  registry.add(apiFolderSchema, { id: 'Folder' })
  registry.add(apiFolderListSchema, { id: 'FolderList' })
  registry.add(apiProjectSchema, { id: 'Project' })
  registry.add(apiProjectListSchema, { id: 'ProjectList' })
  registry.add(apiMeSchema, { id: 'Me' })
  registry.add(apiPresetSchema, { id: 'Preset' })
  registry.add(apiPresetListSchema, { id: 'PresetList' })
  registry.add(apiSignedUrlSchema, { id: 'SignedUrl' })
  registry.add(apiSignedUrlErrorSchema, { id: 'SignedUrlError' })
  registry.add(apiSignedUrlListSchema, { id: 'SignedUrlList' })
  registry.add(apiDelegatedTokenSchema, { id: 'DelegatedToken' })
  registry.add(delegatedTokenClaimsSchema, { id: 'DelegatedTokenClaims' })
  registry.add(apiUploadConstraintsSchema, { id: 'UploadConstraints' })
  registry.add(apiErrorCatalogSchema, { id: 'ErrorCatalog' })
  registry.add(apiProblemSchema, { id: 'Problem' })
  const { schemas } = z.toJSONSchema(registry, { uri: id => `#/components/schemas/${id}`, unrepresentable: 'any' }) as { schemas: Record<string, Json> }

  const json = (schema: string, description: Json, headers?: Json) => ({
    ...description,
    ...(headers ? { headers } : {}),
    content: jsonContent(ref('schemas', schema)),
  })
  const etag = { ETag: ref('headers', 'ETag') }

  return {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        ...t(
          'Clé publique (`sm_pk_`), clé secrète (`sm_sk_`), jeton personnel (`sm_pat_`) ou jeton délégué (`sm_dt_`), dans l\'en-tête `Authorization: Bearer …`.',
          'Publishable key (`sm_pk_`), secret key (`sm_sk_`), personal token (`sm_pat_`) or delegated token (`sm_dt_`), in the `Authorization: Bearer …` header.',
        ),
      },
    },
    schemas: Object.fromEntries(Object.entries(schemas).map(([id, schema]) => [id, clean(schema)])),
    parameters: {
      projectId: { name: 'projectId', in: 'path', required: true, ...t('Identifiant du projet.', 'Project id.'), schema: { type: 'string' } },
      mediaId: { name: 'mediaId', in: 'path', required: true, ...t('Identifiant du média.', 'Media item id.'), schema: { type: 'string' } },
      folderId: { name: 'folderId', in: 'path', required: true, ...t('Identifiant du dossier.', 'Folder id.'), schema: { type: 'string' } },
    },
    headers: {
      ETag: { ...t('Étiquette de version (faible), à renvoyer dans `If-None-Match`.', 'Weak version tag, to send back in `If-None-Match`.'), schema: { type: 'string' } },
      Location: { ...t('URL du média dans l\'API.', 'URL of the media item in the API.'), schema: { type: 'string', format: 'uri' } },
      RetryAfter: { ...t('Secondes à attendre avant de réessayer.', 'Seconds to wait before retrying.'), schema: { type: 'integer' } },
      WWWAuthenticate: { ...t('Schéma attendu (`Bearer`, RFC 6750).', 'Expected scheme (`Bearer`, RFC 6750).'), schema: { type: 'string' } },
    },
    requestBodies: {
      MediaUpload: multipartBody(true, t('Fichier et champs du nouveau média.', 'File and fields of the new media item.')),
      FileReplace: multipartBody(false, t('Nouveau fichier.', 'New file.')),
      MediaUpdate: jsonBody(apiMediaUpdateSchema, true, t('Champs à modifier.', 'Fields to update.')),
      MediaDuplicate: jsonBody(apiDuplicateBodySchema, false, t('Destination de la copie (facultative).', 'Destination of the copy (optional).')),
      SignedUrlRequest: jsonBody(apiSignedUrlBodySchema, false, t('Cible, format et durée du lien (facultatifs : original, 1 h).', 'Target, format and lifetime of the link (optional: original, 1 h).')),
      SignedUrlsRequest: jsonBody(apiSignedUrlsBodySchema, true, t('Liens demandés et durée commune.', 'Requested links and their common lifetime.')),
      DelegatedTokenRequest: jsonBody(apiDelegatedTokenBodySchema, true, t('Portées, durée et contraintes du jeton.', 'Scopes, lifetime and constraints of the token.')),
      FolderCreate: jsonBody(apiFolderCreateSchema, true, t('Nom et parent du dossier.', 'Name and parent of the folder.')),
      FolderUpdate: jsonBody(apiFolderUpdateSchema, true, t('Nouveau nom et/ou nouveau parent.', 'New name and/or new parent.')),
    },
    responses: {
      Me: json('Me', t('Identifiant utilisé.', 'Credential in use.')),
      ProjectList: json('ProjectList', t('Projets actifs accessibles.', 'Accessible active projects.')),
      Project: json('Project', t('Projet et portées effectives de l\'identifiant.', 'Project and effective scopes of the credential.')),
      MediaList: json('MediaList', t('Page de médias.', 'Page of media.'), etag),
      Media: json('Media', t('Média.', 'Media item.'), etag),
      MediaCreated: json('Media', t('Média créé.', 'Media item created.'), { ...etag, Location: ref('headers', 'Location') }),
      MediaCopy: json('Media', t('Copie créée (en-tête `Location` si elle est dans un projet).', 'Copy created (`Location` header when it is in a project).'), { ...etag, Location: ref('headers', 'Location') }),
      FolderList: json('FolderList', t('Dossiers du projet.', 'Folders of the project.'), etag),
      Folder: json('Folder', t('Dossier.', 'Folder.')),
      PresetList: json('PresetList', t('Préréglages utilisables dans le projet.', 'Presets usable in the project.'), etag),
      FolderCreated: json('Folder', t('Dossier créé.', 'Folder created.')),
      SignedUrl: json('SignedUrl', t('Lien, signé si nécessaire.', 'Link, signed when needed.')),
      SignedUrlList: json('SignedUrlList', t('Un résultat par lien demandé, dans le même ordre.', 'One result per requested link, in the same order.')),
      DelegatedToken: json('DelegatedToken', t('Jeton délégué (à ne pas mettre en cache).', 'Delegated token (do not cache).')),
      ErrorCatalog: json('ErrorCatalog', t('Codes d\'erreur, statuts et titres.', 'Error codes, statuses and titles.')),
      OpenApiDocument: { ...t('Cette spécification (OpenAPI 3.1).', 'This specification (OpenAPI 3.1).'), content: jsonContent({ type: 'object' }) },
      NoContent: t('Effectué, sans contenu.', 'Done, no content.'),
      NotModified: t('Inchangé depuis l\'`ETag` fourni (`If-None-Match`).', 'Unchanged since the given `ETag` (`If-None-Match`).'),
    },
  }
}

// ─── Opérations ──────────────────────────────────────────────────────────────

/** Erreurs de toute route authentifiée (identifiant, débit, garde-fous du navigateur). */
function authErrors(credentials: ApiCredentialType[]): ApiErrorCode[] {
  const codes: ApiErrorCode[] = ['TOKEN_MISSING', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_REVOKED']
  if (credentials.some(type => type === 'secret' || type === 'personal')) codes.push('SECRET_IN_BROWSER')
  if (credentials.some(type => type === 'publishable' || type === 'delegated')) codes.push('ORIGIN_NOT_ALLOWED')
  codes.push('RATE_LIMITED')
  return codes
}

/** Réponses d'erreur groupées par statut, un exemple RFC 9457 par code. */
function errorResponses(codes: ApiErrorCode[], serverUrl: string, path: string): Json {
  const byStatus = new Map<number, ApiErrorCode[]>()
  for (const code of new Set(codes)) {
    const { status } = API_ERRORS[code]
    byStatus.set(status, [...(byStatus.get(status) ?? []), code])
  }
  return Object.fromEntries([...byStatus.entries()].sort(([a], [b]) => a - b).map(([status, list]) => {
    const [fr, en] = STATUS_LABELS[status] ?? [String(status), String(status)]
    const names = list.map(code => `\`${code}\``).join(', ')
    const headers = status === 401
      ? { 'WWW-Authenticate': ref('headers', 'WWWAuthenticate') }
      : status === 429 || status === 503 ? { 'Retry-After': ref('headers', 'RetryAfter') } : undefined
    return [status, {
      ...t(`${fr} : ${names}.`, `${en}: ${names}.`),
      ...(headers ? { headers } : {}),
      content: {
        'application/problem+json': {
          schema: ref('schemas', 'Problem'),
          examples: Object.fromEntries(list.map(code => [code, {
            summary: API_ERRORS[code].title,
            value: {
              type: `${serverUrl}/errors#${code}`,
              title: API_ERRORS[code].title,
              status,
              code,
              instance: `${API_PREFIX}${path}`,
              requestId: '0b9f6c1e-2d4a-4c8e-9f1a-3e5d7c9b1a20',
            },
          }])),
        },
      },
    }]
  }))
}

/** Ligne « Portée · Identifiants » ajoutée à la description de chaque opération authentifiée. */
function accessLine(scopes: string[], credentials: ApiCredentialType[], lang: OpenApiLang): string {
  const fr = lang === 'fr'
  const parts: string[] = []
  if (scopes.length) {
    const label = fr ? (scopes.length > 1 ? 'Portées' : 'Portée') : (scopes.length > 1 ? 'Scopes' : 'Scope')
    parts.push(`**${label}**${fr ? ' : ' : ': '}${scopes.map(scope => `\`${scope}\``).join(', ')}`)
  }
  if (credentials.length) {
    const names = credentials.map(type => CREDENTIAL_LABELS[type][fr ? 0 : 1]).join(', ')
    parts.push(`**${fr ? 'Identifiants' : 'Credentials'}**${fr ? ' : ' : ': '}${names}`)
  }
  return parts.join(' · ')
}

const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join('\n\n')

/** `/api/v1/projects/:projectId/media` → `/projects/{projectId}/media`. */
function openApiPath(route: string): string {
  return route.slice(API_PREFIX.length).replace(/:(\w+)/g, '{$1}') || '/'
}

interface Built {
  document: Json
  problems: string[]
}

/** Document complet en français, traductions en `x-i18n`, et incohérences détectées. */
export function describeApi(routes: RouteMetaEntry[], serverUrl: string): Built {
  const problems: string[] = []
  const components = buildComponents()
  const paths: Record<string, Record<string, Json>> = {}
  const operationIds = new Set<string>()
  const tagNames = new Set(TAGS.map(tag => tag.name as string))

  const entries = routes
    .filter(entry => entry.route?.startsWith(`${API_PREFIX}/`) && !entry.route.includes('**'))
    .map(entry => ({ ...entry, path: openApiPath(entry.route!), method: (entry.method ?? 'get').toLowerCase() }))
    .sort((a, b) => a.path.localeCompare(b.path) || methodRank(a.method) - methodRank(b.method))

  for (const entry of entries) {
    const where = `${entry.method.toUpperCase()} ${entry.path}`
    const meta = { ...(entry.meta?.openAPI as Json | undefined) }
    if (!entry.meta?.openAPI) problems.push(`${where} : pas de defineRouteMeta({ openAPI }) — opération non documentée`)

    const {
      'x-scopes': scopes = [],
      'x-credentials': credentials = [],
      'x-query': query,
      'x-errors': codes = [],
      'x-i18n': i18n,
      tags = [],
      parameters = [],
      responses = {},
      security,
      ...rest
    } = meta as Json & {
      'x-scopes'?: string[]
      'x-credentials'?: ApiCredentialType[]
      'x-query'?: string
      'x-errors'?: ApiErrorCode[]
      'x-i18n'?: { en?: { summary?: string, description?: string } }
      'tags'?: string[]
      'parameters'?: Json[]
      'responses'?: Json
      'security'?: unknown[]
    }
    const isPublic = Array.isArray(security) && security.length === 0

    if (typeof rest.summary !== 'string') problems.push(`${where} : summary manquant`)
    if (typeof rest.operationId !== 'string') problems.push(`${where} : operationId manquant`)
    else if (operationIds.has(rest.operationId)) problems.push(`${where} : operationId « ${rest.operationId} » en double`)
    else operationIds.add(rest.operationId)
    for (const tag of tags) if (!tagNames.has(tag)) problems.push(`${where} : étiquette inconnue « ${tag} »`)
    for (const code of codes) if (!(code in API_ERRORS)) problems.push(`${where} : code d'erreur inconnu « ${code} »`)
    if (!isPublic && credentials.length === 0) problems.push(`${where} : x-credentials manquant`)
    if (query && !QUERY_SCHEMAS[query]) problems.push(`${where} : x-query inconnu « ${query} »`)

    // Paramètres : chemin (composants), requête (schéma zod), puis ceux déclarés par la route.
    const pathParameters = [...entry.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => {
      if (name! in components.parameters) return ref('parameters', name!)
      problems.push(`${where} : paramètre de chemin « ${name} » non décrit (composants)`)
      return { name, in: 'path', required: true, schema: { type: 'string' } }
    })
    const queryParams = query && QUERY_SCHEMAS[query] ? queryParameters(QUERY_SCHEMAS[query]) : []

    const known = (codes as string[]).filter((code): code is ApiErrorCode => code in API_ERRORS)
    const access = isPublic ? undefined : { fr: accessLine(scopes, credentials, 'fr'), en: accessLine(scopes, credentials, 'en') }
    const summary = (rest.summary as string | undefined) ?? where
    const description = rest.description as string | undefined
    const descriptionFr = join(description, access?.fr)
    const descriptionEn = join(i18n?.en?.description ?? description, access?.en)
    const english: Json = { summary: i18n?.en?.summary ?? summary, ...(descriptionEn ? { description: descriptionEn } : {}) }
    for (const key of ['summary', 'description'] as const) {
      if (typeof rest[key] === 'string' && !i18n?.en?.[key]) problems.push(`${where} : traduction anglaise manquante (${key})`)
    }

    const operation: Json = {
      ...rest,
      'summary': summary,
      ...(descriptionFr ? { description: descriptionFr } : {}),
      'tags': tags,
      'parameters': [...pathParameters, ...queryParams, ...parameters],
      'security': isPublic ? [] : [{ bearerAuth: scopes }],
      'responses': {
        ...responses,
        ...errorResponses(isPublic ? known : [...known, ...authErrors(credentials)], serverUrl, entry.path),
      },
      'x-i18n': { en: english },
    }
    paths[entry.path] = { ...paths[entry.path], [entry.method]: operation }
  }

  const document = {
    openapi: '3.1.0',
    info: { title: 'surgeMedia API', version: '1.0.0', ...texts({ description: INFO_FR }, { description: INFO_EN }) },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: TAGS,
    paths,
    components,
  }

  walk(document, (node, pointer) => {
    // Textes sans traduction anglaise (schémas zod : `.meta(doc(fr, en))`).
    const english = (node['x-i18n'] as { en?: Json } | undefined)?.en
    for (const key of ['summary', 'description'] as const) {
      if (typeof node[key] === 'string' && typeof english?.[key] !== 'string') problems.push(`${pointer} : traduction anglaise manquante (${key})`)
    }
    // Références pendantes : toute `$ref` interne doit désigner un composant.
    const target = node.$ref
    if (typeof target !== 'string' || !target.startsWith('#/')) return
    const resolved = target.slice(2).split('/').reduce<unknown>((value, key) => (value as Json | undefined)?.[key], document)
    if (resolved === undefined) problems.push(`${pointer} : référence introuvable ${target}`)
  })

  return { document, problems }
}

/** Parcourt les objets du document (hors exemples, qui sont des données, et traductions). */
function walk(node: unknown, visit: (node: Json, pointer: string) => void, pointer = '#'): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, visit, `${pointer}/${index}`))
    return
  }
  if (!node || typeof node !== 'object') return
  visit(node as Json, pointer)
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'examples' && key !== 'example' && key !== 'x-i18n') walk(value, visit, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`)
  }
}

/**
 * Document dans une langue : traductions (`x-i18n`) appliquées hors français, extension retirée
 * partout. Copie profonde : le document de référence n'est pas modifié.
 */
export function localize<T>(value: T, lang: OpenApiLang): T {
  if (Array.isArray(value)) return value.map(item => localize(item, lang)) as T
  if (!value || typeof value !== 'object') return value
  const { 'x-i18n': i18n, ...rest } = value as Json & { 'x-i18n'?: Partial<Record<OpenApiLang, Json>> }
  const result: Json = {}
  for (const [key, item] of Object.entries(rest)) result[key] = localize(item, lang)
  if (lang !== 'fr' && i18n?.[lang]) Object.assign(result, i18n[lang])
  return result as T
}

/** Spécification servie par GET /api/v1/openapi.json. */
export function buildOpenApiDocument(routes: RouteMetaEntry[], options: OpenApiOptions): Json {
  return localize(describeApi(routes, options.serverUrl).document, options.lang)
}

/** Incohérences de la documentation (routes non décrites, traductions, références…), pour le développement et les tests. */
export function openApiProblems(routes: RouteMetaEntry[], serverUrl = 'http://localhost/api/v1'): string[] {
  return describeApi(routes, serverUrl).problems
}
