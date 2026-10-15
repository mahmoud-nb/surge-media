<script setup lang="ts">
import { SmMedia, SmThumbnail, SmVideo } from '@surge-media/vue'
import { computed } from 'vue'
import { usePlaygroundText } from '../messages'
import { locale } from '../state'
import { useProjectMedia } from '../use-project-media'

const t = usePlaygroundText(locale)
const { items, loading, error } = useProjectMedia('video')
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
  <template v-else>
    <div class="playground-grid">
      <figure>
        <SmVideo :media="media" />
        <figcaption>{{ t('demos.video') }}</figcaption>
      </figure>
      <figure>
        <SmMedia :media="media" lazy :poster-width="640" />
        <figcaption>{{ t('demos.lazy') }}</figcaption>
      </figure>
      <figure>
        <SmVideo :media="media" ambient label="" />
        <figcaption>{{ t('demos.ambient') }}</figcaption>
      </figure>
    </div>
    <h3>{{ t('demos.thumbnails') }}</h3>
    <div class="playground-row">
      <SmThumbnail v-for="item in items" :key="item.id" :media="item" :size="120" />
    </div>
  </template>
</template>
