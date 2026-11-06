import type { H3Event } from 'h3'
import {
  DEMO_REFERENCE_SETTING_KEY,
  type DemoAccount,
  type DemoErrorCode,
  type DemoLegal,
  isDemoReference,
  nextDemoReset,
  parseDemoAccounts,
  parseDemoInterval,
  parseDemoLegal,
  parseDemoQuota,
  parseDemoReference,
  safeDemoLink,
} from '#shared/utils/demo'
import type { User } from '../generated/prisma/client'
import { createDemoUploadQuota, type DemoUploadQuota } from '../lib/demo/quota'

/**
 * Mode démo (NUXT_DEMO_*, architecture : .claude/architecture-demo.md). La configuration est lue une fois
 * par processus, comme le reste (server/plugins/runtime-config.ts) : le processus redémarre à chaque remise
 * à zéro, et l'heure de la suivante est fixée dès son démarrage.
 */

export interface DemoSettings {
  enabled: boolean
  resetInterval: number
  accounts: DemoAccount[]
  uploadQuota: number
  contactUrl: string
  abuseUrl: string
  termsUrl: string
  /** Informations légales (pages /legal, /privacy, /terms), null sans éditeur. */
  legal: DemoLegal | null
  /** Champs obligatoires des informations légales encore vides. */
  legalMissing: string[]
}

/** Démarrage du processus (ms Unix) : sert de référence à défaut d'instantané, et au calcul de la remise à zéro. */
const PROCESS_STARTED_AT = Date.now() - Math.round(process.uptime() * 1000)

let settings: DemoSettings | null = null

export function useDemo(): DemoSettings {
  if (settings) return settings
  const config = useRuntimeConfig().demo ?? {}
  const enabled = config.mode === true || String(config.mode) === 'true'
  const { accounts, problem } = parseDemoAccounts(config.accounts)
  if (enabled && problem) console.warn(`[surge-media] NUXT_DEMO_ACCOUNTS : ${problem}.`)
  const { legal, missing } = parseDemoLegal(config.legal)
  settings = {
    enabled,
    resetInterval: parseDemoInterval(config.resetInterval),
    accounts,
    uploadQuota: parseDemoQuota(config.uploadQuota),
    contactUrl: safeDemoLink(config.contactUrl),
    abuseUrl: safeDemoLink(config.abuseUrl),
    termsUrl: safeDemoLink(config.termsUrl),
    legal,
    legalMissing: missing,
  }
  return settings
}

export function demoEnabled(): boolean {
  return useDemo().enabled
}

let nextReset: number | null = null

/** Prochaine remise à zéro (ms Unix), calculée une fois pour le processus : le bandeau et l'arrêt lisent la même. */
export function demoNextResetAt(): number {
  nextReset ??= nextDemoReset(PROCESS_STARTED_AT, useDemo().resetInterval)
  return nextReset
}

let reference: Promise<number> | null = null

/**
 * Date du contenu de référence (`demoReferenceAt`, écrit par `surge-media demo snapshot`), lue une fois. Sans
 * instantané, le démarrage du processus en tient lieu : tout ce qui existe déjà est alors protégé.
 */
export function demoReferenceAt(): Promise<number> {
  reference ??= (async () => {
    const prisma = await usePrisma()
    const setting = await prisma.setting.findUnique({ where: { key: DEMO_REFERENCE_SETTING_KEY } })
    const value = parseDemoReference(setting?.value)
    if (value !== null) return value
    console.warn('[surge-media] Démo : aucun instantané de référence (surge-media demo snapshot) ; le contenu existant au démarrage est protégé.')
    return PROCESS_STARTED_AT
  })().catch((error) => {
    reference = null
    throw error
  })
  return reference
}

/** Un élément créé à cette date fait-il partie du contenu de référence de la démo ? */
export async function isDemoReferenceItem(createdAt: Date | number): Promise<boolean> {
  return isDemoReference(createdAt, await demoReferenceAt())
}

/** Compte de la session courante, ou null (sans lever d'erreur ni effacer le cookie, contrairement à `requireAuth`). */
export async function currentSessionUser(event: H3Event): Promise<User | null> {
  const known = event.context.authUser as User | undefined
  if (known) return known
  const user = await resolveSession(await getUserSession(event))
  if (user) event.context.authUser = user
  return user
}

let quota: DemoUploadQuota | null = null

function uploadQuota(): DemoUploadQuota {
  quota ??= createDemoUploadQuota(useDemo().uploadQuota)
  return quota
}

function clientAddress(event: H3Event): string {
  return getRequestIP(event) ?? 'unknown'
}

/**
 * Mode démo : refuse un envoi quand le volume du cycle est épuisé (en tout ou pour cette adresse) →
 * `429 DEMO_QUOTA`, `Retry-After` jusqu'à la remise à zéro. Sans effet hors démo.
 */
export function assertDemoUploadAllowed(event: H3Event): void {
  if (!useDemo().enabled || uploadQuota().allows(clientAddress(event))) return
  const retryAfter = Math.max(1, Math.ceil((demoNextResetAt() - Date.now()) / 1000))
  setResponseHeader(event, 'Retry-After', retryAfter)
  throw demoError(429, 'DEMO_QUOTA', { retryAfter, resetAt: new Date(demoNextResetAt()).toISOString() })
}

/** Mode démo : compte un fichier reçu dans le volume du cycle. */
export function recordDemoUpload(event: H3Event, bytes: number): void {
  if (useDemo().enabled) uploadQuota().record(clientAddress(event), bytes)
}

/** Erreur de la démo : statut HTTP + code (`data.code`) et précisions, traduits par l'interface. */
export function demoError(statusCode: 403 | 429, code: DemoErrorCode, data: Record<string, unknown> = {}) {
  return createError({ statusCode, statusMessage: code, data: { code, ...data } })
}
