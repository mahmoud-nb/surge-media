<script setup lang="ts">
import { ArrowRight, Blocks, Crop, Server, ShieldCheck } from '@lucide/vue'

const { t } = useI18n()
const { loggedIn } = useAuth()

useSeoMeta({
  title: () => t('landing.meta.title'),
  description: () => t('landing.meta.description'),
})

const FEATURES = [
  { key: 'transform', icon: Crop },
  { key: 'api', icon: ShieldCheck },
  { key: 'selfHosted', icon: Server },
  { key: 'sdk', icon: Blocks },
] as const

const features = computed(() => FEATURES.map(feature => ({
  ...feature,
  title: t(`landing.features.${feature.key}.title`),
  description: t(`landing.features.${feature.key}.description`),
})))
</script>

<template>
  <div>
    <section aria-labelledby="hero-title" class="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-24">
      <div>
        <p class="inline-flex rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium text-muted-foreground">
          {{ t('landing.hero.eyebrow') }}
        </p>
        <h1 id="hero-title" class="mt-5 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
          {{ t('landing.hero.title') }}
        </h1>
        <p class="mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
          {{ t('landing.hero.description') }}
        </p>
        <div class="mt-8">
          <UiButton :to="loggedIn ? '/admin' : '/login'" size="lg">
            {{ loggedIn ? t('landing.hero.ctaAdmin') : t('landing.hero.ctaLogin') }}
            <ArrowRight aria-hidden="true" />
          </UiButton>
        </div>
      </div>

      <figure class="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <figcaption class="border-b border-border px-4 py-3 text-sm font-medium text-muted-foreground">
          {{ t('landing.example.caption') }}
        </figcaption>
        <pre class="overflow-x-auto p-4 text-sm leading-relaxed text-foreground" tabindex="0"><code><span class="font-semibold text-primary">GET</span> /m/cm9f2c4e7a/v1/<span class="font-semibold">w_800,h_600,q_80</span>/photo.webp

<span class="text-muted-foreground">{{ t('landing.example.response') }}</span></code></pre>
      </figure>
    </section>

    <section aria-labelledby="features-title" class="border-t border-border bg-surface">
      <div class="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="features-title" class="text-2xl font-semibold tracking-tight text-foreground">
          {{ t('landing.features.title') }}
        </h2>
        <ul class="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <li v-for="feature in features" :key="feature.key" class="grid content-start gap-3">
            <span class="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <component :is="feature.icon" class="size-5" aria-hidden="true" />
            </span>
            <h3 class="font-semibold text-foreground">
              {{ feature.title }}
            </h3>
            <p class="text-sm text-muted-foreground">
              {{ feature.description }}
            </p>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
