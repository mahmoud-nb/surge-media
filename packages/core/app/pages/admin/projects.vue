<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: 'api:manage' })

const { t } = useI18n()
useSeoMeta({ title: () => t('admin.projects.title') })
</script>

<template>
  <AdminUpcomingSection :title="t('admin.projects.title')" :description="t('admin.projects.description')" />
</template>
