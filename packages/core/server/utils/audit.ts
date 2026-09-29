import type { H3Event } from 'h3'
import type { Prisma, User } from '../generated/prisma/client'

/**
 * Journal d'audit des actions sensibles (modèle AuditEvent, actions : shared/utils/audit.ts).
 * Auteur : l'utilisateur de la session (event.context.authUser, posé par requireAuth) ou, pour
 * l'API v1, l'identifiant présenté (event.context.apiPrincipal) : `tokenId` = l'identifiant (émetteur
 * d'un jeton délégué), `actorUserId` = propriétaire d'un jeton personnel ; `data.via` = type
 * d'identifiant, `data.subject` = sujet final d'un jeton délégué. L'adresse IP est celle vue par le
 * serveur. `data.label` garde un libellé lisible de la cible, affichable après sa suppression.
 */
export interface AuditEntry {
  action: AuditAction
  projectId?: string | null
  targetType?: 'project' | 'member' | 'token' | 'origin' | 'media' | 'user'
  targetId?: string
  data?: { label?: string } & Record<string, unknown>
}

/** Enregistre une entrée ; un échec est journalisé sans faire échouer l'action déjà effectuée. */
export async function recordAudit(event: H3Event, entry: AuditEntry): Promise<void> {
  try {
    const actor = event.context.authUser as User | undefined
    const principal = event.context.apiPrincipal
    const data = principal
      ? { ...entry.data, via: principal.type, ...(principal.delegated?.subject ? { subject: principal.delegated.subject } : {}) }
      : entry.data
    const prisma = await usePrisma()
    await prisma.auditEvent.create({
      data: {
        action: entry.action,
        actorUserId: actor?.id ?? principal?.credential.owner?.id ?? null,
        tokenId: principal?.credential.id ?? null,
        projectId: entry.projectId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ipAddress: getRequestIP(event)?.slice(0, 191) ?? null,
        data: data as Prisma.InputJsonValue | undefined,
      },
    })
  }
  catch (error) {
    console.error(`[surge-media] Journal d'audit : échec de l'enregistrement de « ${entry.action} ».`, error)
  }
}
