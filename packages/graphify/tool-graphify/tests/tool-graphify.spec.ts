import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle, SubprocessOutputReader, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolGraphify from '@deepseek-ai/dsh-tool-graphify'

let callCounter = 0

class StaticReader implements SubprocessOutputReader {
  constructor(private readonly text: string, private readonly lossy = false) {}
  readFrom(fromByte: number) {
    return { text: fromByte === 0 ? this.text : '', nextOffset: this.text.length, lossy: this.lossy, spillPath: 'private-spill-path' }
  }
}

class FakeSubprocess extends SubprocessRuntime {
  command = 'graphify-bin'
  resolveCalls: Array<{ command: string; env: Readonly<Record<string, string>> | undefined }> = []
  spawns: SubprocessSpawnSpec[] = []
  stdout = 'ok\n'
  stderr = ''
  exitCode: number | null = 0
  signal: NodeJS.Signals | null = null
  resolveError: Error | undefined
  spawnError: Error | undefined
  waitForAbort = false
  lossy = false
  treeExited = true
  waitForExitCalls = 0

  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    this.resolveCalls.push({ command, env })
    if (this.resolveError !== undefined) return Promise.reject(this.resolveError)
    return Promise.resolve(this.command)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    if (this.spawnError !== undefined) throw this.spawnError
    const done = this.waitForAbort
      ? new Promise<{ exitCode: null; signal: 'SIGTERM' }>((resolve) => {
        spec.signal?.addEventListener('abort', () => { resolve({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
      })
      : Promise.resolve({ exitCode: this.exitCode, signal: this.signal })
    return {
      pid: 42,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: new StaticReader(this.stdout, this.lossy), stderr: new StaticReader(this.stderr, this.lossy) },
      done,
      terminate: () => {},
      waitForExit: () => {
        this.waitForExitCalls++
        return Promise.resolve(this.treeExited)
      },
    }
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('unused'))
  }
}

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-graphify-tool-'))
  mkdirSync(join(root, 'src'))
  return realpathSync(root)
}

async function setup(root = workspace()) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeSubprocess)
  await ctx.plugin(ToolGraphify, { workspaceRoot: root, timeoutMs: 10_000, graceMs: 10 })
  return { ctx, subprocess: ctx.subprocess as FakeSubprocess, root }
}

function agent(root: string): Agent {
  const id = SessionId('graphify-agent')
  return {
    id,
    session: { id, header: { version: 0, id, createdAt: 0, cwd: root } },
  } as unknown as Agent
}

function call(ctx: Context, name: string, args: unknown, owner?: Agent, signal = new AbortController().signal) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`graphify-${++callCounter}`),
    name,
    arguments: args,
    ...owner === undefined ? {} : { agent: owner },
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('graphify tools', () => {
  it('rejects timer configuration beyond the runtime timer range', async () => {
    const root = workspace()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess)

    await expect(ctx.plugin(ToolGraphify, { workspaceRoot: root, timeoutMs: 2_147_483_648 })).rejects.toThrow(/maximum timer delay/)
  })

  it('indexes a contained workspace directory with deterministic argv and query logging disabled', async () => {
    const { ctx, subprocess, root } = await setup()
    const result = await call(ctx, 'graphify_index', { operation: 'index', path: 'src' }, agent(root))

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(result.value).toMatchObject({
      kind: 'index',
      operation: 'index',
      workspaceRoot: root,
      targetPath: resolve(root, 'src'),
      argv: ['extract', resolve(root, 'src'), '--out', root, '--code-only', '--no-cluster'],
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
    })
    expect(subprocess.resolveCalls[0]).toEqual({ command: 'graphify', env: { GRAPHIFY_QUERY_LOG_DISABLE: '1' } })
    expect(subprocess.spawns[0]?.argv).toEqual(['graphify-bin', 'extract', resolve(root, 'src'), '--out', root, '--code-only', '--no-cluster'])
    expect(subprocess.spawns[0]?.cwd).toBe(root)
    expect(subprocess.spawns[0]?.env).toEqual({ GRAPHIFY_QUERY_LOG_DISABLE: '1' })
    expect(text(result)).toBe('ok')
  })

  it('inserts configured binary arguments before Graphify operation arguments', async () => {
    const root = workspace()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess)
    await ctx.plugin(ToolGraphify, { workspaceRoot: root, binaryPath: 'uvx', binaryArgs: ['--from', 'graphifyy', 'graphify'] })
    const subprocess = ctx.subprocess as FakeSubprocess

    const result = await call(ctx, 'graphify_index', { operation: 'update' })

    expect(result.isError).toBe(false)
    expect(subprocess.resolveCalls[0]?.command).toBe('uvx')
    expect(subprocess.spawns[0]?.argv).toEqual(['graphify-bin', '--from', 'graphifyy', 'graphify', 'update', root])
  })

  it('rejects paths that escape the workspace before resolving the binary', async () => {
    const { ctx, subprocess } = await setup()
    const outside = workspace()
    const result = await call(ctx, 'graphify_index', { operation: 'index', path: outside })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('escapes the session workspace')
    expect(subprocess.resolveCalls).toEqual([])
    expect(subprocess.spawns).toEqual([])
  })

  it('returns a clear missing-binary diagnostic without spawning', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.resolveError = new Error('not found on PATH')
    const result = await call(ctx, 'graphify_index', { operation: 'update' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('graphify CLI unavailable')
    expect(text(result)).toContain("Install the PyPI package 'graphifyy'")
    expect(text(result)).not.toContain('not found on PATH')
    expect(subprocess.spawns).toEqual([])
  })

  it('queries the contained graph path with typed query flags', async () => {
    const root = workspace()
    mkdirSync(join(root, 'graphify-out'))
    writeFileSync(join(root, 'graphify-out', 'graph.json'), '{"nodes":[],"links":[]}')
    const { ctx, subprocess } = await setup(root)
    subprocess.stdout = 'NODE Foo [src=src/foo.ts loc=L1 community=core]\n'
    const result = await call(ctx, 'graphify_query', {
      operation: 'query',
      question: 'where is Foo?',
      budget: 321,
      dfs: true,
      context: ['call', 'import'],
    }, agent(root))

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const graphPath = join(root, 'graphify-out', 'graph.json')
    expect(result.value).toMatchObject({
      kind: 'query',
      operation: 'query',
      graphPath,
      argv: ['query', 'where is Foo?', '--dfs', '--budget', '321', '--context', 'call', '--context', 'import', '--graph', graphPath],
    })
    expect(subprocess.spawns[0]?.argv).toEqual(['graphify-bin', 'query', 'where is Foo?', '--dfs', '--budget', '321', '--context', 'call', '--context', 'import', '--graph', graphPath])
    expect(text(result)).toBe('NODE Foo [src=src/foo.ts loc=L1 community=core]')
  })

  it('requires a graph before read operations', async () => {
    const { ctx, subprocess } = await setup()
    const result = await call(ctx, 'graphify_query', { operation: 'explain', node: 'Foo' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('graphify graph is unavailable')
    expect(subprocess.spawns).toEqual([])
  })

  it('rejects non-positive query budgets before resolving the binary', async () => {
    const root = workspace()
    mkdirSync(join(root, 'graphify-out'))
    writeFileSync(join(root, 'graphify-out', 'graph.json'), '{"nodes":[],"links":[]}')
    const { ctx, subprocess } = await setup(root)

    const result = await call(ctx, 'graphify_query', { operation: 'query', question: 'x', budget: 0 })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('budget must be a positive safe integer')
    expect(subprocess.resolveCalls).toEqual([])
  })

  it('rejects missing targets and update path overrides before resolving the binary', async () => {
    const { ctx, subprocess } = await setup()
    const missing = await call(ctx, 'graphify_index', { operation: 'index', path: 'missing' })
    const updatePath = await call(ctx, 'graphify_index', { operation: 'update', path: 'src' })

    expect(missing.isError).toBe(true)
    expect(updatePath.isError).toBe(true)
    expect(text(updatePath)).toContain('valid only for graphify index')
    expect(subprocess.resolveCalls).toEqual([])
  })

  it('rejects a graphify-out junction whose canonical graph escapes the workspace', async () => {
    const root = workspace()
    const outside = workspace()
    writeFileSync(join(outside, 'graph.json'), '{"nodes":[],"links":[]}')
    symlinkSync(outside, join(root, 'graphify-out'), 'junction')
    const { ctx, subprocess } = await setup(root)

    const result = await call(ctx, 'graphify_query', { operation: 'explain', node: 'Foo' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('must remain inside')
    expect(subprocess.resolveCalls).toEqual([])
  })

  it('rejects an indexing output junction before starting Graphify', async () => {
    const root = workspace()
    const outside = workspace()
    symlinkSync(outside, join(root, 'graphify-out'), 'junction')
    const { ctx, subprocess } = await setup(root)

    const result = await call(ctx, 'graphify_index', { operation: 'index' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('graphify-out must remain inside')
    expect(subprocess.resolveCalls).toEqual([])
  })

  it('permits a not-yet-created graph under a canonical contained output directory', async () => {
    const root = workspace()
    mkdirSync(join(root, 'graphify-out'))
    const { ctx, subprocess } = await setup(root)

    const result = await call(ctx, 'graphify_index', { operation: 'index' })

    expect(result.isError).toBe(false)
    expect(subprocess.spawns).toHaveLength(1)
  })

  it('rejects a broken graph symlink instead of treating it as a new contained target', async () => {
    const root = workspace()
    const outside = workspace()
    symlinkSync(join(outside, 'missing-dir'), join(root, 'graphify-out'), 'junction')
    const { ctx, subprocess } = await setup(root)

    const result = await call(ctx, 'graphify_index', { operation: 'index' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('graphify graph is unavailable')
    expect(subprocess.resolveCalls).toEqual([])
  })

  it('forwards cancellation to the process tree and returns the standard aborted failure', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.waitForAbort = true
    const controller = new AbortController()
    const pending = call(ctx, 'graphify_index', { operation: 'update' }, undefined, controller.signal)
    await vi.waitFor(() => { expect(subprocess.spawns).toHaveLength(1) })
    controller.abort('caller cancelled')

    const result = await pending
    expect(result.isError).toBe(true)
    expect(subprocess.spawns[0]?.signal?.aborted).toBe(true)
  })

  it('enforces the configured deadline and preserves timeout classification after teardown', async () => {
    const root = workspace()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess)
    await ctx.plugin(ToolGraphify, { workspaceRoot: root, timeoutMs: 5, graceMs: 10 })
    const subprocess = ctx.subprocess as FakeSubprocess
    subprocess.waitForAbort = true

    const result = await call(ctx, 'graphify_index', { operation: 'update' })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected classified CLI outcome')
    expect(result.value).toMatchObject({ timedOut: true, aborted: false, signal: 'SIGTERM' })
    expect(subprocess.spawns[0]?.signal?.aborted).toBe(true)
    expect(subprocess.waitForExitCalls).toBe(1)
  })

  it('caps both collected streams and does not expose private spill paths', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.lossy = true
    const result = await call(ctx, 'graphify_index', { operation: 'update' })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(subprocess.spawns[0]?.stdio).toMatchObject({ stdout: { maxBytes: 128_000 }, stderr: { maxBytes: 128_000 } })
    expect(result.value).toMatchObject({ stdout: { truncated: true }, stderr: { truncated: true } })
    expect(JSON.stringify(result.value)).not.toContain('private-spill-path')
  })

  it('classifies graph writes as exclusive barriers and graph reads as parallel-safe', async () => {
    const { ctx } = await setup()
    const execution = (name: string, args: unknown) => ({
      signal: new AbortController().signal,
      callId: ToolCallId(`mode-${name}`),
      name,
      arguments: args,
    })

    expect(ctx.tools.executionMode(execution('graphify_index', { operation: 'index' }))).toEqual({ kind: 'exclusive' })
    expect(ctx.tools.executionMode(execution('graphify_query', { operation: 'query', question: 'x' }))).toEqual({ kind: 'parallel' })
  })

  it('reports non-zero CLI exits as successful tool calls with exit details', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.exitCode = 2
    subprocess.stdout = 'partial\n'
    subprocess.stderr = 'bad args\n'
    const result = await call(ctx, 'graphify_index', { operation: 'update' })

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected infrastructure success')
    expect(result.value).toMatchObject({ exitCode: 2, stderr: { text: 'bad args\n' } })
    expect(text(result)).toBe('graphify update failed.\npartial\n[stderr]\nbad args\n[exit code: 2]')
  })

  it('normalizes platform newlines and renders collector truncation deterministically', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.stdout = 'first\r\nsecond\r\n'
    subprocess.lossy = true

    const result = await call(ctx, 'graphify_index', { operation: 'update' })

    expect(result.isError).toBe(false)
    expect(text(result)).toBe('first\nsecond\n[stdout truncated]')
  })
})
