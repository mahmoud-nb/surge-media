import {
  ACCEPTED_MIME_TYPES,
  DEFAULT_UPLOAD_SIZES,
  ENABLED_MEDIA_KINDS,
  MEDIA_SIZE_CEILING,
  type MediaKind,
  mediaKindForMime,
  type UploadSizes,
} from '#shared/utils/media'

/**
 * Limites d'envoi par genre (architecture phase D, DD4) : images `NUXT_MEDIA_MAX_UPLOAD_SIZE` (25 Mio),
 * vidéos `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE` (512 Mio), toutes plafonnées à `MEDIA_SIZE_CEILING`
 * (2 Gio − 1 : colonne `Media.size` en entier 32 bits). Le genre est connu dès les premiers octets
 * reçus : la limite s'applique pendant la réception (upload.ts). Les vidéos converties (MKV, AVI…,
 * phase D3) ont la limite des vidéos.
 *
 * Types acceptés : ceux de l'installation (`baseTypes` : `ACCEPTED_MIME_TYPES`, ou
 * `acceptedMimeTypes(traitement actif)` pour un envoi de média), restreints par ceux d'un jeton délégué
 * ou d'un usage précis (affiche) — **jamais élargis** : un jeton qui cite le MKV ne l'ouvre pas quand le
 * traitement des vidéos est inactif.
 */

/** Règles d'un envoi : types acceptés (refus immédiat d'un autre), taille selon le type, genre imposé (remplacement). */
export interface UploadRules {
  acceptedTypes: readonly string[]
  maxSizeFor: (mimeType: string) => number
  /** Remplacement d'un fichier : un autre genre est refusé dès les premiers octets (422 KIND_MISMATCH). */
  expectedKind?: MediaKind
}

/**
 * Valeurs configurées → limites valides (fonction pure, testée) : absente ou invalide → défaut du genre,
 * au-delà du plafond → plafond (avec un avertissement).
 */
export function resolveUploadSizes(raw: Partial<Record<MediaKind, unknown>>, warn: (message: string) => void = () => {}): UploadSizes {
  const sizes: UploadSizes = {}
  for (const kind of ENABLED_MEDIA_KINDS) {
    const fallback = DEFAULT_UPLOAD_SIZES[kind] ?? DEFAULT_UPLOAD_SIZES.IMAGE!
    const value = Number(raw[kind])
    if (raw[kind] === undefined || raw[kind] === '' || !Number.isInteger(value) || value < 1) {
      if (raw[kind] !== undefined && raw[kind] !== '') warn(`limite d'envoi ${kind} invalide (${String(raw[kind])}) : ${fallback} octets`)
      sizes[kind] = fallback
    }
    else if (value > MEDIA_SIZE_CEILING) {
      warn(`limite d'envoi ${kind} ramenée au plafond de ${MEDIA_SIZE_CEILING} octets (Media.size, entier 32 bits)`)
      sizes[kind] = MEDIA_SIZE_CEILING
    }
    else {
      sizes[kind] = value
    }
  }
  return sizes
}

/**
 * Règles d'envoi (pure) : types de l'installation (`baseTypes`), restreints s'il y a lieu à `acceptedTypes`
 * (intersection, dans l'ordre de `baseTypes`), avec un plafond éventuel (contrainte d'un jeton délégué).
 */
export function rulesFor(
  sizes: UploadSizes,
  acceptedTypes?: readonly string[],
  cap?: number,
  baseTypes: readonly string[] = ACCEPTED_MIME_TYPES,
): UploadRules {
  return {
    acceptedTypes: acceptedTypes ? baseTypes.filter(type => acceptedTypes.includes(type)) : baseTypes,
    maxSizeFor(mimeType) {
      const kind = mediaKindForMime(mimeType)
      const size = kind ? sizes[kind] ?? 0 : 0
      return cap === undefined ? size : Math.min(size, cap)
    },
  }
}

/**
 * Plus grande taille admise par des règles (pré-contrôle `Content-Length`, avant de connaître le type).
 * 0 quand l'intersection ne laisse aucun type : `receiveUpload` refuse alors d'emblée (415), avant ce
 * pré-contrôle.
 */
export function largestSize(rules: UploadRules): number {
  return Math.max(0, ...rules.acceptedTypes.map(type => rules.maxSizeFor(type)))
}

let cached: UploadSizes | undefined

/** Limites de l'installation (runtimeConfig.media), lues une fois par processus. */
export function useUploadSizes(): UploadSizes {
  if (!cached) {
    const media = useRuntimeConfig().media as Record<string, unknown>
    cached = resolveUploadSizes(
      { IMAGE: media.maxUploadSize, VIDEO: media.maxVideoUploadSize },
      message => console.warn(`[surge-media] ${message}`),
    )
  }
  return cached
}

/**
 * Règles d'envoi de l'installation : `baseTypes` = types que l'installation accepte en ce moment (envoi
 * de média : `acceptedMimeTypes(await videoProcessingActive())`), `acceptedTypes` = restriction éventuelle.
 */
export function uploadRules(acceptedTypes?: readonly string[], cap?: number, baseTypes: readonly string[] = ACCEPTED_MIME_TYPES): UploadRules {
  return rulesFor(useUploadSizes(), acceptedTypes, cap, baseTypes)
}
