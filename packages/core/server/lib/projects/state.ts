import { createLruCache } from '../cache/lru'

/**
 * État d'un projet lu à chaque requête de l'API v1 (existence, archivage, liste publique, origines
 * CORS) : 60 s en mémoire, invalidé localement par les écritures (réglages, archivage, suppression,
 * origines). Architecture § 9.6.
 */
export interface ProjectState {
  id: string
  name: string
  slug: string
  description: string | null
  archived: boolean
  publicListing: boolean
  createdAt: Date
  updatedAt: Date
  /** Origines autorisées normalisées (shared/utils/origins.ts). */
  origins: string[]
}

const cache = createLruCache<ProjectState | null>({ max: 5000, ttlMs: 60_000 })

export async function getProjectState(id: string): Promise<ProjectState | null> {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const prisma = await usePrisma()
  const project = await prisma.project.findUnique({
    where: { id },
    include: { allowedOrigins: { select: { origin: true } } },
  })
  const state = project
    ? {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        archived: project.archivedAt !== null,
        publicListing: project.publicListing,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        origins: project.allowedOrigins.map(({ origin }) => origin),
      }
    : null
  cache.set(id, state, state ? undefined : 10_000)
  return state
}

export function invalidateProjectState(id: string): void {
  cache.delete(id)
}
