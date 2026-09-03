import { describe, expect, it } from 'vitest'
import { ProjectionWorkers } from '../src/worker-client.ts'

function options(palacePath: string) {
  return {
    source: {
      kind: 'mempalace' as const,
      palacePath,
      collectionName: 'unused',
      storageBackend: 'sqlite_exact',
      wing: 'unused',
    },
  }
}

describe('MemPalace projection worker lifecycle', () => {
  it('terminates a timed-out worker before rejecting the operation', async () => {
    const workers = new ProjectionWorkers(new URL('./fixtures/projection-worker.mjs', import.meta.url))
    await expect(workers.run({}, options('hang'), 20)).rejects.toThrow('projection timed out')
    await workers.dispose()
  })

  it('rejects a response-less exit and terminates in-flight work during disposal', async () => {
    const exitWorkers = new ProjectionWorkers(new URL('./fixtures/projection-worker.mjs', import.meta.url))
    await expect(exitWorkers.run({}, options('exit'), 1000)).rejects.toThrow('exited before responding (0)')
    await exitWorkers.dispose()

    const workers = new ProjectionWorkers(new URL('./fixtures/projection-worker.mjs', import.meta.url))
    const pending = workers.run({}, options('hang'), 1000)
    await workers.dispose()
    await expect(pending).rejects.toThrow('owner is disposed')
    await expect(workers.run({}, options('hang'), 1000)).rejects.toThrow('owner is disposed')
  })
})
