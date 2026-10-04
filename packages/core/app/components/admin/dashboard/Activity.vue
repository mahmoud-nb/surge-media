<script setup lang="ts">
/** Dernières entrées du journal d'audit (audit:read), mises en forme comme sur la page du journal. */
import type { AuditEntryView } from '~/composables/useAuditFormat'

const props = defineProps<{
  items: (AuditEntryView & { id: string, at: string | Date, label: string | null })[]
}>()

const { t, locale } = useI18n()
const { actionLabel, actorName, details, projectName } = useAuditFormat()

/** Cible lisible : libellé enregistré, sinon projet concerné. */
function target(item: (typeof props.items)[number]): string | null {
  return item.label ?? (item.project ? projectName(item.project) : null)
}
</script>

<template>
  <section aria-labelledby="activity-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="activity-title" class="text-lg font-semibold text-foreground">
        {{ t('admin.dashboard.activity.title') }}
      </h2>
      <NuxtLink to="/admin/audit" class="text-sm font-medium text-primary underline-offset-4 hover:underline">
        {{ t('admin.dashboard.activity.all') }}
      </NuxtLink>
    </div>
    <ol v-if="items.length" class="mt-4 grid gap-3">
      <li v-for="item in items" :key="item.id" class="grid gap-0.5 border-l-2 border-primary/40 pl-3 text-sm">
        <p class="text-foreground">
          <span class="font-medium">{{ actionLabel(item.action) }}</span>
          <template v-if="target(item)">
            · <span class="break-all">{{ target(item) }}</span>
          </template>
        </p>
        <p v-if="details(item)" class="text-xs text-muted-foreground">
          {{ details(item) }}
        </p>
        <p class="text-xs text-muted-foreground">
          <i18n-t keypath="admin.dashboard.activity.by" tag="span" scope="global">
            <template #actor>
              {{ actorName(item) }}
            </template>
            <template #date>
              <NuxtTime :datetime="item.at" :locale="locale" date-style="medium" time-style="short" />
            </template>
          </i18n-t>
        </p>
      </li>
    </ol>
    <p v-else class="mt-4 text-sm text-muted-foreground">
      {{ t('admin.dashboard.activity.empty') }}
    </p>
  </section>
</template>
