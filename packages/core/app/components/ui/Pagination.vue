<script setup lang="ts">
/**
 * Pagination — liens (et non boutons) : chaque page a une URL, partageable et compatible
 * avec l'historique. La page courante porte aria-current="page".
 */
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  page: number
  pageCount: number
  /** Lien vers une page donnée. */
  to: (page: number) => RouteLocationRaw
}>()

const { t } = useI18n()

/** Pages affichées : première, dernière et voisines de la page courante (null = ellipse). */
const pages = computed<(number | null)[]>(() => {
  const { page, pageCount } = props
  const visible = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter(value => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b)
  return visible.flatMap((value, index) => (index > 0 && value - visible[index - 1]! > 1 ? [null, value] : [value]))
})

const itemClass = 'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg px-3 text-sm font-medium'
</script>

<template>
  <nav v-if="pageCount > 1" :aria-label="t('pagination.label')">
    <ul class="flex flex-wrap items-center gap-1">
      <li>
        <NuxtLink v-if="page > 1" :to="to(page - 1)" :class="cn(itemClass, 'text-foreground hover:bg-muted')">
          <ChevronLeft aria-hidden="true" class="size-4" />
          {{ t('pagination.previous') }}
        </NuxtLink>
      </li>
      <li v-for="(value, index) in pages" :key="value ?? `gap-${index}`">
        <span v-if="value === null" :class="cn(itemClass, 'text-muted-foreground')" aria-hidden="true">…</span>
        <NuxtLink
          v-else
          :to="to(value)"
          :aria-current="value === page ? 'page' : undefined"
          :class="cn(itemClass, value === page ? 'border border-primary bg-primary-soft text-primary' : 'text-foreground hover:bg-muted')"
        >
          <span class="sr-only">{{ t('pagination.page') }}</span>
          {{ value }}
        </NuxtLink>
      </li>
      <li>
        <NuxtLink v-if="page < pageCount" :to="to(page + 1)" :class="cn(itemClass, 'text-foreground hover:bg-muted')">
          {{ t('pagination.next') }}
          <ChevronRight aria-hidden="true" class="size-4" />
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
