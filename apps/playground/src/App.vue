<script setup lang="ts">
import { useSurgeMedia } from '@surge-media/vue'
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { usePlaygroundText } from './messages'
import FallbacksPage from './pages/FallbacksPage.vue'
import ImagesPage from './pages/ImagesPage.vue'
import PrivatePage from './pages/PrivatePage.vue'
import PublicPage from './pages/PublicPage.vue'
import VideosPage from './pages/VideosPage.vue'
import { configured, locale, theme } from './state'

const t = usePlaygroundText(locale)
const { project } = useSurgeMedia()
const PAGES = { images: ImagesPage, videos: VideosPage, private: PrivatePage, public: PublicPage, fallbacks: FallbacksPage } as const
type Page = keyof typeof PAGES

const current = ref<Page>('images')
function readHash() {
  const hash = location.hash.slice(1)
  current.value = hash in PAGES ? hash as Page : 'images'
}
onMounted(() => {
  readHash()
  window.addEventListener('hashchange', readHash)
})
onBeforeUnmount(() => window.removeEventListener('hashchange', readHash))

const projectLine = computed(() => project.value
  ? t('project', { policy: project.value.transformPolicy, formats: project.value.transformFormats.join(', '), max: project.value.transformMaxDimension })
  : t('projectPending'))
const languageId = useId()
const themeId = useId()
</script>

<template>
  <header class="playground-header">
    <h1>{{ t('title') }}</h1>
    <p>{{ t('intro') }}</p>
    <div class="playground-controls">
      <label :for="languageId">{{ t('language') }}</label>
      <select :id="languageId" v-model="locale">
        <option value="fr">
          Français
        </option>
        <option value="en">
          English
        </option>
      </select>
      <label :for="themeId">{{ t('theme') }}</label>
      <select :id="themeId" v-model="theme">
        <option value="system">
          {{ t('themes.system') }}
        </option>
        <option value="light">
          {{ t('themes.light') }}
        </option>
        <option value="dark">
          {{ t('themes.dark') }}
        </option>
      </select>
    </div>
    <nav :aria-label="t('nav')">
      <ul>
        <li v-for="(_, page) in PAGES" :key="page">
          <a :href="`#${page}`" :aria-current="current === page ? 'page' : undefined">{{ t(`pages.${page}`) }}</a>
        </li>
      </ul>
    </nav>
  </header>
  <main class="playground-main">
    <p v-if="!configured" role="alert">
      {{ t('missingConfig') }}
    </p>
    <template v-else>
      <p class="playground-project">
        {{ projectLine }}
      </p>
      <h2>{{ t(`pages.${current}`) }}</h2>
      <component :is="PAGES[current]" :key="current" />
    </template>
  </main>
</template>

<style>
body {
  margin: 0;
  background: var(--sm-color-bg);
  color: var(--sm-color-fg);
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}

.playground-header,
.playground-main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1rem;
}

.playground-header h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
}

.playground-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  margin: 0.75rem 0;
}

.playground-controls select {
  min-height: 2rem;
  padding: 0 0.5rem;
  border: 1px solid var(--sm-color-muted-fg);
  border-radius: 0.375rem;
  background: var(--sm-color-bg);
  color: var(--sm-color-fg);
}

nav ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

nav a {
  color: var(--sm-color-primary);
}

nav a[aria-current='page'] {
  color: var(--sm-color-fg);
  font-weight: 600;
}

a:focus-visible,
select:focus-visible {
  outline: 2px solid var(--sm-focus-ring);
  outline-offset: 2px;
}

.playground-project {
  color: var(--sm-color-muted-fg);
}

.playground-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 1.5rem;
}

figure {
  margin: 0;
}

figcaption {
  margin-top: 0.5rem;
  color: var(--sm-color-muted-fg);
  font-size: 0.875rem;
}

.playground-square {
  width: 240px;
  height: 240px;
  overflow: hidden;
  border-radius: 0.5rem;
}

.playground-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
</style>
