<script setup lang="ts">
/**
 * Invitation d'un compte (users:invite). Administrateur : tout rôle, projets facultatifs.
 * Gestionnaire : développeur ou éditeur, rattaché à au moins un des projets dont il gère les
 * membres. Rattacher à des projets = ajouter des membres : confirmation du mot de passe.
 */
import { ArrowLeft } from '@lucide/vue'
import { createUserSchema, NAME_MAX_LENGTH } from '#shared/schemas/users'

definePageMeta({ layout: 'admin', permission: 'users:invite' })

const { t } = useI18n()
const { $api } = useNuxtApp()
const { user: currentUser, can } = useAuth()
const flash = useFlash()
const reauth = useReauth()

/** Administrateur : gestion complète des comptes ; sinon gestionnaire (invitations seulement). */
const isAdmin = computed(() => can('users:manage'))
const roles = computed(() => invitableRoles(currentUser.value?.role))

useSeoMeta({ title: () => (isAdmin.value ? t('users.create.meta.title') : t('users.create.meta.inviteTitle')) })

const FIELD_IDS = {
  email: 'user-email',
  name: 'user-name',
  role: 'user-role',
  projectIds: 'user-projects',
  projectRole: 'user-project-role',
} as const

// Projets proposés : actifs, dont l'utilisateur gère les membres.
const { data: spacesData, error: spacesError, refresh: refreshSpaces } = await useApiFetch('/api/admin/spaces', { query: { scope: 'project:members' } })
const projects = computed(() => (spacesData.value?.spaces ?? []).flatMap(space => (space.type === 'project' ? [space] : [])))
const projectOptions = computed(() => projects.value.map(project => ({ value: project.id, label: project.name })))

// EDITOR présélectionné : le rôle le moins privilégié.
const form = reactive<{ email: string, name: string, role: Role | '', projectIds: string[], projectRole: ProjectRole | '' }>({
  email: '',
  name: '',
  role: 'EDITOR',
  projectIds: [],
  projectRole: 'EDITOR',
})
const { validate, message, clear, setError } = useFormValidation(createUserSchema, FIELD_IDS)
const serverError = ref<string>()
const submitting = ref(false)

/** Un administrateur est propriétaire de tous les projets : inutile de l'y rattacher. */
const showProjects = computed(() => form.role !== '' && form.role !== 'ADMIN')
const projectRoles = computed(() => (form.role ? assignableProjectRoles(form.role) : []))
const projectRoleOptions = computed(() => projectRoles.value.map(role => ({
  value: role,
  label: t(`projectRoles.${role}.label`),
  description: t(`projectRoles.${role}.description`),
})))

// Nouveau rôle de plateforme : rôle de projet le plus élevé qu'il permet, si l'actuel n'est plus permis.
watch(projectRoles, (allowed) => {
  if (!form.projectRole || !allowed.includes(form.projectRole)) form.projectRole = allowed[0] ?? ''
})
watch(() => form.projectIds.length, () => clear('projectIds'))

async function onSubmit() {
  serverError.value = undefined
  const input = validate({
    email: form.email,
    name: form.name,
    role: form.role,
    ...(showProjects.value && form.projectIds.length ? { projectIds: form.projectIds, projectRole: form.projectRole } : {}),
  })
  if (!input) return
  // Un gestionnaire rattache toujours le compte à l'un de ses projets (le serveur l'impose aussi).
  if (!isAdmin.value && !input.projectIds?.length) {
    setError('projectIds', 'validation.projectsRequired')
    return
  }

  submitting.value = true
  try {
    const create = () => $api('/api/admin/users', { method: 'POST', body: input })
    const { user, invitation } = input.projectIds?.length ? await reauth.run(create) : await create()
    flash.set({
      variant: 'success',
      message: t(isAdmin.value ? 'users.create.success' : 'users.create.inviteSuccess', { email: user.email }),
      payload: { invitation: { ...invitation, email: user.email } },
    })
    await navigateTo(`/admin/users/${user.id}`)
  }
  catch (error) {
    if (isReauthCancelled(error)) return
    const { code } = apiError(error)
    if (code === 'EMAIL_TAKEN') setError('email', 'validation.emailTaken')
    else if (code === 'ROLE_NOT_INVITABLE') setError('role', 'validation.roleNotInvitable')
    else if (code === 'PROJECTS_REQUIRED') setError('projectIds', 'validation.projectsRequired')
    else if (code === 'PROJECT_UNAVAILABLE') {
      await refreshSpaces()
      form.projectIds = form.projectIds.filter(id => projects.value.some(project => project.id === id))
      setError('projectIds', 'validation.projectUnavailable')
    }
    else if (code === 'ROLE_NOT_ASSIGNABLE') setError('projectRole', 'validation.projectRoleNotAssignable')
    else serverError.value = t('common.unexpectedError')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <NuxtLink to="/admin/users" class="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" />
      {{ isAdmin ? t('users.backToList') : t('users.backToInvitations') }}
    </NuxtLink>
    <AdminPageHeader
      :title="isAdmin ? t('users.create.title') : t('users.create.inviteTitle')"
      :description="isAdmin ? t('users.create.description') : t('users.create.inviteDescription')"
    />

    <UiAlert v-if="serverError" variant="error" live="assertive" class="mb-6">
      {{ serverError }}
    </UiAlert>

    <form class="grid gap-6 rounded-xl border border-border bg-surface p-6 shadow-xs" novalidate @submit.prevent="onSubmit">
      <p class="text-sm text-muted-foreground">
        {{ t('form.requiredNote') }}
      </p>

      <div class="grid gap-5 sm:grid-cols-2">
        <UiFormField :id="FIELD_IDS.email" v-slot="field" :label="t('users.fields.email')" :error="message('email')" required>
          <UiInput
            v-bind="field"
            v-model="form.email"
            type="email"
            name="email"
            autocomplete="off"
            inputmode="email"
            autocapitalize="none"
            spellcheck="false"
            @input="clear('email')"
          />
        </UiFormField>
        <UiFormField :id="FIELD_IDS.name" v-slot="field" :label="t('users.fields.name')" :hint="t('users.fields.nameHint')" :error="message('name')">
          <UiInput v-bind="field" v-model="form.name" name="name" autocomplete="off" :maxlength="NAME_MAX_LENGTH" @input="clear('name')" />
        </UiFormField>
      </div>

      <AdminRoleField
        :id="FIELD_IDS.role"
        v-model="form.role"
        :roles="roles"
        :legend="t('users.fields.role')"
        :hint="isAdmin ? undefined : t('users.fields.roleInviteHint')"
        :error="message('role')"
        required
      />

      <template v-if="showProjects">
        <UiAlert v-if="spacesError" variant="error" :title="t('users.fields.projectsLoadError')">
          <UiButton variant="outline" size="sm" class="mt-2" @click="refreshSpaces()">
            {{ t('common.retry') }}
          </UiButton>
        </UiAlert>
        <UiCheckboxGroup
          v-else-if="projectOptions.length"
          :id="FIELD_IDS.projectIds"
          v-model="form.projectIds"
          :legend="isAdmin ? t('users.fields.projects') : t('users.fields.projectsRequired')"
          :hint="isAdmin ? t('users.fields.projectsHint') : t('users.fields.projectsHintManager')"
          :options="projectOptions"
          :error="message('projectIds')"
          :columns="2"
        />
        <UiAlert v-else :variant="isAdmin ? 'info' : 'warning'">
          {{ isAdmin ? t('users.fields.noProjects') : t('users.fields.noProjectsManager') }}
        </UiAlert>

        <template v-if="form.projectIds.length">
          <UiRadioCards
            v-if="projectRoleOptions.length > 1"
            :id="FIELD_IDS.projectRole"
            v-model="form.projectRole"
            :legend="t('users.fields.projectRole')"
            :hint="t('users.fields.projectRoleHint')"
            :options="projectRoleOptions"
            :error="message('projectRole')"
            :columns="2"
          />
          <p v-else-if="projectRoles[0]" :id="FIELD_IDS.projectRole" tabindex="-1" class="text-sm text-muted-foreground">
            {{ t('users.fields.projectRoleFixed', { role: t(`projectRoles.${projectRoles[0]}.label`) }) }}
          </p>
        </template>
      </template>

      <UiAlert variant="info">
        {{ t('users.create.invitationNote') }}
      </UiAlert>

      <div class="flex flex-wrap justify-end gap-3">
        <UiButton to="/admin/users" variant="outline">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" :loading="submitting">
          {{ isAdmin ? t('users.create.submit') : t('users.create.inviteSubmit') }}
        </UiButton>
      </div>
      <p class="sr-only" role="status">
        {{ submitting ? t('common.saving') : '' }}
      </p>
    </form>
  </div>
</template>
