/**
 * Types de médias, visibilités et codes d'erreur (partagés app / serveur).
 *
 * Ajouter un type de média (audio, document…) :
 *  1. déclarer ses types MIME dans ACCEPTED_MEDIA_TYPES et sa limite d'envoi par défaut ;
 *  2. reconnaître sa signature (server/lib/media/sniff.ts) ;
 *  3. écrire son gestionnaire côté serveur (server/lib/media/handlers/) et l'inscrire au registre.
 * Le schéma Prisma prévoit déjà les genres AUDIO et DOCUMENT. Vidéos : phase D (architecture-phase-d.md).
 */

export const MEDIA_KINDS = ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'OTHER'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const MEDIA_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const
export type MediaVisibility = (typeof MEDIA_VISIBILITIES)[number]

/**
 * Types acceptés par genre : type MIME (détecté d'après le contenu, jamais d'après le nom)
 * → extension canonique. SVG exclu (peut contenir du script). Vidéos (phase D1) : MP4, WebM et
 * QuickTime, stockées et servies telles qu'envoyées (MKV, AVI, 3GP, MPEG-TS… refusés : lecture
 * impossible ou aléatoire dans les navigateurs sans transcodage).
 */
export const ACCEPTED_MEDIA_TYPES: Partial<Record<MediaKind, Readonly<Record<string, string>>>> = {
  IMAGE: {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
  },
  VIDEO: {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  },
}

/** Tous les types acceptés par l'installation (traitement des vidéos inactif). */
export const ACCEPTED_MIME_TYPES: readonly string[] = Object.values(ACCEPTED_MEDIA_TYPES).flatMap(types => Object.keys(types ?? {}))

/**
 * Vidéos acceptées **seulement quand le traitement est actif** (phase D3, DD32) : type MIME → extension.
 * L'original est conservé (téléchargement) ; la lecture passe par le rendu H.264. FLV, MPEG-PS,
 * RealMedia restent refusés (rares, surface d'attaque inutile).
 */
export const CONVERTED_VIDEO_TYPES: Readonly<Record<string, string>> = {
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/mp2t': 'ts',
  'video/ogg': 'ogv',
  'video/x-ms-wmv': 'wmv',
}
export const CONVERTED_MIME_TYPES: readonly string[] = Object.keys(CONVERTED_VIDEO_TYPES)

/** Types acceptés selon que le traitement des vidéos est actif ou non. */
export function acceptedMimeTypes(videoProcessingActive: boolean): readonly string[] {
  return videoProcessingActive ? [...ACCEPTED_MIME_TYPES, ...CONVERTED_MIME_TYPES] : ACCEPTED_MIME_TYPES
}

/**
 * Taille maximale stockable (octets) : `Media.size` est un entier 32 bits sous PostgreSQL et MySQL.
 * Au-delà, il faudra passer la colonne en BigInt (migration).
 */
export const MEDIA_SIZE_CEILING = 2_147_483_647

/** Limites d'envoi par défaut, par genre (NUXT_MEDIA_MAX_UPLOAD_SIZE, NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE). */
export const DEFAULT_UPLOAD_SIZES: Readonly<Partial<Record<MediaKind, number>>> = {
  IMAGE: 25 * 1024 * 1024,
  VIDEO: 512 * 1024 * 1024,
}

/** Limite d'envoi par genre activé. */
export type UploadSizes = Partial<Record<MediaKind, number>>

export const ENABLED_MEDIA_KINDS = Object.keys(ACCEPTED_MEDIA_TYPES) as MediaKind[]

export function mediaKindForMime(mimeType: string): MediaKind | undefined {
  if (mimeType in CONVERTED_VIDEO_TYPES) return 'VIDEO'
  return ENABLED_MEDIA_KINDS.find(kind => mimeType in (ACCEPTED_MEDIA_TYPES[kind] ?? {}))
}

export function extensionForMime(mimeType: string): string | undefined {
  if (mimeType in CONVERTED_VIDEO_TYPES) return CONVERTED_VIDEO_TYPES[mimeType]
  const kind = mediaKindForMime(mimeType)
  return kind ? ACCEPTED_MEDIA_TYPES[kind]?.[mimeType] : undefined
}

/** Durées proposées pour les liens temporaires vers un média privé (secondes). */
export const SIGNED_URL_DURATIONS = [3600, 86_400, 604_800] as const
export const SIGNED_URL_MAX_TTL = 604_800

/** Codes d'erreur métier renvoyés par l'API médias (`data.code`), traduits par l'interface. */
export const MEDIA_ERROR_CODES = [
  'NO_FILE', // aucun fichier dans la requête
  'MULTIPART_REQUIRED', // la requête n'est pas un envoi multipart/form-data
  'FILE_TOO_LARGE', // taille maximale dépassée (data.maxSize)
  'UNSUPPORTED_TYPE', // type détecté non accepté
  'UNREADABLE_FILE', // fichier corrompu ou illisible
  'DIMENSIONS_TOO_LARGE', // image trop grande (protection contre les « bombes de décompression »)
  'KIND_MISMATCH', // remplacement par un fichier d'un autre genre
  'VERSION_CONFLICT', // le fichier a été remplacé entre-temps
  'NOT_IN_TRASH', // suppression définitive d'un média qui n'est pas dans la corbeille
  'IN_TRASH', // action impossible sur un média dans la corbeille (lien, duplication, déplacement)
  'MEDIA_FORBIDDEN', // média privé sans autorisation
  'SIGNATURE_INVALID', // lien signé altéré ou obsolète
  'SIGNATURE_EXPIRED', // lien signé expiré
  'SERVER_BUSY', // file des traitements d'images pleine : réessayer dans quelques secondes (503)
  'UPLOAD_TIMEOUT', // envoi arrêté : aucune donnée reçue pendant 60 s (408, data.timeout en secondes)
  'INVALID_TRANSFORM', // transformation d'URL invalide, hors bornes ou zone hors de l'image (400)
  'TRANSFORM_QUOTA', // quota de dérivés de la version ou débit de nouvelles générations atteint (429)
  'TRANSFORM_NOT_ALLOWED', // transformation libre refusée par la politique de l'espace (403)
  'TRACK_NOT_FOUND', // piste de texte inconnue pour cette vidéo (404)
  'TRACK_LIMIT_REACHED', // nombre maximal de pistes de texte atteint pour cette vidéo (409)
  'INVALID_TEXT_TRACK', // fichier de sous-titres illisible (422, data.line, data.detail)
  'PROCESSING_DISABLED', // traitement des vidéos inactif (aucun mode, ou aucun processus de travail vu) (409)
  'PROCESSING_PENDING', // diffusion retenue tant qu'une piste de métadonnées n'est pas retirée (503, Retry-After)
] as const
export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number]
