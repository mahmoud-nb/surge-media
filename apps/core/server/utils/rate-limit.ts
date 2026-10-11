interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimiter {
  /** Secondes à attendre si la limite est atteinte, 0 sinon. */
  retryAfter: (key: string) => number
  hit: (key: string) => void
  reset: (key: string) => void
}

/**
 * Limiteur à fenêtre fixe, en mémoire du processus. Suffisant pour une instance
 * unique ; un déploiement multi-instances devra partager l'état (Redis via unstorage).
 */
export function createRateLimiter(options: { max: number, windowMs: number }): RateLimiter {
  const buckets = new Map<string, Bucket>()

  function current(key: string, now = Date.now()): Bucket | undefined {
    const bucket = buckets.get(key)
    if (bucket && bucket.resetAt <= now) {
      buckets.delete(key)
      return undefined
    }
    return bucket
  }

  return {
    retryAfter(key) {
      const bucket = current(key)
      return bucket && bucket.count >= options.max ? Math.ceil((bucket.resetAt - Date.now()) / 1000) : 0
    },
    hit(key) {
      const now = Date.now()
      const bucket = current(key, now)
      if (bucket) bucket.count++
      else buckets.set(key, { count: 1, resetAt: now + options.windowMs })
      // Purge opportuniste des fenêtres expirées pour borner la mémoire.
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
      }
    },
    reset(key) {
      buckets.delete(key)
    },
  }
}
