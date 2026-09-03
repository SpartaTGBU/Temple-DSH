/**
 * Model-facing Graphify tools over the external `graphify` CLI. The plugin
 * validates session-workspace containment, builds argv arrays without a shell,
 * forwards cancellation to `ctx.subprocess`, and parses collected stdout/stderr
 * into deterministic JSON results.
 * @module @deepseek-ai/dsh-tool-graphify
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { CollectedOutput, SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { Agent } from '@deepseek-ai/dsh-agent'

export const name = 'tool-graphify'
export const inject = ['tools', 'subprocess']

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_TIMEOUT_MS = 600_000
const DEFAULT_MAX_OUTPUT_BYTES = 128_000
const DEFAULT_GRACE_MS = 3_000
const GRAPHIFY_OUT = 'graphify-out'
const GRAPH_JSON = 'graph.json'

/** Model-facing Graphify plugin configuration. */
export interface Config {
  /** Bare command or absolute executable path for the Graphify CLI. */
  binaryPath?: string
  /** Fixed arguments inserted after the resolved executable and before Graphify operation arguments. */
  binaryArgs?: string[]
  /** Fallback workspace root used only when the caller has no agent session cwd. */
  workspaceRoot?: string
  /** Default timeout for each CLI operation, in milliseconds. */
  timeoutMs?: number
  /** Maximum accepted per-call timeout override, in milliseconds. */
  maxTimeoutMs?: number
  /** Per-stream collected output cap. */
  maxOutputBytes?: number
  /** SIGTERM-to-SIGKILL grace period used by the subprocess provider. */
  graceMs?: number
}

/** Runtime configuration schema for the Graphify tool plugin. */
export const Config: z<Config> = z.object({
  binaryPath: z.string().default('graphify'),
  binaryArgs: z.array(z.string()).default([]),
  workspaceRoot: z.string(),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxTimeoutMs: z.number().default(DEFAULT_MAX_TIMEOUT_MS),
  maxOutputBytes: z.number().default(DEFAULT_MAX_OUTPUT_BYTES),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
})

type ResolvedConfig = Required<Omit<Config, 'workspaceRoot'>> & Pick<Config, 'workspaceRoot'>

interface GraphifyIndexArgs {
  operation: 'index' | 'update'
  path?: string
  timeoutMs?: number
  code_only?: boolean
  no_viz?: boolean
}

interface GraphifyQueryArgs {
  operation: 'query' | 'explain' | 'path'
  question?: string
  node?: string
  source?: string
  target?: string
  budget?: number
  dfs?: boolean
  context?: string[]
  timeoutMs?: number
}

interface CliRunResult {
  kind: 'index' | 'query'
  operation: string
  workspaceRoot: string
  targetPath?: string
  graphPath?: string
  argv: string[]
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  stdout: CollectedOutput
  stderr: CollectedOutput
}

/** Stable error for calls that name a path outside the owning workspace. */
export class GraphifyWorkspaceEscapeError extends Error {
  /**
   * @param requested - Caller-supplied path.
   * @param workspaceRoot - Canonical workspace root.
   */
  constructor(readonly requested: string, readonly workspaceRoot: string) {
    super(`graphify path ${JSON.stringify(requested)} escapes workspace ${JSON.stringify(workspaceRoot)}`)
    this.name = 'GraphifyWorkspaceEscapeError'
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`tool-graphify: ${name} must be a positive finite number`)
  }
}

function resolveTimeout(argsTimeout: number | undefined, config: ResolvedConfig): number {
  if (argsTimeout !== undefined) assertPositiveFinite('timeoutMs', argsTimeout)
  const timeoutMs = argsTimeout ?? config.timeoutMs
  return Math.min(timeoutMs, config.maxTimeoutMs)
}

function isInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function existingDirectory(path: string, field: string): Promise<string> {
  const canonical = await realpath(path)
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new Error(`tool-graphify: ${field} must be an existing directory`)
  return canonical
}

async function workspaceRootFor(agent: Agent | undefined, config: ResolvedConfig): Promise<string> {
  const raw = agent?.session.header.cwd ?? config.workspaceRoot ?? process.cwd()
  return existingDirectory(raw, 'workspaceRoot')
}

/**
 * Resolve a caller path against a canonical workspace and reject escapes.
 * @param workspaceRoot - Canonical workspace root.
 * @param requested - Relative or absolute path supplied by a model call.
 * @returns Existing canonical directory inside the workspace.
 */
export async function resolveGraphifyTarget(workspaceRoot: string, requested: string | undefined): Promise<string> {
  const input = requested === undefined || requested.trim() === '' ? '.' : requested
  const candidate = isAbsolute(input) ? input : resolve(workspaceRoot, input)
  const canonical = await existingDirectory(candidate, 'path')
  if (!isInside(workspaceRoot, canonical)) throw new GraphifyWorkspaceEscapeError(input, workspaceRoot)
  return canonical
}

async function graphPathFor(workspaceRoot: string): Promise<string> {
  const outDir = resolve(workspaceRoot, GRAPHIFY_OUT)
  const graphPath = resolve(outDir, GRAPH_JSON)
  if (!isInside(workspaceRoot, graphPath)) throw new Error('tool-graphify: internal graph path escaped workspace')
  await access(graphPath, constants.R_OK)
  return graphPath
}

function output(reader: SubprocessHandle['collected']['stdout']): CollectedOutput {
  if (reader === undefined) throw new Error('tool-graphify: subprocess dropped a requested collect stream')
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...read.spillPath !== undefined ? { spillPath: read.spillPath } : {},
  }
}

function abortError(): HarnessError {
  const error = new HarnessError('tool call aborted', TOOL_ABORTED)
  error.name = 'AbortError'
  return error
}

async function resolveBinary(ctx: Context, config: ResolvedConfig, signal: AbortSignal): Promise<string> {
  try {
    return await ctx.subprocess.resolveExecutable(config.binaryPath, { GRAPHIFY_QUERY_LOG_DISABLE: '1' }, signal)
  } catch (error) {
    if (signal.aborted) throw abortError()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`graphify CLI unavailable: ${message}. Install the PyPI package 'graphifyy' or set tool-graphify.binaryPath.`)
  }
}

async function runCli(
  ctx: Context,
  config: ResolvedConfig,
  execSignal: AbortSignal,
  workspaceRoot: string,
  argvTail: readonly string[],
  timeoutMs: number,
): Promise<Omit<CliRunResult, 'kind' | 'operation' | 'workspaceRoot' | 'argv'>> {
  if (execSignal.aborted) throw abortError()
  const fused = new AbortController()
  let timedOut = false
  let aborted = false
  const onAbort = (): void => {
    aborted = true
    fused.abort()
  }
  const timer = setTimeout(() => {
    timedOut = true
    fused.abort()
  }, timeoutMs)
  execSignal.addEventListener('abort', onAbort, { once: true })
  const command = await resolveBinary(ctx, config, fused.signal)
  const handle = ctx.subprocess.spawn({
    argv: [command, ...config.binaryArgs, ...argvTail],
    cwd: workspaceRoot,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: config.maxOutputBytes },
      stderr: { maxBytes: config.maxOutputBytes },
    },
    graceMs: config.graceMs,
    signal: fused.signal,
    env: { GRAPHIFY_QUERY_LOG_DISABLE: '1' },
  })
  try {
    const outcome = await handle.done
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      aborted,
      stdout: output(handle.collected.stdout),
      stderr: output(handle.collected.stderr),
    }
  } finally {
    clearTimeout(timer)
    execSignal.removeEventListener('abort', onAbort)
  }
}

function renderCliResult(value: CliRunResult): string {
  const stdout = value.stdout.text.trimEnd()
  const stderr = value.stderr.text.trimEnd()
  if (value.exitCode === 0 && value.signal === null && !value.timedOut && !value.aborted) {
    if (stdout.length > 0) return stdout
    return `${value.operation} completed.`
  }
  const lines = [`graphify ${value.operation} failed.`]
  if (stdout.length > 0) lines.push(stdout)
  if (stderr.length > 0) lines.push('[stderr]', stderr)
  if (value.timedOut) lines.push('[timed out after argv timeout]')
  if (value.aborted) lines.push('[aborted]')
  if (value.signal !== null) lines.push(`[killed by signal: ${value.signal}]`)
  if (value.exitCode !== null) lines.push(`[exit code: ${value.exitCode}]`)
  return lines.join('\n')
}

function assertQueryArgs(args: GraphifyQueryArgs): void {
  switch (args.operation) {
    case 'query':
      if (args.question === undefined || args.question.trim() === '') throw new Error('question is required for graphify query')
      break
    case 'explain':
      if (args.node === undefined || args.node.trim() === '') throw new Error('node is required for graphify explain')
      break
    case 'path':
      if (args.source === undefined || args.source.trim() === '' || args.target === undefined || args.target.trim() === '') {
        throw new Error('source and target are required for graphify path')
      }
      break
    default:
      throw new Error('operation must be query, explain, or path')
  }
}

const streamSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    spillPath: { type: 'string' },
  },
} as const

const cliOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['index', 'query'] },
    operation: { type: 'string', required: true },
    workspaceRoot: { type: 'string', required: true },
    targetPath: { type: 'string' },
    graphPath: { type: 'string' },
    argv: { type: 'array', required: true, items: { type: 'string' } },
    exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
    signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    timedOut: { type: 'boolean', required: true },
    aborted: { type: 'boolean', required: true },
    stdout: { ...streamSchema, required: true },
    stderr: { ...streamSchema, required: true },
  },
} as const

/** Register `graphify_index` and `graphify_query` model-facing tools. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = config as ResolvedConfig
  assertPositiveFinite('timeoutMs', resolved.timeoutMs)
  assertPositiveFinite('maxTimeoutMs', resolved.maxTimeoutMs)
  assertPositiveFinite('maxOutputBytes', resolved.maxOutputBytes)
  assertPositiveFinite('graceMs', resolved.graceMs)

  ctx.tools.register(defineTool({
    name: 'graphify_index',
    description: 'Build or update the current workspace Graphify code graph. Use index for the first build and update after source changes. Paths must stay inside the session workspace.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['index', 'update'], description: 'index builds graphify-out/graph.json; update refreshes changed files in an existing graph.' },
      path: { type: 'string', description: `Workspace-relative directory to index. Defaults to ${JSON.stringify('.')}.` },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds, capped by plugin config.' },
      code_only: { type: 'boolean', description: 'For index only, pass --code-only. Defaults true to avoid LLM-backed document/media extraction.' },
      no_viz: { type: 'boolean', description: 'For index only, pass --no-viz. Defaults true to avoid writing graph.html.' },
    },
    output: { schema: cliOutputSchema, render: (_args: unknown, value: JsonValue) => [{ type: 'text', text: renderCliResult(value as unknown as CliRunResult) }] },
    async execute(args: GraphifyIndexArgs, exec: ToolRunContext) {
      const workspaceRoot = await workspaceRootFor(exec.agent, resolved)
      const targetPath = await resolveGraphifyTarget(workspaceRoot, args.path)
      const argv = args.operation === 'index'
        ? [
          'extract',
          targetPath,
          ...((args.code_only ?? true) ? ['--code-only'] : []),
          ...((args.no_viz ?? true) ? ['--no-viz'] : []),
        ]
        : ['update', targetPath]
      const result = await runCli(ctx, resolved, exec.signal, workspaceRoot, argv, resolveTimeout(args.timeoutMs, resolved))
      return { kind: 'index' as const, operation: args.operation, workspaceRoot, targetPath, argv, ...result }
    },
    presentCall: (args: GraphifyIndexArgs) => ({ card: 'generic', title: `Graphify ${args.operation}`, kind: 'execute', rawInput: args as unknown as JsonValue }),
    isConcurrencySafe: () => false,
  }))

  ctx.tools.register(defineTool({
    name: 'graphify_query',
    description: 'Query the current workspace Graphify graph. Use query for broad questions, explain for one node, and path to trace a relationship between two nodes.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['query', 'explain', 'path'], description: 'Graphify read operation.' },
      question: { type: 'string', description: 'Required for operation=query.' },
      node: { type: 'string', description: 'Required for operation=explain.' },
      source: { type: 'string', description: 'Required for operation=path.' },
      target: { type: 'string', description: 'Required for operation=path.' },
      budget: { type: 'integer', description: 'Approximate token budget for query output.' },
      dfs: { type: 'boolean', description: 'For operation=query, use DFS instead of BFS.' },
      context: { type: 'array', items: { type: 'string' }, description: 'For operation=query, relation contexts such as call, import, field, parameter_type, return_type, or generic_arg.' },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds, capped by plugin config.' },
    },
    output: { schema: cliOutputSchema, render: (_args: unknown, value: JsonValue) => [{ type: 'text', text: renderCliResult(value as unknown as CliRunResult) }] },
    async execute(args: GraphifyQueryArgs, exec: ToolRunContext) {
      assertQueryArgs(args)
      const workspaceRoot = await workspaceRootFor(exec.agent, resolved)
      const graphPath = await graphPathFor(workspaceRoot)
      let argv: string[]
      switch (args.operation) {
        case 'query':
          argv = ['query', args.question as string]
          if (args.dfs === true) argv.push('--dfs')
          if (args.budget !== undefined) argv.push('--budget', String(args.budget))
          for (const context of args.context ?? []) argv.push('--context', context)
          argv.push('--graph', graphPath)
          break
        case 'explain':
          argv = ['explain', args.node as string, '--graph', graphPath]
          break
        case 'path':
          argv = ['path', args.source as string, args.target as string, '--graph', graphPath]
          break
      }
      const result = await runCli(ctx, resolved, exec.signal, workspaceRoot, argv, resolveTimeout(args.timeoutMs, resolved))
      const value = { kind: 'query' as const, operation: args.operation, workspaceRoot, graphPath, argv, ...result }
      if (value.aborted) throw abortError()
      return value
    },
    presentCall: (args: GraphifyQueryArgs) => ({ card: 'generic', title: `Graphify ${args.operation}`, kind: 'search', rawInput: args as unknown as JsonValue }),
    isConcurrencySafe: () => true,
  }))
}

