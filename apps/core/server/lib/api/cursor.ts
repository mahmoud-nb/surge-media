/**
 * Curseurs de pagination « keyset » (fonctions pures, testées) : coût constant quelle que soit la
 * page, résultats stables pendant les ajouts. Le curseur est opaque pour les clients (base64url
 * d'un JSON) ; il porte le tri, la valeur de tri et l'identifiant du dernier élément de la page.
 */

export type CursorValue = string | number

export interface Cursor {
  /** Tri pour lequel le curseur a été émis (refusé avec un autre tri). */
  sort: string
  value: CursorValue
  id: string
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.sort, cursor.value, cursor.id])).toString('base64url')
}

/** Curseur décodé, ou null s'il est illisible ou émis pour un autre tri. */
export function decodeCursor(raw: string, sort: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 3) return null
    const [cursorSort, value, id] = parsed as [unknown, unknown, unknown]
    if (cursorSort !== sort || typeof id !== 'string' || id.length > 64) return null
    if (typeof value !== 'string' && typeof value !== 'number') return null
    if (typeof value === 'string' && value.length > 512) return null
    return { sort: cursorSort, value, id }
  }
  catch {
    return null
  }
}
