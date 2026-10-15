<script setup lang="ts">
import type { Media } from '@surge-media/client'
import { SmImage, SmVideo } from '@surge-media/vue'
import { computed } from 'vue'
import { usePlaygroundText } from '../messages'
import { locale } from '../state'
import { useProjectMedia } from '../use-project-media'

/**
 * Replis simulés à partir de vrais médias : gabarit pointant vers un média inexistant (404 → original),
 * original introuvable aussi (état d'erreur), vidéo sans source en préparation ou en échec.
 */
const t = usePlaygroundText(locale)
const images = useProjectMedia('image', 'public')
const videos = useProjectMedia('video')

const image = computed(() => images.items.value[0] ?? null)
const brokenDerived = computed<Media | null>(() => image.value && {
  ...image.value,
  id: `${image.value.id}-derived`,
  urlTemplate: image.value.urlTemplate?.replace(`/m/${image.value.id}/`, '/m/zzzzzzzzmissing/') ?? null,
})
const broken = computed<Media | null>(() => brokenDerived.value && {
  ...brokenDerived.value,
  id: `${image.value!.id}-broken`,
  url: brokenDerived.value.url.replace(`/m/${image.value!.id}/`, '/m/zzzzzzzzmissing/'),
})
const video = computed(() => videos.items.value[0] ?? null)
const pending = computed<Media | null>(() => video.value && {
  ...video.value,
  sources: [],
  processing: { status: 'processing', progress: 0.42, error: null, updatedAt: new Date().toISOString() },
})
const failed = computed<Media | null>(() => video.value && {
  ...video.value,
  sources: [],
  processing: { status: 'failed', progress: null, error: 'CONVERSION_FAILED', updatedAt: new Date().toISOString() },
})
</script>

<template>
  <p v-if="images.loading.value || videos.loading.value">
    {{ t('loading') }}
  </p>
  <div v-else class="playground-grid">
    <figure v-if="brokenDerived">
      <SmImage :media="brokenDerived" :width="320" />
      <figcaption>{{ t('demos.brokenDerived') }}</figcaption>
    </figure>
    <figure v-if="broken">
      <SmImage :media="broken" :width="320" :aspect="3 / 2" />
      <figcaption>{{ t('demos.broken') }}</figcaption>
    </figure>
    <figure v-if="pending">
      <SmVideo :media="pending" :watch="false" />
      <figcaption>{{ t('demos.pending') }}</figcaption>
    </figure>
    <figure v-if="failed">
      <SmVideo :media="failed" :watch="false" />
      <figcaption>{{ t('demos.failed') }}</figcaption>
    </figure>
  </div>
</template>
