<script setup lang="ts">
/**
 * Statut d'un identifiant d'API (actif, expiré, révoqué) ; le texte porte le sens.
 * `kind` accorde le libellé (en français : « clé » est féminin, « jeton » masculin).
 */
const props = defineProps<{
  status: TokenStatus
  kind: 'key' | 'token'
}>()

const { t } = useI18n()
const VARIANTS = { active: 'success', expired: 'warning', revoked: 'danger' } as const
</script>

<template>
  <UiBadge :variant="VARIANTS[props.status]">
    {{ t(`credentials.status.${props.kind}.${props.status}`) }}
  </UiBadge>
</template>
