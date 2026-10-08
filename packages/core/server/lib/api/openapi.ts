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
  apiMediaProcessingSchema,
  apiMediaSchema,
  apiMediaSourceSchema,
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
  apiTextTrackFieldsSchema,
  apiTextTrackListSchema,
  apiTextTrackSchema,
  apiTextTrackUpdateSchema,
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
  408: ['Délai dépassé', 'Request timeout'],
  409: ['Conflit', 'Conflict'],
  413: ['Contenu trop volumineux', 'Payload too large'],
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

## Vidéos
Les vidéos MP4, WebM et QuickTime (MOV) sont stockées et servies sans réencodage. Un MP4 ou un MOV est **préparé à l'envoi**, sans réencodage ni perte de qualité : index placé en tête du fichier (la lecture commence sans aller chercher la fin) et métadonnées d'origine retirées (lieu de tournage, appareil, logiciel) ; \`size\` est la taille du fichier servi. \`width\` et \`height\` sont les dimensions affichées (rotation des vidéos de téléphone appliquée), \`duration\` la durée en secondes (estimée pour un WebM enregistré par un navigateur, \`null\` si elle reste inconnue). La diffusion accepte les requêtes partielles (\`Range\` → \`206\`) et un média public est mis en cache sans limite (CDN).

**Traitement par le serveur** : selon son réglage (choisi par l'installation, pas par l'API : aucun traitement, ou ffmpeg en tâche de fond), le serveur traite chaque nouvelle vidéo après l'envoi — retrait des pistes de métadonnées de l'appareil (positions GPS des téléphones, caméras d'action, drones), durée et index d'un WebM enregistré par un navigateur, image d'affiche extraite quand la vidéo n'en a pas, et **rendus** lisibles partout quand l'original ne l'est pas (HEVC, ProRes, format converti…) ou qu'il est trop lourd (définition ou débit élevés, HDR) : H.264 en MP4 et, si l'installation l'active, AV1 en WebM. Réécrire le fichier ou remplacer un rendu incrémente la version (nouvelles URL, les anciennes redirigent). \`processing\` donne l'état de la dernière tâche : \`pending\`, \`processing\` (avec \`progress\`), \`ready\`, ou \`failed\` (avec \`error\` ; la vidéo reste servie avec ce qui a pu être fait : l'original, éventuellement nettoyé, et les rendus déjà produits) ; il vaut \`null\` pour une vidéo jamais traitée (traitement désactivé, ou vidéo envoyée avant son activation), servie telle quelle.

**Lecture** : reprenez \`sources\` dans l'ordre, une balise \`<source>\` par entrée avec son \`type\` — le navigateur prend la première qu'il sait lire, sans télécharger les autres : les rendus quand ils existent (AV1 d'abord, plus léger ; H.264 ensuite, lu partout), sinon l'original s'il est lisible par \`<video>\`. \`url\` reste l'original (téléchargement, archivage). Sans rendu, la lecture dépend des codecs du fichier : H.264 (MP4, MOV) et VP8/VP9 (WebM) sont lus partout, HEVC ou AV1 selon le navigateur. \`type\` contient des guillemets : entourez l'attribut d'apostrophes (ou laissez votre moteur de gabarits l'échapper). Avec l'affiche (\`poster.url\`) et les pistes de texte (\`textTracks\`) :

\`\`\`html
<video controls playsinline preload="metadata" crossorigin="anonymous" width="1920" height="1080"
       poster="https://media.example.com/m/cm…/v4/full/vacances.jpg">
  <source src="https://media.example.com/m/cm…/v4/renditions/av1.webm" type='video/webm; codecs="av01.0.08M.08, opus"'>
  <source src="https://media.example.com/m/cm…/v4/renditions/h264.mp4" type='video/mp4; codecs="avc1.640028, mp4a.40.2"'>
  <track kind="captions" srclang="fr" label="Français" src="https://media.example.com/m/cm…/v4/tracks/cm….vtt" default>
</video>
\`\`\`

Les URL d'une vidéo privée (\`url\`, \`sources\`, pistes) sont signées pour environ une heure et le lecteur les réutilise pendant toute la lecture : pour une longue vidéo, demandez un lien plus durable (\`POST …/signed-url\`, cible \`file\`, \`expiresIn\` au moins égal à la durée, 7 jours au plus), dont la réponse contient aussi \`sources\`, signées jusqu'à la même échéance.

**Attendre le traitement** : aucune notification n'est envoyée (pas de webhook) ; relisez le média (\`GET …/media/{mediaId}\`) avec \`If-None-Match\`, pas plus d'une fois toutes les 5 s, tant que \`processing.status\` vaut \`pending\` ou \`processing\` : \`304\` tant que rien n'a changé, l'\`ETag\` suit l'avancement. À \`ready\`, reprenez \`url\`, \`sources\` et \`poster\` (nouvelles URL si la version a changé). Les listes suivent aussi l'état du traitement, mais le suivi d'une vidéo passe par son média.

**Formats convertis** : seulement pendant que le traitement est actif, le serveur accepte aussi MKV, AVI, 3GP/3G2, MPEG-TS (et M2TS), OGV et WMV, que les navigateurs ne lisent pas. L'original est servi en téléchargement (\`Content-Disposition: attachment\`), \`width\`, \`height\` et \`duration\` valent \`null\` jusqu'à son analyse, et \`sources\` reste vide tant que le rendu H.264 n'existe pas. Traitement inactif : ces formats sont refusés (\`415 UNSUPPORTED_TYPE\`), même pour un jeton délégué qui les cite.

**Retenue pendant le nettoyage** : tant qu'une piste de métadonnées de l'appareil (souvent des positions GPS) n'est pas retirée, l'original et les rendus de la vidéo répondent \`503\` (\`PROCESSING_PENDING\`, en-tête \`Retry-After\`), par leur URL publique comme par un lien signé ; ce nettoyage passe avant les réencodages et ne prend en général que quelques secondes. L'affiche, les dérivés et les pistes de texte restent servis. Le fichier nettoyé a une nouvelle version : relisez le média pour obtenir ses nouvelles URL. Un échec définitif lève la retenue.

**Image d'affiche** (\`PUT …/media/{mediaId}/poster\`) : une image, normalisée en JPEG, sert d'attribut \`poster\` (\`poster.url\`) et de source aux dérivés de la vidéo (\`previewUrl\`, \`urlTemplate\`) ; sans affiche, ils valent \`null\`. La première affiche garde la version ; la remplacer ou la retirer l'incrémente (nouvelles URL). Quand le traitement est actif, le serveur extrait une affiche de la vidéo qui n'en a pas ; une affiche envoyée l'emporte toujours. Une application peut aussi capturer l'image dans le navigateur, sans attendre le serveur :

\`\`\`js
const video = document.createElement('video')
video.muted = true
video.src = URL.createObjectURL(file) // la vidéo choisie par l'utilisateur
await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }))
video.currentTime = Math.min(video.duration * 0.1, 5)
await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }))
const canvas = Object.assign(document.createElement('canvas'), { width: video.videoWidth, height: video.videoHeight })
canvas.getContext('2d').drawImage(video, 0, 0)
const form = new FormData()
form.append('file', await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9)), 'poster.jpg')
form.append('time', String(video.currentTime))
await fetch(\`\${api}/projects/\${projectId}/media/\${mediaId}/poster\`, { method: 'PUT', headers: { Authorization: \`Bearer \${token}\` }, body: form })
\`\`\`

**Sous-titres** (\`POST …/media/{mediaId}/tracks\`) : fichiers WebVTT ou SRT (convertis), vérifiés puis réécrits en WebVTT ; \`textTracks\` donne pour chacun \`kind\`, \`language\`, \`label\`, \`default\` et \`url\`, à reprendre dans des éléments \`<track>\`. Si les fichiers viennent d'un autre domaine que la page, ajoutez \`crossorigin="anonymous"\` à \`<video>\` (la diffusion autorise toutes les origines). Une piste privée se lit par son URL signée, ou par un lien plus durable (\`POST …/signed-url\`, cible \`track\`).

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

Une URL non canonique (ordre des paramètres, valeurs par défaut, \`dpr\`, \`jpeg\`) est redirigée (\`301\`) vers sa forme canonique ; une URL valable est mise en cache sans limite (une semaine, puis revalidée, pour un préréglage du projet ou de l'installation, modifiable). Selon la politique du projet (\`transformPolicy\`), les paramètres libres sont acceptés (\`open\`), seulement signés (\`signed\` : \`POST …/signed-url\`, ou signature de \`urlTemplate\` pour un média privé) ou refusés (\`presets\`) ; les préréglages sont toujours servis. Les erreurs de \`/m/\` sont en JSON avec un code dans \`data.code\` : \`INVALID_TRANSFORM\` (400), \`TRANSFORM_NOT_ALLOWED\`, \`MEDIA_FORBIDDEN\`, \`SIGNATURE_INVALID\`, \`SIGNATURE_EXPIRED\` (403), \`TRANSFORM_QUOTA\` (429 : 50 dérivés libres par version, débit de nouvelles générations par adresse IP), \`SERVER_BUSY\` (503), \`PROCESSING_PENDING\` (503 avec \`Retry-After\` : original ou rendu d'une vidéo retenu pendant le retrait de ses métadonnées, voir « Vidéos »).`

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

## Videos
MP4, WebM and QuickTime (MOV) videos are stored and served without re-encoding. An MP4 or MOV file is **prepared on upload**, without re-encoding or quality loss: index moved to the start of the file (playback starts without fetching the end) and original metadata removed (shooting location, device, software); \`size\` is the size of the served file. \`width\` and \`height\` are the displayed dimensions (rotation of phone videos applied), \`duration\` the duration in seconds (estimated for a WebM recorded by a browser, \`null\` when it remains unknown). Delivery accepts partial requests (\`Range\` → \`206\`) and a public media item is cached without limit (CDN).

**Processing by the server**: depending on its setting (chosen by the installation, not through the API: no processing, or ffmpeg in the background), the server processes every new video after the upload — removal of device metadata tracks (GPS positions of phones, action cameras, drones), duration and index of a WebM recorded by a browser, poster image extracted when the video has none, and **renditions** playable everywhere when the original is not (HEVC, ProRes, converted format…) or is too heavy (high definition or bitrate, HDR): H.264 in MP4 and, when the installation enables it, AV1 in WebM. Rewriting the file or replacing a rendition increments the version (new URLs, old ones redirect). \`processing\` gives the state of the latest task: \`pending\`, \`processing\` (with \`progress\`), \`ready\`, or \`failed\` (with \`error\`; the video is still served with what could be done: the original, possibly cleaned, and any rendition already produced); it is \`null\` for a video never processed (processing disabled, or video uploaded before it was enabled), served as is.

**Playback**: use \`sources\` in order, one \`<source>\` tag per entry with its \`type\` — the browser takes the first one it can play, without downloading the others: the renditions when they exist (AV1 first, lighter; H.264 next, played everywhere), otherwise the original when \`<video>\` can play it. \`url\` remains the original (download, archiving). Without a rendition, playback depends on the codecs of the file: H.264 (MP4, MOV) and VP8/VP9 (WebM) play everywhere, HEVC or AV1 depending on the browser. \`type\` contains double quotes: wrap the attribute in single quotes (or let your template engine escape it). With the poster (\`poster.url\`) and the text tracks (\`textTracks\`):

\`\`\`html
<video controls playsinline preload="metadata" crossorigin="anonymous" width="1920" height="1080"
       poster="https://media.example.com/m/cm…/v4/full/holidays.jpg">
  <source src="https://media.example.com/m/cm…/v4/renditions/av1.webm" type='video/webm; codecs="av01.0.08M.08, opus"'>
  <source src="https://media.example.com/m/cm…/v4/renditions/h264.mp4" type='video/mp4; codecs="avc1.640028, mp4a.40.2"'>
  <track kind="captions" srclang="en" label="English" src="https://media.example.com/m/cm…/v4/tracks/cm….vtt" default>
</video>
\`\`\`

The URLs of a private video (\`url\`, \`sources\`, tracks) are signed for about one hour and the player reuses them during the whole playback: for a long video, request a longer-lived link (\`POST …/signed-url\`, target \`file\`, \`expiresIn\` at least equal to the duration, 7 days at most), whose response also contains \`sources\`, signed until the same expiry.

**Waiting for processing**: no notification is sent (no webhook); read the media item again (\`GET …/media/{mediaId}\`) with \`If-None-Match\`, no more than once every 5 s, while \`processing.status\` is \`pending\` or \`processing\`: \`304\` while nothing changed, the \`ETag\` follows the progress. At \`ready\`, take \`url\`, \`sources\` and \`poster\` again (new URLs if the version changed). Lists also follow the processing state, but following a video goes through its media item.

**Converted formats**: only while processing is active, the server also accepts MKV, AVI, 3GP/3G2, MPEG-TS (and M2TS), OGV and WMV, which browsers do not play. The original is served as a download (\`Content-Disposition: attachment\`), \`width\`, \`height\` and \`duration\` are \`null\` until it is analysed, and \`sources\` stays empty until the H.264 rendition exists. Processing inactive: these formats are rejected (\`415 UNSUPPORTED_TYPE\`), even for a delegated token that lists them.

**Hold during clean-up**: until a device metadata track (often GPS positions) is removed, the original and the renditions of the video answer \`503\` (\`PROCESSING_PENDING\`, \`Retry-After\` header), through their public URL as through a signed link; this clean-up runs before any re-encoding and usually takes only a few seconds. The poster, derivatives and text tracks are still served. The cleaned file has a new version: read the media item again to get its new URLs. A final failure lifts the hold.

**Poster image** (\`PUT …/media/{mediaId}/poster\`): an image, normalised to JPEG, serves as the \`poster\` attribute (\`poster.url\`) and as the source of the video's derivatives (\`previewUrl\`, \`urlTemplate\`); without a poster, they are \`null\`. The first poster keeps the version; replacing or removing it increments it (new URLs). When processing is active, the server extracts a poster from a video that has none; an uploaded poster always wins. An application can also capture the frame in the browser, without waiting for the server:

\`\`\`js
const video = document.createElement('video')
video.muted = true
video.src = URL.createObjectURL(file) // the video chosen by the user
await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }))
video.currentTime = Math.min(video.duration * 0.1, 5)
await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }))
const canvas = Object.assign(document.createElement('canvas'), { width: video.videoWidth, height: video.videoHeight })
canvas.getContext('2d').drawImage(video, 0, 0)
const form = new FormData()
form.append('file', await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9)), 'poster.jpg')
form.append('time', String(video.currentTime))
await fetch(\`\${api}/projects/\${projectId}/media/\${mediaId}/poster\`, { method: 'PUT', headers: { Authorization: \`Bearer \${token}\` }, body: form })
\`\`\`

**Subtitles** (\`POST …/media/{mediaId}/tracks\`): WebVTT or SRT files (converted), checked then rewritten as WebVTT; \`textTracks\` gives for each one \`kind\`, \`language\`, \`label\`, \`default\` and \`url\`, to use in \`<track>\` elements. If the files come from another domain than the page, add \`crossorigin="anonymous"\` to \`<video>\` (delivery allows any origin). A private track is read through its signed URL, or a longer-lived link (\`POST …/signed-url\`, target \`track\`).

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

A non-canonical URL (parameter order, default values, \`dpr\`, \`jpeg\`) is redirected (\`301\`) to its canonical form; a valid URL is cached without limit (one week, then revalidated, for a project or installation preset, which can change). Depending on the project policy (\`transformPolicy\`), free parameters are accepted (\`open\`), signed only (\`signed\`: \`POST …/signed-url\`, or the signature of \`urlTemplate\` for a private media item) or refused (\`presets\`); presets are always served. Errors of \`/m/\` are JSON with a code in \`data.code\`: \`INVALID_TRANSFORM\` (400), \`TRANSFORM_NOT_ALLOWED\`, \`MEDIA_FORBIDDEN\`, \`SIGNATURE_INVALID\`, \`SIGNATURE_EXPIRED\` (403), \`TRANSFORM_QUOTA\` (429: 50 free derivatives per version, rate of new generations per IP address), \`SERVER_BUSY\` (503), \`PROCESSING_PENDING\` (503 with \`Retry-After\`: original or rendition of a video held while its metadata is removed, see “Videos”).`

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

/** Corps multipart d'une image d'affiche : l'image et l'instant capturé (facultatif). */
function posterBody(): Json {
  return {
    required: true,
    ...t('Image d\'affiche et instant capturé.', 'Poster image and captured moment.'),
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', format: 'binary', ...t('Image JPEG, PNG, WebP, AVIF ou GIF (première image) ; type détecté d\'après son contenu.', 'JPEG, PNG, WebP, AVIF or GIF image (first frame); type detected from its contents.') },
            time: { type: 'number', minimum: 0, ...t('Instant de la vidéo représenté, en secondes (image capturée dans la vidéo).', 'Moment of the video shown, in seconds (frame captured from the video).') },
          },
        },
      },
    },
  }
}

/** Corps multipart d'une piste de texte : le fichier WebVTT ou SRT et ses champs. */
function trackBody(): Json {
  const fields = (inputSchema(apiTextTrackFieldsSchema) as { properties?: Json, required?: string[] })
  return {
    required: true,
    ...t('Fichier de sous-titres et champs de la piste.', 'Subtitle file and track fields.'),
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['file', ...(fields.required ?? [])],
          properties: {
            file: { type: 'string', format: 'binary', ...t('Fichier WebVTT (`.vtt`) ou SubRip (`.srt`), 1 Mio au plus.', 'WebVTT (`.vtt`) or SubRip (`.srt`) file, 1 MiB at most.') },
            ...(fields.properties ?? {}),
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
  registry.add(apiMediaSourceSchema, { id: 'MediaSource' })
  registry.add(apiMediaProcessingSchema, { id: 'MediaProcessing' })
  registry.add(apiTextTrackSchema, { id: 'TextTrack' })
  registry.add(apiTextTrackListSchema, { id: 'TextTrackList' })
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
      trackId: { name: 'trackId', in: 'path', required: true, ...t('Identifiant de la piste de texte.', 'Text track id.'), schema: { type: 'string' } },
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
      PosterUpload: posterBody(),
      TrackUpload: trackBody(),
      TrackUpdate: jsonBody(apiTextTrackUpdateSchema, true, t('Champs de la piste à modifier.', 'Track fields to update.')),
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
      TextTrack: json('TextTrack', t('Piste de texte.', 'Text track.')),
      TextTrackCreated: json('TextTrack', t('Piste de texte créée.', 'Text track created.')),
      TextTrackList: json('TextTrackList', t('Pistes de texte de la vidéo.', 'Text tracks of the video.')),
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

/** Corps de fichier lus en flux (multipart) ; tout autre corps est lu en mémoire, borné (server/lib/http/body.ts). */
const UPLOAD_BODIES = new Set(['MediaUpload', 'FileReplace', 'PosterUpload', 'TrackUpload'])

/** Erreurs de lecture du corps : envoi interrompu par inactivité, ou corps JSON trop volumineux ou trop lent. */
function bodyErrors(requestBody: unknown): ApiErrorCode[] {
  if (!requestBody) return []
  const name = (requestBody as { $ref?: unknown }).$ref
  return typeof name === 'string' && UPLOAD_BODIES.has(name.split('/').pop()!) ? ['UPLOAD_TIMEOUT'] : ['BODY_TOO_LARGE', 'REQUEST_TIMEOUT']
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

    const known = [...(codes as string[]).filter((code): code is ApiErrorCode => code in API_ERRORS), ...bodyErrors(rest.requestBody)]
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
