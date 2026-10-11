import type { TokenType as PrismaTokenType } from '../generated/prisma/client'

// Échoue à la compilation si TOKEN_TYPES (shared/utils/credentials.ts) et l'enum Prisma divergent.
type SameTokenTypes = [TokenType, PrismaTokenType] extends [PrismaTokenType, TokenType] ? true : never
const tokenTypesInSync: SameTokenTypes = true
void tokenTypesInSync

/** Erreur métier des identifiants et origines : statut HTTP + code (`data.code`) traduit par l'interface. */
export function credentialError(statusCode: 403 | 404 | 409 | 422, code: CredentialErrorCode) {
  return createError({ statusCode, statusMessage: code, data: { code } })
}
