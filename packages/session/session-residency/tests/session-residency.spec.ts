import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionResidency, {
  DEFAULT_IDLE_MS,
  DEFAULT_MIN_LEVEL,
  hasOpenTurn,
} from '@deepseek-ai/dsh-session-residency'
import type { EvictionCandidate } from '@deepseek-ai/dsh-session-residency'

interface FakeSession {
  id: string
  events: { type: string }[]
}

function store(sessions: FakeSession[]): { list: () => FakeSession[] } {
  return { list: () => sessions }
}

function turns(count: number, closed = true): { type: string }[] {
  const events: { type: string }[] = []
  for (let t = 1; t <= count; t++) {
    events.push({ type: 'turn/start' })
    events.push({ type: 'user/message' })
    if (closed || t < count) events.push({ type: 'turn/end' })
  }
  return events
}

describe('hasOpenTurn', () => {
  it('is true when the last boundary is a start', () => {
    expect(hasOpenTurn([{ type: 'turn/start' }, { type: 'user/message' }])).toBe(true)
  })
  it('is false when the last boundary is an end', () => {
    expect(hasOpenTurn([{ type: 'turn/start' }, { type: 'turn/end' }])).toBe(false)
  })
  it('is false with no turns', () => {
    expect(hasOpenTurn([{ type: 'user/message' }])).toBe(false)
    expect(hasOpenTurn([])).toBe(false)
  })
})

describe('SessionResidency defaults and shouldRun', () => {
  it('exposes documented defaults', () => {
    expect(DEFAULT_IDLE_MS).toBe(5 * 60 * 1000)
    expect(DEFAULT_MIN_LEVEL).toBe('elevated')
  })
  it('runs at or above the configured floor', () => {
    const svc = new SessionResidency(new Context(), { minLevel: 'elevated' })
    expect(svc.shouldRun('normal')).toBe(false)
    expect(svc.shouldRun('elevated')).toBe(true)
    expect(svc.shouldRun('critical')).toBe(true)
  })
  it('honors a critical floor', () => {
    const svc = new SessionResidency(new Context(), { minLevel: 'critical' })
    expect(svc.shouldRun('elevated')).toBe(false)
    expect(svc.shouldRun('critical')).toBe(true)
  })
})

describe('SessionResidency.plan', () => {
  const now = 1_000_000

  it('ranks idle closed-turn sessions by descending retained bytes', () => {
    const svc = new SessionResidency(new Context(), { idleMs: 1000, maxEvictionsPerPass: 8 })
    const s = store([
      { id: 'big', events: turns(20) },
      { id: 'small', events: turns(2) },
    ])
    const lastActive = () => now - 5000 // all idle
    const plan = svc.plan(s, lastActive, now)
    expect(plan.candidates.map(c => c.id)).toEqual(['big', 'small'])
    expect(plan.candidates[0]!.retainedBytes).toBeGreaterThan(plan.candidates[1]!.retainedBytes)
    expect(plan.totalRetainedBytes).toBe(plan.candidates.reduce((sum, c) => sum + c.retainedBytes, 0))
  })

  it('skips sessions with an open turn', () => {
    const svc = new SessionResidency(new Context(), { idleMs: 1000 })
    const s = store([
      { id: 'active', events: turns(5, false) },
      { id: 'idle', events: turns(5) },
    ])
    const plan = svc.plan(s, () => now - 5000, now)
    expect(plan.candidates.map(c => c.id)).toEqual(['idle'])
  })

  it('skips sessions active within the idle window', () => {
    const svc = new SessionResidency(new Context(), { idleMs: 10_000 })
    const s = store([
      { id: 'recent', events: turns(5) },
      { id: 'stale', events: turns(5) },
    ])
    const lastActive = (id: unknown) => (id === 'recent' ? now - 1000 : now - 60_000)
    const plan = svc.plan(s, lastActive, now)
    expect(plan.candidates.map(c => c.id)).toEqual(['stale'])
  })

  it('treats an unknown last-active as infinitely idle', () => {
    const svc = new SessionResidency(new Context(), { idleMs: 10_000 })
    const s = store([{ id: 'never', events: turns(3) }])
    const plan = svc.plan(s, () => undefined, now)
    expect(plan.candidates.map(c => c.id)).toEqual(['never'])
    expect(plan.candidates[0]!.idleMs).toBe(Number.POSITIVE_INFINITY)
  })

  it('caps candidates at maxEvictionsPerPass', () => {
    const svc = new SessionResidency(new Context(), { idleMs: 1000, maxEvictionsPerPass: 2 })
    const s = store([
      { id: 'a', events: turns(10) },
      { id: 'b', events: turns(8) },
      { id: 'c', events: turns(6) },
    ])
    const plan = svc.plan(s, () => now - 5000, now)
    expect(plan.candidates).toHaveLength(2)
    expect(plan.candidates.map(c => c.id)).toEqual(['a', 'b'])
  })
})

describe('SessionResidency executor and passes', () => {
  const now = 1_000_000

  it('reports a plan without an executor and evicts with one', async () => {
    const svc = new SessionResidency(new Context(), { idleMs: 1000 })
    const s = store([{ id: 'x', events: turns(4) }])
    const planned = await svc.runPass(s, () => now - 5000, now)
    expect(planned.candidates.map(c => c.id)).toEqual(['x'])

    const evicted: EvictionCandidate[] = []
    const dispose = svc.registerExecutor({ evict: (c) => { evicted.push(c) } })
    await svc.runPass(s, () => now - 5000, now)
    expect(evicted.map(c => c.id)).toEqual(['x'])
    dispose()
  })

  it('rejects a second executor registration and unregisters cleanly', () => {
    const svc = new SessionResidency(new Context())
    const dispose = svc.registerExecutor({ evict: () => {} })
    expect(() => svc.registerExecutor({ evict: () => {} })).toThrow(/already registered/)
    dispose()
    expect(() => svc.registerExecutor({ evict: () => {} })).not.toThrow()
  })

  it('onPressure runs only at or above the floor', async () => {
    const svc = new SessionResidency(new Context(), { idleMs: 1000, minLevel: 'elevated' })
    const s = store([{ id: 'y', events: turns(3) }])
    const evicted: string[] = []
    svc.registerExecutor({ evict: (c) => { evicted.push(c.id) } })
    const belowSample = { level: 'normal' as const, heapUsedBytes: 1, elevatedBytes: 2, criticalBytes: 3 }
    const above = await svc.onPressure({ level: 'critical', heapUsedBytes: 3, elevatedBytes: 1, criticalBytes: 2 }, s, () => now - 5000)
    const below = await svc.onPressure(belowSample, s, () => now - 5000)
    expect(below).toBeUndefined()
    expect(above?.candidates.map(c => c.id)).toEqual(['y'])
    expect(evicted).toEqual(['y'])
  })
})
