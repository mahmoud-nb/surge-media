<script setup lang="ts">
/** Lien d'évitement (WCAG 2.4.1) : premier élément focalisable, visible au focus clavier. */
const { t } = useI18n()
</script>

<template>
  <a
    href="#main"
    class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
  >
    {{ t('a11y.skipToContent') }}
  </a>
</template>
