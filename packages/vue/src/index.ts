/**
 * @surge-media/vue — composants Vue 3 de surgeMedia : images responsives (SmImage, SmPicture), vidéos
 * (SmVideo), affichage selon le genre (SmMedia), vignettes (SmThumbnail), état du traitement
 * (SmProcessingStatus). Feuille de style facultative : `import '@surge-media/vue/style.css'`.
 */
export { default as SmImage } from './components/SmImage.vue'
export { default as SmMedia } from './components/SmMedia.vue'
export { default as SmPicture } from './components/SmPicture.vue'
export type { PictureArtSource } from './components/SmPicture.vue'
export { default as SmProcessingStatus } from './components/SmProcessingStatus.vue'
export { default as SmThumbnail } from './components/SmThumbnail.vue'
export { default as SmVideo } from './components/SmVideo.vue'
export { useAltText, useTransformMode } from './composables/image'
export { useLiveMedia, useMedia } from './composables/media'
export type { UseMediaOptions, UseMediaResult } from './composables/media'
export { createSurgeMediaContext, SURGE_MEDIA_KEY, useSurgeMedia } from './context'
export type { ProjectSettings, SurgeMediaContext, SurgeMediaDefaults, SurgeMediaOptions } from './context'
export { BUILTIN_MESSAGES, createTranslate } from './i18n'
export type { DeepPartial, Messages, Translate } from './i18n'
export { imageSourceSet, parseAspect } from './image-sources'
export type { ImageSourceRequest, ImageSourceSet, ImageTransform } from './image-sources'
export { createSurgeMedia } from './plugin'
export type { SurgeMediaPlugin } from './plugin'
