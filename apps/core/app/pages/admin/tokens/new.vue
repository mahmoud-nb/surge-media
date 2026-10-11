<script setup lang="ts">
import { ArrowLeft, KeySquare } from '@lucide/vue'
import { createPersonalTokenSchema, type CreatePersonalTokenData } from '#shared/schemas/credentials'

definePageMeta({ layout: 'admin', permission: 'tokens:personal' })

const { t } = useI18n()
const { can } = useAuth()
const { $api } = useNuxtApp()
const flash = useFlash()
const reauth = useReauth()
const { scopeOptions, credentialErrorMessage } = useCredentialLabels()

useSeoMeta({ title: () => t('tokens.new.meta.title') })

// Espaces sélectionnables : ceux où l'utilisateur peut lire les médias (projets actifs, bibliothèque).
const { data: spacesData, error: spacesError, refresh: refreshSpaces } = await useApiFetch('/api/admin/spaces', { query: { scope: 'media:read' } })
const projects = computed(() => (spacesData.value?.spaces ?? []).flatMap(space => (space.type === 'project' ? [space] : [])))
const libraryAvailable = computed(() => (spacesData.value?.spaces ?? []).some(space => space.type === 'library'))

const formId = useId()
const librarySwitchId = `${formId}-library`
const accessErrorId = `${formId}-access-error`
const FIELD_IDS = {
  name: `${formId}-name`,
  lifetime: `${formId}-lifetime`,
  projectIds: `${formId}-projects`,
  scopes: `${formId}-scopes`,
} as const

const ACCESS_MODES = ['all', 'selected'] as const
const form = reactive({
  name: '',
  lifetime: DEFAULT_PERSONAL_TOKEN_LIFETIME as PersonalTokenLifetime | '',
  access: 'selected' as (typeof ACCESS_MODES)[number] | '',
  projectIds: [] as string[],
  includeLibrary: false,
  scopes: [] as TokenOptionalScope[],
})

// Erreur « aucun espace choisi » : focus sur la première case de projet, sinon sur l'interrupteur.
const fieldIds = reactive<Record<keyof typeof FIELD_IDS, string>>({ ...FIELD_IDS })
watchEffect(() => {
  fieldIds.projectIds = form.access === 'selected' && projects.value.length ? FIELD_IDS.projectIds : librarySwitchId
})
const { validate, message, clear } = useFormValidation(createPersonalTokenSchema, fieldIds)
watch(() => [form.access, form.projectIds.length, form.includeLibrary], () => clear('projectIds'))

const lifetimeOptions = computed(() => PERSONAL_TOKEN_LIFETIMES.map(value => ({
  value,
  label: t(`tokens.new.lifetimes.${value}.label`),
  description: t(`tokens.new.lifetimes.${value}.description`),
})))
const accessOptions = computed(() => ACCESS_MODES.map(value => ({
  value,
  label: t(`tokens.new.access.${value}.label`),
  description: t(`tokens.new.access.${value}.description`),
})))
// Sans liste de projets affichée, l'erreur « aucun espace » est rattachée au groupe entier.
const accessErrorShown = computed(() => Boolean(message('projectIds')) && !(form.access === 'selected' && projects.value.length > 0))
const projectOptions = computed(() => projects.value.map(project => ({ value: project.id, label: project.name })))

const serverError = ref<string>()
const submitting = ref(false)

/** Appel isolé : son type de retour est calculé une fois (sinon inférence trop profonde dans run()). */
function createRequest(body: CreatePersonalTokenData) {
  return $api('/api/admin/tokens', { method: 'POST', body })
}

async function onSubmit() {
  if (submitting.value) return
  serverError.value = undefined
  const input = validate({
    name: form.name,
    lifetime: form.lifetime,
    scopes: form.scopes,
    allProjects: form.access === 'all',
    projectIds: form.access === 'selected' ? form.projectIds : [],
    includeLibrary: libraryAvailable.value && form.includeLibrary,
  })
  if (!input) return

  submitting.value = true
  try {
    const result = await reauth.run(() => createRequest(input))
    flash.set({ variant: 'success', message: t('tokens.new.created', { name: result.token.name }), payload: { value: result.value, name: result.token.name } })
    await navigateTo('/admin/tokens')
  }
  catch (error) {
    if (!isReauthCancelled(error)) serverError.value = credentialErrorMessage(error)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <NuxtLink to="/admin/tokens" class="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" />
      {{ t('tokens.new.back') }}
    </NuxtLink>
    <AdminPageHeader :title="t('tokens.new.title')" :description="t('tokens.new.description')" />

    <UiAlert v-if="spacesError" variant="error" live="assertive" :title="t('tokens.new.spacesError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refreshSpaces()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <form v-else novalidate class="grid gap-8 rounded-xl border border-border bg-surface p-6 shadow-xs" @submit.prevent="onSubmit">
      <UiAlert v-if="serverError" variant="error" live="assertive">
        {{ serverError }}
      </UiAlert>

      <UiFormField :id="FIELD_IDS.name" v-slot="field" :label="t('tokens.new.name')" :hint="t('tokens.new.nameHint')" :error="message('name')" required>
        <UiInput v-bind="field" v-model="form.name" name="name" autocomplete="off" :maxlength="TOKEN_NAME_MAX_LENGTH" @input="clear('name')" />
      </UiFormField>

      <UiRadioCards
        :id="FIELD_IDS.lifetime"
        v-model="form.lifetime"
        :legend="t('tokens.new.lifetime')"
        :hint="t('tokens.new.lifetimeHint')"
        :options="lifetimeOptions"
        :error="message('lifetime')"
        required
      />

      <fieldset class="grid gap-4" :aria-describedby="accessErrorShown ? accessErrorId : undefined">
        <legend class="mb-1 text-base font-semibold text-foreground">
          {{ t('tokens.new.access.legend') }}
        </legend>
        <UiRadioCards v-model="form.access" :legend="t('tokens.new.access.projects')" :options="accessOptions" :columns="2" />

        <template v-if="form.access === 'selected'">
          <UiCheckboxGroup
            v-if="projects.length"
            :id="FIELD_IDS.projectIds"
            v-model="form.projectIds"
            :legend="t('tokens.new.access.choose')"
            :options="projectOptions"
            :error="message('projectIds')"
            :columns="2"
          />
          <p v-else class="rounded-lg border border-dashed border-input px-4 py-3 text-sm text-muted-foreground">
            {{ t('tokens.new.access.noProjects') }}
          </p>
        </template>

        <UiSwitch
          v-if="libraryAvailable"
          :id="librarySwitchId"
          v-model="form.includeLibrary"
          :label="t('tokens.new.access.library')"
          :description="can('library:manage') ? t('tokens.new.access.libraryHint') : t('tokens.new.access.libraryReadHint')"
        />
        <p v-if="accessErrorShown" :id="accessErrorId" class="text-sm font-medium text-destructive">
          {{ message('projectIds') }}
        </p>
      </fieldset>

      <UiCheckboxGroup
        :id="FIELD_IDS.scopes"
        v-model="form.scopes"
        :legend="t('credentials.scopes.legend')"
        :hint="t('credentials.scopes.hint')"
        :options="scopeOptions()"
        :error="message('scopes')"
      />

      <UiAlert variant="info">
        {{ t('tokens.new.notice') }}
      </UiAlert>

      <div class="flex flex-wrap gap-3">
        <UiButton type="submit" :loading="submitting">
          <KeySquare aria-hidden="true" />
          {{ t('tokens.new.submit') }}
        </UiButton>
        <UiButton variant="outline" to="/admin/tokens">
          {{ t('common.cancel') }}
        </UiButton>
      </div>
      <p class="sr-only" role="status">
        {{ submitting ? t('tokens.new.submitting') : '' }}
      </p>
    </form>
  </div>
</template>
