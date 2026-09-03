/** Provider-neutral automatic long-term memory capability seam. @module @deepseek-ai/dsh-memory */

import { Context, Service } from '@deepseek-ai/cordis'

/** Operational state of the configured memory backend. */
export type MemoryBackendState = 'ready' | 'starting' | 'degraded' | 'unavailable' | 'stopped'

/** Non-secret backend status for diagnostics and UI. */
export interface MemoryStatus {
  readonly state: MemoryBackendState
  readonly backend: string
  readonly detail?: string
  readonly pendingCaptures: number
  readonly workerStarts: number
}

/** One recalled memory fragment. */
export interface MemoryRecallItem {
  readonly text: string
  readonly drawerId?: string
  readonly wing?: string
  readonly room?: string
  readonly sourceFile?: string
  readonly distance?: number
}

/** Automatic recall request for one model turn. */
export interface MemoryRecallRequest {
  readonly sessionId: string
  readonly query: string
  readonly limit: number
  readonly maxBytes: number
}

/** Bounded recall result returned by a backend. */
export interface MemoryRecallResult {
  readonly backend: string
  readonly items: readonly MemoryRecallItem[]
  readonly truncated: boolean
}

/** One complete user/assistant exchange captured after a committed turn. */
export interface MemoryCaptureTurn {
  readonly sessionId: string
  readonly turn: number
  readonly userText: string
  readonly assistantText: string
  readonly completedAt: number
  readonly cwd?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryRuntime
  }
}

/**
 * Swappable long-term memory provider. Implementations own storage/process
 * lifecycle; consumers own when recall and capture occur.
 */
export abstract class MemoryRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  /**
   * Return non-secret backend health without starting model-facing work.
   * @returns the current backend state and queue counters.
   */
  abstract status(): MemoryStatus

  /**
   * Recall bounded background information for one turn.
   * @param request - session, query, item limit, and byte limit.
   * @param signal - optional cancellation for this recall.
   * @returns provider-neutral recalled fragments within the requested bounds.
   */
  abstract recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult>

  /**
   * Enqueue one completed turn for durable capture.
   * @param turn - completed direct-user and visible-assistant exchange.
   */
  abstract captureTurn(turn: MemoryCaptureTurn): Promise<void>

  /** Wait until every accepted capture reaches the backend. */
  abstract flush(): Promise<void>
}

export default MemoryRuntime
