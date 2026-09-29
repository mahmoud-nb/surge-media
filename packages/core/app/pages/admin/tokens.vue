<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: 'tokens:personal' })

const { t } = useI18n()
useSeoMeta({ title: () => t('admin.tokens.title') })
</script>

<template>
  <AdminUpcomingSection :title="t('admin.tokens.title')" :description="t('admin.tokens.description')" />
</template>
