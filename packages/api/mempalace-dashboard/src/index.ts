/** MemPalace dashboard Host API over the shared Web connection channel. */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { ConnectionRpcResult, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { buildMemPalaceDashboard, type MemPalaceProjectionOptions } from './projection.ts'
import { MEMPALACE_DASHBOARD_ENDPOINT, type MemPalaceDashboardRequest, type MemPalaceDashboardSnapshot } from './types.ts'

export type * from './types.ts'
export { buildMemPalaceDashboard, normalizeRequest } from './projection.ts'

/** Loader id for the Host plugin. */
export const name = 'mempalace-dashboard'
/** Host services required by the plugin. */
export const inject = ['connection']

/** Host API configuration. */
export interface Config {
  /** Whether to register the read-only API. @default true */
  readonly enabled?: boolean
  /** Optional MemPalace palace directory. Defaults to MemPalace config/env. */
  readonly palacePath?: string
  /** Optional MemPalace config JSON path. Defaults to ~/.mempalace/config.json. */
  readonly configPath?: string
  /** Default read limit for drawers and timeline facts. @default 25 */
  readonly defaultLimit?: number
}

/** Validate MemPalace dashboard configuration. */
export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  palacePath: Schema.string(),
  configPath: Schema.string(),
  defaultLimit: Schema.number().step(1).min(1).max(100).default(25),
})


/**
 * Register the authenticated read-only dashboard RPC endpoint.
 * @param ctx - Host context carrying the Connection registry.
 * @param config - optional path and limit overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  const options: MemPalaceProjectionOptions = {
    ...(config.palacePath === undefined ? {} : { palacePath: config.palacePath }),
    ...(config.configPath === undefined ? {} : { configPath: config.configPath }),
    ...(config.defaultLimit === undefined ? {} : { defaultLimit: config.defaultLimit }),
  }
  const connection = Reflect.get(ctx, 'connection') as HostConnectionHandle
  ctx.effect(() => connection.rpc.intercept(
    '/api',
    (endpoint: string) => endpoint === MEMPALACE_DASHBOARD_ENDPOINT,
    (_endpoint: string, payload: unknown) => Promise.resolve(inspect(payload, options)),
  ), 'mempalace-dashboard: rpc endpoint')
}

function inspect(
  payload: unknown,
  options: MemPalaceProjectionOptions,
): ConnectionRpcResult<MemPalaceDashboardSnapshot> {
  try {
    return { ok: true, value: buildMemPalaceDashboard(requestPayload(payload), options) }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'mempalace-dashboard-failed',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    }
  }
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
