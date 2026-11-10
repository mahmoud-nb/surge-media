import { apiDelegatedTokenBodySchema } from '#shared/schemas/api'
import { isOriginAllowed } from '#shared/utils/origins'
import { DELEGATED_TOKEN_SCOPES } from '#shared/utils/permissions'
import { issueDelegatedToken } from '../../../../lib/access/delegated'
import { requireFolderInSpace } from '../../../../lib/folders/service'
import { defineApiHandler, readApiBody, requireApiProject } from '../../../../lib/api/context'
import { apiProblem } from '../../../../lib/api/problem'

defineRouteMeta({
  openAPI: {
    'operationId': 'createDelegatedToken',
    'tags': ['delegated-tokens'],
    'summary': 'Émettre un jeton délégué',
    'description': 'Votre serveur authentifie son utilisateur, puis demande un jeton de quelques minutes pour un composant dans le navigateur : limité à ce projet, aux portées demandées (toutes détenues par l\'émetteur ici) et aux contraintes d\'envoi (`upload`). Échéance bornée par celle de l\'émetteur ; révoquer l\'émetteur invalide ses jetons délégués. La charge du jeton (`DelegatedTokenClaims`) est lisible par le composant.',
    'x-scopes': ['project:read'],
    'x-credentials': ['secret', 'personal'],
    'x-errors': [
      'INVALID_REQUEST',
      'CREDENTIAL_NOT_ALLOWED',
      'ORIGIN_NOT_ALLOWED',
      'FOLDER_NOT_FOUND',
      'PROJECT_NOT_FOUND',
      'PROJECT_ARCHIVED',
      'INSUFFICIENT_SCOPE',
    ],
    'requestBody': { $ref: '#/components/requestBodies/DelegatedTokenRequest' },
    'responses': { 201: { $ref: '#/components/responses/DelegatedToken' } },
    'x-i18n': {
      en: {
        summary: 'Issue a delegated token',
        description: 'Your server authenticates its user, then requests a token of a few minutes for an in-browser component: limited to this project, to the requested scopes (all held by the issuer here) and to the upload constraints (`upload`). Its expiry is capped by that of the issuer; revoking the issuer invalidates its delegated tokens. The token payload (`DelegatedTokenClaims`) is readable by the component.',
      },
    },
  },
})

/**
 * POST /api/v1/projects/:projectId/delegated-tokens — { scopes, expiresIn?, subject?, origin?, upload? }
 * Émet un jeton délégué `sm_dt_…` pour un composant dans le navigateur : le backend du client
 * authentifie son utilisateur, puis demande un jeton de quelques minutes limité à ce projet, aux
 * portées demandées (toutes détenues par l'émetteur ici) et aux contraintes d'envoi.
 * Émetteur : clé secrète ou jeton personnel (jamais une clé publique ni un jeton délégué).
 * Échéance bornée par celle de l'émetteur ; révoquer l'émetteur invalide ses jetons délégués.
 * Pas d'inscription au journal d'audit (émission fréquente) : les écritures faites avec le jeton,
 * elles, portent l'émetteur et le sujet. → 201 { token, expiresAt, scopes }
 * 400 INVALID_REQUEST · 403 CREDENTIAL_NOT_ALLOWED / INSUFFICIENT_SCOPE / ORIGIN_NOT_ALLOWED /
 * PROJECT_ARCHIVED · 404 PROJECT_NOT_FOUND / FOLDER_NOT_FOUND (`upload.folderId`).
 */
export default defineApiHandler(async (event, principal) => {
  if (principal.type !== 'secret' && principal.type !== 'personal') {
    throw apiProblem('CREDENTIAL_NOT_ALLOWED', 'Delegated tokens are issued by secret keys and personal tokens only.')
  }
  const { project, scopes } = await requireApiProject(event, principal, 'project:read')
  const body = await readApiBody(event, apiDelegatedTokenBodySchema)

  const missing = body.scopes.filter(scope => !scopes.includes(scope))
  if (missing.length > 0) {
    throw apiProblem('INSUFFICIENT_SCOPE', `This credential cannot delegate scopes it does not hold in this project: ${missing.join(', ')}.`)
  }
  if (body.origin && !isOriginAllowed(body.origin, project.origins)) {
    throw apiProblem('ORIGIN_NOT_ALLOWED', `The origin ${body.origin} is not among the allowed origins of this project.`)
  }
  if (body.upload?.folderId) await requireFolderInSpace({ type: 'project', id: project.id }, body.upload.folderId)

  const now = Math.floor(Date.now() / 1000)
  const issuerExpiry = principal.credential.expiresAt ? Math.floor(principal.credential.expiresAt.getTime() / 1000) : Number.POSITIVE_INFINITY
  const { token, claims } = issueDelegatedToken({
    issuerId: principal.credential.id,
    projectId: project.id,
    scopes: DELEGATED_TOKEN_SCOPES.filter(scope => body.scopes.includes(scope)),
    subject: body.subject,
    origin: body.origin,
    upload: body.upload && (body.upload.types ? { ...body.upload, types: [...new Set(body.upload.types)] } : body.upload),
    expires: Math.min(now + body.expiresIn, issuerExpiry),
  }, now)

  setResponseStatus(event, 201)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { token, expiresAt: new Date(claims.exp * 1000).toISOString(), scopes: claims.scopes }
})
