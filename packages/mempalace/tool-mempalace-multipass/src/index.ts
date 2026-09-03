/**
 * Model-facing MemPalace multipass graph explorer.
 * @module @deepseek-ai/dsh-tool-mempalace-multipass
 */

import { readFile, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { normalizeMemPalaceBuildGraph } from './normalize.ts'
import { MEMPALACE_MULTIPASS_FORMAT } from './types.ts'
import type { MultipassGraphExport } from './types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-mempalace-multipass'

/** Services required by the MemPalace multipass tool. */
export const inject = ['tools']

/** Default cooperative timeout budget for graph file reads and normalization. */
export const DEFAULT_TIMEOUT_MS = 10_000

/** Default maximum JSON file size accepted by the file-backed workflow. */
export const DEFAULT_MAX_GRAPH_BYTES = 5_000_000

/** Default maximum normalized room count accepted by one operation. */
export const DEFAULT_MAX_ROOMS = 500

/** Default maximum BFS hop count for multi-hop exploration. */
export const DEFAULT_MAX_HOPS = 2

/** Plugin config for local graph ingestion bounds and default exploration depth. */
export interface Config {
  /** Cooperative timeout budget in milliseconds. Defaults to 10000. */
  timeoutMs?: number
  /** Maximum JSON file size accepted by `graph_json_path`. Defaults to 5000000. */
  maxGraphBytes?: number
  /** Maximum number of normalized MemPalace rooms accepted by one call. Defaults to 500. */
  maxRooms?: number
  /** Default hop depth when a call supplies `start_room` without `max_hops`. Defaults to 2. */
  defaultMaxHops?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
  maxGraphBytes: z.number().step(1).min(1).default(DEFAULT_MAX_GRAPH_BYTES),
  maxRooms: z.number().step(1).min(1).default(DEFAULT_MAX_ROOMS),
  defaultMaxHops: z.number().step(1).min(0).default(DEFAULT_MAX_HOPS),
})

interface ResolvedConfig {
  readonly timeoutMs: number
  readonly maxGraphBytes: number
  readonly maxRooms: number
  readonly defaultMaxHops: number
}

const OUTPUT_SCHEMA = { type: 'json' as const }

/** Register `mempalace_multipass_explore`. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.tools.register(defineTool({
    name: 'mempalace_multipass_explore',
    description:
      'Normalize MemPalace build_graph-compatible JSON and explore room-to-room paths across shared wings. '
      + 'Provide exactly one of graph_json (an object with nodes/edges or a [nodes, edges] array) or graph_json_path '
      + '(a local JSON file already produced outside DSH). This tool does not execute MemPalace or arbitrary code.',
    parameters: {
      graph_json: { type: 'json', description: 'MemPalace build_graph-compatible JSON: either {nodes, edges} or [nodes, edges].' },
      graph_json_path: { type: 'string', description: 'Local path to a JSON file containing MemPalace build_graph-compatible JSON.' },
      start_room: { type: 'string', description: 'Optional room to use as the multi-hop exploration start.' },
      max_hops: { type: 'integer', description: `Optional BFS hop depth. Defaults to ${resolved.defaultMaxHops}.` },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
      presentationMeta: (_args: unknown, value: JsonValue) => value,
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    execute: async (args: unknown, exec: ToolRunContext): Promise<JsonValue> => {
      const input = await resolveInput(args, exec.signal, resolved.maxGraphBytes)
      const maxHops = resolveMaxHops(args, resolved.defaultMaxHops)
      const exportGraph = normalizeMemPalaceBuildGraph(input.graph, {
        source: input.source,
        startRoom: optionalString(args, 'start_room'),
        maxHops,
        maxRooms: resolved.maxRooms,
      })
      return exportGraph as unknown as JsonValue
    },
    presentCall: (args: unknown) => ({
      card: 'generic',
      title: 'Explore MemPalace graph',
      kind: 'search',
      rawInput: args,
    }),
    presentResult: (_args: unknown, result: ToolResult) => ({
      card: 'generic',
      title: result.isError ? 'MemPalace graph exploration failed' : 'MemPalace graph exploration',
      content: result.content,
    }),
  }))
}

/** Re-export stable graph-normalization helpers for package consumers and tests. */
export { MEMPALACE_MULTIPASS_FORMAT, normalizeMemPalaceBuildGraph }
export type { MultipassGraphExport }

type ToolArgs = Record<string, unknown>

function resolveConfig(config: Config): ResolvedConfig {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxGraphBytes = config.maxGraphBytes ?? DEFAULT_MAX_GRAPH_BYTES
  const maxRooms = config.maxRooms ?? DEFAULT_MAX_ROOMS
  const defaultMaxHops = config.defaultMaxHops ?? DEFAULT_MAX_HOPS
  assertPositiveSafeInteger('timeoutMs', timeoutMs)
  assertPositiveSafeInteger('maxGraphBytes', maxGraphBytes)
  assertPositiveSafeInteger('maxRooms', maxRooms)
  if (!Number.isSafeInteger(defaultMaxHops) || defaultMaxHops < 0) throw new Error('tool-mempalace-multipass: defaultMaxHops must be a non-negative safe integer')
  return { timeoutMs, maxGraphBytes, maxRooms, defaultMaxHops }
}

function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`tool-mempalace-multipass: ${name} must be a positive safe integer`)
}

async function resolveInput(args: unknown, signal: AbortSignal, maxGraphBytes: number): Promise<{ readonly graph: unknown; readonly source: 'direct' | 'file' }> {
  const record = asArgs(args)
  const hasDirect = record.graph_json !== undefined
  const hasPath = record.graph_json_path !== undefined
  if (hasDirect === hasPath) throw new Error('mempalace_multipass: provide exactly one of graph_json or graph_json_path')
  if (hasDirect) return { graph: record.graph_json, source: 'direct' }
  const path = requiredString(record, 'graph_json_path')
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`mempalace_multipass: graph_json_path is not a file: ${path}`)
  if (info.size > maxGraphBytes) {
    throw new Error(`mempalace_multipass: graph_json_path is ${info.size} bytes, above configured maxGraphBytes ${maxGraphBytes}`)
  }
  const text = await readFile(path, { encoding: 'utf8', signal })
  return { graph: JSON.parse(text) as unknown, source: 'file' }
}

function resolveMaxHops(args: unknown, defaultMaxHops: number): number {
  const value = asArgs(args).max_hops
  if (value === undefined) return defaultMaxHops
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('mempalace_multipass: max_hops must be a non-negative safe integer')
  return value
}

function optionalString(args: unknown, key: string): string | undefined {
  const value = asArgs(args)[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`mempalace_multipass: ${key} must be a non-empty string`)
  return value.trim()
}

function requiredString(record: ToolArgs, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`mempalace_multipass: ${key} must be a non-empty string`)
  return value.trim()
}

function asArgs(args: unknown): ToolArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('mempalace_multipass: arguments must be an object')
  return args as ToolArgs
}
