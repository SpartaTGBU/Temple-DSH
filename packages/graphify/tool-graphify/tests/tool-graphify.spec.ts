import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  constructor(private readonly text: string) {}
  readFrom(fromByte: number) {
    return { text: fromByte === 0 ? this.text : '', nextOffset: this.text.length, lossy: false }
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

  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    this.resolveCalls.push({ command, env })
    if (this.resolveError !== undefined) return Promise.reject(this.resolveError)
    return Promise.resolve(this.command)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    return {
      pid: 42,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: new StaticReader(this.stdout), stderr: new StaticReader(this.stderr) },
      done: Promise.resolve({ exitCode: this.exitCode, signal: this.signal }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
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

function call(ctx: Context, name: string, args: unknown, owner?: Agent) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
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
      argv: ['extract', resolve(root, 'src'), '--code-only', '--no-viz'],
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
    })
    expect(subprocess.resolveCalls[0]).toEqual({ command: 'graphify', env: { GRAPHIFY_QUERY_LOG_DISABLE: '1' } })
    expect(subprocess.spawns[0]?.argv).toEqual(['graphify-bin', 'extract', resolve(root, 'src'), '--code-only', '--no-viz'])
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
    const result = await call(ctx, 'graphify_index', { operation: 'update', path: outside })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('escapes workspace')
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
    expect(text(result)).toContain('graphify-out')
    expect(subprocess.spawns).toEqual([])
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
})
