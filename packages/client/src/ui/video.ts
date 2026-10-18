import { parseRetryAfter } from '../errors'
import { transformMode } from '../policy'
import type { Media } from '../types'
import { posterUrl } from '../urls/media-url'
import { imageFormat } from '../urls/picture'
import type { DisplaySettings } from './settings'

/**
 * Logique d'une vidéo dans le lecteur natif sans framework : affiche dimensionnée, taille et nom
 * accessible du lecteur, message sans source lisible, nouvel essai d'une vidéo retenue par le serveur
 * (503 `PROCESSING_PENDING`), chargement différé, mode ambiant, styles en ligne.
 */

export interface VideoPosterOptions {
  /** Image d'affiche : celle du média (vrai, par défaut), une URL, ou aucune (faux). */
  poster?: boolean | string
  /** Largeur de l'affiche demandée au serveur (par défaut : celle de l'affiche, 1280 px au plus). */
  posterWidth?: number
}

/** URL de l'affiche : dérivé à la largeur voulue, ou l'affiche telle quelle si seuls les préréglages sont permis. */
export function videoPoster(media: Media, options: VideoPosterOptions, display: DisplaySettings): string | undefined {
  if (options.poster === false) return undefined
  if (typeof options.poster === 'string') return options.poster
  if (!media.poster) return undefined
  if (transformMode(display.policy, media) === 'presets') return media.poster.url
  const width = options.posterWidth ?? Math.min(media.poster.width, 1280)
  return posterUrl(media, { width, format: imageFormat(display.formats, display.imageFormat), maxDimension: display.maxDimension }) ?? undefined
}

/** Dimensions du lecteur : celles demandées, sinon celles de la vidéo, sinon de son affiche. */
export function videoSize(media: Pick<Media, 'width' | 'height' | 'poster'>, options: { width?: number, height?: number } = {}): { width?: number, height?: number } {
  return {
    width: options.width ?? media.width ?? media.poster?.width ?? undefined,
    height: options.height ?? media.height ?? media.poster?.height ?? undefined,
  }
}

/** Nom accessible du lecteur : celui demandé, sinon le titre du média, sinon son texte alternatif. */
export function videoLabel(media: Pick<Media, 'title' | 'altText'>, label?: string): string | undefined {
  return label ?? media.title ?? media.altText ?? undefined
}

/**
 * Message d'une vidéo sans source lisible : « sera lisible dès que… » pendant la préparation, sinon
 * « ne peut pas être lue » (échec du traitement, aucune source jouable, `failed`).
 */
export function videoMessageKey(media: Pick<Media, 'processing'>, failed = false): 'video.unavailable' | 'video.noSource' {
  return failed || !media.processing || media.processing.status === 'failed' ? 'video.unavailable' : 'video.noSource'
}

/** Nouveaux essais d'une vidéo retenue par le serveur, au plus. */
export const VIDEO_RETRY_LIMIT = 10

/**
 * Après l'échec de la dernière source : requête `HEAD` sur `url`. Vidéo retenue par le serveur (503
 * `PROCESSING_PENDING`, piste de données en attente de traitement) → délai avant un nouvel essai (ms) :
 * `Retry-After` (30 s sans lui), entre 5 s et 5 min ; autre réponse ou erreur réseau → null (source
 * illisible).
 */
export async function heldVideoDelay(url: string, options: { fetch?: typeof fetch } = {}): Promise<number | null> {
  try {
    const response = await (options.fetch ?? fetch)(url, { method: 'HEAD', cache: 'no-store' })
    if (response.status !== 503) return null
    const delay = (parseRetryAfter(response.headers.get('retry-after')) ?? 30) * 1000
    return Math.min(Math.max(delay, 5000), 300_000)
  }
  catch {
    return null
  }
}

/** L'utilisateur limite les animations (`prefers-reduced-motion`) : pas de lecture automatique, même ambiante. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/**
 * Appelle `callback` une fois, quand l'élément approche de l'écran (`rootMargin`), ou tout de suite sans
 * `IntersectionObserver` ; rend la fonction qui arrête l'observation.
 */
export function whenNearViewport(element: Element, callback: () => void, rootMargin = '200px'): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback()
    return () => {}
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some(entry => entry.isIntersecting)) return
    observer.disconnect()
    callback()
  }, { rootMargin })
  observer.observe(element)
  return () => observer.disconnect()
}

/** Conteneur du lecteur. */
export const VIDEO_FRAME_STYLE = { position: 'relative', display: 'inline-block', maxWidth: '100%', verticalAlign: 'top' } as const

/** Lecteur : largeur fluide, rapport conservé. */
export const VIDEO_PLAYER_STYLE = { display: 'block', maxWidth: '100%', height: 'auto' } as const

/** Contenu posé au-dessus de l'affiche d'une vidéo sans source (message, état, lien). */
export const VIDEO_LAYER_STYLE = { position: 'relative' } as const

/** Affiche estompée derrière le message d'une vidéo sans source. */
export const VIDEO_EMPTY_POSTER_STYLE = { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', opacity: '0.35' } as const

/** Cadre d'une vidéo sans source lisible : place du lecteur réservée (640 px et 16:9 sans dimensions). */
export function videoEmptyStyle(width: number | undefined, height: number | undefined) {
  return {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    overflow: 'hidden',
    width: width ? `${width}px` : '640px',
    maxWidth: '100%',
    aspectRatio: width && height ? `${width} / ${height}` : '16 / 9',
  } as const
}
