/**
 * Log-tiering measurement: how much of a session's resident event log is COLD
 * (below the derivation surface) and could be tiered out to persistence.
 *
 * `deriveMessages()` only walks the surface nodes; every event below the lowest
 * surface node is cold — never re-derived unless a rare consumer (fork,
 * transcript export) faults it back. This module reports the cold-prefix size
 * (reclaimable) and the hot-tail size (must stay resident) from a session's
 * public surface, so a tiering policy can decide what to page out. It is a
 * pure, non-mutating measurement over the public log and surface.
 *
 * @module @deepseek-ai/dsh-memory-meter/log-tiering
 */

import { contentBytesOf } from './index.ts'

/** Minimal session shape a tiering estimate reads: the public log and surface. */
export interface TierableSession {
  readonly events: readonly unknown[]
  readonly surface: { readonly nodes: readonly number[] }
}

/** Cold/hot split of a session's resident log for tiering decisions. */
export interface LogTieringEstimate {
  /** Total events in the resident log. */
  readonly totalEvents: number
  /** Events below the lowest surface node — cold, tierable to persistence. */
  readonly coldEvents: number
  /** Events at or above the lowest surface node — the hot tail that stays resident. */
  readonly hotEvents: number
  /** Approximate serialized bytes of the cold prefix (the reclaimable amount). */
  readonly coldBytes: number
  /** Approximate serialized bytes of the hot tail (must stay resident). */
  readonly hotBytes: number
  /** The exclusive event index that splits cold from hot (== coldEvents). */
  readonly coldBoundary: number
}

/**
 * The lowest surface-node index — the boundary below which events are cold.
 * With no surface nodes the whole log is cold (nothing is derived).
 * @param session - the session to inspect.
 * @returns the exclusive cold boundary index into the event log.
 */
export function coldBoundaryOf(session: TierableSession): number {
  const nodes = session.surface.nodes
  if (nodes.length === 0) return session.events.length
  let min = nodes[0] as number
  for (const seq of nodes) if (seq < min) min = seq
  // Clamp into the log range; a surface node is always a valid log index.
  return min < 0 ? 0 : min > session.events.length ? session.events.length : min
}

/**
 * Estimate the cold/hot split of a session's resident log for tiering. Pure and
 * non-mutating: reads only the public events and surface.
 * @param session - the session to measure.
 * @returns the log-tiering estimate.
 */
export function estimateLogTiering(session: TierableSession): LogTieringEstimate {
  const events = session.events
  const boundary = coldBoundaryOf(session)
  let coldBytes = 0
  for (let i = 0; i < boundary; i++) coldBytes += contentBytesOf(events[i])
  let hotBytes = 0
  for (let i = boundary; i < events.length; i++) hotBytes += contentBytesOf(events[i])
  return {
    totalEvents: events.length,
    coldEvents: boundary,
    hotEvents: events.length - boundary,
    coldBytes,
    hotBytes,
    coldBoundary: boundary,
  }
}

/** One session's log-tiering accounting, tagged with its identifier. */
export interface SessionLogTieringEntry {
  /** The session identifier (stringified). */
  readonly id: string
  /** The session's log-tiering estimate. */
  readonly estimate: LogTieringEstimate
}

/** A store exposing tierable sessions. */
export interface LogTieringListing {
  list(): readonly (TierableSession & { readonly id: unknown })[]
}

/**
 * Rank every listed session by descending cold (tierable) bytes, so the
 * sessions holding the most pageable cold history come first.
 * @param store - a store exposing list().
 * @returns per-session tiering entries, costliest cold prefix first.
 */
export function reportLogTiering(store: LogTieringListing): readonly SessionLogTieringEntry[] {
  const entries = store.list().map(session => ({
    id: String(session.id),
    estimate: estimateLogTiering(session),
  }))
  entries.sort((a, b) => b.estimate.coldBytes - a.estimate.coldBytes)
  return entries
}
