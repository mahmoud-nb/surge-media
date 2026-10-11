/**
 * Projets : identifiant lisible (slug), statuts et codes d'erreur (partagés app / serveur).
 */

export const PROJECT_NAME_MAX_LENGTH = 100
export const PROJECT_DESCRIPTION_MAX_LENGTH = 191
export const PROJECT_SLUG_MAX_LENGTH = 60
/** Minuscules non accentuées, chiffres et tirets simples, sans tiret au début ni à la fin. */
export const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const PROJECT_STATUSES = ['active', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Sort des médias lors de la suppression d'un projet archivé. */
export const PROJECT_MEDIA_ON_DELETE = ['library', 'purge'] as const
export type ProjectMediaOnDelete = (typeof PROJECT_MEDIA_ON_DELETE)[number]

/** Identifiant lisible déduit d'un nom : « Site vitrine (été) » → « site-vitrine-ete ». */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PROJECT_SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
}

/** Codes d'erreur métier renvoyés par l'API des projets (`data.code`), traduits par l'interface. */
export const PROJECT_ERROR_CODES = [
  'SLUG_TAKEN', // identifiant lisible déjà utilisé par un autre projet
  'PROJECT_ARCHIVED', // modification refusée : projet archivé (lecture seule)
  'PROJECT_NOT_ARCHIVED', // suppression d'un projet qui n'a pas été archivé
  'LAST_OWNER', // retrait ou rétrogradation du dernier propriétaire
  'ALREADY_MEMBER', // l'utilisateur est déjà membre du projet
  'ROLE_NOT_ASSIGNABLE', // rôle de projet supérieur au plafond du rôle de plateforme
  'USER_NOT_FOUND', // utilisateur à ajouter introuvable ou désactivé
  'LIBRARY_NOT_ALLOWED', // verser les médias dans la bibliothèque exige de pouvoir y envoyer des médias
] as const
export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number]
