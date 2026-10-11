<script setup lang="ts">
/** Statut d'un compte (actif, invitation en attente, désactivé) sous forme d'étiquette. */
const props = defineProps<{ status: UserStatus }>()

const { t } = useI18n()

const VARIANTS = { active: 'success', invited: 'warning', inactive: 'neutral' } as const
</script>

<template>
  <UiBadge :variant="VARIANTS[props.status]">
    {{ t(`users.status.${props.status}`) }}
  </UiBadge>
</template>
