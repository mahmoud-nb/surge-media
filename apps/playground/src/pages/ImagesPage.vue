<script setup lang="ts">
import { SmImage, SmPicture, SmThumbnail } from '@surge-media/vue'
import { computed, ref, useId, watch } from 'vue'
import { usePlaygroundText } from '../messages'
import { locale } from '../state'
import { useProjectMedia } from '../use-project-media'

const t = usePlaygroundText(locale)
const { items, loading, error } = useProjectMedia('image', 'public')
const selectedId = ref<string | null>(null)
watch(items, (list) => {
  if (!list.some(item => item.id === selectedId.value)) selectedId.value = list[0]?.id ?? null
})
const media = computed(() => items.value.find(item => item.id === selectedId.value) ?? null)
const selectId = useId()
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
    <p>
      <label :for="selectId">{{ t('media') }}</label>
      <select :id="selectId" v-model="selectedId">
        <option v-for="item in items" :key="item.id" :value="item.id">
          {{ item.title ?? item.filename }}
        </option>
      </select>
    </p>
    <div class="playground-grid">
      <figure>
        <SmImage :media="media" sizes="(min-width: 1100px) 520px, 100vw" priority />
        <figcaption>{{ t('demos.fluid') }}</figcaption>
      </figure>
      <figure>
        <SmImage :media="media" :width="320" />
        <figcaption>{{ t('demos.fixed') }}</figcaption>
      </figure>
      <figure>
        <SmImage :media="media" aspect="16/9" sizes="(min-width: 1100px) 520px, 100vw" />
        <figcaption>{{ t('demos.aspect') }}</figcaption>
      </figure>
      <figure>
        <div class="playground-square">
          <SmImage :media="media" object-fit="cover" :aspect="1" sizes="240px" :widths="[240, 480, 720]" />
        </div>
        <figcaption>{{ t('demos.cover') }}</figcaption>
      </figure>
      <figure>
        <SmPicture :media="media" sizes="(min-width: 1100px) 520px, 100vw" :sources="[{ media: '(max-width: 640px)', aspect: 1 }]" />
        <figcaption>{{ t('demos.picture') }}</figcaption>
      </figure>
      <figure>
        <SmImage :media="media" preset="preview" />
        <figcaption>{{ t('demos.preset') }}</figcaption>
      </figure>
    </div>
    <h3>{{ t('demos.thumbnails') }}</h3>
    <div class="playground-row">
      <SmThumbnail v-for="item in items" :key="item.id" :media="item" :size="120" />
    </div>
  </template>
</template>
