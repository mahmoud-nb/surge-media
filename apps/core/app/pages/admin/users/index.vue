<script setup lang="ts">
import { Plus, Search, Users } from '@lucide/vue'

/**
 * Comptes : tous pour un administrateur (users:manage) ; pour un gestionnaire (users:invite), ceux
 * qu'il a invités — le serveur filtre la liste.
 */
definePageMeta({ layout: 'admin', permission: 'users:invite' })

const { t, locale } = useI18n()
const route = useRoute()
const { user: currentUser, can } = useAuth()
const isAdmin = computed(() => can('users:manage'))

useSeoMeta({ title: () => (isAdmin.value ? t('users.list.meta.title') : t('users.list.meta.invitationsTitle')) })

const flash = useFlash().consume()

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Formulaire de filtres (appliqués à la soumission) ; la liste suit les paramètres d'URL.
const filters = reactive({ q: '', role: '', status: '' })
watch(() => route.query, (query) => {
  filters.q = queryValue(query.q)
  filters.role = queryValue(query.role)
  filters.status = queryValue(query.status)
}, { immediate: true })

const hasFilters = computed(() => Boolean(route.query.q || route.query.role || route.query.status))

const { data, error, refresh } = await useApiFetch('/api/admin/users', {
  query: computed(() => ({
    q: route.query.q,
    role: route.query.role,
    status: route.query.status,
    page: route.query.page,
  })),
})

const pageCount = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))

function applyFilters() {
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
  return navigateTo({ query })
}

function pageLink(page: number) {
  return { query: { ...route.query, page: page > 1 ? String(page) : undefined } }
}

const roleOptions = computed(() => [
  { value: '' as const, label: t('users.filters.allRoles') },
  ...(isAdmin.value ? ROLES : invitableRoles(currentUser.value?.role)).map(role => ({ value: role, label: t(`roles.${role}.label`) })),
])
const statusOptions = computed(() => [
  { value: '' as const, label: t('users.filters.allStatuses') },
  ...USER_STATUSES.map(status => ({ value: status, label: t(`users.status.${status}`) })),
])
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <AdminPageHeader
      :title="isAdmin ? t('users.list.title') : t('users.list.invitationsTitle')"
      :description="isAdmin ? t('users.list.description') : t('users.list.invitationsDescription')"
    >
      <template #actions>
        <UiButton to="/admin/users/new">
          <Plus aria-hidden="true" />
          {{ isAdmin ? t('users.list.create') : t('users.list.invite') }}
        </UiButton>
      </template>
    </AdminPageHeader>

    <UiAlert v-if="flash" :variant="flash.variant" live="polite" class="mb-6">
      {{ flash.message }}
    </UiAlert>

    <form role="search" :aria-label="t('users.filters.label')" class="mb-6 grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] lg:items-end" @submit.prevent="applyFilters">
      <UiFormField v-slot="field" :label="t('users.filters.search')">
        <UiInput v-bind="field" v-model="filters.q" type="search" name="q" autocomplete="off" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('users.filters.role')">
        <UiSelect v-bind="field" v-model="filters.role" :options="roleOptions" name="role" />
      </UiFormField>
      <UiFormField v-slot="field" :label="t('users.filters.status')">
        <UiSelect v-bind="field" v-model="filters.status" :options="statusOptions" name="status" />
      </UiFormField>
      <div class="flex gap-2">
        <UiButton type="submit" variant="secondary">
          <Search aria-hidden="true" />
          {{ t('users.filters.apply') }}
        </UiButton>
        <UiButton v-if="hasFilters" to="/admin/users" variant="ghost">
          {{ t('users.filters.reset') }}
        </UiButton>
      </div>
    </form>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('users.list.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="data">
      <p class="mb-3 text-sm text-muted-foreground" role="status">
        {{ t('users.list.count', { count: data.total }, data.total) }}
      </p>

      <div
        v-if="data.items.length > 0"
        class="overflow-x-auto rounded-xl border border-border bg-surface"
        role="region"
        aria-labelledby="users-caption"
        tabindex="0"
      >
        <table class="w-full min-w-[40rem] text-left text-sm">
          <caption id="users-caption" class="sr-only">
            {{ isAdmin ? t('users.list.caption') : t('users.list.invitationsCaption') }}
          </caption>
          <thead class="border-b border-border text-muted-foreground">
            <tr>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('users.columns.user') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('users.columns.role') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('users.columns.status') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('users.columns.lastLogin') }}
              </th>
              <th scope="col" class="px-4 py-3 font-medium">
                {{ t('users.columns.mfa') }}
              </th>
              <th v-if="isAdmin" scope="col" class="px-4 py-3 font-medium">
                {{ t('users.columns.invitedBy') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="item in data.items" :key="item.id" class="hover:bg-muted/60">
              <th scope="row" class="px-4 py-3 font-normal">
                <div class="flex items-center gap-2">
                  <NuxtLink :to="`/admin/users/${item.id}`" class="font-medium text-primary underline-offset-4 hover:underline">
                    {{ item.name || item.email }}
                  </NuxtLink>
                  <UiBadge v-if="item.id === currentUser?.id">
                    {{ t('users.list.you') }}
                  </UiBadge>
                </div>
                <p v-if="item.name" class="mt-0.5 text-muted-foreground">
                  {{ item.email }}
                </p>
              </th>
              <td class="px-4 py-3">
                {{ t(`roles.${item.role}.label`) }}
              </td>
              <td class="px-4 py-3">
                <AdminUserStatusBadge :status="item.status" />
              </td>
              <td class="px-4 py-3 text-muted-foreground">
                <NuxtTime v-if="item.lastLoginAt" :datetime="item.lastLoginAt" :locale="locale" date-style="medium" time-style="short" />
                <span v-else>{{ t('users.list.never') }}</span>
              </td>
              <td class="px-4 py-3">
                <UiBadge v-if="item.mfaEnabled" variant="success">
                  {{ t('users.mfa.on') }}
                </UiBadge>
                <span v-else class="text-muted-foreground">{{ t('users.mfa.off') }}</span>
              </td>
              <td v-if="isAdmin" class="px-4 py-3 text-muted-foreground">
                <template v-if="item.invitedBy">
                  {{ item.invitedBy.id === currentUser?.id ? t('users.list.you') : (item.invitedBy.name || item.invitedBy.email) }}
                </template>
                <span v-else>{{ t('users.list.noInviter') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input bg-surface px-6 py-14 text-center">
        <Users class="size-8 text-muted-foreground" aria-hidden="true" />
        <p class="font-medium text-foreground">
          {{ hasFilters ? t('users.list.emptyFiltered') : (isAdmin ? t('users.list.empty') : t('users.list.invitationsEmpty')) }}
        </p>
        <UiButton v-if="hasFilters" to="/admin/users" variant="outline" size="sm">
          {{ t('users.filters.reset') }}
        </UiButton>
      </div>

      <UiPagination class="mt-6" :page="data.page" :page-count="pageCount" :to="pageLink" />
    </template>
  </div>
</template>
