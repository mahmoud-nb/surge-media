import type { H3Event } from 'h3'
import { demoQuotaPerAddress } from '#shared/utils/demo'

/**
 * Volume d'envoi d'un cycle de la démo (architecture : .claude/architecture-demo.md, § 8) : octets reçus
 * depuis le démarrage du processus, qui redémarre à chaque remise à zéro. En tout, et par adresse IP (le
 * quart). Un envoi qui commence au-delà est refusé ; le dépassement se limite donc à un fichier.
 */
export interface DemoUploadQuota {
  /** Un nouvel envoi de cette adresse est-il encore admis ? */
  allows: (address: string) => boolean
  /** Compte un fichier reçu. */
  record: (address: string, bytes: number) => void
}

export function createDemoUploadQuota(total: number): DemoUploadQuota {
  const perAddress = demoQuotaPerAddress(total)
  const byAddress = new Map<string, number>()
  let used = 0
  return {
    allows: address => used < total && (byAddress.get(address) ?? 0) < perAddress,
    record(address, bytes) {
      if (!(bytes > 0)) return
      used += bytes
      byAddress.set(address, (byAddress.get(address) ?? 0) + bytes)
    },
  }
}

/** Contrôle du volume branché sur la réception des envois (server/lib/media/upload.ts) par le plugin de la démo. */
export interface DemoUploadGuard {
  /** Lève `429 DEMO_QUOTA` si le volume du cycle est épuisé pour cette requête. */
  check: (event: H3Event) => void
  /** Compte un fichier reçu. */
  record: (event: H3Event, bytes: number) => void
}

let guard: DemoUploadGuard | null = null

/** Branché au démarrage en mode démo seulement (server/plugins/demo.ts) ; sinon la réception n'en sait rien. */
export function setDemoUploadGuard(value: DemoUploadGuard | null): void {
  guard = value
}

export function demoUploadGuard(): DemoUploadGuard | null {
  return guard
}
