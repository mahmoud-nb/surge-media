import { MAX_ALLOWED_ORIGINS } from '#shared/utils/credentials'
import { isWildcardOrigin } from '#shared/utils/origins'
import type { AllowedOrigin } from '../../generated/prisma/client'
import { invalidateProjectState } from './state'

/**
 * Origines autorisées (CORS) d'un projet, pour tous ses environnements. Elles servent au
 * preflight et au contrôle des clés publiques de l'API v1 (jetons délégués : B4) ; la saisie
 * est normalisée par le schéma partagé (addOriginSchema).
 */

export function toOriginSummary(origin: AllowedOrigin) {
  return { id: origin.id, origin: origin.origin, wildcard: isWildcardOrigin(origin.origin), createdAt: origin.createdAt }
}

export async function listOrigins(projectId: string) {
  const prisma = await usePrisma()
  const origins = await prisma.allowedOrigin.findMany({ where: { projectId }, orderBy: [{ origin: 'asc' }] })
  return origins.map(toOriginSummary)
}

/** 409 ORIGIN_EXISTS (déjà autorisée) · 409 ORIGIN_LIMIT_REACHED (MAX_ALLOWED_ORIGINS). */
export async function addOrigin(projectId: string, origin: string) {
  const prisma = await usePrisma()
  if (await prisma.allowedOrigin.count({ where: { projectId } }) >= MAX_ALLOWED_ORIGINS) {
    throw credentialError(409, 'ORIGIN_LIMIT_REACHED')
  }
  try {
    const created = await prisma.allowedOrigin.create({ data: { projectId, origin } })
    invalidateProjectState(projectId)
    return toOriginSummary(created)
  }
  catch (error) {
    if (isUniqueViolation(error)) throw credentialError(409, 'ORIGIN_EXISTS')
    throw error
  }
}

export async function removeOrigin(projectId: string, originId: string): Promise<AllowedOrigin> {
  const prisma = await usePrisma()
  const origin = await prisma.allowedOrigin.findFirst({ where: { id: originId, projectId } })
  if (!origin) throw createError({ statusCode: 404, statusMessage: 'Origin not found' })
  await prisma.allowedOrigin.delete({ where: { id: origin.id } })
  invalidateProjectState(projectId)
  return origin
}
