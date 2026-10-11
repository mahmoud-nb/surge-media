export interface MediaUploadResult {
  status: number
  body: unknown
}

export interface MediaRules {
  /** Plus grande limite (compatibilité). */
  maxUploadSize: number
  /** Limite par genre (IMAGE, VIDEO). */
  maxUploadSizes?: Partial<Record<string, number>>
  acceptedTypes: Partial<Record<string, Record<string, string>>>
  /**
   * Traitement des vidéos (phase D3) : quand il est actif, `acceptedTypes.VIDEO` comprend déjà les
   * formats convertis après l'envoi, dont `convertedTypes` donne les extensions (mkv, avi…).
   */
  videoProcessing?: { mode: string, active: boolean, convertedTypes: readonly string[] }
}

/**
 * Types annoncés par certains systèmes pour des formats acceptés (le serveur reconnaît le contenu,
 * pas ce type) : pris en compte par le pré-contrôle et le sélecteur de fichiers. Un alias ne sert que
 * si son type cible est accepté (formats convertis : seulement quand le traitement est actif).
 */
const CLIENT_TYPE_ALIASES: Record<string, string> = {
  'video/x-m4v': 'video/mp4',
  'image/jpg': 'image/jpeg',
  // Formats convertis (D3) : types de Windows pour .ts/.m2ts/.mts et .avi, variantes d'AVI et d'ASF.
  'video/vnd.dlna.mpeg-tts': 'video/mp2t',
  'video/avi': 'video/x-msvideo',
  'video/msvideo': 'video/x-msvideo',
  'video/x-ms-asf': 'video/x-ms-wmv',
}

/**
 * Extensions reconnues en plus de celles de `convertedTypes` : MPEG-TS des caméscopes AVCHD (le
 * serveur les reconnaît comme video/mp2t, d'après leur contenu).
 */
const CONVERTED_EXTENSION_ALIASES: Record<string, readonly string[]> = {
  ts: ['mts', 'm2ts'],
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Envoi d'un fichier média avec suivi de progression (XMLHttpRequest : fetch ne permet pas
 * de suivre l'envoi). Même comportement que `$api` pour une session expirée (retour à /login).
 * Les messages d'erreur sont traduits à partir des codes métier de l'API (`data.code`).
 */
export function useMediaUpload() {
  const { t, locale } = useI18n()
  const route = useRoute()

  function send(url: string, file: File, fields: Record<string, string>, options: {
    method?: 'POST' | 'PUT'
    onProgress?: (percent: number) => void
  } = {}): Promise<MediaUploadResult> {
    return new Promise((resolve, reject) => {
      const form = new FormData()
      for (const [name, value] of Object.entries(fields)) form.append(name, value)
      form.append('file', file)

      const request = new XMLHttpRequest()
      request.open(options.method ?? 'POST', url)
      request.responseType = 'json'
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
      request.onload = async () => {
        if (request.status === 401) {
          await useUserSession().fetch()
          await navigateTo({ path: '/login', query: { redirect: route.fullPath, expired: '1' } })
        }
        resolve({ status: request.status, body: request.response })
      }
      request.onerror = () => reject(new Error('network'))
      request.send(form)
    })
  }

  /** Genres retenus : tous ceux de l'installation, ou ceux demandés (remplacement : le genre du média). */
  function kindsOf(rules: MediaRules, kinds?: readonly string[]): string[] {
    return Object.keys(rules.acceptedTypes).filter(kind => !kinds || kinds.includes(kind))
  }

  /** Types acceptés, pour l'attribut `accept` et les textes d'aide. */
  function acceptedMimeTypes(rules: MediaRules, kinds?: readonly string[]): string[] {
    const types = kindsOf(rules, kinds).flatMap(kind => Object.keys(rules.acceptedTypes[kind] ?? {}))
    const aliases = Object.entries(CLIENT_TYPE_ALIASES).filter(([, type]) => types.includes(type)).map(([alias]) => alias)
    return [...types, ...aliases]
  }

  /**
   * Extensions des formats convertis après l'envoi (« mkv », « avi »… plus « mts », « m2ts »), quand le
   * traitement des vidéos est actif et que les vidéos sont acceptées ; sinon aucune.
   */
  function convertedExtensions(rules: MediaRules, kinds?: readonly string[]): string[] {
    if (!rules.videoProcessing?.active || !kindsOf(rules, kinds).includes('VIDEO')) return []
    return [...new Set(rules.videoProcessing.convertedTypes.flatMap(extension => [extension, ...(CONVERTED_EXTENSION_ALIASES[extension] ?? [])]))]
  }

  /**
   * Valeur de l'attribut `accept` du champ de fichier : types (et alias), plus les extensions des formats
   * convertis, que les sélecteurs de fichiers ne rattachent pas toujours à un type (.mts, .m2ts, .ts…).
   */
  function acceptAttribute(rules: MediaRules, kinds?: readonly string[]): string {
    return [...acceptedMimeTypes(rules, kinds), ...convertedExtensions(rules, kinds).map(extension => `.${extension}`)].join(',')
  }

  /**
   * Extensions acceptées (« JPG, PNG… »), pour un genre ou tous. `withConverted: false` : sans les
   * formats convertis (texte d'aide qui les présente sur une ligne à part).
   */
  function acceptedExtensions(rules: MediaRules, kinds?: readonly string[], { withConverted = true } = {}): string {
    const converted = convertedExtensions(rules, kinds)
    const extensions = kindsOf(rules, kinds).flatMap(kind => Object.values(rules.acceptedTypes[kind] ?? {}))
    return [...new Set(withConverted ? [...extensions, ...converted] : extensions.filter(extension => !converted.includes(extension)))]
      .map(extension => extension.toUpperCase())
      .join(', ')
  }

  /** Limite d'envoi d'un genre. */
  function maxSizeFor(rules: MediaRules, kind: string): number {
    return rules.maxUploadSizes?.[kind] ?? rules.maxUploadSize
  }

  /**
   * Contrôle immédiat dans le navigateur d'après le type annoncé (le serveur reste seul juge du contenu).
   * Formats convertis : l'extension suffit, car les systèmes annoncent pour eux des types vides ou
   * fantaisistes (« text/vnd.trolltech.linguist » pour un .ts sous Linux, « model/vnd.mts »…).
   */
  function precheck(file: File, rules: MediaRules, kinds?: readonly string[]): string | null {
    const type = CLIENT_TYPE_ALIASES[file.type] ?? file.type
    const allowed = kindsOf(rules, kinds)
    const kind = (type ? allowed.find(candidate => type in (rules.acceptedTypes[candidate] ?? {})) : undefined)
      ?? (convertedExtensions(rules, kinds).includes(fileExtension(file.name)) ? 'VIDEO' : undefined)
    if (type && !kind) return t('media.errors.UNSUPPORTED_TYPE', { types: acceptedExtensions(rules, kinds) })
    // Type inconnu du navigateur : la plus grande limite (le serveur appliquera celle du genre reconnu).
    const max = kind ? maxSizeFor(rules, kind) : Math.max(0, ...allowed.map(candidate => maxSizeFor(rules, candidate)))
    if (file.size > max) return t('media.errors.FILE_TOO_LARGE', { max: formatBytes(max, locale.value) })
    return null
  }

  /** Message traduit d'une réponse d'erreur de l'API médias. */
  function errorMessage(result: MediaUploadResult | null, rules?: MediaRules, kinds?: readonly string[]): string {
    const data = (result?.body as { data?: { code?: string, maxSize?: unknown } } | null)?.data
    switch (data?.code) {
      case 'FILE_TOO_LARGE': {
        // Limite du genre reconnu par le serveur, sinon la plus grande.
        const max = typeof data.maxSize === 'number' ? data.maxSize : rules?.maxUploadSize
        return t('media.errors.FILE_TOO_LARGE', { max: max ? formatBytes(max, locale.value) : '' })
      }
      case 'UNSUPPORTED_TYPE':
        return t('media.errors.UNSUPPORTED_TYPE', { types: rules ? acceptedExtensions(rules, kinds) : '' })
      case 'UNREADABLE_FILE':
      case 'DIMENSIONS_TOO_LARGE':
      case 'KIND_MISMATCH':
      case 'VERSION_CONFLICT':
      case 'NO_FILE':
      case 'SERVER_BUSY':
        return t(`media.errors.${data.code}`)
      case 'UPLOAD_TIMEOUT':
        return t('media.errors.UPLOAD_TIMEOUT', { seconds: (data as { timeout?: number }).timeout ?? 60 })
      default:
        // Dossier de destination supprimé entre-temps, par exemple.
        return data?.code && (FOLDER_ERROR_CODES as readonly string[]).includes(data.code)
          ? t(`folders.errors.${data.code}`)
          : t('common.unexpectedError')
    }
  }

  return { send, precheck, errorMessage, acceptedMimeTypes, acceptAttribute, acceptedExtensions, convertedExtensions, kindsOf, maxSizeFor }
}
