import type { Media } from '../../generated/prisma/client'
import type { Space } from '../../utils/access'
import { createLruCache } from '../cache/lru'
import { bumpRevision } from '../cache/revisions'

/**
 * Caches des médias (architecture § 9.2–9.3) :
 *   - métadonnées de diffusion (/m/) : ~10 000 médias, 60 s, invalidées localement à chaque écriture
 *     (les autres instances voient le changement au plus 60 s après) ;
 *   - dérivé déjà généré « (média, transformation) → fichier » : 10 min, sans requête MediaVariant à
 *     chaque affichage (une nouvelle version change la transformation, donc la clé).
 */

const mediaCache = createLruCache<Media | null>({ max: 10_000, ttlMs: 60_000 })
/** Média inconnu : gardé moins longtemps (limite les requêtes répétées sur des identifiants inexistants). */
const MISSING_TTL_MS = 10_000

export interface CachedVariant {
  key: string
  mimeType: string
  size: number
}
export const variantCache = createLruCache<CachedVariant>({ max: 20_000, ttlMs: 600_000 })

/** Média par identifiant (corbeille comprise) pour la diffusion, via le cache. */
export async function findDeliveryMedia(id: string): Promise<Media | null> {
  const cached = mediaCache.get(id)
  if (cached !== undefined) return cached
  const prisma = await usePrisma()
  const media = await prisma.media.findUnique({ where: { id } })
  mediaCache.set(id, media, media ? undefined : MISSING_TTL_MS)
  return media
}

export function invalidateMedia(...ids: string[]): void {
  for (const id of ids) mediaCache.delete(id)
}

/**
 * Après une écriture : métadonnées de diffusion invalidées et révision des espaces concernés
 * incrémentée (ETag des listes de l'API).
 */
export async function mediaChanged(ids: string[], ...spaces: Space[]): Promise<void> {
  invalidateMedia(...ids)
  await bumpRevision(...spaces)
}
