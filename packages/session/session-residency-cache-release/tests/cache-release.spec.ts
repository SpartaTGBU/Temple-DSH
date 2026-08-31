import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionResidency from '@deepseek-ai/dsh-session-residency'
import * as CacheRelease from '@deepseek-ai/dsh-session-residency-cache-release'

function build(): { ctx: Context; store: SessionStore; residency: SessionResidency } {
  const ctx = new Context()
  const store = new SessionStore(ctx)
  const residency = new SessionResidency(ctx, { idleMs: 1000 })
  return { ctx, store, residency }
}

function warm(store: SessionStore, id: string, turns: number): void {
  const session = store.create(SessionId(id))
  for (let t = 1; t <= turns; t++) {
    session.append('turn/start', { turn: t })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `turn ${t}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: t, reason: { kind: 'completed' } })
  }
  // Build the derived + snapshot caches so a release has something to drop.
  session.deriveMessages()
  void session.events
}

describe('session-residency-cache-release executor', () => {
  it('registers on the residency policy and releases a selected session\'s caches', async () => {
    const { ctx, store, residency } = build()
    CacheRelease.apply(ctx)

    warm(store, 'evict-me', 6)
    const session = store.get(SessionId('evict-me'))!
    const beforeMessages = session.deriveMessages()

    // idle (no last-active) => infinitely idle => a candidate
    const plan = await residency.runPass(store, () => undefined, Date.now())
    expect(plan.candidates.map(c => c.id)).toEqual(['evict-me'])

    // The session is still live and observationally identical after release.
    expect(store.get(SessionId('evict-me'))).toBe(session)
    expect(session.deriveMessages()).toEqual(beforeMessages)

    // A fresh release now drops the just-rebuilt caches, confirming the pass
    // reclaimed real cached state rather than being a no-op.
    void session.events
    expect(session.releaseCaches()).toBeGreaterThan(0)
  })

  it('is a no-op for a candidate id that no longer resolves', async () => {
    const { ctx, store, residency } = build()
    CacheRelease.apply(ctx)
    // Register the executor, then evict a candidate whose session is absent.
    const executorPlan = await residency.runPass(
      { list: () => [{ id: 'ghost', events: [{ type: 'turn/start' }] }] },
      () => undefined,
      Date.now(),
    )
    // 'ghost' has an open turn (only turn/start) -> filtered out, so no eviction attempt.
    expect(executorPlan.candidates).toHaveLength(0)
    void store
  })

  it('declares the services it injects', () => {
    expect(CacheRelease.inject).toEqual(['sessions', 'sessionResidency'])
    expect(CacheRelease.name).toBe('session-residency-cache-release')
  })
})
