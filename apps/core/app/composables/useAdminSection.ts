/**
 * Section de la barre latérale à signaler quand le chemin de la page ne suffit pas : la fiche
 * d'un média (/admin/media/:id) relève de la bibliothèque ou d'un projet selon son espace.
 * La page qui la pose la remet à null en se démontant.
 */
export function useAdminSection() {
  return useState<string | null>('admin-section', () => null)
}
