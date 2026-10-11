import type { TransformPolicy } from '#shared/utils/transforms'
import { createLruCache } from '../cache/lru'

/**
 * État d'un projet lu à chaque requête de l'API v1 et de la diffusion (existence, archivage, liste
 * publique, origines CORS, politique et préréglages de transformation) : 60 s en mémoire, invalidé
 * localement par les écritures (réglages, archivage, suppression, origines, préréglages).
 * Architecture § 9.6 ; phase C § 9.2.
 */
export interface ProjectPresetState {
  id: string
  name: string
  /** Transformation canonique, sans format. */
  transformation: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ProjectState {
  id: string
  name: string
  slug: string
  description: string | null
  archived: boolean
  publicListing: boolean
  transformPolicy: TransformPolicy
  createdAt: Date
  updatedAt: Date
  /** Origines autorisées normalisées (shared/utils/origins.ts). */
  origins: string[]
  /** Préréglages propres au projet, triés par nom. */
  presets: ProjectPresetState[]
}

const cache = createLruCache<ProjectState | null>({ max: 5000, ttlMs: 60_000 })

export async function getProjectState(id: string): Promise<ProjectState | null> {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const prisma = await usePrisma()
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      allowedOrigins: { select: { origin: true } },
      transformPresets: {
        select: { id: true, name: true, transformation: true, description: true, createdAt: true, updatedAt: true },
        orderBy: { name: 'asc' },
      },
    },
  })
  const state = project
    ? {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        archived: project.archivedAt !== null,
        publicListing: project.publicListing,
        transformPolicy: project.transformPolicy,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        origins: project.allowedOrigins.map(({ origin }) => origin),
        presets: project.transformPresets,
      }
    : null
  cache.set(id, state, state ? undefined : 10_000)
  return state
}

export function invalidateProjectState(id: string): void {
  cache.delete(id)
}
