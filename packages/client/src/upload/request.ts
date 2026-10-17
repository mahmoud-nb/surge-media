import { SurgeApiError } from '../errors'

/**
 * Envoi d'un fichier en `multipart/form-data` (architecture phase E, ED33) : XMLHttpRequest dans un
 * navigateur, seul moyen fiable d'y suivre la progression d'un envoi ; `fetch` ailleurs (Node, edge),
 * sans progression. Les champs texte partent avant le fichier : le serveur les connaît dès qu'il lit
 * celui-ci. La réponse est rendue telle quelle (statut, corps, en-têtes) : erreurs et nouvel essai sont
 * traités par la couche HTTP (http.ts).
 */

/** Avancement d'un envoi. */
export interface UploadProgress {
  /** Octets envoyés (enveloppe multipart comprise). */
  loaded: number
  /** Octets à envoyer. */
  total: number
  /** Fraction envoyée, de 0 à 1. */
  fraction: number
}

export interface MultipartRequest {
  method: 'POST' | 'PUT'
  /** Champs texte (valeurs absentes ignorées). */
  fields?: Readonly<Record<string, string | undefined>>
  file: Blob
  /** Nom du fichier (par défaut celui du `File`). */
  filename?: string
  signal?: AbortSignal
  onProgress?: (progress: UploadProgress) => void
}

/** Réponse reçue, corps JSON lu (null sans corps JSON). */
export interface RawResponse {
  status: number
  body: unknown
  header: (name: string) => string | null
}

/** Erreur d'annulation, comme celle de `fetch`. */
export function abortError(): Error {
  return typeof DOMException === 'function'
    ? new DOMException('The upload was aborted.', 'AbortError')
    : Object.assign(new Error('The upload was aborted.'), { name: 'AbortError' })
}

function networkError(cause?: unknown): SurgeApiError {
  return new SurgeApiError({ status: 0, code: 'NETWORK_ERROR', detail: cause instanceof Error ? cause.message : null, cause })
}

function multipartBody(request: MultipartRequest): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(request.fields ?? {})) if (value !== undefined) form.append(name, value)
  const filename = request.filename ?? (typeof File === 'function' && request.file instanceof File ? request.file.name : 'file')
  form.append('file', request.file, filename)
  return form
}

function parseJson(text: string, contentType: string | null): unknown {
  if (!text || !(contentType ?? '').includes('json')) return null
  try {
    return JSON.parse(text) as unknown
  }
  catch {
    return null
  }
}

function sendWithXhr(url: string, headers: Record<string, string>, request: MultipartRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const onAbort = () => xhr.abort()
    const settle = () => request.signal?.removeEventListener('abort', onAbort)
    xhr.open(request.method, url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.responseType = 'text'
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : request.file.size
      request.onProgress?.({ loaded: event.loaded, total, fraction: total > 0 ? Math.min(1, event.loaded / total) : 0 })
    }
    xhr.onload = () => {
      settle()
      resolve({
        status: xhr.status,
        body: parseJson(xhr.responseText, xhr.getResponseHeader('content-type')),
        header: name => xhr.getResponseHeader(name),
      })
    }
    xhr.onerror = () => {
      settle()
      reject(networkError())
    }
    xhr.ontimeout = xhr.onerror
    xhr.onabort = () => {
      settle()
      reject(abortError())
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    xhr.send(multipartBody(request))
  })
}

async function sendWithFetch(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, request: MultipartRequest): Promise<RawResponse> {
  let response: Response
  try {
    response = await fetchImpl(url, { method: request.method, headers, body: multipartBody(request), signal: request.signal })
  }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw networkError(error)
  }
  const text = await response.text().catch(() => '')
  return { status: response.status, body: parseJson(text, response.headers.get('content-type')), header: name => response.headers.get(name) }
}

/** Envoie un fichier : XMLHttpRequest s'il existe (progression), sinon `fetch`. */
export function sendMultipart(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, request: MultipartRequest): Promise<RawResponse> {
  if (request.signal?.aborted) return Promise.reject(abortError())
  return typeof XMLHttpRequest === 'function' ? sendWithXhr(url, headers, request) : sendWithFetch(fetchImpl, url, headers, request)
}
