<script setup lang="ts">
/** Choix du rôle d'un utilisateur, chaque rôle décrit par les permissions qu'il accorde. */
const props = withDefaults(defineProps<{
  legend: string
  /** Rôles proposés (ex. invitableRoles pour un gestionnaire) ; tous par défaut. */
  roles?: readonly Role[]
  id?: string
  hint?: string
  error?: string
  disabled?: boolean
  required?: boolean
}>(), {
  roles: () => ROLES,
})

const model = defineModel<Role | ''>({ default: '' })
const { t } = useI18n()

const options = computed(() => props.roles.map(role => ({
  value: role,
  label: t(`roles.${role}.label`),
  description: t(`roles.${role}.description`),
})))
</script>

<template>
  <UiRadioCards
    :id="id"
    v-model="model"
    :legend="legend"
    :options="options"
    :hint="hint"
    :error="error"
    :disabled="disabled"
    :required="required"
    :columns="2"
  />
</template>
