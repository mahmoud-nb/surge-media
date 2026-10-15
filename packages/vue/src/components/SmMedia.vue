<script setup lang="ts">
/**
 * Affiche un média selon son genre : image (SmImage), vidéo (SmVideo) ; autre genre (à venir : audio,
 * documents) : lien vers le fichier, remplaçable par l'emplacement `fallback`. Les attributs et les
 * propriétés supplémentaires sont transmis au composant choisi.
 */
import type { Media } from '@surge-media/client'
import { useSurgeMedia } from '../context'
import SmImage from './SmImage.vue'
import SmVideo from './SmVideo.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  media: Media
}>()

const { t } = useSurgeMedia()
</script>

<template>
  <SmImage v-if="props.media.kind === 'image'" v-bind="$attrs" :media="props.media" />
  <SmVideo v-else-if="props.media.kind === 'video'" v-bind="$attrs" :media="props.media" />
  <slot v-else name="fallback" :media="props.media">
    <a class="sm-media__link" :href="props.media.url" v-bind="$attrs">{{ t('media.download', { name: props.media.title ?? props.media.filename }) }}</a>
  </slot>
</template>
