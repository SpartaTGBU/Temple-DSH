import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MemPalaceMemory } from '@deepseek-ai/dsh-memory-mempalace'
import type { MemoryCaptureTurn } from '@deepseek-ai/dsh-memory'
import { fileURLToPath } from 'node:url'

const fixture = fileURLToPath(new URL('./fixtures/worker.mjs', import.meta.url))
const contexts: Context[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
})

function mounted(overrides: ConstructorParameters<typeof MemPalaceMemory>[1] = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  new LocalSubprocessRuntime(ctx)
  const memory = new MemPalaceMemory(ctx, {
    pythonExecutable: process.execPath,
    bridgePath: fixture,
    requestTimeoutMs: 500,
    graceMs: 100,
    ...overrides,
  })
  return { ctx, memory }
}

function turn(userText = 'hello'): MemoryCaptureTurn {
  return { sessionId: 's1', turn: 1, userText, assistantText: 'answer', completedAt: Date.now() }
}

describe('persistent worker', () => {
  it('resolves inspection coordinates through the provider worker without exposing configuration internals', async () => {
    const { memory } = mounted()
    await expect(memory.inspectionSource()).resolves.toEqual({
      kind: 'mempalace',
      palacePath: 'C:/fixture/palace',
      collectionName: 'fixture_collection',
      storageBackend: 'sqlite_exact',
      wing: 'wing_fixture',
    })
    expect(memory.status()).toEqual(expect.objectContaining({ state: 'ready', workerStarts: 1 }))
  })

  it('reuses one process across recalls and bounds returned bytes', async () => {
    const { memory } = mounted()
    const first = await memory.recall({ sessionId: 's1', query: 'one', limit: 3, maxBytes: 1000 })
    const second = await memory.recall({ sessionId: 's1', query: 'two', limit: 3, maxBytes: 8 })
    expect(first.items[0]).toEqual(expect.objectContaining({ text: 'memory:one', wing: 'w', room: 'r' }))
    expect(second.items).toEqual([])
    expect(second.truncated).toBe(true)
    expect(memory.status()).toEqual(expect.objectContaining({ state: 'ready', workerStarts: 1 }))
  })

  it('terminates a timed-out worker and restarts cleanly on the next call', async () => {
    const { memory } = mounted({ requestTimeoutMs: 100 })
    await expect(memory.recall({ sessionId: 's1', query: 'delay', limit: 3, maxBytes: 1000 }))
      .rejects.toThrow(/timed out/)
    const result = await memory.recall({ sessionId: 's1', query: 'recovered', limit: 3, maxBytes: 1000 })
    expect(result.items[0]?.text).toBe('memory:recovered')
    expect(memory.status().workerStarts).toBe(2)
  })

  it('fails closed on malformed JSON and restarts the protocol worker', async () => {
    const { memory } = mounted()
    await expect(memory.recall({ sessionId: 's1', query: 'malformed', limit: 3, maxBytes: 1000 }))
      .rejects.toThrow(/invalid JSON/)
    await expect(memory.recall({ sessionId: 's1', query: 'ok', limit: 3, maxBytes: 1000 }))
      .resolves.toEqual(expect.objectContaining({ items: [expect.objectContaining({ text: 'memory:ok' })] }))
    expect(memory.status().workerStarts).toBe(2)
  })
})

describe('capture lifecycle', () => {
  it('queues capture without blocking, flushes it, and disposes the worker', async () => {
    const { ctx, memory } = mounted()
    await memory.captureTurn(turn())
    expect(memory.status().pendingCaptures).toBeGreaterThanOrEqual(1)
    await memory.flush()
    expect(memory.status().pendingCaptures).toBe(0)
    await ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(ctx), 1)
    expect(memory.status().state).toBe('stopped')
  })

  it('rejects capture queue overflow explicitly', async () => {
    const { memory } = mounted({ maxPendingCaptures: 1 })
    await memory.captureTurn(turn('slow'))
    await expect(memory.captureTurn(turn('overflow'))).rejects.toThrow(/capture queue full/)
    expect(memory.status()).toEqual(expect.objectContaining({ state: 'degraded', pendingCaptures: 1 }))
    await memory.flush()
  })

  it('rejects an oversized capture before queueing or writing a frame', async () => {
    const { memory } = mounted({ maxFrameBytes: 1024 })
    await expect(memory.captureTurn(turn('x'.repeat(2000)))).rejects.toThrow(/exceeded maxFrameBytes/)
    expect(memory.status().pendingCaptures).toBe(0)
  })

  it('reports a missing configured executable without exposing stderr', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    new LocalSubprocessRuntime(ctx)
    const memory = new MemPalaceMemory(ctx, { pythonExecutable: 'definitely-not-a-real-memory-python' })
    await expect(memory.recall({ sessionId: 's1', query: 'x', limit: 1, maxBytes: 100 }))
      .rejects.toThrow(/unable to start persistent worker/)
    expect(memory.status()).toEqual(expect.objectContaining({ state: 'unavailable', workerStarts: 0 }))
  })
})
