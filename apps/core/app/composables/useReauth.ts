/**
 * Confirmation du mot de passe avant une action sensible (« mode sudo », shared/utils/auth.ts).
 * `run(action)` exécute l'action ; si l'API répond 403 REAUTH_REQUIRED, la boîte de dialogue
 * <AdminReauthDialog> (mise en page d'administration) demande le mot de passe, puis l'action est
 * rejouée une fois. Si l'utilisateur annule, `run` lève ReauthCancelledError : l'appelant se
 * contente alors de ne rien afficher (isReauthCancelled).
 *
 *   try { await reauth.run(() => $api('/api/admin/tokens', { method: 'POST', body })) }
 *   catch (error) { if (isReauthCancelled(error)) return; … }
 */

export class ReauthCancelledError extends Error {
  constructor() {
    super('Password confirmation cancelled')
    this.name = 'ReauthCancelledError'
  }
}

export function isReauthCancelled(error: unknown): boolean {
  return error instanceof ReauthCancelledError
}

// Demande en cours (navigateur uniquement : les actions ne s'exécutent jamais au rendu serveur).
let pending: ((confirmed: boolean) => void) | null = null

export function useReauth() {
  const open = useState('reauth-open', () => false)

  function request(): Promise<boolean> {
    pending?.(false)
    open.value = true
    return new Promise((resolve) => {
      pending = resolve
    })
  }

  /** Termine la demande : true = mot de passe confirmé, false = annulée. */
  function settle(confirmed: boolean) {
    const resolve = pending
    pending = null
    open.value = false
    resolve?.(confirmed)
  }

  async function run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    }
    catch (error) {
      if (apiError(error).code !== 'REAUTH_REQUIRED') throw error
      if (!(await request())) throw new ReauthCancelledError()
      return action()
    }
  }

  return { open, run, settle }
}
