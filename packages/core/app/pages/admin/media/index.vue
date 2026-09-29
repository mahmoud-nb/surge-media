<script setup lang="ts">
definePageMeta({ layout: 'admin', permission: 'library:manage' })

const { t } = useI18n()
const route = useRoute()

useSeoMeta({ title: () => (route.query.status === 'trash' ? t('media.list.trashTitle') : t('media.list.meta.title')) })

const flash = useFlash().consume()
const inTrash = computed(() => route.query.status === 'trash')
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <AdminPageHeader
      :title="inTrash ? t('media.list.trashTitle') : t('media.list.title')"
      :description="inTrash ? t('media.list.trashDescription') : t('media.list.description')"
    />

    <UiAlert v-if="flash" :variant="flash.variant" live="polite" class="mb-6">
      {{ flash.message }}
    </UiAlert>

    <AdminMediaBrowser />
  </div>
</template>
