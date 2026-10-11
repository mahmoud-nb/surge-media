<script setup lang="ts">
/** Raccourcis du tableau de bord : actions fréquentes, selon les permissions du compte. */
import { BookOpenText, FolderKanban, FolderPlus, Images, KeyRound, ScrollText, Settings, Upload, UserPlus } from '@lucide/vue'
import type { Component } from 'vue'

interface Shortcut {
  to: string
  label: string
  icon: Component
}

const { t } = useI18n()
const { can } = useAuth()

const shortcuts = computed(() => ([
  can('library:manage')
    ? { to: '/admin/media', label: t('admin.dashboard.shortcuts.upload'), icon: Upload }
    : can('library:read') ? { to: '/admin/media', label: t('admin.dashboard.shortcuts.library'), icon: Images } : null,
  can('projects:create')
    ? { to: '/admin/projects/new', label: t('admin.dashboard.shortcuts.newProject'), icon: FolderPlus }
    : { to: '/admin/projects', label: t('admin.dashboard.shortcuts.projects'), icon: FolderKanban },
  can('users:invite') ? { to: '/admin/users/new', label: t('admin.dashboard.shortcuts.invite'), icon: UserPlus } : null,
  can('tokens:personal') ? { to: '/admin/tokens/new', label: t('admin.dashboard.shortcuts.newToken'), icon: KeyRound } : null,
  can('api:docs') ? { to: '/admin/api', label: t('admin.dashboard.shortcuts.apiDocs'), icon: BookOpenText } : null,
  can('audit:read') ? { to: '/admin/audit', label: t('admin.dashboard.shortcuts.audit'), icon: ScrollText } : null,
  can('settings:manage') ? { to: '/admin/settings', label: t('admin.dashboard.shortcuts.settings'), icon: Settings } : null,
] as (Shortcut | null)[]).filter((item): item is Shortcut => item !== null))
</script>

<template>
  <section aria-labelledby="shortcuts-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
    <h2 id="shortcuts-title" class="text-lg font-semibold text-foreground">
      {{ t('admin.dashboard.shortcuts.title') }}
    </h2>
    <ul class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <li v-for="shortcut in shortcuts" :key="shortcut.to">
        <NuxtLink
          :to="shortcut.to"
          class="flex h-full items-center gap-3 rounded-lg border border-input bg-surface px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <component :is="shortcut.icon" class="size-4 shrink-0 text-primary" aria-hidden="true" />
          {{ shortcut.label }}
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
