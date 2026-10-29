import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import type { TrustedDevice, User } from '../generated/prisma/client'

/**
 * Appareils de confiance (« mode sudo », shared/utils/auth.ts) : l'utilisateur qui coche la case du
 * dialogue de confirmation dispense ce navigateur de ressaisir son mot de passe pour les actions
 * sensibles pendant `trustedDeviceDays` jours. Le jeton aléatoire vit dans un cookie HTTP-only,
 * Secure, SameSite=Lax et de chemin / comme celui de la session (le rendu serveur d'une page le
 * transmet ainsi à l'API) ; seule son empreinte est en base (TrustedDevice), liée au compte.
 * La confiance ne remplace jamais le mot de passe : elle survit à la déconnexion (sessions de 12 h), mais
 * tombe à son échéance, au changement de mot de passe, à la désactivation du compte, à toute modification
 * de sa double authentification, quand l'option est désactivée (durée 0) ou sur demande (tableau de bord,
 * fiche du compte). Accordée à l'étape du code de la connexion (`secondFactorAt`), elle dispense aussi du
 * code TOTP aux connexions suivantes ; accordée par le mode sudo (mot de passe seul), jamais.
 */

export const TRUSTED_DEVICE_COOKIE = 'surge-media-trusted-device'
/** Mise à jour de TrustedDevice.lastUsedAt au plus toutes les 5 minutes. */
const LAST_USED_INTERVAL_MS = 5 * 60_000
const DAY_MS = 86_400_000

/** Durée de confiance configurée (jours), 0 = option désactivée. */
export function configuredTrustedDeviceDays(event: H3Event): number {
  return trustedDeviceDays(useRuntimeConfig(event).public.trustedDeviceDays)
}

/**
 * Empreintes des jetons présentés : toutes les valeurs du cookie, pas seulement la première (un
 * navigateur envoie plusieurs cookies homonymes s'ils diffèrent par leur chemin ou leur domaine).
 */
function presentedTokenHashes(event: H3Event): string[] {
  const prefix = `${TRUSTED_DEVICE_COOKIE}=`
  return (getRequestHeader(event, 'cookie') ?? '')
    .split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(prefix) && part.length > prefix.length)
    .map(part => hashToken(part.slice(prefix.length)))
}

function clearTrustedDeviceCookie(event: H3Event): void {
  deleteCookie(event, TRUSTED_DEVICE_COOKIE, { path: '/' })
}

/**
 * Appareil de confiance valide présenté par la requête pour ce compte (cookie, compte, échéance), ou
 * null. Option désactivée : toujours null.
 */
export async function findTrustedDevice(event: H3Event, user: User): Promise<TrustedDevice | null> {
  const hashes = presentedTokenHashes(event)
  if (!hashes.length || configuredTrustedDeviceDays(event) === 0) return null
  const prisma = await usePrisma()
  const device = await prisma.trustedDevice.findFirst({ where: { tokenHash: { in: hashes }, userId: user.id, expiresAt: { gt: new Date() } } })
  if (!device) return null
  if (Date.now() - device.lastUsedAt.getTime() > LAST_USED_INTERVAL_MS) {
    await prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } })
  }
  return device
}

/**
 * Fait confiance à ce navigateur pour `user` : nouveau jeton (le précédent cookie de ce navigateur,
 * quel que soit son compte, est remplacé et sa ligne supprimée), échéance fixe, cookie posé.
 * Les appareils expirés du compte sont purgés au passage. `secondFactor` : la confiance est accordée juste
 * après un second facteur (étape du code de la connexion) et dispense donc du code jusqu'à l'échéance.
 * Renvoie l'échéance.
 */
export async function trustDevice(event: H3Event, user: User, options: { secondFactor?: boolean } = {}): Promise<Date> {
  const days = configuredTrustedDeviceDays(event)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + days * DAY_MS)
  const token = randomBytes(32).toString('base64url')
  const previous = presentedTokenHashes(event)

  const prisma = await usePrisma()
  await prisma.$transaction([
    prisma.trustedDevice.deleteMany({
      where: { OR: [{ userId: user.id, expiresAt: { lte: now } }, ...(previous.length ? [{ tokenHash: { in: previous } }] : [])] },
    }),
    prisma.trustedDevice.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
        secondFactorAt: options.secondFactor ? now : null,
        ipAddress: getRequestIP(event)?.slice(0, 191),
        userAgent: getRequestHeader(event, 'user-agent')?.slice(0, 191),
      },
    }),
  ])
  // Même exigence HTTPS que le cookie de session (NUXT_SESSION_COOKIE_SECURE).
  const sessionCookie = useRuntimeConfig(event).session.cookie
  setCookie(event, TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: !sessionCookie || sessionCookie.secure !== false,
    sameSite: 'lax',
    path: '/',
    maxAge: days * 86_400,
  })
  return expiresAt
}

/** Retire la confiance accordée à ce navigateur (pour ce compte) et efface son cookie ; renvoie le nombre retiré. */
export async function forgetCurrentDevice(event: H3Event, user: User): Promise<number> {
  const hashes = presentedTokenHashes(event)
  clearTrustedDeviceCookie(event)
  if (!hashes.length) return 0
  const prisma = await usePrisma()
  const { count } = await prisma.trustedDevice.deleteMany({ where: { tokenHash: { in: hashes }, userId: user.id } })
  return count
}

/**
 * Retire la confiance de tous les appareils d'un compte ; renvoie le nombre d'appareils encore valables
 * retirés. Si `event` est celui du compte concerné, efface aussi son cookie.
 */
export async function revokeTrustedDevices(userId: string, event?: H3Event): Promise<number> {
  const prisma = await usePrisma()
  const now = new Date()
  const active = await prisma.trustedDevice.count({ where: { userId, expiresAt: { gt: now } } })
  await prisma.trustedDevice.deleteMany({ where: { userId } })
  if (event) clearTrustedDeviceCookie(event)
  return active
}

/** Appareils de confiance encore valables d'un compte. */
export async function countTrustedDevices(userId: string): Promise<number> {
  const prisma = await usePrisma()
  return prisma.trustedDevice.count({ where: { userId, expiresAt: { gt: new Date() } } })
}

/** État présenté au compte connecté : durée configurée, confiance de ce navigateur, appareils valables. */
export async function trustedDeviceState(event: H3Event, user: User) {
  const days = configuredTrustedDeviceDays(event)
  const current = await findTrustedDevice(event, user)
  return {
    days,
    current: current ? { createdAt: current.createdAt, expiresAt: current.expiresAt } : null,
    total: days > 0 ? await countTrustedDevices(user.id) : 0,
  }
}
