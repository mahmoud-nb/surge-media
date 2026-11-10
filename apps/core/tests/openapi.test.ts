import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument, openApiProblems, type RouteMetaEntry } from '../server/lib/api/openapi'

/**
 * Spécification OpenAPI générée depuis le code. Les métadonnées sont lues dans les vrais fichiers de
 * routes, comme le fait Nitro à la compilation : l'argument de `defineRouteMeta` n'est fait que de
 * littéraux, évaluables sans exécuter le module (qui dépend des auto-imports de Nitro).
 */

const API_DIR = fileURLToPath(new URL('../server/api/v1', import.meta.url))
const SERVER = 'https://media.example.com/api/v1'

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? routeFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])
}

/** `projects/[projectId]/media/index.post.ts` → `/api/v1/projects/:projectId/media`, `post` (règles de Nitro). */
function routeOf(file: string): RouteMetaEntry {
  const segments = relative(API_DIR, file).split(sep)
  const name = segments.pop()!.replace(/\.ts$/, '')
  const method = /\.(get|post|put|patch|delete)$/.exec(name)?.[1]
  const base = method ? name.slice(0, -(method.length + 1)) : name
  const parts = [...segments, ...(base === 'index' ? [] : [base])].map(part =>
    part === '[...]' ? '**' : part.replace(/^\[(\w+)\]$/, ':$1'))
  return { route: `/api/v1/${parts.join('/')}`.replace(/\/$/, ''), method }
}

function readMeta(file: string): RouteMetaEntry['meta'] {
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf('defineRouteMeta(')
  if (start === -1) return null
  const end = source.indexOf('\n})\n', start)
  // Littéral d'objet extrait du fichier (voir l'en-tête).
  return new Function(`return ${source.slice(start + 'defineRouteMeta('.length, end + 2)}`)() as RouteMetaEntry['meta']
}

const routes: RouteMetaEntry[] = routeFiles(API_DIR).map(file => ({ ...routeOf(file), meta: readMeta(file) }))

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- document OpenAPI parcouru librement par les assertions
type Doc = Record<string, any>
const fr = buildOpenApiDocument(routes, { serverUrl: SERVER, lang: 'fr' }) as Doc
const en = buildOpenApiDocument(routes, { serverUrl: SERVER, lang: 'en' }) as Doc

describe('spécification OpenAPI générée depuis les routes', () => {
  it('décrit chaque route, traduite, sans référence pendante', () => {
    expect(openApiProblems(routes, SERVER)).toEqual([])
  })

  it('reprend les chemins et méthodes des fichiers', () => {
    expect(fr.openapi).toBe('3.1.0')
    expect(fr.servers).toEqual([{ url: SERVER }])
    const operations = Object.entries(fr.paths as Record<string, Doc>).flatMap(([path, item]) => Object.keys(item).map(method => `${method.toUpperCase()} ${path}`))
    expect(operations).toEqual([
      'GET /errors',
      'GET /me',
      'GET /openapi.json',
      'GET /projects',
      'GET /projects/{projectId}',
      'POST /projects/{projectId}/delegated-tokens',
      'GET /projects/{projectId}/folders',
      'POST /projects/{projectId}/folders',
      'PATCH /projects/{projectId}/folders/{folderId}',
      'DELETE /projects/{projectId}/folders/{folderId}',
      'GET /projects/{projectId}/media',
      'POST /projects/{projectId}/media',
      'GET /projects/{projectId}/media/{mediaId}',
      'PATCH /projects/{projectId}/media/{mediaId}',
      'DELETE /projects/{projectId}/media/{mediaId}',
      'POST /projects/{projectId}/media/{mediaId}/duplicate',
      'PUT /projects/{projectId}/media/{mediaId}/file',
      'PUT /projects/{projectId}/media/{mediaId}/poster',
      'DELETE /projects/{projectId}/media/{mediaId}/poster',
      'POST /projects/{projectId}/media/{mediaId}/signed-url',
      'GET /projects/{projectId}/media/{mediaId}/tracks',
      'POST /projects/{projectId}/media/{mediaId}/tracks',
      'PATCH /projects/{projectId}/media/{mediaId}/tracks/{trackId}',
      'DELETE /projects/{projectId}/media/{mediaId}/tracks/{trackId}',
      'POST /projects/{projectId}/media/tags',
      'GET /projects/{projectId}/presets',
      'POST /projects/{projectId}/signed-urls',
      'GET /projects/{projectId}/tags',
      'POST /projects/{projectId}/tags',
      'PATCH /projects/{projectId}/tags/{tagId}',
      'DELETE /projects/{projectId}/tags/{tagId}',
    ])
  })

  it('dérive les paramètres et les corps des schémas zod', () => {
    const list = fr.paths['/projects/{projectId}/media'].get
    expect(list.parameters.map((parameter: Doc) => parameter.name ?? parameter.$ref)).toEqual([
      '#/components/parameters/projectId', 'q', 'kind', 'visibility', 'ids', 'folder', 'recursive', 'sort', 'limit', 'cursor', 'withTotal', 'tags', 'tagMatch', 'untagged',
    ])
    const upload = fr.components.requestBodies.MediaUpload.content['multipart/form-data'].schema
    expect(upload.required).toEqual(['file'])
    expect(Object.keys(upload.properties)).toEqual(['file', 'title', 'altText', 'visibility', 'folderId', 'tags'])
    expect(Object.keys(fr.components.schemas).sort()).toEqual([
      'DelegatedToken', 'DelegatedTokenClaims', 'ErrorCatalog', 'Folder', 'FolderList', 'Me', 'Media', 'MediaList', 'MediaProcessing', 'MediaSource', 'MediaTagsBulkResult', 'Preset', 'PresetList', 'Problem',
      'Project', 'ProjectList', 'SignedUrl', 'SignedUrlError', 'SignedUrlList', 'Tag', 'TagList', 'TagRef', 'TextTrack', 'TextTrackList', 'UploadConstraints',
    ])
  })

  it('ajoute portées, identifiants admis et erreurs (avec exemples) à chaque opération', () => {
    const list = fr.paths['/projects/{projectId}/media'].get
    expect(list.security).toEqual([{ bearerAuth: ['media:read'] }])
    expect(list.description).toContain('**Portée** : `media:read` · **Identifiants** : clé publique, clé secrète, jeton personnel, jeton délégué')
    expect(Object.keys(list.responses)).toEqual(['200', '304', '400', '401', '403', '404', '429'])
    const forbidden = list.responses[403].content['application/problem+json'].examples
    expect(Object.keys(forbidden).sort()).toEqual(['INSUFFICIENT_SCOPE', 'LISTING_DISABLED', 'ORIGIN_NOT_ALLOWED', 'PROJECT_ARCHIVED', 'SECRET_IN_BROWSER'])
    expect(forbidden.LISTING_DISABLED.value).toMatchObject({ type: `${SERVER}/errors#LISTING_DISABLED`, status: 403, code: 'LISTING_DISABLED' })
    expect(list.responses[429].headers['Retry-After']).toEqual({ $ref: '#/components/headers/RetryAfter' })

    // Délégation : jamais par une clé publique ni un jeton délégué.
    const delegate = fr.paths['/projects/{projectId}/delegated-tokens'].post
    expect(delegate.description).toContain('**Identifiants** : clé secrète, jeton personnel')
    expect(delegate.responses[403].description).not.toContain('LISTING_DISABLED')
  })

  it('laisse les documents publics sans identifiant', () => {
    const errors = fr.paths['/errors'].get
    expect(errors.security).toEqual([])
    expect(errors.responses[401]).toBeUndefined()
    expect(fr.paths['/openapi.json'].get.parameters.map((parameter: Doc) => parameter.name)).toEqual(['lang'])
  })

  it('traduit tout le document et retire les extensions internes', () => {
    const serialized = JSON.stringify([fr, en])
    for (const extension of ['x-i18n', 'x-scopes', 'x-credentials', 'x-query', 'x-errors']) expect(serialized).not.toContain(`"${extension}"`)
    expect(fr.paths['/projects/{projectId}/media'].get.summary).toBe('Liste et recherche des médias')
    expect(en.paths['/projects/{projectId}/media'].get.summary).toBe('List and search media')
    expect(en.paths['/projects/{projectId}/media'].get.description).toContain('**Scope**: `media:read` · **Credentials**: publishable key')
    expect(en.components.schemas.Media.properties.size.description).toBe('Size in bytes.')
    expect(fr.components.schemas.Media.properties.size.description).toBe('Taille en octets.')
    expect(en.tags.find((tag: Doc) => tag.name === 'media')['x-displayName']).toBe('Media')
    expect(en.paths['/projects/{projectId}/media'].get.responses[403].description).toMatch(/^Access denied: /)
  })

  it('vidéos (phase D3) : composants MediaSource et MediaProcessing, traduits, et section « Vidéos »', () => {
    for (const document of [fr, en]) {
      const { schemas } = document.components
      expect(schemas.Media.properties.sources).toMatchObject({ type: 'array', items: { $ref: '#/components/schemas/MediaSource' } })
      expect(JSON.stringify(schemas.Media.properties.processing)).toContain('"$ref":"#/components/schemas/MediaProcessing"')
      expect(schemas.MediaSource.required).toEqual(['url', 'type', 'width', 'height', 'bitrate', 'size', 'rendition'])
      expect(schemas.MediaProcessing.properties.status.enum).toEqual(['pending', 'processing', 'ready', 'failed'])
      expect(schemas.MediaProcessing.properties.error.anyOf ?? [schemas.MediaProcessing.properties.error]).toEqual(expect.arrayContaining([expect.objectContaining({ enum: expect.arrayContaining(['TOO_LONG', 'CONVERSION_FAILED']) })]))
      expect(schemas.SignedUrl.properties.sources.items).toEqual({ $ref: '#/components/schemas/MediaSource' })
      expect(schemas.SignedUrl.required).not.toContain('sources')
      expect(schemas.UploadConstraints.properties.types.items.enum).toEqual(expect.arrayContaining(['video/mp4', 'video/x-matroska', 'video/x-ms-wmv']))
    }
    expect(fr.components.schemas.MediaSource.properties.size.description).toBe('Taille du fichier, en octets.')
    expect(en.components.schemas.MediaSource.properties.size.description).toBe('File size in bytes.')
    expect(en.components.schemas.MediaProcessing.properties.error.description).toMatch(/^Failure code/)
    expect(en.components.schemas.UploadConstraints.properties.types.description).toContain('only while video processing is active')

    for (const [document, heading] of [[fr, '## Vidéos'], [en, '## Videos']] as const) {
      const info = document.info.description as string
      const section = info.slice(info.indexOf(heading))
      for (const text of ['`sources`', '`processing`', '<source src=', '<track ', 'poster=', 'If-None-Match', 'MKV', 'attachment', '`PROCESSING_PENDING`', '`Retry-After`']) {
        expect(section, `${heading} : ${text}`).toContain(text)
      }
      // Préparation à l'envoi, nettoyage et réparation réécrivent le fichier : jamais « tel qu'envoyé ».
      for (const text of [section, document.components.schemas.MediaProcessing.properties.status.description as string]) {
        expect(text).not.toMatch(/telles? qu'envoyée|as uploaded/)
      }
    }
    // Erreurs de /m/ : la retenue d'une vidéo figure dans la liste.
    expect(fr.info.description).toMatch(/`SERVER_BUSY` \(503\), `PROCESSING_PENDING` \(503/)
    expect(en.info.description).toMatch(/`SERVER_BUSY` \(503\), `PROCESSING_PENDING` \(503/)
  })

  it('signale une route non décrite, une traduction manquante et une référence pendante', () => {
    const extra: RouteMetaEntry[] = [
      { route: '/api/v1/widgets', method: 'get', meta: null },
      {
        route: '/api/v1/gadgets/:gadgetId',
        method: 'get',
        meta: { openAPI: { 'operationId': 'getGadget', 'summary': 'Gadget', 'tags': ['media'], 'x-credentials': ['secret'], 'x-errors': ['NOPE'], 'responses': { 200: { $ref: '#/components/responses/Gadget' } } } },
      },
    ]
    const problems = openApiProblems([...routes, ...extra], SERVER)
    expect(problems).toEqual(expect.arrayContaining([
      'GET /widgets : pas de defineRouteMeta({ openAPI }) — opération non documentée',
      'GET /gadgets/{gadgetId} : code d\'erreur inconnu « NOPE »',
      'GET /gadgets/{gadgetId} : traduction anglaise manquante (summary)',
      'GET /gadgets/{gadgetId} : paramètre de chemin « gadgetId » non décrit (composants)',
      '#/paths/~1gadgets~1{gadgetId}/get/responses/200 : référence introuvable #/components/responses/Gadget',
    ]))
    // Non décrite, la route reste listée (rien n'est caché).
    const document = buildOpenApiDocument([...routes, ...extra], { serverUrl: SERVER, lang: 'fr' }) as Doc
    expect(document.paths['/widgets'].get.summary).toBe('GET /widgets')
  })
})
