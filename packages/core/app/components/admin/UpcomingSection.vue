<script setup lang="ts">
/** Page d'une section pas encore livrée : conserve la navigation et les contrôles d'accès. */
import { Construction } from '@lucide/vue'

defineProps<{
  title: string
  description: string
}>()

const { t } = useI18n()
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <AdminPageHeader :title="title" :description="description" />
    <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-16 text-center">
      <Construction class="size-8 text-muted-foreground" aria-hidden="true" />
      <p class="font-medium text-foreground">
        {{ t('admin.upcoming.title') }}
      </p>
      <p class="max-w-md text-sm text-muted-foreground">
        {{ t('admin.upcoming.description') }}
      </p>
    </div>
  </div>
</template>
