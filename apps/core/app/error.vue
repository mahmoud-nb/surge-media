<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

useAppHead()
const { t } = useI18n()
const { loggedIn } = useAuth()

const statusCode = computed(() => props.error.statusCode || 500)
const kind = computed(() => {
  switch (statusCode.value) {
    case 401: return 'unauthorized'
    case 403: return 'forbidden'
    case 404: return 'notFound'
    default: return 'unexpected'
  }
})

useSeoMeta({ title: () => t(`errors.${kind.value}.title`), robots: 'noindex' })

function leave() {
  clearError({ redirect: loggedIn.value ? '/admin' : '/' })
}
</script>

<template>
  <NuxtLayout name="default">
    <div class="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p class="text-sm font-semibold text-primary">
        {{ t('errors.code', { code: statusCode }) }}
      </p>
      <h1 class="mt-3 text-3xl font-semibold tracking-tight text-foreground">
        {{ t(`errors.${kind}.title`) }}
      </h1>
      <p class="mt-4 text-muted-foreground">
        {{ t(`errors.${kind}.description`) }}
      </p>
      <UiButton class="mt-8" @click="leave">
        {{ loggedIn ? t('errors.backToAdmin') : t('errors.backHome') }}
      </UiButton>
    </div>
  </NuxtLayout>
</template>
