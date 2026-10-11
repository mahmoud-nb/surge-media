export interface FlashMessage {
  variant: 'success' | 'info' | 'warning' | 'error'
  /** Message déjà traduit. */
  message: string
  /** Données associées, ex. lien d'invitation à n'afficher qu'une fois. */
  payload?: Record<string, unknown>
}

/**
 * Message à afficher sur la page suivante (après une redirection), lu une seule fois.
 * Conservé en mémoire uniquement : il disparaît au rechargement, ce qui convient aux
 * informations à usage unique comme un lien d'invitation.
 */
export function useFlash() {
  const state = useState<FlashMessage | null>('flash', () => null)

  function set(message: FlashMessage) {
    state.value = message
  }

  /** Renvoie le message en attente et le retire. */
  function consume(): FlashMessage | null {
    const message = state.value
    state.value = null
    return message
  }

  return { set, consume }
}
