import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MemPalaceMemory, type Config } from '@deepseek-ai/dsh-memory-mempalace'
import type { MemoryCaptureTurn } from '@deepseek-ai/dsh-memory'
import { fileURLToPath } from 'node:url'
import { parseGraphResult } from '../src/graph.ts'

const fixture = fileURLToPath(new URL('./fixtures/worker.mjs', import.meta.url))
const liveBridgeFixture = fileURLToPath(new URL('./fixtures/live_bridge.py', import.meta.url))
const contexts: Context[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
})

function mounted(overrides: Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  new LocalSubprocessRuntime(ctx)
  const config: ConstructorParameters<typeof MemPalaceMemory>[1] = {
    pythonExecutable: process.execPath,
    bridgePath: fixture,
    requestTimeoutMs: 500,
    graceMs: 100,
  }
  Object.assign(config, overrides)
  const memory = new MemPalaceMemory(ctx, config)
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

  it('coalesces concurrent lazy startup behind one worker authority', async () => {
    const { memory } = mounted()
    const [first, second] = await Promise.all([
      memory.recall({ sessionId: 's1', query: 'concurrent-one', limit: 1, maxBytes: 1000 }),
      memory.recall({ sessionId: 's2', query: 'concurrent-two', limit: 1, maxBytes: 1000 }),
    ])
    expect(first.items[0]?.text).toBe('memory:concurrent-one')
    expect(second.items[0]?.text).toBe('memory:concurrent-two')
    expect(memory.status().workerStarts).toBe(1)
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

  it('rejects an oversized unterminated response frame before JSON parsing', async () => {
    const { memory } = mounted({ maxFrameBytes: 1024 })
    await expect(memory.recall({ sessionId: 's1', query: 'oversized-frame', limit: 3, maxBytes: 1000 }))
      .rejects.toThrow(/exceeded maxFrameBytes/)
    expect(memory.status().state).toBe('degraded')
  })
})

describe('host graph acquisition', () => {
  const request = { startRoom: 'a', maxNodes: 10, maxEdges: 10, maxHops: 2, maxBytes: 10_000 }

  it('uses the configured provider worker and returns sorted renderer-neutral data', async () => {
    const { memory } = mounted()
    const graph = await memory.exploreGraph(request)
    expect(graph.format).toBe('dsh.memory.graph.v1')
    expect(graph.nodes.map(node => node.id)).toEqual(['room:a', 'room:b', 'wing:w'])
    expect(graph.visits).toEqual([
      { nodeId: 'room:a', hop: 0, via: [] },
      { nodeId: 'room:b', hop: 1, parentNodeId: 'room:a', via: ['w'] },
    ])
    expect(graph.stats).toEqual({ scannedRecords: 3, nodeCount: 3, edgeCount: 3, maxHop: 1 })
    expect(memory.status().workerStarts).toBe(1)
    await memory.recall({ sessionId: 's1', query: 'same-worker', limit: 1, maxBytes: 100 })
    expect(memory.status().workerStarts).toBe(1)
  })

  it('runs the packaged bridge acquisition against a direct MemPalace API fixture', async () => {
    const { memory } = mounted({
      pythonExecutable: 'python',
      bridgePath: liveBridgeFixture,
      maxGraphScanRecords: 2,
    })
    const graph = await memory.exploreGraph({ maxNodes: 10, maxEdges: 10, maxHops: 2, maxBytes: 10_000 })
    expect(graph.nodes.map(node => node.label).sort()).toEqual(['auth', 'product', 'security'])
    expect(graph.edges.map(edge => edge.kind).sort()).toEqual(['placement', 'placement', 'tunnel'])
    expect(graph.stats.scannedRecords).toBe(2)
    expect(graph.truncated).toBe(true)
    const edgeBounded = await memory.exploreGraph({ maxNodes: 10, maxEdges: 1, maxHops: 0, maxBytes: 10_000 })
    expect(edgeBounded.edges).toHaveLength(1)
    expect(edgeBounded.truncated).toBe(true)
  })

  it('enforces provider caps before worker startup', async () => {
    const { memory } = mounted({ maxGraphNodes: 2, maxGraphEdges: 2, maxGraphHops: 1, maxGraphBytes: 2048 })
    await expect(memory.exploreGraph(request)).rejects.toThrow(/maxNodes/)
    expect(memory.status().workerStarts).toBe(0)
    await expect(memory.exploreGraph({ ...request, maxNodes: 2, maxEdges: 2, maxHops: 2, maxBytes: 2048 }))
      .rejects.toThrow(/maxHops/)
    await expect(memory.exploreGraph({ ...request, startRoom: ' a ', maxNodes: 2, maxEdges: 2, maxHops: 1, maxBytes: 2048 }))
      .rejects.toThrow(/trimmed/)
  })

  it('cancels a graph request, terminates the worker, and restarts cleanly', async () => {
    const { memory } = mounted()
    const controller = new AbortController()
    const pending = memory.exploreGraph({ ...request, startRoom: 'delay' }, controller.signal)
    for (let attempt = 0; attempt < 100 && memory.status().workerStarts === 0; attempt += 1) {
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    controller.abort()
    await expect(pending).rejects.toThrow(/cancelled/)
    const graph = await memory.exploreGraph(request)
    expect(graph.nodes).toHaveLength(3)
    expect(memory.status().workerStarts).toBe(2)
  })

  it('rejects malformed topology returned across the worker boundary', async () => {
    const { memory } = mounted()
    await expect(memory.exploreGraph({ ...request, startRoom: 'malformed-graph' }))
      .rejects.toThrow(/unknown node/)
  })

  it('rejects cycles and duplicate visits instead of returning ambiguous traversal', () => {
    const raw = fixtureGraph()
    raw.visits.push({ nodeId: 'room:a', hop: 2, parentNodeId: 'room:b', via: ['w'] })
    expect(() => parseGraphResult(raw, request, 10_000)).toThrow(/duplicate visits/)
  })

  it('enforces exact serialized byte and item limits at the TypeScript boundary', () => {
    const raw = fixtureGraph()
    expect(() => parseGraphResult(raw, { ...request, maxNodes: 2 }, 10_000)).toThrow(/maxNodes/)
    const exact = parseGraphResult(raw, request, 10_000)
    const bytes = new TextEncoder().encode(JSON.stringify(exact)).byteLength
    expect(parseGraphResult(raw, { ...request, maxBytes: bytes }, 10_000)).toEqual(exact)
    expect(() => parseGraphResult(raw, { ...request, maxBytes: bytes - 1 }, 10_000)).toThrow(/maxBytes/)
  })

  it('rejects inconsistent statistics, provider scan overflow, and invalid DTO relationships', () => {
    const inconsistent = fixtureGraph()
    inconsistent.stats.nodeCount = 2
    expect(() => parseGraphResult(inconsistent, request, 10_000)).toThrow(/nodeCount/)

    const overScan = fixtureGraph()
    overScan.stats.scannedRecords = 11
    expect(() => parseGraphResult(overScan, request, 10)).toThrow(/scannedRecords/)

    const wrongKinds = fixtureGraph()
    wrongKinds.edges[0]!.kind = 'placement'
    expect(() => parseGraphResult(wrongKinds, request, 10_000)).toThrow(/endpoint kinds/)

    const brokenTraversal = fixtureGraph()
    delete brokenTraversal.visits[1]!.parentNodeId
    expect(() => parseGraphResult(brokenTraversal, request, 10_000)).toThrow(/parent chain/)
  })
})

function fixtureGraph() {
  const visits: Array<Record<string, unknown>> = [
    { nodeId: 'room:a', hop: 0, via: [] },
    { nodeId: 'room:b', hop: 1, parentNodeId: 'room:a', via: ['w'] },
  ]
  return {
    format: 'dsh.memory.graph.v1',
    nodes: [
      { id: 'room:a', kind: 'room', label: 'a', count: 2, isolated: false },
      { id: 'room:b', kind: 'room', label: 'b', count: 1, isolated: false },
      { id: 'wing:w', kind: 'wing', label: 'w', count: 3, isolated: true },
    ],
    edges: [
      { id: 'path:a:b', source: 'room:a', target: 'room:b', kind: 'path', count: 1 },
    ],
    visits,
    truncated: false,
    stats: { scannedRecords: 3, nodeCount: 3, edgeCount: 1, maxHop: 1 },
  }
}

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
