import type { Media, MediaRendition } from '../../generated/prisma/client'
import type { Space } from '../../utils/access'
import { createLruCache } from '../cache/lru'
import { bumpRevision } from '../cache/revisions'

/**
 * Caches des médias (architecture § 9.2–9.3) :
 *   - métadonnées de diffusion (/m/) : ~10 000 médias avec leurs rendus (phase D3), 60 s, invalidées
 *     localement à chaque écriture (les autres instances, et le serveur web pour les écritures d'un
 *     processus de travail séparé, voient le changement au plus 60 s après, ou dès qu'une URL plus
 *     récente que le cache est demandée : `reloadDeliveryMedia`) ;
 *   - dérivé déjà généré « (média, transformation) → fichier » : 10 min, sans requête MediaVariant à
 *     chaque affichage (une nouvelle version change la transformation, donc la clé).
 */

/** Média servi par /m/ : la ligne et ses rendus (une ligne par rendu, indépendante de la version). */
export type DeliveryMedia = Media & { renditions: MediaRendition[] }

interface DeliveryEntry {
  media: DeliveryMedia | null
  /** Lecture en base (ms) : borne les relectures forcées. */
  loadedAt: number
}

const mediaCache = createLruCache<DeliveryEntry>({ max: 10_000, ttlMs: 60_000 })
/** Média inconnu : gardé moins longtemps (limite les requêtes répétées sur des identifiants inexistants). */
const MISSING_TTL_MS = 10_000
/**
 * Relecture forcée au plus une fois par seconde et par média : une URL inventée (version future, rendu
 * absent, dérivé d'une vidéo sans affiche) ne contourne pas le cache à chaque requête ; une écriture faite
 * ailleurs est vue au plus 1 s après.
 */
const RELOAD_INTERVAL_MS = 1_000

export interface CachedVariant {
  key: string
  mimeType: string
  size: number
}
export const variantCache = createLruCache<CachedVariant>({ max: 20_000, ttlMs: 600_000 })

async function loadDeliveryMedia(id: string): Promise<DeliveryMedia | null> {
  const prisma = await usePrisma()
  const media = await prisma.media.findUnique({ where: { id }, include: { renditions: true } })
  mediaCache.set(id, { media, loadedAt: Date.now() }, media ? undefined : MISSING_TTL_MS)
  return media
}

/** Média par identifiant (corbeille comprise) pour la diffusion, avec ses rendus, via le cache. */
export async function findDeliveryMedia(id: string): Promise<DeliveryMedia | null> {
  const cached = mediaCache.get(id)
  if (cached !== undefined) return cached.media
  return loadDeliveryMedia(id)
}

/**
 * Média relu en base, sans attendre l'expiration du cache : demande d'une version plus récente que celle
 * du cache, d'un rendu ou d'une affiche de vidéo qu'il ne connaît pas (écrits par un processus de travail
 * ou une autre instance, dont l'invalidation ne nous parvient pas ; delivery.ts, `deliveryReloadNeeded`).
 * Une entrée lue il y a moins d'une seconde est reprise telle quelle.
 */
export async function reloadDeliveryMedia(id: string): Promise<DeliveryMedia | null> {
  const cached = mediaCache.get(id)
  if (cached !== undefined && Date.now() - cached.loadedAt < RELOAD_INTERVAL_MS) return cached.media
  return loadDeliveryMedia(id)
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
