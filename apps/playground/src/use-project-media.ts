import type { Media, MediaKind, MediaVisibility } from '@surge-media/client'
import { useSurgeMedia } from '@surge-media/vue'
import { onMounted, ref, shallowRef } from 'vue'

/** Médias du projet de test (jeton délégué du plugin), filtrés par genre et visibilité. */
export function useProjectMedia(kind: MediaKind, visibility?: MediaVisibility) {
  const { client } = useSurgeMedia()
  const items = shallowRef<Media[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)
  onMounted(async () => {
    try {
      items.value = client ? (await client.media.list({ kind, visibility, limit: 50 })).items : []
    }
    catch (caught) {
      error.value = client?.errorMessage(caught) ?? String(caught)
    }
    finally {
      loading.value = false
    }
  })
  return { items, loading, error }
}
