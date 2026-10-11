<script setup lang="ts">
import { LogOut, Search, UserMinus, UserPlus } from '@lucide/vue'

definePageMeta({ layout: 'admin' })

interface StatusMessage {
  variant: 'success' | 'error'
  message: string
}

const { t } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()
const { user: currentUser } = useAuth()
const flash = useFlash()
// Gestion des membres : confirmation récente du mot de passe exigée par l'API.
const reauth = useReauth()

const projectId = computed(() => String(route.params.id))
const { data: projectData, error: projectLoadError, refresh: refreshProject } = await useApiFetch(() => `/api/admin/projects/${projectId.value}`)
if (projectLoadError.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })
}
const { data, error, refresh } = await useApiFetch(() => `/api/admin/projects/${projectId.value}/members`)

const project = computed(() => projectData.value?.project)
const canManage = computed(() => Boolean(data.value?.scopes.includes('project:members')))

type Member = NonNullable<typeof data.value>['members'][number]

useSeoMeta({ title: () => (project.value ? t('projects.members.meta.title', { name: project.value.name }) : t('projects.list.title')) })

const status = ref<StatusMessage | null>(null)

function displayName(user: { name: string | null, email: string }): string {
  return user.name || user.email
}

function errorMessage(error: unknown): string {
  const { code } = apiError(error)
  return code && (PROJECT_ERROR_CODES as readonly string[]).includes(code) ? t(`projects.errors.${code}`) : t('common.unexpectedError')
}

async function reload() {
  await Promise.all([refresh(), refreshProject()])
}

/** Rôle exercé inférieur au rôle enregistré (plafond du rôle de plateforme). */
function isCapped(member: Member): boolean {
  return member.effectiveRole !== null && PROJECT_ROLES.indexOf(member.effectiveRole) > PROJECT_ROLES.indexOf(member.role)
}

function roleOptions(roles: readonly ProjectRole[]) {
  return roles.map(role => ({ value: role, label: t(`projectRoles.${role}.label`) }))
}

// ─── Rôles ───────────────────────────────────────────────────────────────────

const roleDrafts = reactive<Record<string, ProjectRole | ''>>({})
watch(() => data.value?.members, (members) => {
  for (const member of members ?? []) roleDrafts[member.user.id] = member.role
}, { immediate: true })

const savingRole = ref<string | null>(null)

async function saveRole(member: Member) {
  const role = roleDrafts[member.user.id]
  if (!role || role === member.role) return
  status.value = null
  savingRole.value = member.user.id
  try {
    await reauth.run(async () => {
      await $api(`/api/admin/projects/${projectId.value}/members/${member.user.id}`, { method: 'PATCH', body: { role } })
    })
    await reload()
    status.value = { variant: 'success', message: t('projects.members.roleUpdated', { name: displayName(member.user) }) }
  }
  catch (error) {
    if (isReauthCancelled(error)) return
    roleDrafts[member.user.id] = member.role
    status.value = { variant: 'error', message: errorMessage(error) }
  }
  finally {
    savingRole.value = null
  }
}

// ─── Retrait (ou départ de l'utilisateur lui-même) ───────────────────────────

const removeTarget = ref<Member | null>(null)
const removeOpen = computed({
  get: () => removeTarget.value !== null,
  set: (value) => {
    if (!value) removeTarget.value = null
  },
})
const removingSelf = computed(() => removeTarget.value?.user.id === currentUser.value?.id)
const removeError = ref<string>()
const removing = ref(false)

function askRemove(member: Member) {
  removeError.value = undefined
  removeTarget.value = member
}

async function confirmRemove() {
  const member = removeTarget.value
  if (!member) return
  removeError.value = undefined
  removing.value = true
  try {
    await reauth.run(async () => {
      await $api(`/api/admin/projects/${projectId.value}/members/${member.user.id}`, { method: 'DELETE' })
    })
    removeTarget.value = null
    if (member.user.id === currentUser.value?.id) {
      flash.set({ variant: 'success', message: t('projects.members.left', { name: project.value?.name ?? '' }) })
      await navigateTo('/admin/projects')
      return
    }
    await reload()
    status.value = { variant: 'success', message: t('projects.members.removed', { name: displayName(member.user) }) }
    // Le bouton qui a ouvert la boîte de dialogue a disparu avec la ligne : focus sur la section.
    await nextTick()
    document.getElementById('members-title')?.focus()
  }
  catch (error) {
    if (!isReauthCancelled(error)) removeError.value = errorMessage(error)
  }
  finally {
    removing.value = false
  }
}

// ─── Ajout ───────────────────────────────────────────────────────────────────

interface Candidate {
  id: string
  name: string | null
  email: string
  role: Role
  assignableRoles: ProjectRole[]
}

const searchId = useId()
const searchHintId = useId()
const resultsId = useId()
const search = ref('')
const searched = ref(false)
const searching = ref(false)
const candidates = ref<Candidate[]>([])
const candidateRoles = reactive<Record<string, ProjectRole | ''>>({})
const addStatus = ref<StatusMessage | null>(null)
const adding = ref<string | null>(null)

async function searchCandidates() {
  addStatus.value = null
  searching.value = true
  try {
    const result = await $api(`/api/admin/projects/${projectId.value}/candidates`, { query: { q: search.value.trim() || undefined } })
    candidates.value = result.candidates
    // Rôle le moins privilégié parmi ceux qu'on peut lui attribuer (propriétaire pour un gestionnaire).
    for (const candidate of result.candidates) candidateRoles[candidate.id] = candidate.assignableRoles.at(-1) ?? ''
    searched.value = true
  }
  catch (error) {
    addStatus.value = { variant: 'error', message: errorMessage(error) }
  }
  finally {
    searching.value = false
  }
}

async function addCandidate(candidate: Candidate) {
  const role = candidateRoles[candidate.id]
  if (!role) return
  addStatus.value = null
  adding.value = candidate.id
  try {
    await reauth.run(async () => {
      await $api(`/api/admin/projects/${projectId.value}/members`, { method: 'POST', body: { userId: candidate.id, role } })
    })
    candidates.value = candidates.value.filter(item => item.id !== candidate.id)
    await reload()
    addStatus.value = { variant: 'success', message: t('projects.members.add.added', { name: displayName(candidate) }) }
    // Le bouton « Ajouter » a disparu avec le compte : focus sur la liste des résultats.
    await nextTick()
    document.getElementById(resultsId)?.focus()
  }
  catch (error) {
    if (!isReauthCancelled(error)) addStatus.value = { variant: 'error', message: errorMessage(error) }
  }
  finally {
    adding.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <UiAlert v-if="projectLoadError" variant="error" live="assertive" :title="t('projects.overview.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="reload()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="project">
      <AdminProjectHeader :project="project" :scopes="projectData?.scopes ?? []" />

      <section aria-labelledby="members-title" class="mb-8">
        <h2 id="members-title" tabindex="-1" class="text-lg font-semibold text-foreground">
          {{ t('projects.members.title') }}
        </h2>
        <p class="mt-1 mb-4 text-sm text-muted-foreground">
          {{ t('projects.members.description') }} {{ t('projects.members.adminNote') }}
        </p>

        <UiAlert v-if="status" :variant="status.variant" :live="status.variant === 'error' ? 'assertive' : 'polite'" class="mb-4">
          {{ status.message }}
        </UiAlert>

        <UiAlert v-if="error" variant="error" live="assertive" :title="t('projects.members.loadError')">
          <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
            {{ t('common.retry') }}
          </UiButton>
        </UiAlert>

        <div
          v-else-if="data && data.members.length > 0"
          class="overflow-x-auto rounded-xl border border-border bg-surface"
          role="region"
          aria-labelledby="members-caption"
          tabindex="0"
        >
          <table class="w-full min-w-[44rem] text-left text-sm">
            <caption id="members-caption" class="sr-only">
              {{ t('projects.members.caption') }}
            </caption>
            <thead class="border-b border-border text-muted-foreground">
              <tr>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('projects.members.columns.member') }}
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('projects.members.columns.platformRole') }}
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('projects.members.columns.role') }}
                </th>
                <th scope="col" class="px-4 py-3 font-medium">
                  {{ t('projects.members.columns.actions') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="member in data.members" :key="member.user.id">
                <th scope="row" class="px-4 py-3 align-top font-normal">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium text-foreground">{{ displayName(member.user) }}</span>
                    <UiBadge v-if="member.user.id === currentUser?.id">
                      {{ t('projects.members.you') }}
                    </UiBadge>
                    <AdminUserStatusBadge v-if="member.user.status !== 'active'" :status="member.user.status" />
                  </div>
                  <p v-if="member.user.name" class="mt-0.5 break-all text-muted-foreground">
                    {{ member.user.email }}
                  </p>
                </th>
                <td class="px-4 py-3 align-top">
                  {{ t(`roles.${member.user.role}.label`) }}
                </td>
                <td class="px-4 py-3 align-top">
                  <form v-if="canManage && member.assignableRoles.length > 1" class="flex flex-wrap items-center gap-2" @submit.prevent="saveRole(member)">
                    <UiSelect
                      v-model="roleDrafts[member.user.id]"
                      :options="roleOptions(member.assignableRoles)"
                      :aria-label="t('projects.members.roleLabel', { name: displayName(member.user) })"
                      class="w-44"
                    />
                    <UiButton
                      type="submit"
                      variant="outline"
                      size="sm"
                      :disabled="roleDrafts[member.user.id] === member.role"
                      :loading="savingRole === member.user.id"
                      :aria-label="t('projects.members.saveRoleLabel', { name: displayName(member.user) })"
                    >
                      {{ t('projects.members.saveRole') }}
                    </UiButton>
                  </form>
                  <span v-else>{{ t(`projectRoles.${member.effectiveRole ?? member.role}.label`) }}</span>
                  <p v-if="member.user.role === 'MANAGER'" class="mt-1 text-xs text-muted-foreground">
                    {{ t('projects.members.managerOwner') }}
                  </p>
                  <p v-if="isCapped(member) && member.effectiveRole" class="mt-1 text-xs text-muted-foreground">
                    {{ t('projects.members.capped', { role: t(`projectRoles.${member.effectiveRole}.label`) }) }}
                  </p>
                </td>
                <td class="px-4 py-3 align-top">
                  <UiButton
                    v-if="member.user.id === currentUser?.id"
                    variant="outline"
                    size="sm"
                    @click="askRemove(member)"
                  >
                    <LogOut aria-hidden="true" />
                    {{ t('projects.members.leave') }}
                  </UiButton>
                  <UiButton
                    v-else-if="canManage"
                    variant="outline"
                    size="sm"
                    :aria-label="t('projects.members.removeLabel', { name: displayName(member.user) })"
                    @click="askRemove(member)"
                  >
                    <UserMinus aria-hidden="true" />
                    {{ t('projects.members.remove') }}
                  </UiButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-else-if="data" class="rounded-xl border border-dashed border-input bg-surface px-6 py-10 text-center text-muted-foreground">
          {{ t('projects.members.empty') }}
        </p>
      </section>

      <section v-if="canManage" aria-labelledby="add-member-title" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <h2 id="add-member-title" class="text-lg font-semibold text-foreground">
          {{ t('projects.members.add.title') }}
        </h2>
        <form role="search" :aria-labelledby="searchId" class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="searchCandidates">
          <div class="grid min-w-64 flex-1 gap-1.5">
            <label :id="searchId" :for="`${searchId}-input`" class="text-sm font-medium text-foreground">
              {{ t('projects.members.add.search') }}
            </label>
            <p :id="searchHintId" class="text-sm text-muted-foreground">
              {{ t('projects.members.add.searchHint') }}
            </p>
            <UiInput :id="`${searchId}-input`" v-model="search" type="search" name="q" autocomplete="off" :aria-describedby="searchHintId" />
          </div>
          <UiButton type="submit" variant="secondary" :loading="searching">
            <Search aria-hidden="true" />
            {{ t('projects.members.add.searchAction') }}
          </UiButton>
        </form>

        <UiAlert v-if="addStatus" :variant="addStatus.variant" :live="addStatus.variant === 'error' ? 'assertive' : 'polite'" class="mt-4">
          {{ addStatus.message }}
        </UiAlert>

        <div v-if="searched" class="mt-5">
          <h3 :id="resultsId" tabindex="-1" class="text-base font-semibold text-foreground">
            {{ t('projects.members.add.results') }}
          </h3>
          <p v-if="candidates.length === 0" class="mt-2 text-sm text-muted-foreground" role="status">
            {{ t('projects.members.add.noResults') }}
          </p>
          <ul v-else class="mt-3 divide-y divide-border rounded-lg border border-border">
            <li v-for="candidate in candidates" :key="candidate.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="font-medium text-foreground">
                  {{ displayName(candidate) }}
                </p>
                <p class="text-sm break-all text-muted-foreground">
                  <template v-if="candidate.name">
                    {{ candidate.email }} ·
                  </template>
                  {{ t(`roles.${candidate.role}.label`) }}
                </p>
              </div>
              <form class="flex flex-wrap items-center gap-2" @submit.prevent="addCandidate(candidate)">
                <UiSelect
                  v-if="candidate.assignableRoles.length > 1"
                  v-model="candidateRoles[candidate.id]"
                  :options="roleOptions(candidate.assignableRoles)"
                  :aria-label="t('projects.members.add.role', { name: displayName(candidate) })"
                  class="w-44"
                />
                <span v-else-if="candidate.assignableRoles[0]" class="text-sm text-muted-foreground">
                  {{ t('projects.members.add.asRole', { role: t(`projectRoles.${candidate.assignableRoles[0]}.label`) }) }}
                </span>
                <UiButton
                  type="submit"
                  size="sm"
                  :loading="adding === candidate.id"
                  :aria-label="t('projects.members.add.actionLabel', { name: displayName(candidate) })"
                >
                  <UserPlus aria-hidden="true" />
                  {{ t('projects.members.add.action') }}
                </UiButton>
              </form>
            </li>
          </ul>
        </div>
      </section>

      <UiDialog
        v-model:open="removeOpen"
        :title="removingSelf ? t('projects.members.leaveConfirmTitle') : t('projects.members.removeConfirmTitle', { name: removeTarget ? displayName(removeTarget.user) : '' })"
        :description="removingSelf ? t('projects.members.leaveConfirmDescription') : t('projects.members.removeConfirmDescription')"
      >
        <UiAlert v-if="removeError" variant="error" live="assertive">
          {{ removeError }}
        </UiAlert>
        <template #actions>
          <UiButton variant="outline" autofocus @click="removeOpen = false">
            {{ t('common.cancel') }}
          </UiButton>
          <UiButton variant="destructive" :loading="removing" @click="confirmRemove">
            {{ removingSelf ? t('projects.members.leave') : t('projects.members.remove') }}
          </UiButton>
        </template>
      </UiDialog>
    </template>
  </div>
</template>
