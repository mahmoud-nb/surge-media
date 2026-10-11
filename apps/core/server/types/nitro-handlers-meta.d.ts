/**
 * Module virtuel de Nitro (`nitro.experimental.openAPI`) : chaque route et les métadonnées de son
 * `defineRouteMeta(…)`, lues à la compilation. Nitro ne publie pas sa déclaration de type ; celle-ci
 * reprend la forme générée (nitropack/dist/rollup › « server-handlers-meta »).
 */
declare module '#nitro-internal-virtual/server-handlers-meta' {
  import type { NitroRouteMeta } from 'nitropack/types'

  export const handlersMeta: {
    route?: string
    method?: string
    meta: NitroRouteMeta | null
  }[]
}
