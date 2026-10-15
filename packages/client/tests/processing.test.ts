import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SurgeClient } from '../src/client'
import { SurgeApiError } from '../src/errors'
import { isProcessing, watchMedia } from '../src/processing'
import type { Media } from '../src/types'
import { videoMedia } from './fixtures'

const pending: Media = { ...videoMedia, sources: [], processing: { status: 'pending', progress: null, error: null, updatedAt: '2026-10-15T10:00:00.000Z' } }
const running: Media = { ...pending, processing: { status: 'processing', progress: 0.4, error: null, updatedAt: '2026-10-15T10:00:30.000Z' } }

function clientReturning(responses: (Media | Error)[]): { client: SurgeClient, get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('Unexpected request')
    if (next instanceof Error) throw next
    return next
  })
  return { client: { media: { get } } as unknown as SurgeClient, get }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('suivi du traitement d\'une vidéo', () => {
  it('états en cours', () => {
    expect(isProcessing(pending)).toBe(true)
    expect(isProcessing(running)).toBe(true)
    expect(isProcessing(videoMedia)).toBe(false)
  })

  it('relit tant que la vidéo est en cours, signale chaque changement, s\'arrête quand elle est prête', async () => {
    vi.useFakeTimers()
    const { client, get } = clientReturning([running, running, videoMedia])
    const updates: Media[] = []
    const done = watchMedia(client, pending, { intervalMs: 1000, onUpdate: media => updates.push(media) })
    await vi.advanceTimersByTimeAsync(3500)
    await done
    expect(get).toHaveBeenCalledTimes(3)
    expect(updates.map(media => media.processing?.status)).toEqual(['processing', 'ready'])
  })

  it('erreur passagère : nouvel essai ; média introuvable : arrêt signalé', async () => {
    vi.useFakeTimers()
    const notFound = new SurgeApiError({ status: 404, code: 'MEDIA_NOT_FOUND' })
    const { client, get } = clientReturning([new SurgeApiError({ status: 503, code: 'SERVER_BUSY', retryAfter: 2 }), notFound])
    const onError = vi.fn()
    const done = watchMedia(client, pending, { intervalMs: 1000, onUpdate: () => {}, onError })
    await vi.advanceTimersByTimeAsync(5000)
    await done
    expect(get).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith(notFound)
  })

  it('arrêt par signal', async () => {
    vi.useFakeTimers()
    const { client, get } = clientReturning([])
    const controller = new AbortController()
    const done = watchMedia(client, pending, { intervalMs: 1000, signal: controller.signal, onUpdate: () => {} })
    controller.abort()
    await vi.advanceTimersByTimeAsync(2000)
    await done
    expect(get).not.toHaveBeenCalled()
  })
})
