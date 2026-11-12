<script setup lang="ts">
/**
 * Logo surgeMedia : pictogramme (vague et point) et logotype monoligne, le tout en SVG, sans police.
 * Le M du logotype est la vague du pictogramme, le point du i est son point.
 *
 * Tracés générés par `apps/website/scripts/brand.mjs` (`pnpm --filter @surge-media/website brand`) :
 * après une modification du dessin, recopiez-les depuis `apps/website/public/brand/surgemedia-logo-light.svg`
 * (le logotype est le second groupe ; son cadre vertical est celui du logo complet, pour garder l'alignement).
 * Les couleurs viennent des jetons du thème (clair et sombre). Le nom reste lu par les lecteurs d'écran
 * (texte masqué). Placez le logo dans un lien pour la navigation.
 */
defineProps<{
  /** Sous 480 px de large, n'affiche que le pictogramme (en-têtes chargés, WCAG 1.4.10). */
  collapsible?: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <span class="inline-flex items-center gap-2">
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
    <svg
      viewBox="0 -95.3 547.1 117.86"
      :class="['h-8 w-auto shrink-0', collapsible && 'hidden min-[30rem]:block']"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
        <path
          d="M33.69 -44.05A15.5 11.4 0 1 0 20 -27.3A15.5 11.4 0 1 1 6.31 -10.55M52 -50.1V-27.3A22.8 22.8 0 0 0 97.6 -27.3M97.6 -50.1V-4.5M114.1 -4.5V-50.1M114.1 -33.1A17 17 0 0 1 131.1 -50.1h3M146.6 -27.3a22.8 22.8 0 1 0 45.6 0a22.8 22.8 0 1 0 -45.6 0M192.2 -50.1V-0.5A22.8 15 0 0 1 148.74 5.84M207.7 -27.3H253.3A22.8 22.8 0 1 0 247.44 -12.04"
          fill="none"
          class="stroke-foreground"
        />
        <path
          d="M271.8 -4.5V-55.25C271.8 -62.43 277.62 -68.25 284.8 -68.25C295.12 -68.25 295.98 -30 306.3 -30C316.62 -30 317.48 -68.25 327.8 -68.25C334.98 -68.25 340.8 -62.43 340.8 -55.25V-4.5M359.3 -27.3H404.9A22.8 22.8 0 1 0 399.04 -12.04M419.4 -27.3a22.8 22.8 0 1 0 45.6 0a22.8 22.8 0 1 0 -45.6 0M465 -68.25V-4.5M481.5 -50.1V-4.5M497 -27.3a22.8 22.8 0 1 0 45.6 0a22.8 22.8 0 1 0 -45.6 0M542.6 -50.1V-4.5"
          fill="none"
          class="stroke-primary"
        />
        <circle cx="481.5" cy="-65.6" r="7.65" class="fill-brand-accent" />
      </g>
    </svg>
    <span class="sr-only">{{ t('app.name') }}</span>
  </span>
</template>
