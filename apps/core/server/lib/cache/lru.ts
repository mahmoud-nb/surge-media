/**
 * Cache mémoire L1 (par processus) : LRU borné avec durée de vie par entrée. Sert aux chemins
 * chauds (identités des jetons, état des projets, métadonnées de diffusion, révisions) ; chaque
 * écriture locale invalide son entrée, les autres instances voient le changement à l'expiration.
 * Un cache partagé (Redis via le stockage Nitro) pourra s'ajouter en second niveau (architecture § 9.9).
 */
export interface LruCache<V> {
  get: (key: string) => V | undefined
  set: (key: string, value: V, ttlMs?: number) => void
  delete: (key: string) => void
  /** Supprime les entrées dont la valeur vérifie le prédicat (ex. tous les jetons d'un compte). */
  deleteWhere: (predicate: (value: V) => boolean) => void
  clear: () => void
  readonly size: number
}

export function createLruCache<V>(options: { max: number, ttlMs: number, now?: () => number }): LruCache<V> {
  const now = options.now ?? Date.now
  const entries = new Map<string, { value: V, expires: number }>()

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (entry.expires <= now()) {
        entries.delete(key)
        return undefined
      }
      // Ordre d'insertion = ordre d'utilisation : l'entrée lue passe en dernier.
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key, value, ttlMs = options.ttlMs) {
      entries.delete(key)
      entries.set(key, { value, expires: now() + ttlMs })
      while (entries.size > options.max) entries.delete(entries.keys().next().value!)
    },
    delete(key) {
      entries.delete(key)
    },
    deleteWhere(predicate) {
      for (const [key, entry] of entries) if (predicate(entry.value)) entries.delete(key)
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}
