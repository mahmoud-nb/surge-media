/**
 * Origines autorisées (CORS) d'un projet : normalisation de la saisie et correspondance avec
 * l'en-tête `Origin` d'une requête. Fonctions pures, partagées interface / serveur, testées.
 *
 * Forme acceptée : `schéma://hôte[:port]` (http ou https, sans chemin, requête, fragment ni
 * identifiants), ou un joker de sous-domaine en tête d'hôte : `https://*.example.com`.
 * Le joker couvre `a.example.com` et `a.b.example.com`, jamais `example.com` lui-même.
 */

import { ORIGIN_MAX_LENGTH } from './credentials'

const WILDCARD_PREFIX = '*.'

/** Hôte dont au moins deux libellés suivent le joker (refuse `*.com`), et qui n'est pas une adresse IP. */
function isWildcardBase(host: string): boolean {
  if (host.startsWith('[') || /^[\d.]+$/.test(host)) return false
  const labels = host.split('.')
  return labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
}

/**
 * Origine normalisée (minuscules, port par défaut retiré, sans « / » final), ou null si la saisie
 * n'est pas une origine valable.
 */
export function normalizeOrigin(input: string): string | null {
  const value = input.trim()
  if (!value || value.length > ORIGIN_MAX_LENGTH) return null

  const match = /^(https?):\/\/(.+)$/i.exec(value)
  if (!match) return null
  const scheme = match[1]!.toLowerCase()
  let rest = match[2]!.replace(/\/$/, '')
  const wildcard = rest.startsWith(WILDCARD_PREFIX)
  if (wildcard) rest = rest.slice(WILDCARD_PREFIX.length)
  if (!rest || /[/?#@\\*\s]/.test(rest)) return null

  let url: URL
  try {
    url = new URL(`${scheme}://${rest}`)
  }
  catch {
    return null
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
  if (wildcard && !isWildcardBase(url.hostname)) return null

  const origin = wildcard ? `${url.protocol}//${WILDCARD_PREFIX}${url.host}` : url.origin
  return origin.length <= ORIGIN_MAX_LENGTH ? origin : null
}

export function isWildcardOrigin(origin: string): boolean {
  return origin.includes(`://${WILDCARD_PREFIX}`)
}

/**
 * L'origine d'une requête (en-tête `Origin`) figure-t-elle parmi les origines autorisées
 * (déjà normalisées) ? Comparaison exacte, ou par joker de sous-domaine (même schéma et port).
 */
export function isOriginAllowed(requestOrigin: string, allowed: readonly string[]): boolean {
  let url: URL
  try {
    url = new URL(requestOrigin)
  }
  catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const origin = url.origin
  for (const entry of allowed) {
    if (entry === origin) return true
    if (!isWildcardOrigin(entry)) continue
    const [scheme, host] = entry.split(`://${WILDCARD_PREFIX}`) as [string, string]
    if (`${scheme}:` !== url.protocol) continue
    // host peut contenir un port : il doit correspondre exactement (url.host l'omet s'il est par défaut).
    if (url.host.endsWith(`.${host}`)) return true
  }
  return false
}
