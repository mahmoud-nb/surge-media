<script setup lang="ts">
import { ArrowLeft, KeyRound, LogOut, Trash2 } from '@lucide/vue'
import { NAME_MAX_LENGTH, updateUserSchema } from '#shared/schemas/users'

definePageMeta({ layout: 'admin', permission: 'users:manage' })

interface PasswordLink {
  path: string
  purpose: 'INVITATION' | 'RESET'
  expiresAt: string | Date
  email: string
}

interface StatusMessage {
  variant: 'success' | 'error'
  message: string
}

const { t, locale } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()
const { user: currentUser, refresh: refreshSession } = useAuth()
const flash = useFlash()
const initialFlash = flash.consume()

const userId = computed(() => String(route.params.id))
const { data, error, refresh } = await useApiFetch(() => `/api/admin/users/${userId.value}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'User not found', fatal: true })
}

const user = computed(() => data.value?.user)
const isSelf = computed(() => user.value?.id === currentUser.value?.id)
const displayName = computed(() => user.value?.name || user.value?.email || '')

useSeoMeta({ title: () => displayName.value || t('users.list.title') })

/** Message traduit d'une erreur métier de l'API. */
function userErrorMessage(err: unknown): string {
  const { code } = apiError(err)
  if (code === 'SELF_ACTION') return t('users.errors.selfAction')
  if (code === 'LAST_ADMIN') return t('users.errors.lastAdmin')
  return t('common.unexpectedError')
}

// ─── Profil ──────────────────────────────────────────────────────────────────

const FIELD_IDS = { name: 'user-name', role: 'user-role' } as const
const form = reactive<{ name: string, role: Role | '', isActive: boolean }>({ name: '', role: '', isActive: true })
watch(user, (value) => {
  if (value) Object.assign(form, { name: value.name ?? '', role: value.role, isActive: value.isActive })
}, { immediate: true })

const { validate, message, clear } = useFormValidation(updateUserSchema, FIELD_IDS)
const profileStatus = ref<StatusMessage | null>(null)
const saving = ref(false)

async function saveProfile() {
  profileStatus.value = null
  // Son propre compte : seul le nom est modifiable (le serveur l'impose aussi).
  const input = validate(isSelf.value ? { name: form.name } : { ...form })
  if (!input) return

  saving.value = true
  try {
    await $api(`/api/admin/users/${userId.value}`, { method: 'PATCH', body: input })
    await refresh()
    if (isSelf.value) await refreshSession()
    profileStatus.value = { variant: 'success', message: t('users.edit.saved') }
  }
  catch (err) {
    profileStatus.value = { variant: 'error', message: userErrorMessage(err) }
  }
  finally {
    saving.value = false
  }
}

// ─── Accès : lien de mot de passe et sessions ───────────────────────────────

const link = ref<PasswordLink | null>((initialFlash?.payload?.invitation as PasswordLink | undefined) ?? null)
const accessStatus = ref<StatusMessage | null>(null)
const generating = ref(false)
const revoking = ref(false)

async function generateLink() {
  accessStatus.value = null
  link.value = null
  generating.value = true
  try {
    const result = await $api(`/api/admin/users/${userId.value}/password-link`, { method: 'POST' })
    link.value = { ...result, email: user.value?.email ?? '' }
    await refresh()
  }
  catch (err) {
    accessStatus.value = { variant: 'error', message: userErrorMessage(err) }
  }
  finally {
    generating.value = false
  }
}

async function revokeSessions() {
  accessStatus.value = null
  revoking.value = true
  try {
    const { revoked } = await $api(`/api/admin/users/${userId.value}/sessions`, { method: 'DELETE' })
    accessStatus.value = { variant: 'success', message: t('users.access.sessionsRevoked', { count: revoked }, revoked) }
    await refresh()
  }
  catch (err) {
    accessStatus.value = { variant: 'error', message: userErrorMessage(err) }
  }
  finally {
    revoking.value = false
  }
}

// ─── Suppression ─────────────────────────────────────────────────────────────

const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref<string>()

async function deleteUser() {
  deleteError.value = undefined
  deleting.value = true
  try {
    await $api(`/api/admin/users/${userId.value}`, { method: 'DELETE' })
    flash.set({ variant: 'success', message: t('users.delete.success', { email: user.value?.email ?? '' }) })
    deleteOpen.value = false
    await navigateTo('/admin/users')
  }
  catch (err) {
    deleteError.value = userErrorMessage(err)
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <NuxtLink to="/admin/users" class="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" />
      {{ t('users.backToList') }}
    </NuxtLink>

    <UiAlert v-if="error" variant="error" live="assertive" :title="t('users.edit.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="user && data">
      <AdminPageHeader :title="displayName" :description="user.name ? user.email : undefined">
        <template #actions>
          <AdminUserStatusBadge :status="user.status" />
        </template>
      </AdminPageHeader>

      <div class="grid gap-6">
        <UiAlert v-if="initialFlash" :variant="initialFlash.variant" live="polite">
          {{ initialFlash.message }}
        </UiAlert>

        <AdminPasswordLinkPanel v-if="link" v-bind="link" />

        <!-- Profil -->
        <section aria-labelledby="profile-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
          <h2 id="profile-title" class="text-lg font-semibold text-foreground">
            {{ t('users.edit.profileTitle') }}
          </h2>
          <form class="mt-5 grid gap-6" novalidate @submit.prevent="saveProfile">
            <UiAlert v-if="profileStatus" :variant="profileStatus.variant" :live="profileStatus.variant === 'error' ? 'assertive' : 'polite'">
              {{ profileStatus.message }}
            </UiAlert>

            <dl class="grid gap-1 text-sm">
              <dt class="font-medium text-foreground">
                {{ t('users.fields.email') }}
              </dt>
              <dd class="break-all text-muted-foreground">
                {{ user.email }}
              </dd>
            </dl>

            <UiFormField v-slot="field" :id="FIELD_IDS.name" :label="t('users.fields.name')" :hint="t('users.fields.nameHint')" :error="message('name')" class="max-w-md">
              <UiInput v-bind="field" v-model="form.name" name="name" autocomplete="off" :maxlength="NAME_MAX_LENGTH" @input="clear('name')" />
            </UiFormField>

            <AdminRoleField
              :id="FIELD_IDS.role"
              v-model="form.role"
              :legend="t('users.fields.role')"
              :hint="isSelf ? t('users.edit.selfRoleHint') : undefined"
              :error="message('role')"
              :disabled="isSelf"
            />

            <UiSwitch
              v-model="form.isActive"
              :label="t('users.fields.active')"
              :description="isSelf ? t('users.edit.selfActiveHint') : t('users.fields.activeHint')"
              :disabled="isSelf"
            />

            <div class="flex justify-end">
              <UiButton type="submit" :loading="saving">
                {{ t('common.save') }}
              </UiButton>
            </div>
          </form>
        </section>

        <!-- Accès et sécurité -->
        <section aria-labelledby="access-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
          <h2 id="access-title" class="text-lg font-semibold text-foreground">
            {{ t('users.access.title') }}
          </h2>

          <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-3">
            <div class="grid gap-1">
              <dt class="text-muted-foreground">
                {{ t('users.access.password') }}
              </dt>
              <dd class="font-medium text-foreground">
                {{ user.status === 'invited' ? t('users.access.passwordPending') : t('users.access.passwordSet') }}
              </dd>
            </div>
            <div class="grid gap-1">
              <dt class="text-muted-foreground">
                {{ t('users.columns.lastLogin') }}
              </dt>
              <dd class="font-medium text-foreground">
                <NuxtTime v-if="user.lastLoginAt" :datetime="user.lastLoginAt" :locale="locale" date-style="medium" time-style="short" />
                <span v-else>{{ t('users.list.never') }}</span>
              </dd>
            </div>
            <div class="grid gap-1">
              <dt class="text-muted-foreground">
                {{ t('users.access.sessions') }}
              </dt>
              <dd class="font-medium text-foreground">
                {{ data.activeSessions }}
              </dd>
            </div>
          </dl>

          <p v-if="data.pendingLink" class="mt-4 text-sm text-muted-foreground">
            <i18n-t :keypath="`users.access.pending.${data.pendingLink.purpose === 'INVITATION' ? 'invitation' : 'reset'}`" tag="span" scope="global">
              <template #date>
                <NuxtTime :datetime="data.pendingLink.expiresAt" :locale="locale" date-style="long" time-style="short" />
              </template>
            </i18n-t>
          </p>

          <UiAlert v-if="accessStatus" :variant="accessStatus.variant" :live="accessStatus.variant === 'error' ? 'assertive' : 'polite'" class="mt-4">
            {{ accessStatus.message }}
          </UiAlert>

          <div class="mt-5 flex flex-wrap gap-3">
            <UiButton variant="outline" :disabled="!user.isActive" :loading="generating" @click="generateLink">
              <KeyRound aria-hidden="true" />
              {{ user.status === 'invited' ? t('users.access.newInvitation') : t('users.access.resetLink') }}
            </UiButton>
            <UiButton variant="outline" :disabled="data.activeSessions === 0" :loading="revoking" @click="revokeSessions">
              <LogOut aria-hidden="true" />
              {{ isSelf ? t('users.access.revokeOtherSessions') : t('users.access.revokeSessions') }}
            </UiButton>
          </div>
          <p v-if="!user.isActive" class="mt-3 text-sm text-muted-foreground">
            {{ t('users.access.inactiveHint') }}
          </p>
        </section>

        <!-- Suppression -->
        <section v-if="!isSelf" aria-labelledby="danger-title" class="rounded-xl border border-destructive/40 bg-surface p-6 shadow-xs">
          <h2 id="danger-title" class="text-lg font-semibold text-foreground">
            {{ t('users.delete.title') }}
          </h2>
          <p class="mt-2 text-sm text-muted-foreground">
            {{ t('users.delete.description') }}
          </p>
          <UiButton variant="destructive" class="mt-4" @click="deleteOpen = true">
            <Trash2 aria-hidden="true" />
            {{ t('users.delete.open') }}
          </UiButton>

          <UiDialog
            v-model:open="deleteOpen"
            :title="t('users.delete.confirmTitle')"
            :description="t('users.delete.confirmDescription', { email: user.email })"
          >
            <UiAlert v-if="deleteError" variant="error" live="assertive">
              {{ deleteError }}
            </UiAlert>
            <template #actions>
              <UiButton variant="outline" autofocus @click="deleteOpen = false">
                {{ t('common.cancel') }}
              </UiButton>
              <UiButton variant="destructive" :loading="deleting" @click="deleteUser">
                {{ t('users.delete.confirm') }}
              </UiButton>
            </template>
          </UiDialog>
        </section>
      </div>
    </template>
  </div>
</template>
