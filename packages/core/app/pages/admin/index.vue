<script setup lang="ts">
import { Check, Minus } from '@lucide/vue'

definePageMeta({ layout: 'admin' })

const { t, locale } = useI18n()
const { user, role, loggedInAt, can } = useAuth()

useSeoMeta({ title: () => t('admin.dashboard.meta.title') })

// Réservé aux administrateurs : identifiants d'amorçage encore présents dans l'environnement ?
const { data: status } = await useFetch('/api/admin/status', {
  immediate: can('users:manage'),
})

const displayName = computed(() => user.value?.name || user.value?.email || '')

const permissionList = computed(() => PERMISSIONS.map(permission => ({
  permission,
  granted: can(permission),
  label: t(`permissions.${permission.replace(':', '.')}`),
})))
</script>

<template>
  <div v-if="user && role" class="mx-auto max-w-5xl">
    <AdminPageHeader
      :title="t('admin.dashboard.title')"
      :description="t('admin.dashboard.greeting', { name: displayName })"
    />

    <UiAlert
      v-if="status?.bootstrapCredentialsSet"
      variant="warning"
      :title="t('admin.dashboard.bootstrapWarning.title')"
      class="mb-6"
    >
      {{ t('admin.dashboard.bootstrapWarning.description') }}
    </UiAlert>

    <div class="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="account-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <h2 id="account-title" class="text-lg font-semibold text-foreground">
          {{ t('admin.dashboard.account.title') }}
        </h2>
        <dl class="mt-5 grid gap-4 text-sm">
          <div class="grid gap-1">
            <dt class="text-muted-foreground">
              {{ t('admin.dashboard.account.name') }}
            </dt>
            <dd class="font-medium text-foreground">
              {{ user.name || t('admin.dashboard.account.noName') }}
            </dd>
          </div>
          <div class="grid gap-1">
            <dt class="text-muted-foreground">
              {{ t('admin.dashboard.account.email') }}
            </dt>
            <dd class="font-medium break-all text-foreground">
              {{ user.email }}
            </dd>
          </div>
          <div class="grid gap-1">
            <dt class="text-muted-foreground">
              {{ t('admin.dashboard.account.role') }}
            </dt>
            <dd>
              <span class="inline-flex rounded-full border border-primary/40 bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
                {{ t(`roles.${role}.label`) }}
              </span>
            </dd>
          </div>
          <div v-if="loggedInAt" class="grid gap-1">
            <dt class="text-muted-foreground">
              {{ t('admin.dashboard.account.loggedInAt') }}
            </dt>
            <dd class="font-medium text-foreground">
              <NuxtTime :datetime="loggedInAt" :locale="locale" date-style="long" time-style="short" />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="permissions-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <h2 id="permissions-title" class="text-lg font-semibold text-foreground">
          {{ t('admin.dashboard.permissions.title') }}
        </h2>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ t(`roles.${role}.description`) }}
        </p>
        <ul class="mt-5 grid gap-3 text-sm">
          <li v-for="item in permissionList" :key="item.permission" class="flex items-center gap-3">
            <span
              :class="cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full',
                item.granted ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground',
              )"
            >
              <Check v-if="item.granted" class="size-3.5" aria-hidden="true" />
              <Minus v-else class="size-3.5" aria-hidden="true" />
            </span>
            <span :class="item.granted ? 'text-foreground' : 'text-muted-foreground'">
              {{ item.label }}
            </span>
            <span class="ml-auto text-xs text-muted-foreground">
              {{ item.granted ? t('admin.dashboard.permissions.granted') : t('admin.dashboard.permissions.notGranted') }}
            </span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
