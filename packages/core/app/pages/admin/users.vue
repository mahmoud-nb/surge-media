<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: 'users:manage' })

const { t } = useI18n()
useSeoMeta({ title: () => t('admin.users.title') })
</script>

<template>
  <AdminUpcomingSection :title="t('admin.users.title')" :description="t('admin.users.description')" />
</template>
