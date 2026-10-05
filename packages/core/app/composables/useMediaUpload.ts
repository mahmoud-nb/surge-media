export interface MediaUploadResult {
  status: number
  body: unknown
}

export interface MediaRules {
  maxUploadSize: number
  acceptedTypes: Partial<Record<string, Record<string, string>>>
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

  /** Types acceptés, pour l'attribut `accept` et les textes d'aide. */
  function acceptedMimeTypes(rules: MediaRules): string[] {
    return Object.values(rules.acceptedTypes).flatMap(types => Object.keys(types ?? {}))
  }

  function acceptedExtensions(rules: MediaRules): string {
    return [...new Set(Object.values(rules.acceptedTypes).flatMap(types => Object.values(types ?? {})))]
      .map(extension => extension.toUpperCase())
      .join(', ')
  }

  /** Contrôle immédiat dans le navigateur (le serveur reste seul juge). */
  function precheck(file: File, rules: MediaRules): string | null {
    if (file.size > rules.maxUploadSize) {
      return t('media.errors.FILE_TOO_LARGE', { max: formatBytes(rules.maxUploadSize, locale.value) })
    }
    if (file.type && !acceptedMimeTypes(rules).includes(file.type)) {
      return t('media.errors.UNSUPPORTED_TYPE', { types: acceptedExtensions(rules) })
    }
    return null
  }

  /** Message traduit d'une réponse d'erreur de l'API médias. */
  function errorMessage(result: MediaUploadResult | null, rules?: MediaRules): string {
    const data = (result?.body as { data?: { code?: string } } | null)?.data
    switch (data?.code) {
      case 'FILE_TOO_LARGE':
        return t('media.errors.FILE_TOO_LARGE', { max: rules ? formatBytes(rules.maxUploadSize, locale.value) : '' })
      case 'UNSUPPORTED_TYPE':
        return t('media.errors.UNSUPPORTED_TYPE', { types: rules ? acceptedExtensions(rules) : '' })
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

  return { send, precheck, errorMessage, acceptedMimeTypes, acceptedExtensions }
}
