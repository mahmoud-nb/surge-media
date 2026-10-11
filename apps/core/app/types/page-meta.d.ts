import type { Permission } from '../../shared/utils/permissions'

declare module '#app' {
  interface PageMeta {
    /** Permission requise pour afficher la page (vérifiée par middleware/auth.global.ts). */
    permission?: Permission
    /**
     * La page intègre un composant qui rend son propre `<main>` (documentation de l'API, Scalar) :
     * la mise en page n'en ajoute pas un second autour (repères `main` imbriqués).
     */
    providesMain?: boolean
  }
}

export {}
