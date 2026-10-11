import { describe, expect, it } from 'vitest'
import { createSemaphore, QueueFullError } from '../server/lib/media/processing'

/** Promesse contrôlée de l'extérieur. */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('concurrence bornée des traitements', () => {
  it('au plus `concurrency` tâches simultanées, les suivantes attendent dans l\'ordre', async () => {
    const semaphore = createSemaphore({ concurrency: 2, queue: 10 })
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const started: number[] = []
    let running = 0
    let peak = 0
    const tasks = gates.map((gate, index) => semaphore.run(async () => {
      started.push(index)
      running++
      peak = Math.max(peak, running)
      await gate.promise
      running--
      return index
    }))

    await tick()
    expect(started).toEqual([0, 1])
    expect(semaphore.active).toBe(2)
    expect(semaphore.pending).toBe(2)

    gates[1]!.resolve()
    await tick()
    expect(started).toEqual([0, 1, 2])
    gates[0]!.resolve()
    gates[2]!.resolve()
    gates[3]!.resolve()
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3])
    expect(peak).toBe(2)
    expect(semaphore.active).toBe(0)
    expect(semaphore.pending).toBe(0)
  })

  it('file pleine : QueueFullError immédiate, sans bloquer les autres tâches', async () => {
    const semaphore = createSemaphore({ concurrency: 1, queue: 1 })
    const gate = deferred()
    const first = semaphore.run(() => gate.promise)
    const second = semaphore.run(async () => 'second')
    await expect(semaphore.run(async () => 'third')).rejects.toBeInstanceOf(QueueFullError)
    gate.resolve()
    await first
    expect(await second).toBe('second')
  })

  it('une tâche en échec libère sa place', async () => {
    const semaphore = createSemaphore({ concurrency: 1, queue: 0 })
    await expect(semaphore.run(async () => {
      throw new Error('échec')
    })).rejects.toThrow('échec')
    expect(semaphore.active).toBe(0)
    expect(await semaphore.run(async () => 'ok')).toBe('ok')
  })
})
