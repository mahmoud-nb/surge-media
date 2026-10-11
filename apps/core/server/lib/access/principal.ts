import type { H3Event } from 'h3'
import { API_CREDENTIAL_TYPES, type ApiCredentialType } from '#shared/utils/api'
import { isOriginAllowed } from '#shared/utils/origins'
import { credentialScopes, type TokenScope } from '#shared/utils/permissions'
import { getProjectState, type ProjectState } from '../projects/state'
import {
  credentialLibraryScopes,
  credentialProjectScopes,
  type CredentialFailure,
  type CredentialRecord,
  isBrowserRequest,
  resolveCredential,
  resolveCredentialById,
} from './credentials'
import { type DelegatedGrant, isDelegatedToken, toDelegatedGrant, verifyDelegatedToken } from './delegated'

/**
 * Identité d'un appel par `Authorization: Bearer` (API v1 et diffusion /m/) : identifiant opaque
 * (jeton personnel, clé secrète, clé publique) ou jeton délégué. Pour un jeton délégué, `credential`
 * est son **émetteur** : les droits effectifs sont l'intersection des portées du jeton et des
 * portées actuelles de l'émetteur, dans le seul projet du jeton (moteur pur `credentialScopes`).
 * Toute décision d'accès passe par ce module (jamais par `credential.type` seul).
 */

export interface Principal {
  /** Type présenté : personal, secret, publishable ou delegated. */
  type: ApiCredentialType
  /** Identifiant opaque présenté, ou émetteur du jeton délégué. */
  credential: CredentialRecord
  /** Jeton délégué présenté (null pour un identifiant opaque). */
  delegated: DelegatedGrant | null
}

export type PrincipalResolution = { ok: true, principal: Principal } | { ok: false, code: CredentialFailure }

/** Valeur de l'en-tête Bearer → identité valable, ou code d'erreur 401. */
export async function resolvePrincipal(value: string): Promise<PrincipalResolution> {
  if (!isDelegatedToken(value)) {
    const resolution = await resolveCredential(value)
    if (!resolution.ok) return resolution
    const { credential } = resolution
    return { ok: true, principal: { type: API_CREDENTIAL_TYPES[credential.type], credential, delegated: null } }
  }

  const decoded = verifyDelegatedToken(value)
  if (!decoded.ok) return decoded
  // Émetteur supprimé, révoqué, expiré ou propriétaire désactivé : le jeton délégué tombe avec lui.
  const issuer = await resolveCredentialById(decoded.claims.iss)
  if (!issuer.ok || issuer.credential.type === 'PUBLISHABLE') return { ok: false, code: 'TOKEN_REVOKED' }
  return { ok: true, principal: { type: 'delegated', credential: issuer.credential, delegated: toDelegatedGrant(decoded.claims) } }
}

/** Portées effectives dans un projet actif ; liste vide = projet invisible (404). */
export async function principalProjectScopes(principal: Principal, project: Pick<ProjectState, 'id'>): Promise<TokenScope[]> {
  const { delegated } = principal
  if (delegated && delegated.projectId !== project.id) return []
  const scopes = await credentialProjectScopes(principal.credential, project)
  if (!delegated) return scopes
  return credentialScopes({ type: 'DELEGATED', scopes: delegated.scopes, ownProject: true, issuerScopes: scopes })
}

/** Portées dans la bibliothèque : seulement un jeton personnel qui l'inclut (jamais un jeton délégué). */
export function principalLibraryScopes(principal: Principal): TokenScope[] {
  return principal.delegated ? [] : credentialLibraryScopes(principal.credential)
}

/**
 * Garde-fous liés au navigateur, ou null si l'appel est admis :
 *   - clé secrète ou jeton personnel : jamais depuis un navigateur (`SECRET_IN_BROWSER`) ;
 *   - clé publique, jeton délégué : si `Origin` est présent, il doit figurer parmi les origines
 *     autorisées du projet (et égaler l'origine du jeton délégué s'il en fixe une). Sans `Origin`
 *     (serveur, application mobile) : admis. Contrôle anti-abus, pas une frontière de sécurité :
 *     un client hors navigateur peut forger `Origin`.
 */
export async function browserGuard(event: H3Event, principal: Principal): Promise<'SECRET_IN_BROWSER' | 'ORIGIN_NOT_ALLOWED' | null> {
  if (principal.type === 'secret' || principal.type === 'personal') {
    return isBrowserRequest(event) ? 'SECRET_IN_BROWSER' : null
  }
  const origin = getRequestHeader(event, 'origin')
  if (!origin) return null
  if (principal.delegated?.origin && !isOriginAllowed(origin, [principal.delegated.origin])) return 'ORIGIN_NOT_ALLOWED'
  const projectId = principal.delegated?.projectId ?? principal.credential.projectId
  const project = projectId ? await getProjectState(projectId) : null
  return project && isOriginAllowed(origin, project.origins) ? null : 'ORIGIN_NOT_ALLOWED'
}
