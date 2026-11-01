<script setup lang="ts">
/**
 * Bandeau du mode démo, en tête des deux mises en page : heure de la prochaine remise à zéro (heure locale,
 * temps restant rafraîchi toutes les 30 s après le chargement), consigne, liens configurés (contact,
 * signalement, conditions) ; `noindex` sur toutes les pages. Région nommée, sans annonce live : le décompte
 * n'est pas lu à chaque minute. Hors démo : rien.
 */
import { TriangleAlert } from '@lucide/vue'

const { t, locale } = useI18n()
const demo = useDemoInfo()

useHead({ meta: computed(() => (demo.value ? [{ name: 'robots', content: 'noindex, nofollow' }] : [])) })

// Temps restant calculé côté navigateur seulement (pas d'écart d'hydratation avec le rendu serveur).
const now = ref<number | null>(null)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  now.value = Date.now()
  timer = setInterval(() => (now.value = Date.now()), 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

const remaining = computed(() => {
  if (!demo.value || now.value === null) return null
  const minutes = Math.ceil((Date.parse(demo.value.nextResetAt) - now.value) / 60_000)
  if (minutes < 1) return t('demo.banner.in.soon')
  if (minutes < 60) return t('demo.banner.in.minutes', { minutes })
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? t('demo.banner.in.hoursMinutes', { hours, minutes: minutes % 60 }) : t('demo.banner.in.hours', { hours })
})

const links = computed(() => {
  if (!demo.value) return []
  return [
    { href: demo.value.contactUrl, label: t('demo.banner.contact') },
    { href: demo.value.abuseUrl, label: t('demo.banner.abuse') },
    { href: demo.value.termsUrl, label: t('demo.banner.terms') },
  ].filter(link => link.href)
})
</script>

<template>
  <section
    v-if="demo"
    :aria-label="t('demo.banner.label')"
    class="border-b border-warning/40 bg-warning-soft text-sm text-foreground lg:col-span-2"
  >
    <div class="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:px-6">
      <p class="flex items-start gap-2">
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>
          <strong class="font-semibold">{{ t('demo.banner.title') }}</strong>
          {{ ' ' }}
          <i18n-t keypath="demo.banner.reset" scope="global" tag="span">
            <template #time>
              <NuxtTime :datetime="demo.nextResetAt" hour="2-digit" minute="2-digit" :locale="locale" />
              <!-- v-text : aucun blanc ajouté avant la ponctuation qui suit (« 23:00 (in 37 min): ») -->
              <span v-if="remaining" v-text="` (${remaining})`" />
            </template>
          </i18n-t>
          {{ ' ' }}{{ t('demo.banner.notice') }}
        </span>
      </p>
      <ul v-if="links.length" class="flex flex-wrap gap-x-4 gap-y-1">
        <li v-for="link in links" :key="link.href">
          <a :href="link.href" class="rounded font-medium underline underline-offset-2 hover:no-underline">{{ link.label }}</a>
        </li>
      </ul>
    </div>
  </section>
</template>
