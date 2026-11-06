<script setup lang="ts">
/** Adresse e-mail d'une page légale : lien `mailto:`, ou « Non renseigné » si l'exploitant ne l'a pas donnée. */
defineProps<{ address: string }>()

const { t } = useI18n()
</script>

<template>
  <a v-if="address" :href="`mailto:${address}`" class="rounded font-medium text-primary underline underline-offset-2 hover:no-underline">{{ address }}</a>
  <span v-else class="text-muted-foreground italic">{{ t('legal.missing') }}</span>
</template>
