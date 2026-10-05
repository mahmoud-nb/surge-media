import type { MediaKind } from '#shared/utils/media'
import { imageHandler } from './image'
import { videoHandler } from './video'
import type { MediaTypeHandler } from './types'

export type { InspectedMedia, MediaTypeHandler, RenderedVariant } from './types'

/**
 * Registre des gestionnaires. Chaque genre activé dans ACCEPTED_MEDIA_TYPES
 * (shared/utils/media.ts) doit avoir le sien ici.
 */
const HANDLERS: Partial<Record<MediaKind, MediaTypeHandler>> = {
  IMAGE: imageHandler,
  VIDEO: videoHandler,
}

export function handlerFor(kind: MediaKind): MediaTypeHandler | undefined {
  return HANDLERS[kind]
}
