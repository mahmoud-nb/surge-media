import {
  createUploadQueue,
  type UploadFields,
  type UploadItem,
  type UploadQueue,
  type UploadQueueOptions,
  type UploadRules,
} from '@surge-media/client'
import { computed, type ComputedRef, type MaybeRefOrGetter, onMounted, onScopeDispose, type Ref, ref, shallowRef, type ShallowRef, toValue, watch } from 'vue'
import { useSurgeMedia } from '../context'

export interface UseUploadRulesResult {
  /** Règles d'envoi de l'identifiant ; null sans droit d'envoi (ou tant qu'elles ne sont pas lues). */
  rules: ShallowRef<UploadRules | null>
  /** Première lecture terminée (réussie ou non) ; faux en rendu serveur. */
  ready: Ref<boolean>
  pending: Ref<boolean>
  error: ShallowRef<unknown>
  /** Relit les règles (envois restants, après un changement de jeton). */
  refresh: () => Promise<void>
}

/**
 * Règles d'envoi de l'identifiant du plugin (`GET /me`) : types acceptés et leur taille maximale, envois
 * restants, visibilité et dossier imposés. Lues au montage, dans le navigateur seulement ; `enabled` faux :
 * aucune lecture (règles fournies autrement).
 */
export function useUploadRules(enabled: MaybeRefOrGetter<boolean> = true): UseUploadRulesResult {
  const { client } = useSurgeMedia()
  const rules = shallowRef<UploadRules | null>(null)
  const ready = ref(false)
  const pending = ref(false)
  const error = shallowRef<unknown>(null)

  async function refresh(): Promise<void> {
    if (!toValue(enabled)) return
    if (!client) {
      ready.value = true
      return
    }
    pending.value = true
    try {
      rules.value = await client.uploadRules()
      error.value = null
    }
    catch (caught) {
      error.value = caught
    }
    finally {
      pending.value = false
      ready.value = true
    }
  }

  onMounted(() => void refresh())
  return { rules, ready, pending, error, refresh }
}

export interface UseUploadQueueOptions extends Omit<UploadQueueOptions, 'client' | 'rules'> {
  /** Règles d'envoi (pré-contrôle, envois restants), suivies si elles changent. */
  rules?: MaybeRefOrGetter<UploadRules | null | undefined>
}

export interface UseUploadQueueResult {
  /** Fichiers de la file (liste immuable, remplacée à chaque changement). */
  items: ShallowRef<readonly UploadItem[]>
  /** Un envoi est en cours ou prêt à partir. */
  busy: ComputedRef<boolean>
  /** File du client ; null sans client (plugin sans identifiant). */
  queue: UploadQueue | null
  add: (files: Iterable<Blob> | ArrayLike<Blob>, fields?: UploadFields) => UploadItem[]
  update: (id: string, fields: UploadFields) => void
  start: () => void
  cancel: (id: string) => void
  retry: (id: string) => void
  remove: (id: string) => void
  clear: () => void
}

/**
 * File d'envoi (`createUploadQueue` du client) rendue réactive : `items` suit chaque changement, la file
 * est détruite avec le composant (envois en cours interrompus). Sans client, les méthodes ne font rien.
 */
export function useUploadQueue(options: UseUploadQueueOptions = {}): UseUploadQueueResult {
  const { client } = useSurgeMedia()
  const items = shallowRef<readonly UploadItem[]>([])
  const queue = client ? createUploadQueue({ ...options, client, rules: toValue(options.rules) ?? null }) : null
  queue?.subscribe((next) => {
    items.value = next
  })
  watch(() => toValue(options.rules), next => queue?.setRules(next ?? null))
  onScopeDispose(() => queue?.destroy())

  return {
    items,
    busy: computed(() => {
      void items.value
      return queue?.busy ?? false
    }),
    queue,
    add: (files, fields) => queue?.add(files, fields) ?? [],
    update: (id, fields) => queue?.update(id, fields),
    start: () => queue?.start(),
    cancel: id => queue?.cancel(id),
    retry: id => queue?.retry(id),
    remove: id => queue?.remove(id),
    clear: () => queue?.clear(),
  }
}
