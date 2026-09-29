<script setup lang="ts">
/**
 * Mise en page de l'administration. La barre latérale (logo, navigation, préférences,
 * compte) forme le landmark « banner » : colonne fixe sur grand écran ; sur mobile, un
 * bouton « Menu » (aria-expanded) la déplie sous la barre supérieure. Échap la referme.
 */
import { Menu, X } from '@lucide/vue'

const { t } = useI18n()
const route = useRoute()
const menuOpen = ref(false)
const toggle = useTemplateRef<HTMLButtonElement>('toggle')

watch(() => route.fullPath, () => {
  menuOpen.value = false
})

function closeMenu() {
  if (!menuOpen.value) return
  menuOpen.value = false
  toggle.value?.focus()
}
</script>

<template>
  <div class="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
    <AppSkipLink />

    <header
      class="sticky top-0 z-30 border-b border-border bg-surface lg:h-dvh lg:border-r lg:border-b-0"
      @keydown.esc="closeMenu"
    >
      <div class="flex h-14 items-center justify-between px-4 lg:hidden">
        <NuxtLink to="/admin" class="rounded-lg">
          <AppLogo />
          <span class="sr-only">{{ t('admin.nav.homeSuffix') }}</span>
        </NuxtLink>
        <button
          ref="toggle"
          type="button"
          class="inline-flex size-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted"
          :aria-expanded="menuOpen"
          aria-controls="admin-sidebar"
          @click="menuOpen = !menuOpen"
        >
          <X v-if="menuOpen" class="size-5" aria-hidden="true" />
          <Menu v-else class="size-5" aria-hidden="true" />
          <span class="sr-only">{{ t('admin.nav.menu') }}</span>
        </button>
      </div>

      <div
        id="admin-sidebar"
        :class="cn(
          'max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-border lg:block lg:h-full lg:max-h-none lg:border-t-0',
          menuOpen ? 'block' : 'hidden',
        )"
      >
        <AdminSidebar />
      </div>
    </header>

    <main id="main" tabindex="-1" class="min-w-0 px-4 py-8 sm:px-8 lg:px-12 lg:py-10">
      <slot />
    </main>

    <!-- Confirmation du mot de passe des actions sensibles (useReauth). -->
    <AdminReauthDialog />
  </div>
</template>
