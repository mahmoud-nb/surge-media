import type { H3Event } from 'h3'
import type { Prisma, User } from '../generated/prisma/client'

/**
 * Journal d'audit des actions sensibles (modèle AuditEvent, actions : shared/utils/audit.ts).
 * L'auteur est l'utilisateur de la session (event.context.authUser, posé par requireAuth) ;
 * l'adresse IP est celle vue par le serveur. `data.label` garde un libellé lisible de la cible,
 * qui reste affichable après sa suppression.
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
    const prisma = await usePrisma()
    await prisma.auditEvent.create({
      data: {
        action: entry.action,
        actorUserId: actor?.id ?? null,
        projectId: entry.projectId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ipAddress: getRequestIP(event)?.slice(0, 191) ?? null,
        data: entry.data as Prisma.InputJsonValue | undefined,
      },
    })
  }
  catch (error) {
    console.error(`[surge-media] Journal d'audit : échec de l'enregistrement de « ${entry.action} ».`, error)
  }
}
