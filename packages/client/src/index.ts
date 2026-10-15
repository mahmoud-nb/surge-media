/**
 * @surge-media/client — client TypeScript sans framework de surgeMedia : API v1 (lectures en cache ETag,
 * clé publique ou jetons délégués renouvelés, erreurs traduites) et construction des URL d'images et de
 * vidéos (transformations canoniques, srcset, `<picture>`, point d'intérêt).
 */
export { createSurgeClient, normalizeBaseUrl } from './client'
export type { SurgeClient, SurgeClientOptions } from './client'
export { decodeDelegatedToken } from './credentials'
export type { Credential, CredentialKind, DelegatedTokenClaims, TokenProvider, TokenResult } from './credentials'
export { isSurgeApiError, parseRetryAfter, SurgeApiError } from './errors'
export type { ProblemFieldError } from './errors'
export { formatBitrate, formatBytes, formatClock, formatDuration, formatPercent } from './format'
export type { RequestOptions } from './http'
export { CLIENT_MESSAGES, DEFAULT_LOCALE, errorMessage, resolveLocale } from './i18n'
export type { ClientMessages, ErrorCode } from './i18n'
export { isSignedTemplate, transformMode } from './policy'
export type { TransformMode } from './policy'
export { isProcessing, watchMedia } from './processing'
export type { WatchMediaOptions } from './processing'
export type * from './types'
export { focalObjectPosition, objectPosition } from './urls/focal'
export { FORMAT_MIME_TYPES, mediaUrl, posterUrl, PRESET_NAME_PATTERN, requestSegment } from './urls/media-url'
export type { MediaUrlOptions } from './urls/media-url'
export { ALL_FORMATS, imageFormat, pictureFormats } from './urls/picture'
export {
  BUILTIN_PRESETS,
  DEFAULT_DENSITIES,
  DEFAULT_WIDTHS,
  densityCandidates,
  derivedSourceSize,
  presetCandidates,
  srcsetAttribute,
  widthCandidates,
} from './urls/srcset'
export type { DensitySrcsetOptions, SrcsetCandidate, WidthSrcsetOptions } from './urls/srcset'
export { buildTransform, DEFAULT_MAX_DIMENSION, outputSize, parseTransform, transformSegment } from './urls/transform'
export type {
  TransformFit,
  TransformFlip,
  TransformGravity,
  TransformOptions,
  TransformRegion,
  TransformRotation,
} from './urls/transform'
