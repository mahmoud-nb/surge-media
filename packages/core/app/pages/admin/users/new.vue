<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import { createUserSchema, NAME_MAX_LENGTH } from '#shared/schemas/users'

definePageMeta({ layout: 'admin', permission: 'users:manage' })

const { t } = useI18n()
const { $api } = useNuxtApp()
const flash = useFlash()

useSeoMeta({ title: () => t('users.create.meta.title') })

const FIELD_IDS = { email: 'user-email', name: 'user-name', role: 'user-role' } as const

// EDITOR présélectionné : le rôle le moins privilégié.
const form = reactive<{ email: string, name: string, role: Role | '' }>({ email: '', name: '', role: 'EDITOR' })
const { validate, message, clear, setError } = useFormValidation(createUserSchema, FIELD_IDS)
const serverError = ref<string>()
const submitting = ref(false)

async function onSubmit() {
  serverError.value = undefined
  const input = validate(form)
  if (!input) return

  submitting.value = true
  try {
    const { user, invitation } = await $api('/api/admin/users', { method: 'POST', body: input })
    flash.set({
      variant: 'success',
      message: t('users.create.success', { email: user.email }),
      payload: { invitation: { ...invitation, email: user.email } },
    })
    await navigateTo(`/admin/users/${user.id}`)
  }
  catch (error) {
    const { code } = apiError(error)
    if (code === 'EMAIL_TAKEN') setError('email', 'validation.emailTaken')
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
      {{ t('users.backToList') }}
    </NuxtLink>
    <AdminPageHeader :title="t('users.create.title')" :description="t('users.create.description')" />

    <UiAlert v-if="serverError" variant="error" live="assertive" class="mb-6">
      {{ serverError }}
    </UiAlert>

    <form class="grid gap-6 rounded-xl border border-border bg-surface p-6 shadow-xs" novalidate @submit.prevent="onSubmit">
      <p class="text-sm text-muted-foreground">
        {{ t('form.requiredNote') }}
      </p>

      <div class="grid gap-5 sm:grid-cols-2">
        <UiFormField v-slot="field" :id="FIELD_IDS.email" :label="t('users.fields.email')" :error="message('email')" required>
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
        <UiFormField v-slot="field" :id="FIELD_IDS.name" :label="t('users.fields.name')" :hint="t('users.fields.nameHint')" :error="message('name')">
          <UiInput v-bind="field" v-model="form.name" name="name" autocomplete="off" :maxlength="NAME_MAX_LENGTH" @input="clear('name')" />
        </UiFormField>
      </div>

      <AdminRoleField
        :id="FIELD_IDS.role"
        v-model="form.role"
        :legend="t('users.fields.role')"
        :error="message('role')"
        required
      />

      <UiAlert variant="info">
        {{ t('users.create.invitationNote') }}
      </UiAlert>

      <div class="flex flex-wrap justify-end gap-3">
        <UiButton to="/admin/users" variant="outline">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" :loading="submitting">
          {{ t('users.create.submit') }}
        </UiButton>
      </div>
      <p class="sr-only" role="status">
        {{ submitting ? t('common.saving') : '' }}
      </p>
    </form>
  </div>
</template>
