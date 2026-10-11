<script setup lang="ts">
/**
 * Statistique du tableau de bord : libellé, valeur, précision. Avec `to`, le libellé est un lien
 * étendu à toute la carte (un seul arrêt de tabulation, contour de focus sur la carte).
 */
import type { Component } from 'vue'

defineProps<{
  label: string
  value: string
  detail?: string
  to?: string
  icon: Component
}>()
</script>

<template>
  <li class="relative flex gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs transition-colors has-[a:hover]:bg-muted/60 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring">
    <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
      <component :is="icon" class="size-5" aria-hidden="true" />
    </span>
    <div class="min-w-0">
      <p class="text-sm text-muted-foreground">
        <NuxtLink v-if="to" :to="to" class="font-medium text-foreground focus-visible:outline-none after:absolute after:inset-0 after:rounded-xl">
          {{ label }}
        </NuxtLink>
        <span v-else class="font-medium text-foreground">{{ label }}</span>
      </p>
      <p class="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {{ value }}
      </p>
      <p v-if="detail" class="mt-1 text-sm text-muted-foreground">
        {{ detail }}
      </p>
    </div>
  </li>
</template>
