import { type DemoInfo, type DemoLegal, mailtoAddress } from '#shared/utils/demo'

type EnabledDemo = Extract<DemoInfo, { enabled: true }>

/** Requête partagée de `GET /api/demo` : une seule par page, relue quand le compte connecté change. */
function demoInfoFetch() {
  const { user } = useAuth()
  return useFetch<DemoInfo>('/api/demo', { key: computed(() => `demo-info:${user.value?.id ?? ''}`) })
}

/**
 * Mode démo (`GET /api/demo`, public) : null hors démo. Une seule requête partagée par le bandeau, la page de
 * connexion et les réglages ; relue quand le compte connecté change (`protectedAccount`).
 */
export function useDemoInfo() {
  const { data } = demoInfoFetch()
  return computed<EnabledDemo | null>(() => {
    const info = data.value as DemoInfo | null | undefined
    return info?.enabled ? info : null
  })
}

/**
 * Pages légales de la démo (/legal, /privacy, /terms) : attend `GET /api/demo` ; 404 hors démo ou tant que
 * l'éditeur n'est pas renseigné (NUXT_DEMO_LEGAL_PUBLISHER_NAME).
 */
export async function useDemoLegal() {
  // Avant l'attente : useI18n et useAuth exigent le composant courant.
  const { t } = useI18n()
  const { data } = await demoInfoFetch()
  const first = data.value as DemoInfo | null | undefined
  if (!first?.enabled || !first.legal) throw createError({ statusCode: 404, statusMessage: 'Not Found', fatal: true })
  const initial = { ...first, legal: first.legal }
  const demo = computed<EnabledDemo & { legal: DemoLegal }>(() => {
    const info = data.value as DemoInfo | null | undefined
    return info?.enabled && info.legal ? { ...info, legal: info.legal } : initial
  })
  /** Intervalle des remises à zéro, en toutes lettres (« 2 heures », « 90 minutes »). */
  const interval = computed(() => {
    const minutes = demo.value.resetInterval
    const hours = minutes / 60
    return Number.isInteger(hours) ? t('legal.interval.hours', { count: hours }, hours) : t('legal.interval.minutes', { count: minutes }, minutes)
  })
  /** Adresse de signalement : celle du lien NUXT_DEMO_ABUSE_URL, sinon l'e-mail de l'éditeur. */
  const reportEmail = computed(() => mailtoAddress(demo.value.abuseUrl) ?? demo.value.legal.email)
  return { demo, interval, reportEmail }
}
