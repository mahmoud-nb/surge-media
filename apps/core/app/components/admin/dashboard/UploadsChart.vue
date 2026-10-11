<script setup lang="ts">
/**
 * Médias envoyés par jour sur 30 jours, dans le fuseau du navigateur (comptes horaires du serveur
 * regroupés par dailyUploads). Barres SVG décoratives résumées par la légende ; les valeurs exactes
 * sont dans un tableau repliable. Rendu côté navigateur seulement (<ClientOnly> du parent) : le
 * serveur ne connaît pas le fuseau du visiteur.
 */
const props = defineProps<{
  since: string | Date
  hours: [number, number][]
}>()

const { t, locale } = useI18n()
const titleId = useId()
const captionId = useId()

const days = computed(() => dailyUploads(new Date(props.since), props.hours, Intl.DateTimeFormat().resolvedOptions().timeZone))
const total = computed(() => days.value.reduce((sum, day) => sum + day.count, 0))
const peak = computed(() => days.value.reduce((best, day) => (day.count > best.count ? day : best), days.value[0]!))
const max = computed(() => Math.max(1, peak.value.count))

// Les jours sont des dates calendaires (AAAA-MM-JJ) : affichées sans conversion de fuseau.
const dayFormat = computed(() => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', timeZone: 'UTC' }))
const longFormat = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }))
const asDate = (day: string) => new Date(`${day}T12:00:00Z`)

const WIDTH = 20
const GAP = 4
const HEIGHT = 120
const bars = computed(() => days.value.map((day, index) => {
  const height = day.count ? Math.max(3, (day.count / max.value) * HEIGHT) : 0
  return { ...day, x: index * WIDTH + GAP / 2, y: HEIGHT - height, height }
}))
const axis = computed(() => [days.value[0]!, days.value[Math.floor(days.value.length / 2)]!, days.value.at(-1)!]
  .map(day => dayFormat.value.format(asDate(day.date))))
</script>

<template>
  <section :aria-labelledby="titleId" class="rounded-xl border border-border bg-surface p-6 shadow-xs">
    <h2 :id="titleId" class="text-lg font-semibold text-foreground">
      {{ t('admin.dashboard.uploads.title') }}
    </h2>
    <figure class="mt-4" :aria-labelledby="captionId">
      <figcaption :id="captionId" class="text-sm text-muted-foreground">
        <template v-if="total">
          {{ t('admin.dashboard.uploads.summary', { count: total, peak: t('admin.dashboard.uploads.peak', { count: peak.count }, peak.count), date: longFormat.format(asDate(peak.date)) }, total) }}
        </template>
        <template v-else>
          {{ t('admin.dashboard.uploads.empty') }}
        </template>
      </figcaption>
      <div class="mt-4" aria-hidden="true">
        <div class="flex items-end gap-2">
          <span class="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{{ max }}</span>
          <svg :viewBox="`0 0 ${days.length * WIDTH} ${HEIGHT}`" preserveAspectRatio="none" class="h-32 w-full overflow-visible" focusable="false">
            <line x1="0" :x2="days.length * WIDTH" :y1="HEIGHT" :y2="HEIGHT" class="stroke-border" stroke-width="1" vector-effect="non-scaling-stroke" />
            <line x1="0" :x2="days.length * WIDTH" y1="0" y2="0" class="stroke-border" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" />
            <rect
              v-for="bar in bars"
              :key="bar.date"
              :x="bar.x"
              :y="bar.y"
              :width="WIDTH - GAP"
              :height="bar.height"
              rx="2"
              class="fill-primary"
            >
              <title>{{ t('admin.dashboard.uploads.bar', { date: dayFormat.format(asDate(bar.date)), count: bar.count }, bar.count) }}</title>
            </rect>
          </svg>
        </div>
        <div class="mt-1 flex justify-between pl-10 text-xs text-muted-foreground">
          <span v-for="label in axis" :key="label">{{ label }}</span>
        </div>
      </div>
    </figure>
    <details class="mt-4 text-sm">
      <summary class="cursor-pointer font-medium text-primary">
        {{ t('admin.dashboard.uploads.table') }}
      </summary>
      <div class="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border" tabindex="0" role="region" :aria-label="t('admin.dashboard.uploads.table')">
        <table class="w-full text-left">
          <caption class="sr-only">
            {{ t('admin.dashboard.uploads.caption') }}
          </caption>
          <thead class="sticky top-0 bg-surface text-muted-foreground">
            <tr>
              <th scope="col" class="px-3 py-2 font-medium">
                {{ t('admin.dashboard.uploads.day') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ t('admin.dashboard.uploads.count') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="day in [...days].reverse()" :key="day.date">
              <th scope="row" class="px-3 py-1.5 font-normal text-foreground">
                {{ longFormat.format(asDate(day.date)) }}
              </th>
              <td class="px-3 py-1.5 text-right text-foreground tabular-nums">
                {{ day.count }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>
