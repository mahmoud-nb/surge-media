<script setup lang="ts">
/** Logo surgeMedia (pictogramme décoratif + nom). Placez-le dans un lien pour la navigation. */
const { t } = useI18n()
</script>

<template>
  <span class="inline-flex items-center gap-2.5 font-semibold tracking-tight text-foreground">
    <svg viewBox="0 0 32 32" class="size-8 shrink-0" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" class="fill-primary" />
      <path
        d="M7 19.5c2.2-5.3 4.4-5.3 6.6 0s4.4 5.3 6.6 0 3.3-6 4.8-7.5"
        fill="none"
        class="stroke-primary-foreground"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="25" cy="10" r="2.2" class="fill-primary-foreground" />
    </svg>
    <span class="text-lg">{{ t('app.name') }}</span>
  </span>
</template>
