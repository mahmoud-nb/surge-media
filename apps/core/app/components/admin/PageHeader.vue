<script setup lang="ts">
/** En-tête de page d'administration : titre (h1 unique de la page) et description. */
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div class="grid gap-1.5">
      <h1 class="text-2xl font-semibold tracking-tight text-foreground">
        {{ title }}
      </h1>
      <p v-if="description" class="text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <slot name="actions" />
  </header>
</template>
