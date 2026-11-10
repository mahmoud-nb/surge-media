<script setup lang="ts">
import { KeyRound } from '@lucide/vue'
import { createProjectKeySchema, type CreateProjectKeyData } from '#shared/schemas/credentials'

definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const route = useRoute()
const { $api } = useNuxtApp()
const flash = useFlash()
const reauth = useReauth()
const { environmentLabel, scopeOptions, credentialErrorMessage } = useCredentialLabels()

const projectId = computed(() => String(route.params.id))
const { data, error, refresh } = await useApiFetch(() => `/api/admin/projects/${projectId.value}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Project not found', fatal: true })
}
const project = computed(() => data.value?.project)
if (data.value && !data.value.scopes.includes('project:credentials')) {
  throw createError({ statusCode: 403, statusMessage: 'Forbidden', fatal: true })
}

useSeoMeta({ title: () => (project.value ? t('apiKeys.new.meta.title', { name: project.value.name }) : t('projects.list.title')) })

const listPath = computed(() => `/admin/projects/${projectId.value}/keys`)
const formId = useId()
const FIELD_IDS = {
  type: `${formId}-type`,
  name: `${formId}-name`,
  environment: `${formId}-environment`,
  scopes: `${formId}-scopes`,
  lifetime: `${formId}-lifetime`,
} as const
const customEnvironmentId = `${formId}-environment-custom`

const OTHER = 'other'
const form = reactive({
  type: 'PUBLISHABLE' as ProjectKeyType | '',
  name: '',
  environmentChoice: 'production' as string,
  customEnvironment: '',
  scopes: [] as TokenOptionalScope[],
  lifetime: DEFAULT_SECRET_KEY_LIFETIME as SecretKeyLifetime | '',
})
const isSecret = computed(() => form.type === 'SECRET')

// Le focus d'une erreur d'environnement va au champ affiché (liste ou saisie libre).
const fieldIds = reactive<Record<keyof typeof FIELD_IDS, string>>({ ...FIELD_IDS })
const { validate, message, clear } = useFormValidation(createProjectKeySchema, fieldIds)
watch(() => form.environmentChoice, (choice) => {
  fieldIds.environment = choice === OTHER ? customEnvironmentId : FIELD_IDS.environment
  clear('environment')
})

const typeOptions = computed(() => PROJECT_KEY_TYPES.map(type => ({
  value: type,
  label: t(`apiKeys.types.${type}.label`),
  description: t(`apiKeys.types.${type}.description`),
})))
const environmentOptions = computed(() => [
  ...KEY_ENVIRONMENTS.map(value => ({ value, label: environmentLabel(value) })),
  { value: OTHER, label: t('apiKeys.new.environmentOther') },
])
const lifetimeOptions = computed(() => SECRET_KEY_LIFETIMES.map(value => ({
  value,
  label: t(`apiKeys.new.lifetimes.${value}`),
})))

const serverError = ref<string>()
const submitting = ref(false)

/** Appel isolé : son type de retour est calculé une fois (sinon inférence trop profonde dans run()). */
function createRequest(body: CreateProjectKeyData) {
  return $api(`/api/admin/projects/${projectId.value}/keys`, { method: 'POST', body })
}

async function onSubmit() {
  if (submitting.value) return
  serverError.value = undefined
  const input = validate({
    type: form.type,
    name: form.name,
    environment: form.environmentChoice === OTHER ? form.customEnvironment : form.environmentChoice,
    scopes: isSecret.value ? form.scopes : [],
    lifetime: isSecret.value ? form.lifetime : undefined,
  })
  if (!input) return

  submitting.value = true
  try {
    const result = await reauth.run(() => createRequest(input))
    flash.set({
      variant: 'success',
      message: t('apiKeys.new.created', { name: result.key.name }),
      payload: { value: result.value, type: result.key.type, name: result.key.name },
    })
    await navigateTo(listPath.value)
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
  <div class="mx-auto max-w-6xl">
    <UiAlert v-if="error" variant="error" live="assertive" :title="t('projects.overview.loadError')">
      <UiButton variant="outline" size="sm" class="mt-2" @click="refresh()">
        {{ t('common.retry') }}
      </UiButton>
    </UiAlert>

    <template v-else-if="project">
      <AdminProjectHeader :project="project" :scopes="data?.scopes ?? []" />

      <section :aria-labelledby="`${formId}-title`" class="max-w-3xl rounded-xl border border-border bg-surface p-6 shadow-xs">
        <h2 :id="`${formId}-title`" class="text-lg font-semibold text-foreground">
          {{ t('apiKeys.new.title') }}
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('apiKeys.new.description') }}
        </p>

        <form novalidate class="mt-6 grid gap-6" @submit.prevent="onSubmit">
          <UiAlert v-if="serverError" variant="error" live="assertive">
            {{ serverError }}
          </UiAlert>

          <UiRadioCards
            :id="FIELD_IDS.type"
            v-model="form.type"
            :legend="t('apiKeys.new.type')"
            :options="typeOptions"
            :error="message('type')"
            :columns="2"
            required
          />

          <UiFormField :id="FIELD_IDS.name" v-slot="field" :label="t('apiKeys.new.name')" :hint="t('apiKeys.new.nameHint')" :error="message('name')" required>
            <UiInput v-bind="field" v-model="form.name" name="name" autocomplete="off" :maxlength="TOKEN_NAME_MAX_LENGTH" @input="clear('name')" />
          </UiFormField>

          <div class="grid gap-4 sm:grid-cols-2">
            <UiFormField
              :id="FIELD_IDS.environment"
              v-slot="field"
              :label="t('apiKeys.new.environment')"
              :hint="t('apiKeys.new.environmentHint')"
              :error="form.environmentChoice === OTHER ? undefined : message('environment')"
              required
            >
              <UiSelect v-bind="field" v-model="form.environmentChoice" :options="environmentOptions" name="environment" />
            </UiFormField>
            <UiFormField
              v-if="form.environmentChoice === OTHER"
              :id="customEnvironmentId"
              v-slot="field"
              :label="t('apiKeys.new.environmentCustom')"
              :hint="t('apiKeys.new.environmentCustomHint')"
              :error="message('environment')"
              required
            >
              <UiInput v-bind="field" v-model="form.customEnvironment" name="customEnvironment" autocomplete="off" :maxlength="ENVIRONMENT_MAX_LENGTH" @input="clear('environment')" />
            </UiFormField>
          </div>

          <template v-if="isSecret">
            <UiCheckboxGroup
              :id="FIELD_IDS.scopes"
              v-model="form.scopes"
              :legend="t('credentials.scopes.legend')"
              :hint="t('credentials.scopes.hint')"
              :options="scopeOptions(data?.scopes ?? [])"
              :error="message('scopes')"
            />
            <UiRadioCards
              :id="FIELD_IDS.lifetime"
              v-model="form.lifetime"
              :legend="t('apiKeys.new.lifetime')"
              :hint="t('apiKeys.new.lifetimeHint')"
              :options="lifetimeOptions"
              :error="message('lifetime')"
              :columns="2"
              required
            />
            <UiAlert variant="info">
              {{ t('apiKeys.new.secretNotice') }}
            </UiAlert>
          </template>

          <div class="flex flex-wrap gap-3">
            <UiButton type="submit" :loading="submitting">
              <KeyRound aria-hidden="true" />
              {{ t('apiKeys.new.submit') }}
            </UiButton>
            <UiButton variant="outline" :to="listPath">
              {{ t('common.cancel') }}
            </UiButton>
          </div>
          <p class="sr-only" role="status">
            {{ submitting ? t('apiKeys.new.submitting') : '' }}
          </p>
        </form>
      </section>
    </template>
  </div>
</template>
