<script setup lang="ts">
/** Mise en page publique (accueil, connexion, erreurs), avec le bandeau du mode démo s'il est actif. */
const { t } = useI18n()
const route = useRoute()
const { loggedIn } = useAuth()
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <AppSkipLink />
    <AppDemoBanner />
    <header class="border-b border-border bg-surface">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <NuxtLink to="/" class="rounded-lg">
          <AppLogo collapsible />
          <span class="sr-only">{{ t('nav.homeSuffix') }}</span>
        </NuxtLink>
        <div class="flex items-center gap-2">
          <AppLocaleSwitcher />
          <AppThemeSwitcher />
          <UiButton
            v-if="route.path !== '/login'"
            :to="loggedIn ? '/admin' : '/login'"
            variant="outline"
            size="sm"
            class="ml-2 hidden sm:inline-flex"
          >
            {{ loggedIn ? t('nav.admin') : t('nav.login') }}
          </UiButton>
        </div>
      </div>
    </header>

    <main id="main" tabindex="-1" class="flex flex-1 flex-col">
      <slot />
    </main>

    <footer class="border-t border-border">
      <p class="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
        {{ t('footer.text') }}
      </p>
    </footer>
  </div>
</template>
