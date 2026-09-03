import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolExecution, ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as GraphifyInvariant from '@deepseek-ai/dsh-tool-graphify/invariant'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(GraphifyInvariant)
  return ctx
}

function exec(name: 'graphify_index' | 'graphify_query'): ToolExecution {
  const signal = new AbortController().signal
  return {
    callId: ToolCallId(`call-${name}`),
    rootCallId: ToolCallId(`call-${name}`),
    name,
    arguments: {},
    signal,
    token: Symbol(name) as ToolExecutionToken,
  }
}

const okValue = {
  kind: 'query',
  operation: 'query',
  workspaceRoot: '/repo',
  graphPath: '/repo/graphify-out/graph.json',
  argv: ['query', 'x'],
  exitCode: 0,
  signal: null,
  timedOut: false,
  aborted: false,
  stdout: { text: 'NODE X', truncated: false },
  stderr: { text: '', truncated: false },
} as const

function success(value: unknown): ToolExecutionResult {
  return { isError: false, value: value as never, content: [{ type: 'text', text: 'x' }] }
}

describe('graphify invariants', () => {
  it('accepts coherent graphify query tool results', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('tools/result', exec('graphify_query'), success(okValue)) }).not.toThrow()
  })

  it('rejects mismatched tool/result kind relations', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('tools/result', exec('graphify_index'), success(okValue)) }).toThrow(/kind must be index/)
  })

  it('rejects successful query values with no stdout text', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('tools/result', exec('graphify_query'), success({
        ...okValue,
        stdout: { text: '', truncated: false },
      }))
    }).toThrow(/successful graphify_query result must carry stdout text/)
  })

  it('rejects private collector spill paths', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('tools/result', exec('graphify_query'), success({
        ...okValue,
        stdout: { text: 'NODE X', truncated: true, spillPath: 'host-private' },
      }))
    }).toThrow(/spillPath must not be exposed/)
  })

  it('ignores failed and unrelated tool results', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('tools/result', exec('graphify_query'), {
        isError: true,
        error: { message: 'no graph' },
        content: [{ type: 'text', text: 'Error: no graph' }],
      })
      ctx.emit('tools/result', { ...exec('graphify_query'), name: 'bash' }, success({}))
    }).not.toThrow()
  })
})
