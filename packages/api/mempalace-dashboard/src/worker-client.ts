/** Worker-thread execution for blocking SQLite dashboard projections. */

import { Worker } from 'node:worker_threads'
import type { MemPalaceProjectionOptions } from './projection.ts'
import type { MemPalaceDashboardRequest, MemPalaceDashboardSnapshot } from './types.ts'

interface WorkerResponse {
  readonly ok: boolean
  readonly value?: MemPalaceDashboardSnapshot
  readonly error?: string
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  return typeof value === 'object' && value !== null && 'ok' in value
    && typeof value.ok === 'boolean'
}

interface ActiveProjection {
  abort(error: Error): Promise<void>
}

/** Owns the finite set of in-flight one-shot projection workers. */
export class ProjectionWorkers {
  private readonly active = new Set<ActiveProjection>()
  private disposed = false

  constructor(
    private readonly workerUrl = new URL('./projection-worker.js', import.meta.url),
    private readonly maxConcurrent = 4,
  ) {}

  /**
   * Run one blocking projection outside the Host event loop.
   * @param request - normalized by the worker projection.
   * @param options - provider-owned source and bounded defaults.
   * @param timeoutMs - hard worker lifetime limit.
   * @param signal - request cancellation that terminates the worker.
   * @returns the projected snapshot after the worker has terminated.
   */
  async run(
    request: MemPalaceDashboardRequest,
    options: MemPalaceProjectionOptions,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<MemPalaceDashboardSnapshot> {
    if (this.disposed) throw new Error('MemPalace projection worker owner is disposed')
    signal?.throwIfAborted()
    if (this.active.size >= this.maxConcurrent) throw new Error('MemPalace projection capacity is busy')
    const worker = new Worker(this.workerUrl, {
      workerData: { request, options },
    })
    return await new Promise<MemPalaceDashboardSnapshot>((resolve, reject) => {
      let settled = false
      const finish = async (settle: () => void): Promise<void> => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        worker.removeAllListeners()
        try {
          await worker.terminate()
        } finally {
          this.active.delete(operation)
          settle()
        }
      }
      const operation: ActiveProjection = {
        abort: async (error) => { await finish(() => { reject(error) }) },
      }
      this.active.add(operation)
      const onAbort = (): void => {
        void operation.abort(new Error('MemPalace projection cancelled'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => {
        void operation.abort(new Error('MemPalace projection timed out'))
      }, timeoutMs)
      worker.once('message', (message: unknown) => {
        void finish(() => {
          if (!isWorkerResponse(message)) {
            reject(new Error('MemPalace projection worker emitted an invalid response'))
          } else if (message.ok && message.value !== undefined) {
            resolve(message.value)
          } else {
            reject(new Error(message.error ?? 'MemPalace projection worker failed'))
          }
        })
      })
      worker.once('error', (error) => { void finish(() => { reject(error) }) })
      worker.once('exit', (code) => {
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
    await Promise.all(operations.map(async (operation) => {
      await operation.abort(new Error('MemPalace projection worker owner is disposed'))
    }))
  }
}
