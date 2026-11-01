/**
 * Mode démo (instance publique remise à zéro à heures fixes) : règles partagées par le serveur, la CLI et
 * l'interface (architecture : .claude/architecture-demo.md). Fonctions pures, testées.
 *
 * Tout ce qui existait à la capture de l'instantané (`demoReferenceAt`) est en lecture seule ; tout ce qu'un
 * visiteur crée lui appartient jusqu'à la remise à zéro suivante.
 */

/** Codes d'erreur propres à la démo, traduits par l'interface (`demo.errors.*`). */
export const DEMO_ERROR_CODES = ['DEMO_READ_ONLY', 'DEMO_QUOTA'] as const
export type DemoErrorCode = (typeof DEMO_ERROR_CODES)[number]

/** Ressources protégées citées par `403 DEMO_READ_ONLY` (`details.resource`). */
export const DEMO_RESOURCES = ['media', 'folder', 'project', 'member', 'origin', 'key', 'token', 'preset', 'user', 'setting'] as const
export type DemoResource = (typeof DEMO_RESOURCES)[number]

/** Réglage (`Setting`) qui date le contenu de référence : millisecondes Unix, écrit par `surge-media demo snapshot`. */
export const DEMO_REFERENCE_SETTING_KEY = 'demoReferenceAt'

/** Archive d'un instantané : fichier descriptif, base et dossier des médias (`surge-media demo snapshot`). */
export const DEMO_SNAPSHOT_MANIFEST = 'surge-media-demo.json'
export const DEMO_SNAPSHOT_DATABASE = 'database.sqlite'
export const DEMO_SNAPSHOT_MEDIA = 'media'
export const DEMO_SNAPSHOT_FORMAT = 1

/** Minutes entre deux remises à zéro (NUXT_DEMO_RESET_INTERVAL), créneaux alignés sur minuit UTC. */
export const DEMO_RESET_INTERVAL_DEFAULT = 120
export const DEMO_RESET_INTERVAL_MAX = 24 * 60
/** Volume envoyé par cycle (NUXT_DEMO_UPLOAD_QUOTA), en tout ; une adresse IP en a le quart. */
export const DEMO_UPLOAD_QUOTA_DEFAULT = 1024 * 1024 * 1024
/** Comptes affichés sur la page de connexion, au plus. */
export const DEMO_ACCOUNTS_MAX = 4

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
/** Écart minimal entre le démarrage du processus et la remise à zéro suivante (plafonné à la moitié de l'intervalle). */
const DEMO_RESET_MIN_GAP_MS = 10 * MINUTE_MS

export interface DemoAccount {
  email: string
  password: string
}

/** Intervalle configuré → minutes entières de 1 à 1 440 ; absent ou invalide → défaut. */
export function parseDemoInterval(raw: unknown): number {
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= DEMO_RESET_INTERVAL_MAX ? value : DEMO_RESET_INTERVAL_DEFAULT
}

/** Volume configuré → octets (entier positif) ; absent ou invalide → défaut. */
export function parseDemoQuota(raw: unknown): number {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : DEMO_UPLOAD_QUOTA_DEFAULT
}

/** Part du volume d'un cycle accordée à une adresse IP. */
export function demoQuotaPerAddress(total: number): number {
  return Math.max(1, Math.floor(total / 4))
}

/**
 * Remise à zéro suivante : premier créneau `minuit UTC + k × intervalle` (le compte repart de zéro chaque
 * jour, minuit compris) situé au moins `min(10 min, intervalle / 2)` après `nowMs`. Un redémarrage imprévu
 * juste avant un créneau ne déclenche donc pas une seconde remise à zéro aussitôt après.
 */
export function nextDemoReset(nowMs: number, intervalMinutes: number): number {
  const step = parseDemoInterval(intervalMinutes) * MINUTE_MS
  const earliest = nowMs + Math.min(DEMO_RESET_MIN_GAP_MS, step / 2)
  const dayStart = Math.floor(earliest / DAY_MS) * DAY_MS
  const slot = dayStart + Math.ceil((earliest - dayStart) / step) * step
  return Math.min(slot, dayStart + DAY_MS)
}

/**
 * Comptes de NUXT_DEMO_ACCOUNTS : JSON `[{ "email": "…", "password": "…" }]` (Nitro peut l'avoir déjà
 * converti en tableau). Entrées invalides ignorées, 4 comptes au plus ; `problem` dit pourquoi s'il y en a.
 */
export function parseDemoAccounts(raw: unknown): { accounts: DemoAccount[], problem: string | null } {
  if (raw === undefined || raw === null || raw === '') return { accounts: [], problem: null }
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    }
    catch {
      return { accounts: [], problem: 'JSON illisible' }
    }
  }
  if (!Array.isArray(value)) return { accounts: [], problem: 'un tableau JSON est attendu' }
  const accounts: DemoAccount[] = []
  let ignored = 0
  for (const entry of value) {
    // Minuscules, comme les adresses en base (emailSchema).
    const email = typeof entry?.email === 'string' ? entry.email.trim().toLowerCase() : ''
    const password = typeof entry?.password === 'string' ? entry.password : ''
    if (!email || email.length > 254 || !email.includes('@') || !password || password.length > 256 || accounts.length >= DEMO_ACCOUNTS_MAX) {
      ignored++
      continue
    }
    accounts.push({ email, password })
  }
  return { accounts, problem: ignored ? `${ignored} entrée(s) ignorée(s)` : null }
}

/** Lien configuré du bandeau : `https:`, `http:` ou `mailto:` seulement, sinon vide (jamais de `javascript:`). */
export function safeDemoLink(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return ''
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''
  }
  catch {
    return ''
  }
}

/** Valeur du réglage `demoReferenceAt` → millisecondes Unix, ou null. */
export function parseDemoReference(value: unknown): number | null {
  const ms = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : null
}

/** Un élément fait-il partie du contenu de référence (créé au plus tard à la capture) ? */
export function isDemoReference(createdAt: Date | number, referenceAt: number): boolean {
  const at = typeof createdAt === 'number' ? createdAt : createdAt.getTime()
  return at <= referenceAt
}

/** Données publiques de la démo (`GET /api/demo`). */
export type DemoInfo
  = | { enabled: false }
    | {
      enabled: true
      /** Prochaine remise à zéro (ISO 8601). */
      nextResetAt: string
      contactUrl: string
      abuseUrl: string
      termsUrl: string
      accounts: Array<DemoAccount & { role: string | null }>
      /** La session courante est-elle celle d'un compte de référence (non modifiable) ? */
      protectedAccount: boolean
    }
