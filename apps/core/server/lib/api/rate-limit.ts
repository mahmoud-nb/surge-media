import { createLruCache } from '../cache/lru'

/**
 * Limitation de débit par seau à jetons (fonction pure, horloge injectable, testée) : chaque clé
 * dispose de `limit` requêtes, rechargées en continu sur `windowSeconds`. En mémoire du processus :
 * un déploiement multi-instances devra partager l'état (Redis, architecture § 6.7 et § 9.9).
 *
 * En-têtes du brouillon IETF « RateLimit header fields for HTTP » (httpapi-ratelimit-headers) :
 *   RateLimit-Policy: "<nom>";q=<limite>;w=<fenêtre>   RateLimit: "<nom>";r=<restant>;t=<secondes>
 */

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  /** Secondes avant que le seau soit plein. */
  reset: number
  /** Secondes avant la prochaine requête possible (si refusée). */
  retryAfter: number
}

interface Bucket {
  tokens: number
  updated: number
}

export function createTokenBucketLimiter(options: { maxKeys?: number, now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const buckets = createLruCache<Bucket>({ max: options.maxKeys ?? 50_000, ttlMs: 3_600_000, now })

  return {
    take(key: string, limit: number, windowSeconds = 60): RateLimitResult {
      const rate = limit / windowSeconds
      const time = now()
      const bucket = buckets.get(key) ?? { tokens: limit, updated: time }
      bucket.tokens = Math.min(limit, bucket.tokens + ((time - bucket.updated) / 1000) * rate)
      bucket.updated = time
      const allowed = bucket.tokens >= 1
      if (allowed) bucket.tokens -= 1
      buckets.set(key, bucket)
      return {
        allowed,
        limit,
        remaining: Math.floor(bucket.tokens),
        reset: Math.ceil((limit - bucket.tokens) / rate),
        retryAfter: allowed ? 0 : Math.max(1, Math.ceil((1 - bucket.tokens) / rate)),
      }
    },
  }
}

export function rateLimitHeaders(policy: string, result: RateLimitResult, windowSeconds = 60): Record<string, string> {
  return {
    'RateLimit-Policy': `"${policy}";q=${result.limit};w=${windowSeconds}`,
    'RateLimit': `"${policy}";r=${result.remaining};t=${result.reset}`,
  }
}
