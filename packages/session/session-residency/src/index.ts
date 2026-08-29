/**
 * Session residency policy: choose idle, safe-to-evict sessions under host
 * memory pressure.
 *
 * This is the decision half of session eviction (Gap A). It consumes the host
 * memory-pressure signal and the per-session memory meter to rank the resident
 * sessions a store lists, and selects eviction candidates while never choosing
 * a session with an open turn or one active within the idle window. The
 * mechanical drop-and-rehydrate is delegated to a registered ResidencyExecutor,
 * so the policy stays a pure, swappable decision and the store spine is
 * untouched. With no executor registered the policy only reports candidates, so
 * a deployment opts in explicitly.
 *
 * @module @deepseek-ai/dsh-session-residency
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { reportSessionMemory } from '@deepseek-ai/dsh-memory-meter'
import type { SessionListing } from '@deepseek-ai/dsh-memory-meter'
import type {} from '@deepseek-ai/dsh-memory-pressure'
import type { MemoryPressureLevel, MemoryPressureSample } from '@deepseek-ai/dsh-memory-pressure'
import type { ResidencyConfig, ResidencyExecutor, EvictionCandidate, EvictionPlan } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionResidency: SessionResidency
  }
}

/** Default idle window (ms) before a session may be evicted: 5 minutes. */
export const DEFAULT_IDLE_MS = 5 * 60 * 1000
/** Default pressure level at or above which eviction runs. */
export const DEFAULT_MIN_LEVEL: 'elevated' | 'critical' = 'elevated'

const LEVEL_RANK: Readonly<Record<MemoryPressureLevel, number>> = { normal: 0, elevated: 1, critical: 2 }

/**
 * Whether a session has an open turn (its last turn boundary is a start), read
 * from the public event log so no private session state is needed.
 * @param events - the session's public events.
 * @returns true when a turn is open.
 */
export function hasOpenTurn(events: readonly { readonly type?: unknown }[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const type = events[i]?.type
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

/** Milliseconds-epoch last-active accessor per session id, supplied by the caller. */
export type LastActiveAt = (id: unknown) => number | undefined

/** Session residency decision service (`ctx.sessionResidency`). */
export class SessionResidency extends Service {
  static Config: z<ResidencyConfig> = z.object({
    idleMs: z.number().step(1).min(1).default(DEFAULT_IDLE_MS),
    minLevel: z.union(['elevated', 'critical']).default(DEFAULT_MIN_LEVEL),
    maxEvictionsPerPass: z.number().step(1).min(1).default(8),
  })

  private executor: ResidencyExecutor | undefined
  readonly idleMs: number
  readonly minLevel: 'elevated' | 'critical'
  readonly maxEvictionsPerPass: number

  constructor(ctx: Context, config: ResidencyConfig = {}) {
    super(ctx, 'sessionResidency')
    this.idleMs = config.idleMs ?? DEFAULT_IDLE_MS
    this.minLevel = config.minLevel ?? DEFAULT_MIN_LEVEL
    this.maxEvictionsPerPass = config.maxEvictionsPerPass ?? 8
  }

  /**
   * Register the mechanism that actually drops and rehydrates a session.
   * @param executor - the residency executor.
   * @returns a disposer that unregisters the executor.
   */
  registerExecutor(executor: ResidencyExecutor): () => void {
    if (this.executor !== undefined) throw new Error('session-residency: an executor is already registered')
    this.executor = executor
    return () => { if (this.executor === executor) this.executor = undefined }
  }

  /**
   * Whether the given pressure level is at or above the configured floor.
   * @param level - the current pressure level.
   * @returns true when eviction should run.
   */
  shouldRun(level: MemoryPressureLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[this.minLevel]
  }

  /**
   * Plan which sessions to evict now, ranked by descending retained bytes and
   * filtered to idle, closed-turn sessions. Reads the store's public surface
   * and the memory meter; performs no eviction itself.
   * @param store - the session store (its public list()).
   * @param lastActiveAt - last-active timestamp accessor (ms epoch) per id.
   * @param now - current time in ms epoch (injectable for tests).
   * @returns the ordered eviction plan, capped at maxEvictionsPerPass.
   */
  plan(store: SessionListing, lastActiveAt: LastActiveAt, now: number = Date.now()): EvictionPlan {
    const report = reportSessionMemory(store)
    const byId = new Map(store.list().map(session => [String(session.id), session]))
    const candidates: EvictionCandidate[] = []
    for (const entry of report.sessions) {
      const session = byId.get(entry.id)
      if (session === undefined) continue
      if (hasOpenTurn(session.events as readonly { readonly type?: unknown }[])) continue
      const last = lastActiveAt(session.id)
      const idleMsElapsed = last === undefined ? Number.POSITIVE_INFINITY : now - last
      if (idleMsElapsed < this.idleMs) continue
      candidates.push({ id: entry.id, retainedBytes: entry.estimate.retainedBytes, idleMs: idleMsElapsed })
      if (candidates.length >= this.maxEvictionsPerPass) break
    }
    return { candidates, totalRetainedBytes: candidates.reduce((sum, c) => sum + c.retainedBytes, 0) }
  }

  /**
   * Run one eviction pass: plan candidates and, when an executor is registered,
   * evict each. Returns the plan acted on. A no-executor composition returns
   * the plan without evicting, so reporting works without opting in.
   * @param store - the session store.
   * @param lastActiveAt - last-active timestamp accessor per id.
   * @param now - current time in ms epoch (injectable for tests).
   * @returns the eviction plan that was executed (or only planned).
   */
  async runPass(store: SessionListing, lastActiveAt: LastActiveAt, now: number = Date.now()): Promise<EvictionPlan> {
    const evictionPlan = this.plan(store, lastActiveAt, now)
    if (this.executor !== undefined) {
      for (const candidate of evictionPlan.candidates) await this.executor.evict(candidate)
    }
    return evictionPlan
  }

  /**
   * React to a memory-pressure transition: run a pass when the level meets the
   * floor. The store and last-active source are supplied by the composition
   * that wires this policy to its session store.
   * @param sample - the memory-pressure sample.
   * @param store - the session store.
   * @param lastActiveAt - last-active timestamp accessor per id.
   * @returns the plan acted on, or undefined when the level was below the floor.
   */
  async onPressure(sample: MemoryPressureSample, store: SessionListing, lastActiveAt: LastActiveAt): Promise<EvictionPlan | undefined> {
    if (!this.shouldRun(sample.level)) return undefined
    return this.runPass(store, lastActiveAt)
  }
}

export default SessionResidency
