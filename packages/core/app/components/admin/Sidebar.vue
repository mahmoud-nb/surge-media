<script setup lang="ts">
/**
 * Barre latérale de l'administration : navigation filtrée selon les permissions du
 * rôle, langue, thème, utilisateur connecté et déconnexion.
 * La page courante est signalée par aria-current="page" (posé par <NuxtLink>).
 */
import { BookOpenText, FolderKanban, Images, KeyRound, LayoutDashboard, LogOut, ScrollText, Settings, Users } from '@lucide/vue'
import type { Component } from 'vue'

interface NavItem {
  to: string
  label: string
  icon: Component
  permission?: Permission
}

const { t } = useI18n()
const { user, can, logout } = useAuth()

const items = computed<NavItem[]>(() => [
  { to: '/admin', label: t('admin.nav.dashboard'), icon: LayoutDashboard },
  { to: '/admin/media', label: t('admin.nav.library'), icon: Images, permission: 'library:manage' as const },
  { to: '/admin/projects', label: t('admin.nav.projects'), icon: FolderKanban },
  { to: '/admin/tokens', label: t('admin.nav.tokens'), icon: KeyRound, permission: 'tokens:personal' as const },
  { to: '/admin/users', label: t('admin.nav.users'), icon: Users, permission: 'users:manage' as const },
  { to: '/admin/audit', label: t('admin.nav.audit'), icon: ScrollText, permission: 'audit:read' as const },
  { to: '/admin/api', label: t('admin.nav.apiDocs'), icon: BookOpenText, permission: 'api:docs' as const },
  { to: '/admin/settings', label: t('admin.nav.settings'), icon: Settings, permission: 'settings:manage' as const },
].filter(item => !item.permission || can(item.permission)))

const route = useRoute()
const section = useAdminSection()

/**
 * Page exacte → "page" ; sous-page d'une section (/admin/users/…) → "true".
 * Test sur le chemin : les pages d'une section sont des routes sœurs, pas imbriquées. Une page
 * peut imposer sa section (fiche d'un média de projet → Projets) : useAdminSection().
 */
function currentState(to: string): 'page' | 'true' | undefined {
  if (route.path === to) return 'page'
  if (section.value) return section.value === to ? 'true' : undefined
  if (to !== '/admin' && route.path.startsWith(`${to}/`)) return 'true'
  return undefined
}

const displayName = computed(() => user.value?.name || user.value?.email || '')
const initials = computed(() => displayName.value.slice(0, 1).toUpperCase())

const loggingOut = ref(false)
async function onLogout() {
  loggingOut.value = true
  try {
    await logout()
  }
  finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col gap-6 overflow-y-auto p-4">
    <NuxtLink to="/admin" class="hidden rounded-lg px-2 pt-2 lg:block">
      <AppLogo />
      <span class="sr-only">{{ t('admin.nav.homeSuffix') }}</span>
    </NuxtLink>

    <nav :aria-label="t('admin.nav.label')">
      <ul class="grid gap-1">
        <li v-for="item in items" :key="item.to">
          <!-- aria-current : "page" sur la page exacte, "true" sur la section parente (ex. /admin/users/…). -->
          <NuxtLink v-slot="{ href, navigate }" :to="item.to" custom>
            <a
              :href="href ?? undefined"
              :aria-current="currentState(item.to)"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&[aria-current]]:bg-primary-soft [&[aria-current]]:text-primary"
              @click="navigate"
            >
              <component :is="item.icon" class="size-4 shrink-0" aria-hidden="true" />
              {{ item.label }}
            </a>
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <div class="mt-auto grid gap-4 border-t border-border pt-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <AppLocaleSwitcher placement="top" />
        <AppThemeSwitcher />
      </div>

      <div v-if="user" class="flex items-center gap-3 px-1">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary" aria-hidden="true">
          {{ initials }}
        </span>
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-foreground" :title="displayName">
            {{ displayName }}
          </p>
          <p class="truncate text-xs text-muted-foreground">
            {{ t(`roles.${user.role}.label`) }}
          </p>
        </div>
      </div>

      <UiButton variant="outline" class="w-full" :loading="loggingOut" @click="onLogout">
        <LogOut aria-hidden="true" />
        {{ t('auth.logout') }}
      </UiButton>
    </div>
  </div>
</template>
