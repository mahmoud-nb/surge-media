import type { DemoInfo } from '#shared/utils/demo'

type EnabledDemo = Extract<DemoInfo, { enabled: true }>

/**
 * Mode démo (`GET /api/demo`, public) : null hors démo. Une seule requête partagée par le bandeau, la page de
 * connexion et les réglages ; relue quand le compte connecté change (`protectedAccount`).
 */
export function useDemoInfo() {
  const { user } = useAuth()
  const { data } = useFetch<DemoInfo>('/api/demo', { key: computed(() => `demo-info:${user.value?.id ?? ''}`) })
  return computed<EnabledDemo | null>(() => {
    const info = data.value as DemoInfo | null | undefined
    return info?.enabled ? info : null
  })
}
