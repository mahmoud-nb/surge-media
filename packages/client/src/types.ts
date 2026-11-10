/**
 * Représentations de l'API v1 de surgeMedia (contrat : apps/core/shared/schemas/api.ts). Écrites à la main
 * pour rester lisibles et stables ; un test de contrat (tests/contract.test.ts) vérifie qu'elles restent
 * identiques aux schémas du serveur. Valeurs en minuscules, dates ISO 8601, URL absolues.
 */

export type MediaKind = 'image' | 'video'
export type MediaVisibility = 'public' | 'private'
export type TransformFormat = 'jpg' | 'png' | 'webp' | 'avif'
export type TransformPolicy = 'open' | 'signed' | 'presets'
export type TokenScope = 'project:read' | 'media:read' | 'media:upload' | 'media:write' | 'media:delete' | 'tags:manage'
export type TextTrackKind = 'subtitles' | 'captions' | 'descriptions' | 'chapters'
export type RenditionName = 'av1' | 'h264'
export type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type ProcessingError
  = | 'NO_VIDEO_TRACK'
    | 'UNREADABLE'
    | 'CONVERSION_FAILED'
    | 'TOO_LONG'
    | 'TIMEOUT'
    | 'SOURCE_MISSING'
    | 'FFMPEG_UNAVAILABLE'
export type MediaSort = 'newest' | 'oldest' | 'name' | 'size'
export type PresetLevel = 'builtin' | 'global' | 'project'
export type CredentialType = 'personal' | 'secret' | 'publishable' | 'delegated'
/** Teinte d'affichage d'une étiquette (palette fixe du serveur). */
export type TagColor = 'gray' | 'red' | 'orange' | 'amber' | 'green' | 'teal' | 'blue' | 'violet'
/** `global` : commune à l'installation ; `project` : propre au projet. */
export type TagLevel = 'global' | 'project'
/** Filtre à plusieurs étiquettes : au moins une (`any`, défaut) ou toutes (`all`). */
export type TagMatch = 'any' | 'all'

/** Étiquette telle que la porte un média. */
export interface TagRef {
  id: string
  /** Identifiant des filtres (`tags`) et des affectations. */
  slug: string
  name: string
  color: TagColor
  level: TagLevel
}

/** Étiquette utilisable dans le projet (`client.tags.list()`). */
export interface Tag extends TagRef {
  /** Médias actifs du projet qui la portent (avec `withCounts`). */
  mediaCount?: number
  createdAt: string
  updatedAt: string
}

/** Point d'intérêt : fractions (0 à 1) de la largeur et de la hauteur, depuis le coin haut gauche. */
export interface FocalPoint {
  x: number
  y: number
}

/** Piste de texte d'une vidéo : élément `<track>`. */
export interface TextTrack {
  id: string
  kind: TextTrackKind
  /** Étiquette BCP 47 (`fr`, `en-GB`), attribut `srclang`. */
  language: string
  label: string
  default: boolean
  /** Fichier WebVTT ; signé pour un média privé. */
  url: string
  size: number
  cueCount: number
  createdAt: string
}

/** Image d'affiche d'une vidéo (JPEG entier ; autres tailles et formats : `urlTemplate`). */
export interface Poster {
  url: string
  width: number
  height: number
  time: number | null
}

/** Source de lecture d'une vidéo : élément `<source src type>`, dans l'ordre de préférence. */
export interface MediaSource {
  url: string
  /** Type MIME avec ses codecs (RFC 6381). */
  type: string
  width: number | null
  height: number | null
  bitrate: number | null
  size: number
  /** Rendu du serveur (`av1`, `h264`) ; null : le fichier original. */
  rendition: RenditionName | null
}

/** Traitement d'une vidéo par le serveur : état de sa dernière tâche. */
export interface MediaProcessing {
  status: ProcessingStatus
  /** Avancement du réencodage en cours (0 à 1), null hors réencodage. */
  progress: number | null
  /** Code de l'échec, au statut `failed` seulement (un code inconnu reste un échec). */
  error: ProcessingError | null
  updatedAt: string
}

export interface Media {
  id: string
  /** Projet ; null = bibliothèque de l'organisation. */
  projectId: string | null
  kind: MediaKind
  visibility: MediaVisibility
  title: string | null
  altText: string | null
  filename: string
  mimeType: string
  extension: string | null
  size: number
  /** Dimensions affichées (orientation appliquée) ; null pour un format vidéo converti pas encore analysé. */
  width: number | null
  height: number | null
  duration: number | null
  version: number
  folderId: string | null
  /** Étiquettes du média : globales puis du projet, par nom. */
  tags: TagRef[]
  /** Fichier original ; signé (temporaire) pour un média privé. */
  url: string
  sources: MediaSource[]
  previewUrl: string | null
  /** Gabarit des dérivés : `{transform}` et `{format}` à remplacer ; null sans dérivé possible. */
  urlTemplate: string | null
  poster: Poster | null
  textTracks: TextTrack[]
  processing: MediaProcessing | null
  focalPoint: FocalPoint | null
  /** Échéance des URL signées ; null pour un média public (URL permanentes). */
  urlExpiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MediaList {
  items: Media[]
  nextCursor: string | null
  total?: number
}

export interface MediaListQuery {
  q?: string
  kind?: MediaKind
  visibility?: MediaVisibility
  /** Dossier : identifiant, ou `root` pour les médias hors dossier. */
  folder?: string
  recursive?: boolean
  /** Étiquettes (slugs) : seulement les médias qui les portent, selon `tagMatch` ; absent = tous les médias. */
  tags?: string[]
  /** Avec plusieurs étiquettes : au moins une (`any`, défaut) ou toutes (`all`). */
  tagMatch?: TagMatch
  /** Seulement les médias sans étiquette (incompatible avec `tags`). */
  untagged?: boolean
  sort?: MediaSort
  limit?: number
  cursor?: string
  withTotal?: boolean
}

export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  publicListing: boolean
  transformPolicy: TransformPolicy
  /** Formats de sortie des dérivés activés sur le serveur. */
  transformFormats: TransformFormat[]
  /** Largeur et hauteur maximales d'un dérivé, en pixels. */
  transformMaxDimension: number
  scopes: TokenScope[]
  createdAt: string
  updatedAt: string
}

export interface Preset {
  name: string
  /** Paramètres appliqués, forme canonique sans format (vide pour `full`). */
  transformation: string
  description: string | null
  level: PresetLevel
}

export interface UploadConstraints {
  maxFiles?: number
  maxSize?: number
  types?: string[]
  visibility?: MediaVisibility
  folderId?: string
}

/** Type de fichier accepté par les règles d'envoi (`GET /me`, champ `upload.types`). */
export interface UploadTypeRule {
  /** Type MIME, reconnu par le serveur d'après le contenu du fichier. */
  mimeType: string
  /** Extension canonique (`jpg`, `mp4`…). */
  extension: string
  kind: MediaKind
  /** Taille maximale d'un fichier de ce type, en octets. */
  maxSize: number
  /** Format vidéo lu par son rendu H.264 (MKV, AVI…), accepté pendant que le traitement des vidéos est actif. */
  converted: boolean
}

/** Règles d'envoi effectives d'un identifiant (`GET /me`, champ `upload`). */
export interface UploadRules {
  /** Types acceptés en ce moment, dans l'ordre de l'installation. */
  types: UploadTypeRule[]
  /** Envois encore permis par un jeton délégué limité (`maxFiles`) ; null : pas de limite de nombre. */
  remaining: number | null
  /** Visibilité imposée par le jeton délégué. */
  visibility: MediaVisibility | null
  /** Dossier imposé par le jeton délégué. */
  folderId: string | null
}

/** Champs d'un envoi (`multipart/form-data`, à côté du fichier) ; ceux qu'impose un jeton délégué l'emportent. */
export interface UploadFields {
  title?: string
  /** Texte alternatif (accessibilité). */
  altText?: string
  /** `public` par défaut. */
  visibility?: MediaVisibility
  /** Dossier du projet (hors dossier par défaut). */
  folderId?: string
  /** Étiquettes du nouveau média (slugs). */
  tags?: string[]
}

interface ProjectRef {
  id: string
  name: string
  slug: string
}

export interface Me {
  credential: {
    id: string
    type: CredentialType
    name: string
    prefix: string
    environment: string | null
    scopes: TokenScope[]
    expiresAt: string | null
    createdAt: string
  }
  delegated: {
    subject: string | null
    origin: string | null
    upload: UploadConstraints | null
  } | null
  user: { id: string, name: string | null } | null
  project: (ProjectRef & { archived: boolean }) | null
  access: {
    allProjects: boolean
    library: boolean
    projects: ProjectRef[]
  } | null
  /** Règles d'envoi effectives ; null sans la portée `media:upload`. */
  upload: UploadRules | null
}
