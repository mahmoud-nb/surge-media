<script setup lang="ts">
/** Projets actifs visibles (les premiers par ordre alphabétique) : rôle exercé, nombre de médias. */
import { FolderKanban } from '@lucide/vue'

defineProps<{
  items: { id: string, name: string, slug: string, role: ProjectRole | null, mediaCount: number }[]
  total: number
}>()

const { t, locale } = useI18n()
const { can } = useAuth()
const number = computed(() => new Intl.NumberFormat(locale.value))
</script>

<template>
  <section aria-labelledby="dashboard-projects-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="dashboard-projects-title" class="text-lg font-semibold text-foreground">
        {{ can('projects:all') ? t('admin.dashboard.projects.titleAll') : t('admin.dashboard.projects.title') }}
      </h2>
      <NuxtLink v-if="total" to="/admin/projects" class="text-sm font-medium text-primary underline-offset-4 hover:underline">
        {{ t('admin.dashboard.projects.all', { count: total }, total) }}
      </NuxtLink>
    </div>
    <ul v-if="items.length" class="mt-4 divide-y divide-border rounded-lg border border-border">
      <li v-for="project in items" :key="project.id" class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
        <span class="flex min-w-0 items-center gap-2">
          <FolderKanban class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <NuxtLink :to="`/admin/projects/${project.id}`" class="truncate font-medium text-primary underline-offset-4 hover:underline">
            {{ project.name }}
          </NuxtLink>
        </span>
        <span class="text-muted-foreground">
          {{ t('admin.dashboard.projects.media', { count: number.format(project.mediaCount) }, project.mediaCount) }}<template v-if="project.role"> · {{ t(`projectRoles.${project.role}.label`) }}</template>
        </span>
      </li>
    </ul>
    <div v-else class="mt-4 grid justify-items-start gap-3 text-sm text-muted-foreground">
      <p>{{ can('projects:create') ? t('admin.dashboard.projects.emptyCreate') : t('projects.list.emptyMember') }}</p>
      <UiButton v-if="can('projects:create')" to="/admin/projects/new" variant="outline" size="sm">
        {{ t('admin.dashboard.shortcuts.newProject') }}
      </UiButton>
    </div>
  </section>
</template>
