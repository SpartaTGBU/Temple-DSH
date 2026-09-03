import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { MemoryRuntime, type MemoryCaptureTurn, type MemoryGraphResult, type MemoryRecallRequest, type MemoryRecallResult, type MemoryStatus } from '@deepseek-ai/dsh-memory'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { apply, deriveCompletedTurn, renderRecall } from '@deepseek-ai/dsh-memory-context'

class FakeMemory extends MemoryRuntime {
  recalls: MemoryRecallRequest[] = []
  captures: MemoryCaptureTurn[] = []
  recallResult: MemoryRecallResult = { backend: 'fake', items: [{ text: 'prefers concise answers', wing: 'identity', room: 'preferences' }], truncated: false }
  recallImpl: ((request: MemoryRecallRequest, signal?: AbortSignal) => Promise<MemoryRecallResult>) | undefined
  status(): MemoryStatus { return { state: 'ready', backend: 'fake', pendingCaptures: 0, workerStarts: 0 } }
  async recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult> {
    this.recalls.push(request)
    return this.recallImpl === undefined ? this.recallResult : await this.recallImpl(request, signal)
  }
  async exploreGraph(): Promise<MemoryGraphResult> { throw new Error('fake graph unsupported') }
  async captureTurn(turn: MemoryCaptureTurn): Promise<void> { this.captures.push(turn) }
  async flush(): Promise<void> {}
}

function testAgent(session: ReturnType<SessionStore['create']>): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send() {}, followup() {}, steer() {}, inject() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function preStep(ctx: Context, agent: Agent, turn: number, step: number) {
  const direct = createUserMessage({ content: [{ type: 'text' as const, text: 'What do I prefer?' }], source: { kind: 'user' as const } })
  return await agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages: [direct], turn, step, signal: new AbortController().signal,
  }, () => Promise.resolve({ kind: 'enter' as const, messages: [direct] }))
}

function mounted(meta: { origin?: 'subagent'; cwd?: string } = {}) {
  const ctx = new Context()
  const memory = new FakeMemory(ctx)
  const sessions = new SessionStore(ctx)
  apply(ctx, { recallTimeoutMs: 20 })
  const session = sessions.create(SessionId(`s-${Math.random()}`), { meta })
  return { ctx, memory, session }
}

describe('automatic recall', () => {
  it('recalls only on the first step and injects explicitly untrusted durable context', async () => {
    const { ctx, memory, session } = mounted()
    const agent = testAgent(session)
    const first = await preStep(ctx, agent, 1, 1)
    const second = await preStep(ctx, agent, 1, 2)
    expect(memory.recalls).toHaveLength(1)
    expect(first.kind).toBe('enter')
    if (first.kind !== 'enter') throw new Error('expected enter')
    const recalled = first.messages.at(-1)!
    expect(recalled.source).toEqual(expect.objectContaining({ kind: 'plugin', plugin: 'memory-context', form: 'snapshot' }))
    expect(recalled.content[0]).toEqual(expect.objectContaining({ type: 'text', text: expect.stringContaining('untrusted background') }))
    expect(JSON.stringify(recalled)).toContain('[identity/preferences] prefers concise answers')
    expect(second.kind).toBe('enter')
  })

  it('bounds UTF-8 output and does not block a turn when recall times out', async () => {
    const rendered = renderRecall([{ text: '界'.repeat(200) }], 300)
    expect(new TextEncoder().encode(rendered).byteLength).toBeLessThanOrEqual(300)
    const { ctx, memory, session } = mounted()
    memory.recallImpl = (_request, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    })
    const decision = await preStep(ctx, testAgent(session), 1, 1)
    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') expect(decision.messages).toHaveLength(1)
  })
})

describe('automatic capture', () => {
  it('extracts visible direct user and assistant text and captures a completed turn once', async () => {
    const { memory, session } = mounted({ cwd: 'D:/workspace' })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'User fact' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'plugin noise' }], source: { kind: 'plugin', plugin: 'other' } }), { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'Assistant answer' }], source: { provider: 'fake', model: 'fake' } }) }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await Promise.resolve()
    expect(memory.captures).toEqual([expect.objectContaining({ turn: 1, userText: 'User fact', assistantText: 'Assistant answer', cwd: 'D:/workspace' })])
  })

  it('skips subagent sessions by default and non-completed turns', async () => {
    const { memory, session } = mounted({ origin: 'subagent' })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'child' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await Promise.resolve()
    expect(memory.captures).toEqual([])

    const top = mounted()
    top.session.append('turn/start', { turn: 2 })
    top.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'cancelled' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    top.session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    await Promise.resolve()
    expect(top.memory.captures).toEqual([])
  })

  it('pure extraction returns undefined without a turn boundary or visible content', () => {
    const { session } = mounted()
    expect(deriveCompletedTurn(session, 1, Date.now())).toBeUndefined()
  })
})
