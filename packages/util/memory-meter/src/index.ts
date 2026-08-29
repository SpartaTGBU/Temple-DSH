/**
 * Zero-dependency memory-accounting primitive for the harness host.
 *
 * Estimates the approximate retained heap bytes of a session's in-memory
 * structures from its public event log, so telemetry and memory-pressure
 * responders can rank sessions by cost without reaching into private fields.
 * The estimate is a heuristic (JSON byte length plus a fixed per-event object
 * overhead), not an exact v8.getHeapStatistics() measurement: it is stable,
 * cheap, and monotonic in log size, which is what an eviction policy needs.
 *
 * @module @deepseek-ai/dsh-memory-meter
 */

/** Fixed per-event object bookkeeping added on top of serialized content. */
export const EVENT_OBJECT_OVERHEAD_BYTES = 64

/** Retained-byte accounting for one measured unit. */
export interface MemoryEstimate {
  /** Number of events (or items) measured. */
  readonly count: number
  /** Approximate serialized content bytes across the measured items. */
  readonly contentBytes: number
  /** Fixed per-item object overhead applied (count * EVENT_OBJECT_OVERHEAD_BYTES). */
  readonly overheadBytes: number
  /** Total approximate retained bytes (contentBytes + overheadBytes). */
  readonly retainedBytes: number
}

/** Anything exposing a readonly event array, e.g. a dsh Session. */
export interface EventBearing {
  readonly events: readonly unknown[]
}

/**
 * UTF-8 byte length of a string without allocating a Buffer when TextEncoder
 * is available; falls back to a code-unit-aware manual count.
 * @param text - the string to measure.
 * @returns the UTF-8 byte length.
 */
export function utf8ByteLength(text: string): number {
  const encoder = (globalThis as { TextEncoder?: new () => { encode(s: string): { length: number } } }).TextEncoder
  if (encoder !== undefined) return new encoder().encode(text).length
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++ }
    else bytes += 3
  }
  return bytes
}

/**
 * Approximate the serialized content bytes of one value.
 * A value that cannot be JSON-serialized (a cycle) contributes zero content
 * bytes rather than throwing; the fixed overhead still counts it.
 * @param value - the value to measure.
 * @returns the approximate serialized byte length, or 0 when unserializable.
 */
export function contentBytesOf(value: unknown): number {
  try {
    // JSON.stringify is typed to return string, but returns undefined at
    // runtime for undefined/function/symbol inputs; guard by runtime type.
    const json: string | undefined = JSON.stringify(value)
    return typeof json === 'string' ? utf8ByteLength(json) : 0
  }
  catch {
    return 0
  }
}

/**
 * Estimate the retained bytes of an ordered collection of events.
 * @param events - the events (or arbitrary serializable items) to measure.
 * @returns the retained-byte accounting for the collection.
 */
export function estimateEvents(events: readonly unknown[]): MemoryEstimate {
  let contentBytes = 0
  for (const event of events) contentBytes += contentBytesOf(event)
  const count = events.length
  const overheadBytes = count * EVENT_OBJECT_OVERHEAD_BYTES
  return { count, contentBytes, overheadBytes, retainedBytes: contentBytes + overheadBytes }
}

/**
 * Estimate the retained bytes of one event-bearing unit, such as a Session.
 * Reads only the public events surface, so it never depends on private
 * session internals.
 * @param unit - the event-bearing unit to measure.
 * @returns the retained-byte accounting for the unit's event log.
 */
export function estimateSessionMemory(unit: EventBearing): MemoryEstimate {
  return estimateEvents(unit.events)
}

/** One session's retained-byte accounting, tagged with its identifier. */
export interface SessionMemoryEntry {
  /** The session identifier (stringified). */
  readonly id: string
  /** The session's retained-byte accounting. */
  readonly estimate: MemoryEstimate
}

/** Aggregate retained-byte accounting across many sessions. */
export interface MemoryReport {
  /** Per-session accounting, sorted by descending retainedBytes. */
  readonly sessions: readonly SessionMemoryEntry[]
  /** Sum of every session's retainedBytes. */
  readonly totalRetainedBytes: number
  /** Total number of sessions measured. */
  readonly sessionCount: number
}

/** A store exposing its live sessions, e.g. dsh SessionStore via list(). */
export interface SessionListing {
  list(): readonly (EventBearing & { readonly id: unknown })[]
}

/**
 * Build a memory report across every session a store lists, ranked so the
 * costliest sessions (the first eviction candidates) come first.
 * @param store - a store exposing list().
 * @returns the aggregate memory report, sessions sorted by descending cost.
 */
export function reportSessionMemory(store: SessionListing): MemoryReport {
  const sessions = store.list().map(session => ({
    id: String(session.id),
    estimate: estimateSessionMemory(session),
  }))
  sessions.sort((a, b) => b.estimate.retainedBytes - a.estimate.retainedBytes)
  const totalRetainedBytes = sessions.reduce((sum, entry) => sum + entry.estimate.retainedBytes, 0)
  return { sessions, totalRetainedBytes, sessionCount: sessions.length }
}
