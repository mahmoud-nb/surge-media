<script setup lang="ts">
import type { Media } from '@surge-media/client'
import { createSurgeMediaContext, SmThumbnail, SmUploader, SURGE_MEDIA_KEY } from '@surge-media/vue'
import { onMounted, provide, shallowRef, useId } from 'vue'
import { usePlaygroundText } from '../messages'
import { config, locale } from '../state'

/**
 * Envoi (phase E2) : un contexte propre à la page, alimenté par des jetons d'envoi (`UPLOAD_SCOPES`, 20
 * fichiers par jeton, 50 Mio au plus) émis par le serveur Vite avec `createDelegatedToken`. Les fichiers
 * envoyés vont dans le projet du bac à sable.
 */
const t = usePlaygroundText(locale)
const context = createSurgeMediaContext({
  baseUrl: config.baseUrl,
  projectId: config.projectId,
  locale,
  getToken: async () => {
    const response = await fetch('/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'upload' }),
    })
    if (!response.ok) throw new Error(`Delegated token: HTTP ${response.status}`)
    return response.json()
  },
})
provide(SURGE_MEDIA_KEY, context)
onMounted(() => void context.refreshProject())

const uploaded = shallowRef<Media[]>([])
function onUploaded(media: Media) {
  uploaded.value = [media, ...uploaded.value]
}

const directId = useId()
const detailsId = useId()
const resultsId = useId()
</script>

<template>
  <section class="playground-section" :aria-labelledby="directId">
    <h3 :id="directId">
      {{ t('demos.upload') }}
    </h3>
    <SmUploader choose-visibility @uploaded="onUploaded" />
  </section>
  <section class="playground-section" :aria-labelledby="detailsId">
    <h3 :id="detailsId">
      {{ t('demos.uploadDetails') }}
    </h3>
    <SmUploader details :kinds="['image']" @uploaded="onUploaded" />
  </section>
  <section v-if="uploaded.length > 0" class="playground-section" :aria-labelledby="resultsId">
    <h3 :id="resultsId">
      {{ t('demos.uploaded') }}
    </h3>
    <div class="playground-row">
      <SmThumbnail v-for="media in uploaded" :key="media.id" :media="media" :size="120" />
    </div>
  </section>
</template>
