/**
 * Chunk-retention measurement: how much resident heap a session's streaming
 * `assistant/chunk` runs would reclaim if packed with the shipped chunk-row
 * codec.
 *
 * Providers stream token-sized deltas, so a completed session holds hundreds of
 * near-identical `assistant/chunk` events whose JSON envelopes dwarf their
 * payloads (~56x measured on a real session). Persistence already packs those
 * runs for storage; this module reports the reclaimable size for the RESIDENT
 * log so a residency policy can rank sessions by chunk-retention cost. It is a
 * pure, non-mutating measurement: it packs a read-only copy and compares
 * serialized sizes, never touching the durable log.
 *
 * @module @deepseek-ai/dsh-memory-meter/chunk-reclaim
 */

import { packChunkRuns } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { contentBytesOf } from './index.ts'

/** Reclaimable-byte accounting for one session's chunk runs. */
export interface ChunkReclaimEstimate {
  /** Approximate serialized bytes of the events as they sit resident today. */
  readonly residentBytes: number
  /** Approximate serialized bytes after packing chunk runs to storage rows. */
  readonly packedBytes: number
  /** residentBytes - packedBytes: heap a pack would reclaim (never negative). */
  readonly reclaimableBytes: number
  /** Number of `assistant/chunk` events in the measured log. */
  readonly chunkEvents: number
}

/**
 * Count `assistant/chunk` events in an event log.
 * @param events - the events to scan.
 * @returns the number of assistant/chunk events.
 */
export function countChunkEvents(events: readonly SessionEvent[]): number {
  let count = 0
  for (const event of events) if (event.type === 'assistant/chunk') count++
  return count
}

/**
 * Estimate the resident heap a session would reclaim by packing its
 * `assistant/chunk` runs, using the shipped codec on a read-only copy. Pure and
 * non-mutating: it never alters the session or its log.
 * @param events - the session's event log (e.g. `session.events`).
 * @returns the reclaimable-byte accounting.
 */
export function estimateChunkReclaim(events: readonly SessionEvent[]): ChunkReclaimEstimate {
  const chunkEvents = countChunkEvents(events)
  // packChunkRuns is pure; measuring its output never mutates the log.
  const packed = packChunkRuns(events)
  let residentBytes = 0
  for (const event of events) residentBytes += contentBytesOf(event)
  let packedBytes = 0
  for (const record of packed) packedBytes += contentBytesOf(record)
  const reclaimableBytes = residentBytes > packedBytes ? residentBytes - packedBytes : 0
  return { residentBytes, packedBytes, reclaimableBytes, chunkEvents }
}

/** One session's chunk-reclaim accounting, tagged with its identifier. */
export interface SessionChunkReclaimEntry {
  /** The session identifier (stringified). */
  readonly id: string
  /** The session's chunk-reclaim accounting. */
  readonly estimate: ChunkReclaimEstimate
}

/** A store exposing sessions whose event logs can be measured. */
export interface ChunkReclaimListing {
  list(): readonly { readonly id: unknown; readonly events: readonly SessionEvent[] }[]
}

/**
 * Rank every listed session by descending reclaimable chunk bytes, so the
 * sessions holding the most packable streaming history come first.
 * @param store - a store exposing list().
 * @returns per-session chunk-reclaim entries, costliest first.
 */
export function reportChunkReclaim(store: ChunkReclaimListing): readonly SessionChunkReclaimEntry[] {
  const entries = store.list().map(session => ({
    id: String(session.id),
    estimate: estimateChunkReclaim(session.events),
  }))
  entries.sort((a, b) => b.estimate.reclaimableBytes - a.estimate.reclaimableBytes)
  return entries
}
