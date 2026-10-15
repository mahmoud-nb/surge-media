<script setup lang="ts">
import { createSurgeClient, type Media } from '@surge-media/client'
import { SmImage } from '@surge-media/vue'
import { onMounted, ref, shallowRef } from 'vue'
import { usePlaygroundText } from '../messages'
import { config, locale } from '../state'

/** Lecture avec la clé publique seule (médias publics, liste publique du projet). */
const t = usePlaygroundText(locale)
const client = createSurgeClient({ baseUrl: config.baseUrl, projectId: config.projectId, publishableKey: config.publishableKey })
const items = shallowRef<Media[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    items.value = (await client.media.list({ kind: 'image' })).items
  }
  catch (caught) {
    error.value = client.errorMessage(caught, locale.value)
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <p v-if="loading">
    {{ t('loading') }}
  </p>
  <p v-else-if="error" role="alert">
    {{ t('error', { message: error }) }}
  </p>
  <template v-else>
    <p>{{ t('demos.public') }}</p>
    <div class="playground-grid">
      <SmImage v-for="item in items" :key="item.id" :media="item" aspect="4/3" sizes="(min-width: 1100px) 340px, 100vw" />
    </div>
  </template>
</template>
