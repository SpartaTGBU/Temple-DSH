/** Worker-thread execution for blocking SQLite dashboard projections. */

import { Worker } from 'node:worker_threads'
import type { MemPalaceProjectionOptions } from './projection.ts'
import type { MemPalaceDashboardRequest, MemPalaceDashboardSnapshot } from './types.ts'

interface WorkerResponse {
  readonly ok: boolean
  readonly value?: MemPalaceDashboardSnapshot
  readonly error?: string
}

interface ActiveProjection {
  abort(error: Error): Promise<void>
}

/** Owns the finite set of in-flight one-shot projection workers. */
export class ProjectionWorkers {
  private readonly active = new Set<ActiveProjection>()
  private disposed = false

  constructor(private readonly workerUrl = new URL('./projection-worker.js', import.meta.url)) {}

  /**
   * Run one blocking projection outside the Host event loop.
   * @param request - normalized by the worker projection.
   * @param options - provider-owned source and bounded defaults.
   * @param timeoutMs - hard worker lifetime limit.
   * @returns the projected snapshot after the worker has terminated.
   */
  async run(
    request: MemPalaceDashboardRequest,
    options: MemPalaceProjectionOptions,
    timeoutMs: number,
  ): Promise<MemPalaceDashboardSnapshot> {
    if (this.disposed) throw new Error('MemPalace projection worker owner is disposed')
    const worker = new Worker(this.workerUrl, {
      workerData: { request, options },
    })
    return await new Promise<MemPalaceDashboardSnapshot>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const finish = async (settle: () => void): Promise<void> => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker.removeAllListeners()
        try {
          await worker.terminate()
        } finally {
          this.active.delete(operation)
          settle()
        }
      }
      const operation: ActiveProjection = {
        abort: async error => { await finish(() => { reject(error) }) },
      }
      this.active.add(operation)
      timer = setTimeout(() => {
        void operation.abort(new Error('MemPalace projection timed out'))
      }, timeoutMs)
      worker.once('message', (message: unknown) => {
        const response = message as WorkerResponse
        void finish(() => {
          if (response?.ok === true && response.value !== undefined) resolve(response.value)
          else reject(new Error(response?.error ?? 'MemPalace projection worker failed'))
        })
      })
      worker.once('error', error => { void finish(() => { reject(error) }) })
      worker.once('exit', code => {
        void finish(() => {
          reject(new Error(`MemPalace projection worker exited before responding (${String(code)})`))
        })
      })
    })
  }

  /** Terminate every in-flight worker, settle its operation, and reject future work. */
  async dispose(): Promise<void> {
    this.disposed = true
    const operations = [...this.active]
    await Promise.all(operations.map(async operation => {
      await operation.abort(new Error('MemPalace projection worker owner is disposed'))
    }))
  }
}
