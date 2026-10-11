import { apiMediaUploadFieldsSchema } from '#shared/schemas/api'
import { defineApiHandler, requireApiProject } from '../../../../../lib/api/context'
import { invalidRequest } from '../../../../../lib/api/problem'
import { apiLinkExpiry, mediaEtag, toApiMedia } from '../../../../../lib/api/serializers'
import { apiMediaLocation, principalProvenance, toMetadataInput, withApiUpload } from '../../../../../lib/api/writes'
import { createMedia } from '../../../../../lib/media/service'
import { mediaBaseUrl } from '../../../../../lib/media/urls'

defineRouteMeta({
  openAPI: {
    'operationId': 'uploadMedia',
    'tags': ['media'],
    'summary': 'Envoyer un média',
    'description': 'Un fichier par requête (`multipart/form-data`, champ `file`), type détecté d\'après son contenu : images JPEG, PNG, WebP, AVIF ou GIF (25 Mio par défaut), vidéos MP4, WebM ou QuickTime (512 Mio par défaut) et, seulement pendant que le traitement des vidéos est actif sur le serveur, MKV, AVI, 3GP, MPEG-TS, OGV ou WMV (lues par leur rendu H.264). Type et taille sont contrôlés dès les premiers octets : un fichier refusé n\'est pas reçu en entier. Une vidéo n\'a ni aperçu ni transformation par URL ; selon le réglage du serveur, elle est traitée après l\'envoi (`processing`, rendus dans `sources` : voir « Vidéos »). Visibilité `public` par défaut. Jeton délégué : nombre de fichiers, taille, types, visibilité et dossier selon ses contraintes. En-tête `Location` : URL du média dans l\'API.',
    'x-scopes': ['media:upload'],
    'x-credentials': ['secret', 'personal', 'delegated'],
    'x-errors': [
      'INVALID_REQUEST',
      'MULTIPART_REQUIRED',
      'NO_FILE',
      'UPLOAD_LIMIT_REACHED',
      'FOLDER_NOT_FOUND',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_TYPE',
      'UNREADABLE_FILE',
      'DIMENSIONS_TOO_LARGE',
      'SERVER_BUSY',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/MediaUpload' },
    'responses': { 201: { $ref: '#/components/responses/MediaCreated' } },
    'x-i18n': {
      en: {
        summary: 'Upload a media item',
        description: 'One file per request (`multipart/form-data`, `file` field), type detected from its contents: JPEG, PNG, WebP, AVIF or GIF images (25 MiB by default), MP4, WebM or QuickTime videos (512 MiB by default) and, only while video processing is active on the server, MKV, AVI, 3GP, MPEG-TS, OGV or WMV (played through their H.264 rendition). Type and size are checked from the first bytes: a rejected file is not received in full. A video has no preview and no transformation by URL; depending on the server setting, it is processed after the upload (`processing`, renditions in `sources`: see “Videos”). Visibility `public` by default. Delegated token: number of files, size, types, visibility and folder according to its constraints. `Location` header: URL of the media item in the API.',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/media — multipart/form-data : `file` (obligatoire), `title`,
 * `altText`, `visibility` (`public` par défaut), `folderId` (dossier du projet ; hors dossier par
 * défaut). Portée media:upload (clé secrète, jeton personnel, jeton délégué). Le type est détecté
 * d'après le contenu (images, vidéos), limite de taille du genre appliquée dès les premiers octets. → 201 Media + Location.
 * Jeton délégué : nombre de fichiers, taille, types, visibilité et dossier selon ses contraintes.
 * 404 FOLDER_NOT_FOUND (dossier d'un autre projet ou supprimé).
 * 400 INVALID_REQUEST / MULTIPART_REQUIRED / NO_FILE · 403 UPLOAD_LIMIT_REACHED · 408 UPLOAD_TIMEOUT · 413 FILE_TOO_LARGE ·
 * 415 UNSUPPORTED_TYPE · 422 UNREADABLE_FILE / DIMENSIONS_TOO_LARGE · 429 · 503 SERVER_BUSY.
 */
export default defineApiHandler(async (event, principal) => {
  // Droits vérifiés avant de lire le corps de la requête.
  const { project } = await requireApiProject(event, principal, 'media:upload')
  const media = await withApiUpload(event, principal, async (upload, options) => {
    const fields = apiMediaUploadFieldsSchema.safeParse(upload.fields)
    if (!fields.success) throw invalidRequest(fields.error.issues)
    const input = toMetadataInput(fields.data, principal.delegated?.upload)
    return createMedia({ type: 'project', id: project.id }, upload, input, principalProvenance(principal), options)
  })

  const expires = apiLinkExpiry()
  setResponseStatus(event, 201)
  setResponseHeaders(event, { Location: apiMediaLocation(event, media)!, ETag: mediaEtag(media, expires) })
  return toApiMedia(media, mediaBaseUrl(event), expires)
})
