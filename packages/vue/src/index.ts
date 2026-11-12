/**
 * @surge-media/vue — composants Vue 3 de SurgeMedia : images responsives (SmImage, SmPicture), vidéos
 * (SmVideo), affichage selon le genre (SmMedia), vignettes (SmThumbnail), état du traitement
 * (SmProcessingStatus), envoi de fichiers (SmUploader). Feuille de style facultative :
 * `import '@surge-media/vue/style.css'` (thème de `@surge-media/client`). La logique sans framework (textes,
 * icônes, URL, styles en ligne, états) est dans `@surge-media/client` ; les noms historiques sont réexportés.
 */
export {
  COMPONENT_MESSAGES as BUILTIN_MESSAGES,
  createTranslate,
} from '@surge-media/client'
export type {
  ComponentMessages as Messages,
  DeepPartial,
  PictureArtSource,
  Translate,
} from '@surge-media/client'
export { default as SmImage } from './components/SmImage.vue'
export { default as SmMedia } from './components/SmMedia.vue'
export { default as SmPicture } from './components/SmPicture.vue'
export { default as SmProcessingStatus } from './components/SmProcessingStatus.vue'
export { default as SmThumbnail } from './components/SmThumbnail.vue'
export { default as SmUploader } from './components/SmUploader.vue'
export { default as SmVideo } from './components/SmVideo.vue'
export { useAltText, useTransformMode } from './composables/image'
export { useLiveMedia, useMedia } from './composables/media'
export type { UseMediaOptions, UseMediaResult } from './composables/media'
export { useUploadQueue, useUploadRules } from './composables/upload'
export type { UseUploadQueueOptions, UseUploadQueueResult, UseUploadRulesResult } from './composables/upload'
export { createSurgeMediaContext, SURGE_MEDIA_KEY, useSurgeMedia } from './context'
export type { ProjectSettings, SurgeMediaContext, SurgeMediaDefaults, SurgeMediaOptions } from './context'
export { createSurgeMedia } from './plugin'
export type { SurgeMediaPlugin } from './plugin'
