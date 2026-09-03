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
import { access, lstat, realpath, stat } from 'node:fs/promises'
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
const MAX_TIMER_DELAY_MS = 2_147_483_647
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
  no_cluster?: boolean
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
  stdout: BoundedOutput
  stderr: BoundedOutput
}

type BoundedOutput = Pick<CollectedOutput, 'text' | 'truncated'>

/** Stable error for calls that name a path outside the owning workspace. */
export class GraphifyWorkspaceEscapeError extends Error {
  /**
   * @param requested - Caller-supplied path.
   * @param workspaceRoot - Canonical workspace root.
   */
  constructor(readonly requested: string, readonly workspaceRoot: string) {
    super('graphify path escapes the session workspace')
    this.name = 'GraphifyWorkspaceEscapeError'
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`tool-graphify: ${name} must be a positive safe integer`)
  }
}

function assertTimer(name: string, value: number): void {
  assertPositiveInteger(name, value)
  if (value > MAX_TIMER_DELAY_MS) throw new Error(`tool-graphify: ${name} exceeds the maximum timer delay`)
}

function resolveTimeout(argsTimeout: number | undefined, config: ResolvedConfig): number {
  if (argsTimeout !== undefined) assertPositiveInteger('timeoutMs', argsTimeout)
  const timeoutMs = argsTimeout ?? config.timeoutMs
  return Math.min(timeoutMs, config.maxTimeoutMs)
}

function isInside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function existingDirectory(path: string, field: string): Promise<string> {
  try {
    const canonical = await realpath(path)
    const info = await stat(canonical)
    if (!info.isDirectory()) throw new Error('not a directory')
    return canonical
  } catch {
    throw new Error(`tool-graphify: ${field} must be an existing directory`)
  }
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

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function isTrulyMissing(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return false
  } catch (error) {
    return isMissing(error)
  }
}

async function graphPathFor(workspaceRoot: string, requireExisting: boolean): Promise<string> {
  const outputPath = resolve(workspaceRoot, GRAPHIFY_OUT)
  const requested = resolve(outputPath, GRAPH_JSON)
  let canonicalOutput: string
  try {
    canonicalOutput = await realpath(outputPath)
  } catch (error) {
    if (!requireExisting && isMissing(error) && await isTrulyMissing(outputPath)) return requested
    throw new Error('graphify graph is unavailable; run graphify_index for this workspace first')
  }
  const outputInfo = await stat(canonicalOutput)
  if (!outputInfo.isDirectory()) throw new Error('graphify-out must be a directory inside the session workspace')
  if (!isInside(workspaceRoot, canonicalOutput)) {
    throw new Error('graphify-out must remain inside the session workspace')
  }

  let graphPath: string
  try {
    graphPath = await realpath(resolve(canonicalOutput, GRAPH_JSON))
  } catch (error) {
    const canonicalRequested = resolve(canonicalOutput, GRAPH_JSON)
    if (!requireExisting && isMissing(error) && await isTrulyMissing(canonicalRequested)) return canonicalRequested
    throw new Error('graphify graph is unavailable; run graphify_index for this workspace first')
  }
  const info = await stat(graphPath)
  if (!info.isFile()) throw new Error('graphify graph must be a regular file inside the session workspace')
  if (requireExisting) {
    try {
      await access(graphPath, constants.R_OK)
    } catch {
      throw new Error('graphify graph is unavailable; run graphify_index for this workspace first')
    }
  }
  if (!isInside(workspaceRoot, graphPath)) {
    throw new Error('graphify graph must remain inside the session workspace')
  }
  return graphPath
}

function output(reader: SubprocessHandle['collected']['stdout']): BoundedOutput {
  if (reader === undefined) throw new Error('tool-graphify: subprocess dropped a requested collect stream')
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
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
  } catch {
    if (signal.aborted) throw signal.reason
    throw new Error("graphify CLI unavailable. Install the PyPI package 'graphifyy' or set tool-graphify.binaryPath.")
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
  const state = { timedOut: false, aborted: false }
  const onAbort = (): void => {
    state.aborted = true
    fused.abort()
  }
  const timer = setTimeout(() => {
    state.timedOut = true
    fused.abort()
  }, timeoutMs)
  execSignal.addEventListener('abort', onAbort, { once: true })
  try {
    const command = await resolveBinary(ctx, config, fused.signal)
    let handle: SubprocessHandle
    try {
      handle = ctx.subprocess.spawn({
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
    } catch {
      if (state.aborted) throw abortError()
      if (state.timedOut) throw new Error(`graphify operation timed out after ${timeoutMs} ms before the CLI started`)
      throw new Error('graphify CLI failed to start')
    }
    let outcome: Awaited<SubprocessHandle['done']>
    try {
      outcome = await handle.done
    } catch {
      if (state.aborted) throw abortError()
      if (state.timedOut) throw new Error(`graphify operation timed out after ${timeoutMs} ms before process output was available`)
      throw new Error('graphify CLI failed to start')
    }
    await handle.waitForExit()
    if (state.aborted) throw abortError()
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: state.timedOut,
      aborted: state.aborted,
      stdout: output(handle.collected.stdout),
      stderr: output(handle.collected.stderr),
    }
  } catch (error) {
    if (state.aborted) throw abortError()
    if (state.timedOut) throw new Error(`graphify operation timed out after ${timeoutMs} ms`)
    throw error
  } finally {
    clearTimeout(timer)
    execSignal.removeEventListener('abort', onAbort)
  }
}

function renderCliResult(value: CliRunResult): string {
  const stdout = value.stdout.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trimEnd()
  const stderr = value.stderr.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trimEnd()
  if (value.exitCode === 0 && value.signal === null && !value.timedOut && !value.aborted) {
    if (stdout.length > 0) return [stdout, ...(value.stdout.truncated ? ['[stdout truncated]'] : [])].join('\n')
    return `${value.operation} completed.`
  }
  const lines = [`graphify ${value.operation} failed.`]
  if (stdout.length > 0) lines.push(stdout)
  if (value.stdout.truncated) lines.push('[stdout truncated]')
  if (stderr.length > 0) lines.push('[stderr]', stderr)
  if (value.stderr.truncated) lines.push('[stderr truncated]')
  if (value.timedOut) lines.push('[timed out after argv timeout]')
  if (value.aborted) lines.push('[aborted]')
  if (value.signal !== null) lines.push(`[killed by signal: ${value.signal}]`)
  if (value.exitCode !== null) lines.push(`[exit code: ${value.exitCode}]`)
  return lines.join('\n')
}

function assertQueryArgs(args: GraphifyQueryArgs): void {
  if (args.budget !== undefined) assertPositiveInteger('budget', args.budget)
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
  assertTimer('timeoutMs', resolved.timeoutMs)
  assertTimer('maxTimeoutMs', resolved.maxTimeoutMs)
  assertPositiveInteger('maxOutputBytes', resolved.maxOutputBytes)
  assertTimer('graceMs', resolved.graceMs)

  ctx.tools.register(defineTool({
    name: 'graphify_index',
    description: 'Build or update the current workspace Graphify code graph. Use index for the first build and update after source changes. Paths must stay inside the session workspace.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['index', 'update'], description: 'index builds graphify-out/graph.json; update refreshes changed files in an existing graph.' },
      path: { type: 'string', description: `Workspace-relative directory to index. Valid only for index; defaults to ${JSON.stringify('.')}.` },
      timeoutMs: { type: 'integer', description: 'Optional positive timeout in milliseconds, capped by plugin config.' },
      code_only: { type: 'boolean', description: 'For index only, pass --code-only. Defaults true to avoid LLM-backed document/media extraction.' },
      no_cluster: { type: 'boolean', description: 'For index only, pass --no-cluster. Defaults true for a fast local-only initial graph.' },
    },
    output: { schema: cliOutputSchema, render: (_args: unknown, value: JsonValue) => [{ type: 'text', text: renderCliResult(value as unknown as CliRunResult) }] },
    async execute(args: GraphifyIndexArgs, exec: ToolRunContext) {
      const workspaceRoot = await workspaceRootFor(exec.agent, resolved)
      if (args.operation === 'update' && args.path !== undefined) throw new Error('path is valid only for graphify index')
      const targetPath = await resolveGraphifyTarget(workspaceRoot, args.path)
      await graphPathFor(workspaceRoot, false)
      const argv = args.operation === 'index'
        ? [
          'extract',
          targetPath,
          '--out',
          workspaceRoot,
          ...((args.code_only ?? true) ? ['--code-only'] : []),
          ...((args.no_cluster ?? true) ? ['--no-cluster'] : []),
        ]
        : ['update', workspaceRoot]
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
      budget: { type: 'integer', description: 'Positive approximate token budget for query output.' },
      dfs: { type: 'boolean', description: 'For operation=query, use DFS instead of BFS.' },
      context: { type: 'array', items: { type: 'string' }, description: 'For operation=query, relation contexts such as call, import, field, parameter_type, return_type, or generic_arg.' },
      timeoutMs: { type: 'integer', description: 'Optional positive timeout in milliseconds, capped by plugin config.' },
    },
    output: { schema: cliOutputSchema, render: (_args: unknown, value: JsonValue) => [{ type: 'text', text: renderCliResult(value as unknown as CliRunResult) }] },
    async execute(args: GraphifyQueryArgs, exec: ToolRunContext) {
      assertQueryArgs(args)
      const workspaceRoot = await workspaceRootFor(exec.agent, resolved)
      const graphPath = await graphPathFor(workspaceRoot, true)
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
      return { kind: 'query' as const, operation: args.operation, workspaceRoot, graphPath, argv, ...result }
    },
    presentCall: (args: GraphifyQueryArgs) => ({ card: 'generic', title: `Graphify ${args.operation}`, kind: 'search', rawInput: args as unknown as JsonValue }),
    isConcurrencySafe: () => true,
  }))
}

