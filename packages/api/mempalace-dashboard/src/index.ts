/** MemPalace dashboard Host API over the shared Web connection channel. */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import {
  unavailableMemPalaceDashboard,
  type MemPalaceProjectionOptions,
} from './projection.ts'
import type { MemPalaceDashboardRequest, MemPalaceDashboardSnapshot } from './types.ts'
import { ProjectionWorkers } from './worker-client.ts'

export type * from './types.ts'
export { buildMemPalaceDashboard, normalizeRequest, unavailableMemPalaceDashboard } from './projection.ts'

/** Logical endpoint inside the shared `/api` RPC channel. */
export const MEMPALACE_DASHBOARD_ENDPOINT = 'mempalaceDashboard/inspect'

/** Loader id for the Host plugin. */
export const name = 'mempalace-dashboard'
/** Host services required by the plugin. */
export const inject = ['connection']

/** Host API configuration. */
export interface Config {
  /** Whether to register the read-only API. @default true */
  readonly enabled?: boolean
  /** Default read limit for drawers and timeline facts. @default 25 */
  readonly defaultLimit?: number
  /** Provider configuration resolution timeout in milliseconds. @default 5000 */
  readonly sourceTimeoutMs?: number
  /** Hard lifetime for one storage projection worker in milliseconds. @default 5000 */
  readonly projectionTimeoutMs?: number
  /** Maximum simultaneous storage projection workers. @default 4 */
  readonly maxConcurrentProjections?: number
}

/** Validate MemPalace dashboard configuration. */
export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  defaultLimit: Schema.number().step(1).min(1).max(100).default(25),
  sourceTimeoutMs: Schema.number().step(1).min(1).max(30_000).default(5000),
  projectionTimeoutMs: Schema.number().step(1).min(1).max(30_000).default(5000),
  maxConcurrentProjections: Schema.number().step(1).min(1).max(32).default(4),
})

/**
 * Register the authenticated read-only dashboard RPC endpoint.
 * @param ctx - Host context carrying the Connection registry.
 * @param config - bounded query configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  const options: MemPalaceProjectionOptions = {
    ...(config.defaultLimit === undefined ? {} : { defaultLimit: config.defaultLimit }),
  }
  const connection = ctx.connection
  const workers = new ProjectionWorkers(undefined, config.maxConcurrentProjections ?? 4)
  ctx.effect(() => async () => { await workers.dispose() }, 'mempalace-dashboard: projection workers')
  ctx.effect(() => connection.rpc.intercept(
    '/api',
    (endpoint: string) => endpoint === MEMPALACE_DASHBOARD_ENDPOINT,
    (_endpoint: string, payload: unknown, signal: AbortSignal) => inspect(
      ctx,
      workers,
      payload,
      options,
      config.sourceTimeoutMs ?? 5000,
      config.projectionTimeoutMs ?? 5000,
      signal,
    ),
  ), 'mempalace-dashboard: rpc endpoint')
}

async function inspect(
  ctx: Context,
  workers: ProjectionWorkers,
  payload: unknown,
  options: MemPalaceProjectionOptions,
  sourceTimeoutMs: number,
  projectionTimeoutMs: number,
  signal: AbortSignal,
): Promise<ConnectionRpcResult<MemPalaceDashboardSnapshot>> {
  const request = requestPayload(payload)
  try {
    const memory = ctx.get('memory')
    if (memory === undefined) {
      return {
        ok: true,
        value: unavailableMemPalaceDashboard(
          request,
          'memory-provider-not-found',
          'The native memory provider is not mounted.',
        ),
      }
    }
    const status = memory.status()
    if (status.backend !== 'mempalace') {
      return {
        ok: true,
        value: unavailableMemPalaceDashboard(
          request,
          'memory-provider-unsupported',
          'The configured memory backend is not mempalace.',
        ),
      }
    }
    const source = await memory.inspectionSource(AbortSignal.any([
      signal,
      AbortSignal.timeout(sourceTimeoutMs),
    ]))
    if (source?.kind !== 'mempalace') {
      return {
        ok: true,
        value: unavailableMemPalaceDashboard(
          request,
          'memory-provider-unsupported',
          'The configured memory provider does not expose a local MemPalace inspection source.',
        ),
      }
    }
    try {
      return {
        ok: true,
        value: await workers.run(request, { ...options, source, providerStatus: status }, projectionTimeoutMs, signal),
      }
    } catch {
      return {
        ok: true,
        value: unavailableMemPalaceDashboard(
          request,
          'memory-projection-unavailable',
          'The MemPalace storage projection could not complete.',
        ),
      }
    }
  } catch (error) {
    return {
      ok: true,
      value: unavailableMemPalaceDashboard(
        request,
        'memory-provider-unavailable',
        safeProviderMessage(error),
      ),
    }
  }
}

function safeProviderMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return 'The memory provider did not resolve its inspection source before the timeout.'
  }
  return 'The memory provider could not resolve its inspection source.'
}

function requestPayload(payload: unknown): MemPalaceDashboardRequest {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {}
  const record = payload as Record<string, unknown>
  return {
    ...(typeof record.wing === 'string' ? { wing: record.wing } : {}),
    ...(typeof record.room === 'string' ? { room: record.room } : {}),
    ...(typeof record.query === 'string' ? { query: record.query } : {}),
    ...(typeof record.limit === 'number' ? { limit: record.limit } : {}),
  }
}
