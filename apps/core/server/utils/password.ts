import { hash, verify } from '@node-rs/argon2'

/**
 * Hachage des mots de passe : argon2id (algorithme par défaut de @node-rs/argon2),
 * paramètres minimaux recommandés par l'OWASP (19 Mio, 2 itérations, 1 fil).
 * Noms distincts de `hashPassword`/`verifyPassword` de nuxt-auth-utils (scrypt).
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

export function hashUserPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

export async function verifyUserPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  }
  catch {
    // Empreinte illisible ou d'un autre format : refus.
    return false
  }
}

let dummyHash: Promise<string> | undefined

/**
 * Vérification factice, de même coût qu'une vraie : appelée quand le compte n'existe
 * pas, pour ne pas révéler par le temps de réponse si une adresse e-mail est inscrite.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashUserPassword('surge-media:dummy-password')
  await verifyUserPassword(await dummyHash, password)
  return false
}
