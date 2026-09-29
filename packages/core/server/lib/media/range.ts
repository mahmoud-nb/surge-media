/**
 * Requêtes partielles HTTP (RFC 9110 § 14) pour la diffusion : une seule plage d'octets par
 * requête (les plages multiples, rarement utiles, reçoivent le fichier entier, ce que la RFC
 * autorise). Fonction pure, testée.
 */

export type RangeResolution =
  | { type: 'full' }
  | { type: 'partial', start: number, end: number }
  | { type: 'unsatisfiable' }

/**
 * `Range: bytes=<début>-<fin>`, `bytes=<début>-` ou `bytes=-<suffixe>` rapporté à la taille du
 * fichier. Syntaxe invalide ou non reconnue : fichier entier ; plage hors du fichier : 416.
 */
export function resolveRange(header: string | undefined, size: number): RangeResolution {
  if (!header) return { type: 'full' }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return { type: 'full' }
  const [, first, last] = match as unknown as [string, string, string]
  if (!first && !last) return { type: 'full' }

  if (!first) {
    const suffix = Number(last)
    if (suffix === 0 || size === 0) return { type: 'unsatisfiable' }
    return { type: 'partial', start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(first)
  const end = last ? Number(last) : size - 1
  if (last && end < start) return { type: 'full' }
  if (start >= size) return { type: 'unsatisfiable' }
  return { type: 'partial', start, end: Math.min(end, size - 1) }
}
