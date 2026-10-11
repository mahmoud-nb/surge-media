<script setup lang="ts">
/** Portées d'un identifiant d'API, sous forme d'étiquettes (libellés traduits). */
defineProps<{ scopes: readonly string[] }>()

const { t } = useI18n()
</script>

<template>
  <ul class="flex flex-wrap gap-1.5" :aria-label="t('credentials.scopes.listLabel')">
    <li v-for="scope in scopes" :key="scope">
      <UiBadge>{{ t(`scopes.${scope.replace(':', '.')}.short`) }}</UiBadge>
    </li>
  </ul>
</template>
