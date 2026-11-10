import type { Space } from '../../utils/access'
import { createLruCache } from './lru'

/**
 * Compteurs de révision par espace (table CacheRevision) : toute écriture de médias dans un espace
 * l'incrémente. Les ETag des listes de l'API contiennent la révision : après une écriture, les
 * anciennes réponses ne correspondent plus (cache « générationnel », aucune purge à orchestrer).
 * La vérité est en base (partagée entre instances) ; lecture gardée 2 s en mémoire, invalidée
 * localement à chaque incrément.
 */

const cache = createLruCache<number>({ max: 5000, ttlMs: 2000 })

export function revisionScope(space: Space): string {
  return space.type === 'project' ? `project:${space.id}` : 'library'
}

/**
 * Révision des étiquettes **globales** (architecture-tags.md, TG10) : elles apparaissent dans les
 * réponses de tous les espaces ; les ETag les incluent par ce compteur unique plutôt que d'incrémenter
 * la révision de chaque projet à chaque modification.
 */
export const GLOBAL_TAGS_REVISION_SCOPE = 'tags'

export async function getRevision(space: Space): Promise<number> {
  return getScopeRevision(revisionScope(space))
}

export async function getGlobalTagsRevision(): Promise<number> {
  return getScopeRevision(GLOBAL_TAGS_REVISION_SCOPE)
}

export async function bumpGlobalTagsRevision(): Promise<void> {
  await bumpScopes([GLOBAL_TAGS_REVISION_SCOPE])
}

async function getScopeRevision(scope: string): Promise<number> {
  const cached = cache.get(scope)
  if (cached !== undefined) return cached
  const prisma = await usePrisma()
  const row = await prisma.cacheRevision.findUnique({ where: { scope } })
  const revision = row?.revision ?? 0
  cache.set(scope, revision)
  return revision
}

/**
 * Incrémente la révision des espaces touchés par une écriture. Ne lève jamais : un échec est
 * journalisé (les listes resteraient au plus en cache jusqu'à la prochaine écriture).
 */
export async function bumpRevision(...spaces: Space[]): Promise<void> {
  await bumpScopes([...new Set(spaces.map(revisionScope))])
}

async function bumpScopes(scopes: readonly string[]): Promise<void> {
  for (const scope of scopes) {
    cache.delete(scope)
    try {
      const prisma = await usePrisma()
      await prisma.cacheRevision.upsert({
        where: { scope },
        create: { scope, revision: 1 },
        update: { revision: { increment: 1 } },
      })
    }
    catch (error) {
      console.error(`[surge-media] Révision de cache « ${scope} » non incrémentée :`, error)
    }
  }
}
