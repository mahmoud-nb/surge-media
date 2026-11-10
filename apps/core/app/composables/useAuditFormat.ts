/**
 * Mise en forme des entrées du journal d'audit (libellé de l'action, auteur, détails lisibles),
 * partagée par la page du journal et le widget « Activité récente » du tableau de bord.
 */

type Missing = { id: string, deleted: true }

/** Entrée du journal telle que renvoyée par l'API d'administration (listAuditEvents). */
export interface AuditEntryView {
  action: string
  actor: { id: string, name: string | null, email: string } | Missing | null
  project: { id: string, name: string } | Missing | null
  token: { id: string, name: string, type: string } | Missing | null
  data: unknown
}

export function useAuditFormat() {
  const { t, te, locale } = useI18n()
  const { environmentLabel } = useCredentialLabels()

  function actionLabel(action: string): string {
    return (AUDIT_ACTIONS as readonly string[]).includes(action) ? t(`audit.actions.${action}`) : action
  }

  function credentialName(token: NonNullable<AuditEntryView['token']>): string {
    return 'deleted' in token ? t('audit.deletedCredential') : t(`credentials.named.${token.type}`, { name: token.name })
  }

  /** Auteur : compte (session, ou propriétaire d'un jeton personnel), sinon identifiant d'API, sinon système. */
  function actorName(item: AuditEntryView): string {
    const { actor, token } = item
    if (actor) return 'deleted' in actor ? t('audit.deletedUser') : (actor.name || actor.email)
    return token ? credentialName(token) : t('audit.system')
  }

  /** Précisions sur une action faite par l'API v1 : identifiant utilisé (si l'auteur est un compte), jeton délégué. */
  function actorDetails(item: AuditEntryView): string[] {
    const data = (item.data ?? {}) as Record<string, unknown>
    const lines: string[] = []
    if (item.token && item.actor) lines.push(t('audit.via', { credential: credentialName(item.token) }))
    if (data.via === 'delegated') {
      lines.push(typeof data.subject === 'string' ? t('audit.delegatedSubject', { subject: data.subject }) : t('audit.delegated'))
    }
    return lines
  }

  function projectName(project: NonNullable<AuditEntryView['project']>): string {
    return 'deleted' in project ? t('audit.deletedProject') : project.name
  }

  function text(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  /** Date ISO enregistrée dans les données → date et heure lisibles (texte brut si illisible). */
  function dateTime(value: unknown): string {
    const date = new Date(text(value))
    return Number.isNaN(date.getTime()) ? text(value) : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }

  function spaceName(space: unknown): string {
    return space && typeof space === 'object' && 'name' in space ? text(space.name) : t('space.library')
  }

  /** Détails lisibles d'une entrée, selon son action (données enregistrées par le serveur). */
  function details(item: AuditEntryView): string | null {
    const data = (item.data ?? {}) as Record<string, unknown>
    const change = (data.changes ?? {}) as Record<string, { from: unknown, to: unknown }>
    switch (item.action) {
      case 'member.added':
        return t('audit.details.role', { role: t(`projectRoles.${text(data.role)}.label`) })
      case 'member.role_changed':
        return t('audit.details.change', { from: t(`projectRoles.${text(data.from)}.label`), to: t(`projectRoles.${text(data.to)}.label`) })
      case 'project.updated':
        return t('audit.details.fields', { fields: Object.keys(change).map(field => t(`audit.fields.${field}`)).join(', ') })
      case 'project.deleted':
        return t(`audit.details.projectMedia.${data.media === 'purge' ? 'purge' : 'library'}`, { count: Number(data.count ?? 0) })
      case 'media.visibility_changed':
        return t('audit.details.change', { from: t(`media.visibility.${text(data.from)}.label`), to: t(`media.visibility.${text(data.to)}.label`) })
      case 'media.moved':
        return t('audit.details.change', { from: spaceName(data.from), to: spaceName(data.to) })
      // Traiter les vidéos existantes (phase D3) : `partial` = boucle interrompue par une erreur, les
      // tâches déjà créées restant en file.
      case 'media.processing_backfill': {
        const count = Number(data.count ?? 0)
        return [
          t('audit.details.processingBackfill', { count }, count),
          data.partial ? t('audit.details.processingBackfillPartial') : null,
        ].filter(Boolean).join(' · ')
      }
      case 'key.created':
      case 'key.revoked':
      case 'key.deleted':
        return `${t(`apiKeys.types.${text(data.type)}.short`)} · ${environmentLabel(text(data.environment))}`
      case 'key.rotated':
        return [t(`apiKeys.rotate.overlaps.${text(data.overlap)}.label`), data.replacedBy ? t('apiKeys.replacedBy', { name: text(data.replacedBy) }) : null].filter(Boolean).join(' · ')
      case 'user.created':
        return [
          t('audit.details.role', { role: t(`roles.${text(data.role)}.label`) }),
          Array.isArray(data.projects) && data.projects.length ? t('audit.details.projects', { names: data.projects.map(text).join(', ') }) : null,
        ].filter(Boolean).join(' · ')
      case 'user.updated':
        return [
          change.role ? t('audit.details.change', { from: t(`roles.${text(change.role.from)}.label`), to: t(`roles.${text(change.role.to)}.label`) }) : null,
          change.isActive ? t(change.isActive.to ? 'audit.details.activated' : 'audit.details.deactivated') : null,
        ].filter(Boolean).join(' · ') || null
      case 'user.device_trusted':
        return t('audit.details.deviceTrusted', { days: Number(data.days ?? 0) }, Number(data.days ?? 0))
      case 'user.devices_revoked':
        return data.scope === 'current'
          ? t('audit.details.deviceForgotten')
          : t('audit.details.devicesRevoked', { count: Number(data.count ?? 0) }, Number(data.count ?? 0))
      case 'user.password_link':
      case 'user.link_emailed':
        return t(`audit.details.passwordLink.${data.purpose === 'RESET' ? 'reset' : 'invitation'}`)
      case 'user.sessions_revoked':
        return t('audit.details.sessions', { count: Number(data.count ?? 0) }, Number(data.count ?? 0))
      case 'preset.created':
      case 'preset.deleted':
        return data.transformation ? t('audit.details.transformation', { value: text(data.transformation) }) : null
      case 'preset.updated':
        return t('audit.details.fields', { fields: Object.keys(change).map(field => t(`audit.fields.${field}`)).join(', ') })
      case 'tag.created':
        return [
          t(`audit.details.tagLevel.${data.level === 'project' ? 'project' : 'global'}`),
          data.confidential === true ? t('audit.details.tagConfidential') : null,
        ].filter(Boolean).join(' · ')
      case 'tag.updated':
        return [
          t(`audit.details.tagLevel.${data.level === 'project' ? 'project' : 'global'}`),
          t('audit.details.fields', { fields: Object.keys(change).map(field => t(`audit.fields.${field}`)).join(', ') }),
        ].join(' · ')
      case 'tag.deleted':
        return [
          t(`audit.details.tagLevel.${data.level === 'project' ? 'project' : 'global'}`),
          t('audit.details.tagMedia', { count: Number(data.mediaCount ?? 0) }, Number(data.mediaCount ?? 0)),
        ].join(' · ')
      case 'settings.updated':
        if (change.mfaPolicy) {
          return t('audit.details.mfaPolicy', {
            from: t(`settings.security.policies.${text(change.mfaPolicy.from)}.label`),
            to: t(`settings.security.policies.${text(change.mfaPolicy.to)}.label`),
          })
        }
        return change.libraryPolicy
          ? t('audit.details.libraryPolicy', {
              from: t(`transforms.policy.options.${text(change.libraryPolicy.from)}.label`),
              to: t(`transforms.policy.options.${text(change.libraryPolicy.to)}.label`),
            })
          : null
      case 'settings.license_installed':
      case 'settings.license_removed':
        return data.id
          ? t('audit.details.license', {
              plan: te(`settings.license.plans.${text(data.plan)}`) ? t(`settings.license.plans.${text(data.plan)}`) : text(data.plan),
              id: text(data.id),
            })
          : null
      case 'settings.license_clock_reset':
        return t('audit.details.licenseClock', { from: dateTime(data.from), to: dateTime(data.to) })
      case 'settings.license_usage_declared': {
        const usageLabel = (value: unknown) => te(`settings.license.usage.options.${text(value)}.label`)
          ? t(`settings.license.usage.options.${text(value)}.label`)
          : t('audit.details.licenseUsageNone')
        return data.from === data.to
          ? t('audit.details.licenseUsageConfirmed', { usage: usageLabel(data.to) })
          : t('audit.details.change', { from: usageLabel(data.from), to: usageLabel(data.to) })
      }
      default:
        return null
    }
  }

  return { actionLabel, actorName, actorDetails, projectName, details }
}
