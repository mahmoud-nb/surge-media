<script setup lang="ts">
/**
 * Logo SurgeMedia : pictogramme (vague et point) et logotype dessiné, le tout en SVG, sans police.
 * Lettres carrées à chasse fixe, angles extérieurs arrondis, extrémités droites ; le point du i reprend
 * la couleur d'accent, comme le point du pictogramme.
 *
 * Tracés générés par `apps/website/scripts/brand.mjs` (`pnpm --filter @surge-media/website brand`) :
 * après une modification du dessin, recopiez-les depuis `apps/website/public/brand/surgemedia-logo-light.svg`
 * (le logotype est le second groupe ; son cadre vertical est celui du logo complet, pour garder l'alignement).
 * Les couleurs viennent des jetons du thème (clair et sombre). Le nom reste lu par les lecteurs d'écran
 * (texte masqué). Placez le logo dans un lien pour la navigation.
 */
defineProps<{
  /** Sous 512 px de large, n'affiche que le pictogramme (en-têtes chargés, WCAG 1.4.10). */
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
      viewBox="0 -95.3 639.43 117.86"
      :class="['h-8 w-auto shrink-0', collapsible && 'hidden min-[32rem]:block']"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke-width="8" stroke-linecap="butt" stroke-linejoin="round">
        <path
          d="M44 -53.89L44 -62.25A6.5 6.5 0 0 0 37.5 -68.75L10.5 -68.75A6.5 6.5 0 0 0 4 -62.25L4 -48.26A6.5 6.5 0 0 0 10.5 -41.76L37.5 -41.76A6.5 6.5 0 0 1 44 -35.26L44 -10.5A6.5 6.5 0 0 1 37.5 -4L10.5 -4A6.5 6.5 0 0 1 4 -10.5L4 -20.21M68.67 -44.46L68.67 -10.5A6.5 6.5 0 0 0 75.17 -4L108.67 -4M108.67 -44.46L108.67 0M133.33 0L133.33 -33.96A6.5 6.5 0 0 1 139.83 -40.46L166.83 -40.46A6.5 6.5 0 0 1 173.33 -33.96L173.33 -28.46M238 -10.5L204.5 -10.5A6.5 6.5 0 0 1 198 -17L198 -33.96A6.5 6.5 0 0 1 204.5 -40.46L231.5 -40.46A6.5 6.5 0 0 1 238 -33.96L238 5.67A6.5 6.5 0 0 1 231.5 12.17L204.5 12.17A6.5 6.5 0 0 1 198 5.67L198 1.67M302.67 -14L302.67 -10.5A6.5 6.5 0 0 1 296.17 -4L269.17 -4A6.5 6.5 0 0 1 262.67 -10.5L262.67 -33.96A6.5 6.5 0 0 1 269.17 -40.46L296.17 -40.46A6.5 6.5 0 0 1 302.67 -33.96L302.67 -28.73A6.5 6.5 0 0 1 296.17 -22.23L262.67 -22.23"
          fill="none"
          class="stroke-foreground"
        />
        <path
          d="M326.05 0L326.05 -62.25A6.5 6.5 0 0 1 332.55 -68.75L371.55 -68.75A6.5 6.5 0 0 1 378.05 -62.25L378.05 0M352.05 -68.75L352.05 -37.5M441.43 -14L441.43 -10.5A6.5 6.5 0 0 1 434.93 -4L407.93 -4A6.5 6.5 0 0 1 401.43 -10.5L401.43 -33.96A6.5 6.5 0 0 1 407.93 -40.46L434.93 -40.46A6.5 6.5 0 0 1 441.43 -33.96L441.43 -28.73A6.5 6.5 0 0 1 434.93 -22.23L401.43 -22.23M506.1 -40.46L472.6 -40.46A6.5 6.5 0 0 0 466.1 -33.96L466.1 -10.5A6.5 6.5 0 0 0 472.6 -4L506.1 -4M506.1 -67.36L506.1 0M539.76 -40.46L546.26 -40.46A6.5 6.5 0 0 1 552.76 -33.96L552.76 -4M536.26 -4L569.26 -4M635.43 0L635.43 -33.96A6.5 6.5 0 0 0 628.93 -40.46L601.93 -40.46A6.5 6.5 0 0 0 595.43 -33.96L595.43 -10.5A6.5 6.5 0 0 0 601.93 -4L610.9 -4A6.5 6.5 0 0 0 615.3 -5.71L635.43 -24.2"
          fill="none"
          class="stroke-primary"
        />
        <rect x="548.76" y="-67.36" width="8" height="16.17" rx="2" class="fill-brand-accent" />
      </g>
    </svg>
    <span class="sr-only">{{ t('app.name') }}</span>
  </span>
</template>
