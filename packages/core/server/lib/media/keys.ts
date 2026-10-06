import { createHash, randomBytes } from 'node:crypto'

/**
 * Clés de stockage, toujours générées par le serveur :
 *  - jamais dérivées du nom envoyé par le client (pas de traversée de chemin, pas d'écrasement) ;
 *  - un segment aléatoire de 128 bits rend toute collision impossible ;
 *  - un remplacement produit une nouvelle clé (l'ancien fichier est supprimé ensuite).
 *
 *   originaux : originals/2026/09/Qx7…Kp.jpg   (répartis par mois : dossiers de taille raisonnable)
 *   dérivés   : variants/<mediaId>/v3-9f2c…e1.webp
 */
export function originalKey(extension: string, date = new Date()): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `originals/${date.getUTCFullYear()}/${month}/${randomBytes(16).toString('base64url')}.${extension}`
}

export function variantPrefix(mediaId: string): string {
  return `variants/${mediaId}/`
}

export function variantKey(mediaId: string, version: number, transformation: string, extension: string): string {
  const hash = createHash('sha256').update(transformation).digest('hex').slice(0, 16)
  return `${variantPrefix(mediaId)}v${version}-${hash}.${extension}`
}

/**
 * Fichiers associés à une vidéo (phase D2), rangés avec ses dérivés (supprimés avec eux à la purge), mais
 * hors des préfixes de version (« v3- ») : un remplacement du fichier vidéo les garde.
 *   affiche : variants/<mediaId>/poster-Qx7…Kp.jpg
 *   piste   : variants/<mediaId>/track-Qx7…Kp.vtt
 */
export function posterKey(mediaId: string): string {
  return `${variantPrefix(mediaId)}poster-${randomBytes(12).toString('base64url')}.jpg`
}

export function trackKey(mediaId: string): string {
  return `${variantPrefix(mediaId)}track-${randomBytes(12).toString('base64url')}.vtt`
}
