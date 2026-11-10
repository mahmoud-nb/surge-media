/**
 * Libellés et messages des étiquettes dans l'administration (architecture-tags.md) : options de couleur,
 * messages d'erreur traduits (`tags.errors.*`, projets en conflit pour une étiquette globale), recherche
 * sans casse ni accents des suggestions.
 */

/** Étiquette telle que l'administration la reçoit (médias, listes). */
export interface TagOption {
  id: string
  name: string
  slug: string
  color: string
  level: TagLevel
  confidential: boolean
}

/** Champs d'une étiquette dans le formulaire de création ou de modification. */
export interface TagFormValue {
  name: string
  slug: string
  color: TagColor
  confidential: boolean
}

export function useTagLabels() {
  const { t } = useI18n()
  const { errorFallback } = useDemoErrors()

  const colorOptions = computed(() => TAG_COLORS.map(value => ({ value, label: t(`tags.colors.${value}`) })))

  /** Message traduit d'une erreur des étiquettes ; `projects` : projets qui utilisent déjà le nom. */
  function tagErrorMessage(error: unknown): string {
    const { code, details } = apiError(error)
    if (code && (TAG_ERROR_CODES as readonly string[]).includes(code)) {
      const projects = Array.isArray(details?.projects)
        ? (details.projects as { name?: unknown }[]).map(project => String(project.name ?? '')).filter(Boolean)
        : []
      const message = t(`tags.errors.${code}`)
      return projects.length ? `${message} ${t('tags.errors.usedInProjects', { names: projects.join(', ') })}` : message
    }
    return errorFallback(error)
  }

  return { colorOptions, tagErrorMessage }
}

/** Texte de recherche d'une étiquette (nom et slug, sans casse ni accents). */
export function tagSearchText(tag: Pick<TagOption, 'name' | 'slug'>): string {
  return normalizeSearchText(`${tag.name} ${tag.slug}`)
}
