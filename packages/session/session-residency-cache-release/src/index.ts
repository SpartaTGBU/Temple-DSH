/**
 * Cache-release residency executor: reclaim a session's volatile derived
 * caches when the residency policy selects it under memory pressure.
 *
 * This is the mechanical half of session eviction (the decision half is
 * dsh-session-residency). Registered as the policy's ResidencyExecutor, it
 * calls Session.releaseCaches() on each selected session, dropping the events
 * snapshot, derived-message projection, and request-context fold while the
 * durable log stays resident. Every cache rebuilds lazily from the log, so a
 * released session is observationally identical: this reclaims heap without
 * touching durable history, the surface, or the store lifecycle.
 *
 * @module @deepseek-ai/dsh-session-residency-cache-release
 */

import { Context } from '@deepseek-ai/cordis'
// Type-only: resolve the sessions store and residency policy Context merges.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-residency'
import type { EvictionCandidate } from '@deepseek-ai/dsh-session-residency'

/** Cordis companion plugin name. */
export const name = 'session-residency-cache-release'
/** Services this executor needs: the store to resolve a session, the policy to register on. */
export const inject = ['sessions', 'sessionResidency']

/**
 * Register the cache-release executor on `ctx.sessionResidency`. Each eviction
 * resolves the candidate to a live session and releases its volatile caches;
 * an id that no longer resolves is a no-op (the session already left the store).
 * @param ctx - Cordis context carrying `ctx.sessions` and `ctx.sessionResidency`.
 */
export function apply(ctx: Context): void {
  const evict = (candidate: EvictionCandidate): void => {
    const session = ctx.sessions.get(candidate.id as never)
    if (session === undefined) return
    session.releaseCaches()
  }
  ctx.effect(() => ctx.sessionResidency.registerExecutor({ evict }), 'session-residency-cache-release: executor')
}
