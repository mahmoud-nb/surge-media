<script setup lang="ts">
/**
 * Points d'attention (assemblés par le serveur selon les droits) : base SQLite sous pression, jetons et
 * clés qui expirent, invitations en attente ou expirées, corbeille, configuration incomplète. Chaque point mène à
 * l'écran où agir ; une icône et un libellé distinguent ce qui demande d'agir de ce qui renseigne.
 */
import { CircleCheck, Info, TriangleAlert } from '@lucide/vue'
import { PRESSURE_LOADED_SHARE, PRESSURE_SLOW_OPERATION_MS } from '#shared/utils/database-pressure'

defineProps<{ items: DashboardAttention[] }>()

const { t, locale } = useI18n()
const { environmentLabel } = useCredentialLabels()
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))
const when = (date: string | Date) => dateFormat.value.format(new Date(date))
const number = (value: number) => new Intl.NumberFormat(locale.value).format(value)
</script>

<template>
  <section aria-labelledby="attention-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
    <h2 id="attention-title" class="text-lg font-semibold text-foreground">
      {{ t('admin.dashboard.attention.title') }}
    </h2>
    <p v-if="!items.length" class="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
      <CircleCheck class="size-4 shrink-0 text-success" aria-hidden="true" />
      {{ t('admin.dashboard.attention.none') }}
    </p>
    <ul v-else class="mt-4 grid gap-3">
      <li
        v-for="item in items"
        :key="item.kind"
        :class="cn(
          'flex gap-3 rounded-lg border p-3 text-sm',
          attentionSeverity(item) === 'warning' ? 'border-warning/40 bg-warning-soft' : 'border-border bg-muted/40',
        )"
      >
        <TriangleAlert v-if="attentionSeverity(item) === 'warning'" class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <Info v-else class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div class="min-w-0 grid gap-1 text-foreground">
          <span class="sr-only">{{ attentionSeverity(item) === 'warning' ? t('admin.dashboard.attention.warning') : t('admin.dashboard.attention.info') }}</span>

          <template v-if="item.kind === 'database'">
            <p class="font-medium">
              {{ item.level === 'warning' ? t('admin.dashboard.attention.database.warning') : t('admin.dashboard.attention.database.info') }}
            </p>
            <ul class="grid gap-0.5 text-muted-foreground">
              <li v-if="item.busy">
                {{ t('admin.dashboard.attention.database.busy', { count: item.busy }, item.busy) }}
              </li>
              <li v-if="item.slow">
                {{ t('admin.dashboard.attention.database.slow', { count: item.slow, ms: number(PRESSURE_SLOW_OPERATION_MS) }, item.slow) }}
              </li>
              <li v-if="item.loadedMinutes">
                {{ t('admin.dashboard.attention.database.loaded', { count: item.loadedMinutes, percent: formatPercent(PRESSURE_LOADED_SHARE * 100, locale) }, item.loadedMinutes) }}
              </li>
              <li>
                {{ t('admin.dashboard.attention.database.peaks', { requests: number(item.peakRequests), writes: number(item.peakWrites), share: formatPercent(item.peakShare * 100, locale) }) }}
              </li>
            </ul>
            <p>{{ t('admin.dashboard.attention.database.advice') }}</p>
            <p class="text-muted-foreground">
              {{ t('admin.dashboard.attention.database.seenAt', { date: when(item.at) }) }}
            </p>
          </template>

          <template v-else-if="item.kind === 'expiringTokens'">
            <p class="font-medium">
              {{ t('admin.dashboard.attention.expiringTokens', { count: item.items.length, days: EXPIRING_SOON_DAYS }, item.items.length) }}
            </p>
            <ul class="grid gap-0.5 text-muted-foreground">
              <li v-for="token in item.items" :key="token.id">
                {{ t('admin.dashboard.attention.expiresOn', { name: token.name, date: when(token.expiresAt) }) }}
              </li>
            </ul>
            <NuxtLink to="/admin/tokens" class="font-medium text-primary underline-offset-4 hover:underline">
              {{ t('admin.dashboard.attention.manageTokens') }}
            </NuxtLink>
          </template>

          <template v-else-if="item.kind === 'expiringKeys'">
            <p class="font-medium">
              {{ t('admin.dashboard.attention.expiringKeys', { count: item.items.length, days: EXPIRING_SOON_DAYS }, item.items.length) }}
            </p>
            <ul class="grid gap-0.5">
              <li v-for="key in item.items" :key="key.id">
                <NuxtLink :to="`/admin/projects/${key.project.id}/keys`" class="text-primary underline-offset-4 hover:underline">
                  {{ t('admin.dashboard.attention.keyLine', { name: key.name, project: key.project.name, environment: environmentLabel(key.environment ?? '') }) }}
                </NuxtLink>
                <span class="text-muted-foreground"> — {{ when(key.expiresAt) }}</span>
              </li>
            </ul>
          </template>

          <template v-else-if="item.kind === 'invitations'">
            <p class="font-medium">
              {{ t('admin.dashboard.attention.invitations', { count: item.pending }, item.pending) }}
            </p>
            <p v-if="item.expired" class="text-muted-foreground">
              {{ t('admin.dashboard.attention.invitationsExpired', { count: item.expired }, item.expired) }}
            </p>
            <NuxtLink to="/admin/users?status=invited" class="font-medium text-primary underline-offset-4 hover:underline">
              {{ t('admin.dashboard.attention.manageInvitations') }}
            </NuxtLink>
          </template>

          <template v-else-if="item.kind === 'trash'">
            <p class="font-medium">
              {{ t('admin.dashboard.attention.trash', { count: item.total }, item.total) }}
            </p>
            <ul class="grid gap-0.5">
              <li v-for="space in item.spaces" :key="space.type === 'library' ? 'library' : space.id">
                <NuxtLink
                  :to="space.type === 'library' ? '/admin/media?status=trash' : `/admin/projects/${space.id}/media?status=trash`"
                  class="text-primary underline-offset-4 hover:underline"
                >
                  {{ t('admin.dashboard.attention.trashSpace', { space: space.type === 'library' ? t('space.library') : space.name, count: space.count }, space.count) }}
                </NuxtLink>
              </li>
            </ul>
          </template>

          <p v-else-if="item.kind === 'siteUrl'">
            {{ t('admin.dashboard.attention.siteUrl') }}
          </p>
          <p v-else-if="item.kind === 'mail'">
            {{ t('admin.dashboard.attention.mail') }}
          </p>
        </div>
      </li>
    </ul>
  </section>
</template>
