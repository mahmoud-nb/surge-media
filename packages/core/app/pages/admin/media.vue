<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: 'media:manage' })

const { t } = useI18n()
useSeoMeta({ title: () => t('admin.media.title') })
</script>

<template>
  <AdminUpcomingSection :title="t('admin.media.title')" :description="t('admin.media.description')" />
</template>
