import type { DemoResource } from '#shared/utils/demo'

/**
 * Routes d'écriture et mode démo (architecture : .claude/architecture-demo.md, § 6). Chaque route
 * d'écriture de `server/api` est classée ici (test de couverture : tests/demo-routes.test.ts) :
 *   - gardée : refusée (`403 DEMO_READ_ONLY`) quand elle vise un élément du contenu de référence ;
 *   - permise : création, lecture, liens, connexion… (`DEMO_ALLOWED_WRITES`).
 * Fonctions pures ; la lecture des dates de création est faite par server/middleware/demo.ts.
 */

export type DemoTarget
  /** Élément désigné par un paramètre du chemin. */
  = | { kind: 'param', resource: Exclude<DemoResource, 'member' | 'setting'>, param: string }
  /** Adhésion d'un compte à un projet (`:id` = projet, `:userId` = compte). */
    | { kind: 'member' }
  /** Médias désignés par le champ `ids` du corps (classement en lot). */
    | { kind: 'body-ids', resource: 'media' }
  /** Compte de la session (ses propres réglages de double authentification). */
    | { kind: 'session' }
  /** Réglage global de l'installation : toujours refusé en démo. */
    | { kind: 'setting' }
  /** Politique des transformations : celle du projet `?project=` (gardée comme le projet), sinon réglage global. */
    | { kind: 'project-query' }

export interface DemoGuardedRoute {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Chemin avec paramètres `:nom` (même forme que la liste des fichiers de `server/api`). */
  path: string
  target: DemoTarget
}

const media = (param: string): DemoTarget => ({ kind: 'param', resource: 'media', param })
const SETTING: DemoTarget = { kind: 'setting' }

export const DEMO_GUARDED_ROUTES: readonly DemoGuardedRoute[] = [
  // Administration : médias et pistes (les pistes suivent leur média).
  { method: 'PATCH', path: '/api/admin/media', target: { kind: 'body-ids', resource: 'media' } },
  { method: 'POST', path: '/api/admin/media/tags', target: { kind: 'body-ids', resource: 'media' } },
  { method: 'DELETE', path: '/api/admin/media/:id', target: media('id') },
  { method: 'PATCH', path: '/api/admin/media/:id', target: media('id') },
  { method: 'PUT', path: '/api/admin/media/:id/file', target: media('id') },
  { method: 'POST', path: '/api/admin/media/:id/move', target: media('id') },
  { method: 'DELETE', path: '/api/admin/media/:id/poster', target: media('id') },
  { method: 'PUT', path: '/api/admin/media/:id/poster', target: media('id') },
  { method: 'POST', path: '/api/admin/media/:id/prepare', target: media('id') },
  { method: 'POST', path: '/api/admin/media/:id/process', target: media('id') },
  { method: 'POST', path: '/api/admin/media/:id/restore', target: media('id') },
  { method: 'POST', path: '/api/admin/media/:id/tracks', target: media('id') },
  { method: 'DELETE', path: '/api/admin/media/:id/tracks/:trackId', target: media('id') },
  { method: 'PATCH', path: '/api/admin/media/:id/tracks/:trackId', target: media('id') },
  { method: 'PUT', path: '/api/admin/media/:id/tracks/:trackId/file', target: media('id') },
  // Dossiers, préréglages, projets et ce qui en dépend.
  { method: 'DELETE', path: '/api/admin/folders/:id', target: { kind: 'param', resource: 'folder', param: 'id' } },
  { method: 'PATCH', path: '/api/admin/folders/:id', target: { kind: 'param', resource: 'folder', param: 'id' } },
  { method: 'DELETE', path: '/api/admin/presets/:id', target: { kind: 'param', resource: 'preset', param: 'id' } },
  { method: 'PATCH', path: '/api/admin/presets/:id', target: { kind: 'param', resource: 'preset', param: 'id' } },
  // Étiquettes (globales ou d'un projet) : celles de l'exemple restent ; un visiteur crée les siennes.
  { method: 'DELETE', path: '/api/admin/tags/:id', target: { kind: 'param', resource: 'tag', param: 'id' } },
  { method: 'PATCH', path: '/api/admin/tags/:id', target: { kind: 'param', resource: 'tag', param: 'id' } },
  { method: 'DELETE', path: '/api/admin/projects/:id', target: { kind: 'param', resource: 'project', param: 'id' } },
  { method: 'PATCH', path: '/api/admin/projects/:id', target: { kind: 'param', resource: 'project', param: 'id' } },
  { method: 'DELETE', path: '/api/admin/projects/:id/keys/:keyId', target: { kind: 'param', resource: 'key', param: 'keyId' } },
  { method: 'POST', path: '/api/admin/projects/:id/keys/:keyId/revoke', target: { kind: 'param', resource: 'key', param: 'keyId' } },
  { method: 'POST', path: '/api/admin/projects/:id/keys/:keyId/rotate', target: { kind: 'param', resource: 'key', param: 'keyId' } },
  { method: 'DELETE', path: '/api/admin/projects/:id/members/:userId', target: { kind: 'member' } },
  { method: 'PATCH', path: '/api/admin/projects/:id/members/:userId', target: { kind: 'member' } },
  { method: 'DELETE', path: '/api/admin/projects/:id/origins/:originId', target: { kind: 'param', resource: 'origin', param: 'originId' } },
  { method: 'DELETE', path: '/api/admin/tokens/:id', target: { kind: 'param', resource: 'token', param: 'id' } },
  { method: 'POST', path: '/api/admin/tokens/:id/revoke', target: { kind: 'param', resource: 'token', param: 'id' } },
  // Comptes : ceux de la démo restent tels quels (mot de passe, MFA, sessions des autres visiteurs).
  { method: 'DELETE', path: '/api/admin/users/:id', target: { kind: 'param', resource: 'user', param: 'id' } },
  { method: 'PATCH', path: '/api/admin/users/:id', target: { kind: 'param', resource: 'user', param: 'id' } },
  { method: 'DELETE', path: '/api/admin/users/:id/mfa', target: { kind: 'param', resource: 'user', param: 'id' } },
  { method: 'POST', path: '/api/admin/users/:id/password-link', target: { kind: 'param', resource: 'user', param: 'id' } },
  { method: 'POST', path: '/api/admin/users/:id/password-link/email', target: { kind: 'param', resource: 'user', param: 'id' } },
  { method: 'DELETE', path: '/api/admin/users/:id/sessions', target: { kind: 'param', resource: 'user', param: 'id' } },
  { method: 'DELETE', path: '/api/admin/users/:id/trusted-devices', target: { kind: 'param', resource: 'user', param: 'id' } },
  { method: 'DELETE', path: '/api/auth/mfa', target: { kind: 'session' } },
  { method: 'POST', path: '/api/auth/mfa/enable', target: { kind: 'session' } },
  { method: 'POST', path: '/api/auth/mfa/recovery-codes', target: { kind: 'session' } },
  { method: 'POST', path: '/api/auth/mfa/setup', target: { kind: 'session' } },
  // Réglages globaux.
  { method: 'PUT', path: '/api/admin/security', target: SETTING },
  { method: 'PATCH', path: '/api/admin/transforms', target: { kind: 'project-query' } },
  { method: 'PUT', path: '/api/admin/license', target: SETTING },
  { method: 'DELETE', path: '/api/admin/license', target: SETTING },
  { method: 'PUT', path: '/api/admin/license/usage', target: SETTING },
  { method: 'POST', path: '/api/admin/video-processing/backfill', target: SETTING },
  // API v1.
  { method: 'DELETE', path: '/api/v1/projects/:projectId/folders/:folderId', target: { kind: 'param', resource: 'folder', param: 'folderId' } },
  { method: 'PATCH', path: '/api/v1/projects/:projectId/folders/:folderId', target: { kind: 'param', resource: 'folder', param: 'folderId' } },
  { method: 'DELETE', path: '/api/v1/projects/:projectId/media/:mediaId', target: media('mediaId') },
  { method: 'PATCH', path: '/api/v1/projects/:projectId/media/:mediaId', target: media('mediaId') },
  { method: 'PUT', path: '/api/v1/projects/:projectId/media/:mediaId/file', target: media('mediaId') },
  { method: 'DELETE', path: '/api/v1/projects/:projectId/media/:mediaId/poster', target: media('mediaId') },
  { method: 'PUT', path: '/api/v1/projects/:projectId/media/:mediaId/poster', target: media('mediaId') },
  { method: 'POST', path: '/api/v1/projects/:projectId/media/:mediaId/tracks', target: media('mediaId') },
  { method: 'DELETE', path: '/api/v1/projects/:projectId/media/:mediaId/tracks/:trackId', target: media('mediaId') },
  { method: 'PATCH', path: '/api/v1/projects/:projectId/media/:mediaId/tracks/:trackId', target: media('mediaId') },
]

/** Routes d'écriture permises en démo : elles créent, lisent ou n'agissent que sur la session. */
export const DEMO_ALLOWED_WRITES: readonly string[] = [
  'POST /api/admin/folders',
  'POST /api/admin/media',
  'POST /api/admin/media/:id/duplicate',
  'POST /api/admin/media/:id/links',
  'POST /api/admin/media/:id/signed-url',
  'POST /api/admin/presets',
  'POST /api/admin/projects',
  'POST /api/admin/projects/:id/keys',
  'POST /api/admin/projects/:id/members',
  'POST /api/admin/projects/:id/origins',
  'POST /api/admin/tags',
  'POST /api/admin/tokens',
  'POST /api/admin/users',
  'POST /api/auth/confirm-password',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/mfa/verify',
  'POST /api/auth/password/:token',
  'DELETE /api/auth/trusted-devices',
  'POST /api/v1/projects/:projectId/delegated-tokens',
  'POST /api/v1/projects/:projectId/folders',
  'POST /api/v1/projects/:projectId/media',
  'POST /api/v1/projects/:projectId/media/:mediaId/duplicate',
  'POST /api/v1/projects/:projectId/media/:mediaId/signed-url',
  'POST /api/v1/projects/:projectId/signed-urls',
]

interface CompiledRoute {
  route: DemoGuardedRoute
  pattern: RegExp
  names: string[]
}

const COMPILED: CompiledRoute[] = DEMO_GUARDED_ROUTES.map((route) => {
  const names: string[] = []
  const source = route.path.split('/').map((segment) => {
    if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    names.push(segment.slice(1))
    return '([^/]+)'
  }).join('/')
  return { route, pattern: new RegExp(`^${source}/?$`), names }
})

/** Route gardée correspondant à la requête, avec ses paramètres décodés ; null si la route n'est pas gardée. */
export function matchDemoRoute(method: string, pathname: string): { route: DemoGuardedRoute, params: Record<string, string> } | null {
  const upper = method.toUpperCase()
  for (const { route, pattern, names } of COMPILED) {
    if (route.method !== upper) continue
    const found = pattern.exec(pathname)
    if (!found) continue
    const params: Record<string, string> = {}
    try {
      names.forEach((name, index) => {
        params[name] = decodeURIComponent(found[index + 1]!)
      })
    }
    catch {
      // Encodage invalide : la route répondra elle-même (404).
      return null
    }
    return { route, params }
  }
  return null
}

/** Identifiants `ids` d'un corps de classement en lot (valeurs inattendues ignorées, 100 au plus comme la route). */
export function bodyIds(body: unknown): string[] {
  const ids = (body as { ids?: unknown } | null)?.ids
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, 100) : []
}
