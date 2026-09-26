import type { Permission } from '../../shared/utils/permissions'

declare module '#app' {
  interface PageMeta {
    /** Permission requise pour afficher la page (vérifiée par middleware/auth.global.ts). */
    permission?: Permission
  }
}

export {}
