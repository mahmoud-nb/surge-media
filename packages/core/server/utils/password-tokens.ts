import { randomBytes } from 'node:crypto'
import type { PasswordToken, PasswordTokenPurpose, User } from '../generated/prisma/client'

/** Durée de validité des liens : une invitation peut attendre, une réinitialisation non. */
const TOKEN_TTL_MS: Record<PasswordTokenPurpose, number> = {
  INVITATION: 7 * 24 * 60 * 60_000,
  RESET: 24 * 60 * 60_000,
}

export interface IssuedPasswordLink {
  /** Chemin relatif de la page de saisie (`/password/<jeton>`), à préfixer par l'origine publique. */
  path: string
  purpose: PasswordTokenPurpose
  expiresAt: Date
}

/**
 * Crée un lien à usage unique (invitation si aucun mot de passe, sinon réinitialisation).
 * Les liens encore valables du même compte sont annulés : un seul lien actif à la fois.
 */
export async function issuePasswordLink(user: User, createdById: string): Promise<IssuedPasswordLink> {
  const prisma = await usePrisma()
  const purpose: PasswordTokenPurpose = user.passwordHash ? 'RESET' : 'INVITATION'
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[purpose])

  await prisma.$transaction([
    prisma.passwordToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordToken.create({
      data: { userId: user.id, purpose, tokenHash: hashToken(token), expiresAt, createdById },
    }),
  ])
  return { path: `/password/${token}`, purpose, expiresAt }
}

/** Lien valable (non utilisé, non expiré, compte actif) ou null. */
export async function findValidPasswordToken(token: string): Promise<(PasswordToken & { user: User }) | null> {
  const prisma = await usePrisma()
  const record = await prisma.passwordToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!record || record.usedAt || record.expiresAt <= new Date() || !record.user.isActive) return null
  return record
}

/** Lien en attente d'un compte (pour l'afficher dans l'administration, sans le jeton). */
export async function pendingPasswordLink(userId: string): Promise<Pick<PasswordToken, 'purpose' | 'expiresAt'> | null> {
  const prisma = await usePrisma()
  return prisma.passwordToken.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    select: { purpose: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Consomme le lien et enregistre le nouveau mot de passe. L'invalidation est atomique
 * (updateMany conditionnel) : deux soumissions simultanées ne peuvent pas réussir toutes les deux.
 * Toutes les sessions du compte sont fermées (réinitialisation après oubli ou compromission).
 */
export async function consumePasswordToken(record: PasswordToken, password: string): Promise<boolean> {
  const prisma = await usePrisma()
  const passwordHash = await hashUserPassword(password)
  const now = new Date()

  const claimed = await prisma.passwordToken.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  if (claimed.count !== 1) return false

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordToken.deleteMany({ where: { userId: record.userId, usedAt: null } }),
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ])
  return true
}
