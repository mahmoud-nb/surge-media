import type { Role } from '../utils/permissions'

// Typage des sessions nuxt-auth-utils (cookie scellé, chiffré avec NUXT_SESSION_PASSWORD).
declare module '#auth-utils' {
  /** Données visibles côté client (useUserSession().user). */
  interface User {
    id: string
    email: string
    name: string | null
    role: Role
    locale: string
  }

  interface UserSession {
    /** Horodatage (ms) de la connexion. */
    loggedInAt: number
  }

  /** Données réservées au serveur, jamais envoyées au navigateur. */
  interface SecureSessionData {
    /** Jeton de session ; seule son empreinte SHA-256 est stockée en base (table Session). */
    token: string
  }
}

export {}
