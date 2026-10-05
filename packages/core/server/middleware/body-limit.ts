import type { IncomingMessage } from 'node:http'
import { BODY_MAX_SIZE, BODY_READ_TIMEOUT_MS, BodyReadError, readLimitedBody } from '../lib/http/body'

const PAYLOAD_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Borne la lecture du corps des requêtes : 1 Mio au plus (413 BODY_TOO_LARGE), reçu en 30 s au plus à
 * partir du moment où la route le lit (408 REQUEST_TIMEOUT). Voir server/lib/http/body.ts.
 *
 * Rien n'est lu ici : h3 (`readRawBody`, utilisé par `readBody`, `readValidatedBody`…) prend en priorité
 * `req.rawBody` ; on y place un « thenable » qui ne lit le corps — une seule fois — que lorsque la route
 * le demande, donc après ses contrôles d'accès. Les envois de fichiers lisent la requête en flux
 * (busboy) sans passer par `readRawBody` : ils ne sont pas concernés. À revérifier avec h3 2.
 */
export default defineEventHandler((event) => {
  if (!PAYLOAD_METHODS.has(event.method)) return
  const request = event.node.req as IncomingMessage & { rawBody?: unknown, body?: unknown }
  // Corps déjà fourni (appel interne `$fetch` pendant le rendu serveur : `body` posé par Nitro) : rien à lire.
  if (request.rawBody !== undefined || request.body !== undefined) return

  const declared = Number(request.headers['content-length'])
  const chunked = /\bchunked\b/i.test(String(request.headers['transfer-encoding'] ?? ''))
  // Sans corps annoncé : h3 répond `undefined` sans lire, comportement conservé.
  if (!(declared > 0) && !chunked) return

  let body: Promise<Buffer> | undefined
  const read = () => body ??= readLimitedBody(request, {
    maxBytes: BODY_MAX_SIZE,
    timeoutMs: BODY_READ_TIMEOUT_MS,
    declaredLength: declared > 0 ? declared : undefined,
  }).catch((error: unknown) => {
    if (!(error instanceof BodyReadError)) throw error
    // Le reste du corps n'est pas lu : la connexion est fermée après la réponse.
    setResponseHeader(event, 'Connection', 'close')
    throw error.reason === 'too_large'
      ? createError({
          statusCode: 413,
          statusMessage: 'BODY_TOO_LARGE',
          data: { code: 'BODY_TOO_LARGE', maxSize: BODY_MAX_SIZE, detail: `The request body exceeds ${BODY_MAX_SIZE} bytes.` },
        })
      : createError({
          statusCode: 408,
          statusMessage: 'REQUEST_TIMEOUT',
          data: { code: 'REQUEST_TIMEOUT', detail: `The request body was not received within ${BODY_READ_TIMEOUT_MS / 1000} s.` },
        })
  })
  const lazyBody: PromiseLike<Buffer> = {
    then(onFulfilled, onRejected) {
      return read().then(onFulfilled, onRejected)
    },
  }
  request.rawBody = lazyBody
})
