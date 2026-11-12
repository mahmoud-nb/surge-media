/**
 * @surge-media/client/server — aide côté serveur (architecture phase E, ED37) : émission des jetons
 * délégués qu'une application remet au navigateur (`getToken` du client, composants). Utilise la clé
 * secrète du projet (ou un jeton personnel) : **jamais dans un navigateur** — l'entrée refuse de s'y
 * exécuter, et l'entrée principale du paquet ne l'importe jamais.
 *
 *   import { createDelegatedToken, UPLOAD_SCOPES } from '@surge-media/client/server'
 *   const token = await createDelegatedToken({ baseUrl, projectId, secretKey, scopes: UPLOAD_SCOPES, subject: user.id })
 */
import { normalizeBaseUrl } from './base-url'
import { errorFromResponse, SurgeApiError } from './errors'
import type { TokenScope, UploadConstraints } from './types'

/** Portées d'un jeton pour les composants d'affichage (médias privés compris). */
export const DISPLAY_SCOPES = ['project:read', 'media:read'] as const satisfies readonly TokenScope[]

/** Portées d'un jeton pour les composants d'envoi (affichage compris). */
export const UPLOAD_SCOPES = ['project:read', 'media:read', 'media:upload'] as const satisfies readonly TokenScope[]

export interface CreateDelegatedTokenOptions {
  /** Adresse de l'installation SurgeMedia (`https://media.example.com`, `…/api/v1` accepté). */
  baseUrl: string
  projectId: string
  /** Clé secrète du projet (`sm_sk_`) ou jeton personnel (`sm_pat_`) qui détient les portées demandées. */
  secretKey: string
  scopes: readonly TokenScope[]
  /** Durée de validité en secondes : 60 à 3600, 900 par défaut (côté serveur). */
  expiresIn?: number
  /** Identifiant opaque de l'utilisateur final (provenance des médias envoyés, journal d'audit). */
  subject?: string
  /** Origine exacte du site autorisé à utiliser le jeton (`https://app.example.com`). */
  origin?: string
  /** Contraintes d'envoi : nombre de fichiers, taille, types, visibilité et dossier imposés. */
  upload?: UploadConstraints
  fetch?: typeof fetch
  signal?: AbortSignal
}

/** Jeton émis, tel que `getToken()` du client l'accepte. */
export interface DelegatedToken {
  token: string
  expiresAt: string
  scopes: TokenScope[]
}

function inBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

/**
 * Émet un jeton délégué (`POST /api/v1/projects/:projectId/delegated-tokens`). Erreurs : `SurgeApiError`
 * (portée non détenue, origine non autorisée, contraintes invalides…) ; `SECRET_IN_BROWSER` dans un navigateur.
 */
export async function createDelegatedToken(options: CreateDelegatedTokenOptions): Promise<DelegatedToken> {
  if (inBrowser()) {
    throw new SurgeApiError({
      status: 0,
      code: 'SECRET_IN_BROWSER',
      detail: '@surge-media/client/server must run on your server: never send a secret key to a browser.',
    })
  }
  if (!options.secretKey) throw new TypeError('createDelegatedToken: secretKey is required.')
  if (!options.projectId) throw new TypeError('createDelegatedToken: projectId is required.')
  const { apiBaseUrl } = normalizeBaseUrl(options.baseUrl)
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const body = {
    scopes: [...options.scopes],
    ...(options.expiresIn === undefined ? {} : { expiresIn: options.expiresIn }),
    ...(options.subject === undefined ? {} : { subject: options.subject }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.upload === undefined ? {} : { upload: options.upload }),
  }
  let response: Response
  try {
    response = await fetchImpl(`${apiBaseUrl}/projects/${encodeURIComponent(options.projectId)}/delegated-tokens`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${options.secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    })
  }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new SurgeApiError({ status: 0, code: 'NETWORK_ERROR', detail: error instanceof Error ? error.message : null, cause: error })
  }
  if (!response.ok) throw await errorFromResponse(response)
  return await response.json() as DelegatedToken
}

export { isSurgeApiError, SurgeApiError } from './errors'
export type { TokenScope, UploadConstraints } from './types'
