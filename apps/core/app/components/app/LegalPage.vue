<script setup lang="ts">
/**
 * Mise en forme commune des pages légales de la démo (/legal, /privacy, /terms) : titre, introduction,
 * navigation entre les trois pages (lien courant marqué par `aria-current`), puis le contenu, en sections
 * `AppLegalSection` (h2). Valeurs fournies par l'exploitant (NUXT_DEMO_LEGAL_*), jamais écrites dans le dépôt.
 */
defineProps<{
  title: string
  description: string
}>()

const { t } = useI18n()
const route = useRoute()

const pages = computed(() => [
  { to: '/legal', label: t('legal.nav.legal') },
  { to: '/privacy', label: t('legal.nav.privacy') },
  { to: '/terms', label: t('legal.nav.terms') },
])
</script>

<template>
  <div class="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
    <nav :aria-label="t('legal.nav.label')" class="mb-8">
      <ul class="flex flex-wrap gap-2 text-sm">
        <li v-for="page in pages" :key="page.to">
          <NuxtLink
            :to="page.to"
            :aria-current="route.path === page.to ? 'page' : undefined"
            :class="cn(
              'inline-flex rounded-lg border px-3 py-1.5 font-medium transition-colors',
              route.path === page.to ? 'border-primary bg-primary-soft text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )"
          >
            {{ page.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <h1 class="text-3xl font-semibold tracking-tight text-foreground">
      {{ title }}
    </h1>
    <p class="mt-3 text-lg text-muted-foreground">
      {{ description }}
    </p>

    <div class="mt-10 grid gap-10">
      <slot />
    </div>
  </div>
</template>
