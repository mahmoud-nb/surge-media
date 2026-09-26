<script setup lang="ts">
/**
 * Vignette de la médiathèque. Toute la carte est cliquable (lien « étiré » sur le titre),
 * mais le lien n'a pour nom que le titre du média ; le focus est rendu sur la carte entière.
 * L'aperçu est décoratif (alt vide) : le titre, juste en dessous, identifie le média.
 */
import { Lock } from '@lucide/vue'

const props = defineProps<{
  media: {
    id: string
    originalName: string
    title: string | null
    previewUrl: string | null
    extension: string | null
    width: number | null
    height: number | null
    size: number
    visibility: MediaVisibility
  }
}>()

const { t, locale } = useI18n()
const name = computed(() => props.media.title || props.media.originalName)
const details = computed(() => [
  props.media.extension?.toUpperCase(),
  props.media.width && props.media.height ? t('media.dimensions', { width: props.media.width, height: props.media.height }) : null,
  formatBytes(props.media.size, locale.value),
].filter(Boolean) as string[])
</script>

<template>
  <article class="relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow hover:shadow-md has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring">
    <!-- Image en position absolue : un aspect-ratio seul se laisserait étirer par une image haute. -->
    <div class="bg-checker relative aspect-[4/3] overflow-hidden border-b border-border">
      <img v-if="media.previewUrl" :src="media.previewUrl" alt="" loading="lazy" decoding="async" class="absolute inset-0 size-full object-contain">
    </div>
    <div class="grid gap-1.5 p-3">
      <h3 class="truncate text-sm font-medium text-foreground" :title="name">
        <NuxtLink :to="`/admin/media/${media.id}`" class="after:absolute after:inset-0 focus-visible:outline-none">
          {{ name }}
        </NuxtLink>
      </h3>
      <p class="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
        <template v-for="(detail, index) in details" :key="index">
          <span v-if="index > 0" aria-hidden="true">·</span>
          <span>{{ detail }}</span>
        </template>
      </p>
      <p v-if="media.visibility === 'PRIVATE'">
        <UiBadge>
          <Lock class="size-3" aria-hidden="true" />
          {{ t('media.visibility.PRIVATE.label') }}
        </UiBadge>
      </p>
    </div>
  </article>
</template>
