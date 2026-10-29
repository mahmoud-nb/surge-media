import { renderSVG } from 'uqr'

/**
 * QR code SVG d'une URI `otpauth://` (bibliothèque uqr, sans dépendance). Toujours noir sur blanc,
 * avec sa marge : les applications le lisent mal en couleurs inversées, y compris en thème sombre.
 * L'interface le double de la clé en texte (saisie manuelle, lecteurs d'écran).
 */
export function otpauthQrSvg(uri: string): string {
  return renderSVG(uri, { ecc: 'M', border: 2, whiteColor: '#ffffff', blackColor: '#000000' })
}
