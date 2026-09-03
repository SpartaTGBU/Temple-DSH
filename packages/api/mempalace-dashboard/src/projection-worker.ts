/** One-shot worker entry for synchronous SQLite and bounded sidecar inspection. */

import { parentPort, workerData } from 'node:worker_threads'
import { buildMemPalaceDashboard, type MemPalaceProjectionOptions } from './projection.ts'
import type { MemPalaceDashboardRequest } from './types.ts'

interface ProjectionWorkerData {
  readonly request: MemPalaceDashboardRequest
  readonly options: MemPalaceProjectionOptions
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function main(data: unknown): void {
  if (!isRecord(data) || !isRecord(data.request) || !isRecord(data.options)) {
    throw new TypeError('MemPalace projection worker received invalid data')
  }
  const value = buildMemPalaceDashboard(
    data.request as MemPalaceDashboardRequest,
    data.options as MemPalaceProjectionOptions,
  )
  parentPort?.postMessage({ ok: true, value })
}

try {
  main(workerData as ProjectionWorkerData)
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : 'MemPalace projection failed',
  })
}
