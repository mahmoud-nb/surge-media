<script setup lang="ts">
import { SmImage, SmPicture } from '@surge-media/vue'
import { computed } from 'vue'
import { usePlaygroundText } from '../messages'
import { locale } from '../state'
import { useProjectMedia } from '../use-project-media'

const t = usePlaygroundText(locale)
const { items, loading, error } = useProjectMedia('image', 'private')
const media = computed(() => items.value[0] ?? null)
</script>

<template>
  <p v-if="loading">
    {{ t('loading') }}
  </p>
  <p v-else-if="error" role="alert">
    {{ t('error', { message: error }) }}
  </p>
  <p v-else-if="!media">
    {{ t('empty') }}
  </p>
  <div v-else class="playground-grid">
    <figure>
      <SmImage :media="media" sizes="(min-width: 1100px) 520px, 100vw" />
      <figcaption>{{ t('demos.private') }}</figcaption>
    </figure>
    <figure>
      <SmPicture :media="media" aspect="4/3" sizes="(min-width: 1100px) 520px, 100vw" />
      <figcaption>{{ t('demos.picture') }}</figcaption>
    </figure>
  </div>
</template>
