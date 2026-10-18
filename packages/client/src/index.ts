/**
 * @surge-media/client — client TypeScript sans framework de surgeMedia : API v1 (lectures en cache ETag,
 * clé publique ou jetons délégués renouvelés, erreurs traduites), construction des URL d'images et de
 * vidéos (transformations canoniques, srcset, `<picture>`, point d'intérêt) et envoi de fichiers (règles
 * du serveur, file d'envoi avec progression, affiche capturée). Logique des composants commune à toutes les
 * librairies (Vue, React, Svelte…) : textes fr / en, icônes, attributs et styles en ligne, états. Thème
 * facultatif : `@surge-media/client/style.css`. Côté serveur : `@surge-media/client/server`.
 */
export { createSurgeClient, normalizeBaseUrl } from './client'
export type { PosterOptions, SurgeClient, SurgeClientOptions, UploadOptions } from './client'
export { decodeDelegatedToken } from './credentials'
export type { Credential, CredentialKind, DelegatedTokenClaims, TokenProvider, TokenResult } from './credentials'
export { isSurgeApiError, parseRetryAfter, SurgeApiError } from './errors'
export type { ProblemExtensions, ProblemFieldError } from './errors'
export { formatBitrate, formatBytes, formatClock, formatDuration, formatPercent } from './format'
export type { RequestOptions } from './http'
export { CLIENT_MESSAGES, DEFAULT_LOCALE, errorMessage, resolveLocale } from './i18n'
export type { ClientMessages, ErrorCode } from './i18n'
export { isSignedTemplate, transformMode } from './policy'
export type { TransformMode } from './policy'
export { isProcessing, watchMedia } from './processing'
export type { WatchMediaOptions } from './processing'
export { DEFAULT_REFRESH_BEFORE_MS, refreshDelay } from './refresh'
export type * from './types'
export { DEV_MODE } from './ui/dev'
export { COMPONENT_MESSAGES, createTranslate } from './ui/i18n'
export type { ComponentMessages, DeepPartial, Translate } from './ui/i18n'
export { ICON_SIZE, ICONS, iconSvgAttributes } from './ui/icons'
export type { IconName, IconNode } from './ui/icons'
export {
  imageErrorFrameStyle,
  imageFailedEarly,
  imageRequest,
  imageSource,
  imageStyle,
  nextImageStage,
  resolveAltText,
} from './ui/image'
export type { ImageFrameStyle, ImageOptions, ImageStage, ImageStyle, LoadedImage } from './ui/image'
export { pictureSources } from './ui/picture'
export type { PictureArtSource, PictureOptions, PictureSources, PictureSourceTag } from './ui/picture'
export { displaySettings, knownPresets, projectSettings } from './ui/settings'
export type { DisplayDefaults, DisplaySettings, ProjectSettings } from './ui/settings'
export { PROCESSING_ICONS, processingAnnouncementKey, processingProgress, processingReason, processingVisible } from './ui/status'
export { cssText, VISUALLY_HIDDEN } from './ui/styles'
export {
  kindIcon,
  kindLabelKey,
  thumbnailFrameStyle,
  thumbnailIconSizes,
  thumbnailImageStyle,
  thumbnailSource,
} from './ui/thumbnail'
export {
  awaitingUploads,
  canCancelUpload,
  canRemoveUpload,
  canRetryUpload,
  PERMANENT_UPLOAD_ERRORS,
  previewableUpload,
  sentUploads,
  showsUploadError,
  showsVisibilityChoice,
  takeSettledUploads,
  uploaderAccept,
  uploaderFields,
  uploaderKinds,
  uploadHelpLines,
  uploadStatusText,
} from './ui/uploader'
export type { SettledUploads, UploaderFieldOptions, UploadHelpLine } from './ui/uploader'
export {
  heldVideoDelay,
  prefersReducedMotion,
  VIDEO_EMPTY_POSTER_STYLE,
  VIDEO_FRAME_STYLE,
  VIDEO_LAYER_STYLE,
  VIDEO_PLAYER_STYLE,
  VIDEO_RETRY_LIMIT,
  videoEmptyStyle,
  videoLabel,
  videoMessageKey,
  videoPoster,
  videoSize,
  whenNearViewport,
} from './ui/video'
export type { VideoPosterOptions } from './ui/video'
export { fileExtension, typeLabels, UPLOAD_FILE_TYPES } from './upload/file-types'
export { createUploadQueue } from './upload/queue'
export type { UploadItem, UploadQueue, UploadQueueOptions, UploadStatus } from './upload/queue'
export type { UploadProgress } from './upload/request'
export {
  acceptAttribute,
  acceptedExtensions,
  checkFile,
  fileKind,
  matchFileType,
  maxSizeFor,
  rulesTypes,
  uploadKinds,
} from './upload/rules'
export type { FileLike } from './upload/rules'
export { canCaptureVideoFrame, captureVideoFrame } from './upload/video-frame'
export type { CapturedFrame } from './upload/video-frame'
export { focalObjectPosition, focusPosition, objectPosition } from './urls/focal'
export { imageSourceSet, parseAspect } from './urls/image-sources'
export type { ImageSourceRequest, ImageSourceSet, ImageTransform } from './urls/image-sources'
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
